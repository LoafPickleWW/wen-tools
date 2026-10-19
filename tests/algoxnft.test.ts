import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import {
  ALGOXNFT_ADMIN,
  algoxCloseJob,
  buildAlgoxClosePlan,
  countClaimTxns,
  findAlgoxListings,
  isClosableAlgoxEscrow,
  nodeErrorMessage,
  signClaimJobs,
  simulateAlgoxClose,
  submitClaimJobs,
} from "../src/utils/algoxnft";
import { FakeResponse } from "./fakeChain";
import { ALICE, BOB, algod, sk } from "./accounts";
import { b64, wire, wireSigned } from "./wire";

const IDX = "https://mainnet-idx.algonode.cloud";

/** Minimal AlgoxNFT-shaped escrow: pays leftovers to the admin, closes the NFT to `seller`. */
function escrowProgram(seller: string) {
  return new Uint8Array([
    0x02, // version
    0x26, 0x02, // bytecblock, 2 constants
    0x20, ...algosdk.decodeAddress(ALGOXNFT_ADMIN).publicKey,
    0x20, ...algosdk.decodeAddress(seller).publicKey,
    0x33, 2, 9, 0x28, 0x12, // gtxn 2 CloseRemainderTo; bytec_0; ==
    0x33, 1, 21, 0x29, 0x12, // gtxn 1 AssetCloseTo; bytec_1; ==
    0x10, // &&
  ]);
}

const PROGRAM = escrowProgram(ALICE);
const ESCROW = new algosdk.LogicSigAccount(PROGRAM).address().toString();

describe("algoxnft", () => {
  it("recognizes closable escrows", () => {
    expect(isClosableAlgoxEscrow(PROGRAM, ESCROW, ALICE)).toBe(true);
    expect(isClosableAlgoxEscrow(PROGRAM, ESCROW, BOB)).toBe(false);
    expect(isClosableAlgoxEscrow(escrowProgram(BOB), ESCROW, BOB)).toBe(false);
  });

  it("findAlgoxListings discovers escrows still holding NFTs", async () => {
    chain.on("GET", /\/v2\/transactions\?address=/, (req) =>
      req.url.searchParams.get("currency-greater-than") === "249999"
        ? {
            transactions: [{ group: "g", "confirmed-round": 20_000_000, "payment-transaction": { receiver: ESCROW, amount: 250_000 } }],
            "current-round": 1,
          }
        : { transactions: [], "current-round": 1 }
    );
    chain.on("GET", new RegExp(`/v2/accounts/${ESCROW}/transactions`), () => ({
      transactions: [{ signature: { logicsig: { logic: b64(PROGRAM) } } }],
      "current-round": 1,
    }));
    chain.addAccount({ address: ESCROW, amount: 300_000, assets: [{ id: 777, amount: 1 }, { id: 778, amount: 0 }] });
    chain.addAccount({ address: ALICE, assets: [] });
    const listings = await findAlgoxListings(ALICE, algod(), IDX);
    expect(listings).toEqual([{ escrow: ESCROW, assetId: 777, program: PROGRAM, needsOptIn: true }]);
  });

  it("builds, simulates, signs and submits close jobs", async () => {
    const params = await algod().getTransactionParams().do();
    const listing = { escrow: ESCROW, assetId: 777, program: PROGRAM, needsOptIn: true };
    const plan = buildAlgoxClosePlan(listing, ALICE, params);
    expect({ optIn: wire(plan.optIn!), group: plan.group.map(wire) }).toMatchSnapshot("plan");

    chain.simulateHook = () => ({});
    expect(await simulateAlgoxClose(algod(), plan)).toEqual({ status: "ready" });
    chain.simulateHook = () => ({ failure: "transaction rejected by logic" });
    expect((await simulateAlgoxClose(algod(), plan)).status).toBe("rejected");
    expect(chain.simulated[0].map((s: any) => Object.keys(s).sort())).toEqual([["txn"], ["lsig", "txn"], ["lsig", "txn"]]);

    const job = algoxCloseJob(plan);
    expect(countClaimTxns([job])).toBe(4);
    const viaSk = await signClaimJobs([job], { sk: sk("alice") });
    const viaWallet = await signClaimJobs([algoxCloseJob(buildAlgoxClosePlan(listing, ALICE, params))], {
      signer: async (groups, idx) => {
        const flat = groups.flat();
        return flat.map((t, i) => (idx.includes(i) ? algosdk.signTransaction(t, sk("alice")).blob : null));
      },
    });
    expect(viaWallet).toEqual(viaSk);
    expect(viaSk[0].steps.map((s) => s.map(wireSigned))).toMatchSnapshot("signed");

    const results = await submitClaimJobs(algod(), viaSk);
    expect(results[0].error).toBeUndefined();
    expect(chain.sent).toHaveLength(4);
  });

  it("submitClaimJobs reports node errors per job", async () => {
    allowConsoleErrors();
    chain.on("POST", /\/v2\/transactions$/, () => new FakeResponse(400, { message: "TransactionPool.Remember: txn dead: round 5 outside of 6--1006" }));
    const params = await algod().getTransactionParams().do();
    const job = algoxCloseJob(buildAlgoxClosePlan({ escrow: ESCROW, assetId: 777, program: PROGRAM, needsOptIn: false }, ALICE, params));
    const signed = await signClaimJobs([job], { sk: sk("alice") });
    const [res] = await submitClaimJobs(algod(), signed);
    expect(res.error).toContain("txn dead");
  });

  it("nodeErrorMessage handles plain messages", () => {
    expect(nodeErrorMessage(new Error("Network request error. Received status 400 (Bad Request): overspend"))).toBe("overspend");
  });
});
