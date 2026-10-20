import * as algosdk from "algosdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { createAssetOptInTransactions } from "../src/utils/wallet";
import { boxKey } from "./fakeChain";
import { ALICE, BOB, CAROL, MNEMONICS, algod, sk } from "./accounts";
import { b64, wireSigned } from "./wire";

// ---- Redis stand-in for api/deaddrop -------------------------------------------------------
const redisStore = new Map<string, string>();
vi.mock("redis", () => ({
  createClient: () => ({
    on: () => {},
    connect: async () => {},
    disconnect: async () => {},
    set: async (k: string, v: string) => void redisStore.set(k, v),
    get: async (k: string) => redisStore.get(k) ?? null,
    del: async (k: string) => void redisStore.delete(k),
    keys: async (pattern: string) => [...redisStore.keys()].filter((k) => k.startsWith(pattern.replace("*", ""))),
  }),
}));

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => ((res.headers[k] = v), res);
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.end = () => res;
  return res;
}

const envBackup = { ...process.env };
beforeEach(() => {
  redisStore.clear();
});
afterEach(() => {
  process.env = { ...envBackup };
});

describe("api/deaddrop", () => {
  async function authQuery(signer: "alice" | "bob") {
    const [txn] = await createAssetOptInTransactions([1], ALICE, algod());
    const blob = algosdk.signTransaction(txn, sk(signer)).blob;
    return { address: ALICE, sig: "x", txn: Buffer.from(blob).toString("base64") };
  }

  it("verifies the signer against the indexer and burns drops on read", async () => {
    process.env.REDIS_URL = "redis://fake";
    const { default: handler } = await import("../api/deaddrop");
    chain.on("GET", new RegExp(`idx\\.algonode\\.cloud/v2/accounts/${ALICE}`), () => ({
      account: { address: ALICE, amount: 0, "amount-without-pending-rewards": 0, "min-balance": 0, "pending-rewards": 0, rewards: 0, round: 1, status: "Offline", "total-apps-opted-in": 0, "total-assets-opted-in": 0, "total-created-apps": 0, "total-created-assets": 0, "total-box-bytes": 0, "total-boxes": 0 },
      "current-round": 1,
    }));
    redisStore.set(`dd:${ALICE}:1`, JSON.stringify({ msg: "secret", recipient: ALICE }));

    const res = mockRes();
    await handler({ method: "GET", query: await authQuery("alice"), body: {} } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ drops: [{ msg: "secret", recipient: ALICE }] });
    expect(redisStore.size).toBe(0);
  });

  it("rejects a signature that does not verify", async () => {
    allowConsoleErrors();
    process.env.REDIS_URL = "redis://fake";
    const { default: handler } = await import("../api/deaddrop");
    chain.on("GET", new RegExp(`idx\\.algonode\\.cloud/v2/accounts/${ALICE}`), () => ({
      account: { address: ALICE, "auth-addr": CAROL, amount: 0, "amount-without-pending-rewards": 0, "min-balance": 0, "pending-rewards": 0, rewards: 0, round: 1, status: "Offline", "total-apps-opted-in": 0, "total-assets-opted-in": 0, "total-created-apps": 0, "total-created-assets": 0, "total-box-bytes": 0, "total-boxes": 0 },
      "current-round": 1,
    }));
    const res = mockRes();
    // Signed by Bob's key for Alice's txn: the ed25519 check itself fails.
    await handler({ method: "GET", query: await authQuery("bob"), body: {} } as any, res);
    expect(res.statusCode).toBe(401);
  });

  it("KNOWN ISSUE (pre-existing): a rekeyed account's original key still passes", async () => {
    // The auth-addr mismatch is thrown inside the indexer try/catch, whose fallback only checks
    // signer === address, so Alice's old key is accepted even though Alice is rekeyed to Carol.
    // Pinned here so the SDK upgrade doesn't silently change it; fix separately.
    process.env.REDIS_URL = "redis://fake";
    const { default: handler } = await import("../api/deaddrop");
    chain.on("GET", new RegExp(`idx\\.algonode\\.cloud/v2/accounts/${ALICE}`), () => ({
      account: { address: ALICE, "auth-addr": CAROL, amount: 0, "amount-without-pending-rewards": 0, "min-balance": 0, "pending-rewards": 0, rewards: 0, round: 1, status: "Offline", "total-apps-opted-in": 0, "total-assets-opted-in": 0, "total-created-apps": 0, "total-created-assets": 0, "total-box-bytes": 0, "total-boxes": 0 },
      "current-round": 1,
    }));
    const res = mockRes();
    await handler({ method: "GET", query: await authQuery("alice"), body: {} } as any, res);
    expect(res.statusCode).toBe(200);
  });
});

describe("api/wenpad-reveal (keeper)", () => {
  const FACTORY = 3732791636;
  const SALE = 2001;
  const u64 = (n: number) => algosdk.encodeUint64(n);
  const pre = (s: string, n: number) => new Uint8Array([...new TextEncoder().encode(s), ...u64(n)]);
  const RECORD = algosdk.ABIType.from("(uint64,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64)");
  const META = algosdk.ABIType.from("(string,string,string,string)");
  const COMMIT = algosdk.ABIType.from("(address,uint64,uint64,uint64,uint64,uint64)");
  const REVEALED = algosdk.ABIType.from("(uint64,address,uint64,uint64)");
  const SEL = sha512_256(new TextEncoder().encode("Revealed(uint64,address,uint64,uint64)")).slice(0, 4);

  function seed(status: number, pending: number) {
    chain.addApp({
      id: FACTORY,
      creator: ALICE,
      boxes: {
        [boxKey(pre("s", 7))]: RECORD.encode([SALE, ALICE, BOB, CAROL, 1, 1, 9e6, 3, 1, status, 1, 1]),
        [boxKey(pre("m", 7))]: META.encode(["Wen", "W", "arc3", ""]),
      },
    });
    chain.addApp({
      id: SALE,
      creator: algosdk.getApplicationAddress(FACTORY).toString(),
      globalState: { sale_id: 7, factory: FACTORY, status, pending, next_reveal: 14, price: 1, reveal_fee: 20_000, delivery_budget: 400_000 },
      boxes: { [boxKey(pre("c", 14))]: COMMIT.encode([BOB, chain.round - 5, 1, 20_000, 400_000, 31_700]) },
    });
    chain.simulateHook = (group) => ({ txns: group.map((s) => ({ inner: s.txn.type === "appl" ? 2 : 0 })) });
  }

  it("reveals the commit as the keeper and returns the delivered asset", async () => {
    process.env.KEEPER_MNEMONIC = MNEMONICS.carol;
    const { default: handler } = await import("../api/_keepers/wenpad-reveal");
    seed(1, 1);
    chain.confirmHook = (s) => (s.raw.txn.type === "appl" ? { logs: [new Uint8Array([...SEL, ...REVEALED.encode([14, BOB, 9001, 0])])] } : {});
    const res = mockRes();
    await handler({ method: "POST", body: { network: "mainnet", appId: SALE, commitId: 14 } } as any, res);
    expect(res.body).toMatchObject({ assetId: 9001, closed: false });
    expect(res.statusCode).toBe(200);
    expect(chain.sent.map((s) => wireSigned(s.bytes))).toMatchSnapshot();
  });

  it("auto-closes a released sale with nothing pending", async () => {
    process.env.KEEPER_MNEMONIC = MNEMONICS.carol;
    const { default: handler } = await import("../api/_keepers/wenpad-reveal");
    seed(3, 0);
    chain.simulateHook = (group) => ({ txns: group.map(() => ({ inner: 0 })) });
    const res = mockRes();
    await handler({ method: "POST", body: { network: "mainnet", appId: SALE } } as any, res);
    expect(res.body).toEqual({ closed: true });
    expect(chain.sent).toHaveLength(1);
    expect(b64(chain.sent[0].raw.txn.snd)).toBe(b64(algosdk.decodeAddress(CAROL).publicKey));
  });

  it("validates input", async () => {
    const { default: handler } = await import("../api/_keepers/wenpad-reveal");
    const res = mockRes();
    await handler({ method: "POST", body: { network: "betanet", appId: 1 } } as any, res);
    expect(res.statusCode).toBe(400);
  });
});

describe("api/keeper (merged keeper function)", () => {
  it("routes ?job= to the Shuffle and Vote keepers, and GET without a job to the vote cron", async () => {
    process.env.KEEPER_MNEMONIC = MNEMONICS.carol;
    delete process.env.CRON_SECRET;
    const { default: handler } = await import("../api/keeper");

    // Vote job, bad input → the vote keeper's own validation answers
    let res = mockRes();
    await handler({ method: "POST", query: { job: "vote" }, body: { network: "testnet" } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "appId required" });

    // GET with no job = the cron sweep, which needs CRON_SECRET
    res = mockRes();
    await handler({ method: "GET", query: {}, headers: {} } as any, res);
    expect(res.statusCode).toBe(401);

    // Shuffle job → the wenpad keeper (it only accepts POST)
    res = mockRes();
    await handler({ method: "GET", query: { job: "wenpad" }, headers: {} } as any, res);
    expect(res.statusCode).toBe(405);

    res = mockRes();
    await handler({ method: "POST", query: { job: "nope" } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Unknown keeper job" });
  });
});
