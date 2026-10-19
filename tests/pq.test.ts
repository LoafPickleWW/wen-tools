import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { decode as mpDecode } from "@msgpack/msgpack";
import {
  buildClaimTxn,
  buildPrintTxn,
  buildRegisterTxns,
  getPendingCoupons,
  getTopHolders,
  isOptedIn,
  type CouponDeployment,
} from "../src/utils/pqCoupon";
import { deriveNativePQAddress, nativePQFee, signNativePQTransaction, type NativePQAccount } from "../src/utils/pqNative";
import { algoAddressToCurve25519B64, extractSignatureBytes } from "../src/utils/deadDropCrypto";
import { checkIsPQAccount } from "../src/utils/pqDetection";
import { createAssetOptInTransactions } from "../src/utils/wallet";
import { FakeResponse, boxKey } from "./fakeChain";
import { ALICE, BOB, CAROL, algod, sk } from "./accounts";
import { b64, wire, wireRaw } from "./wire";

const DEPLOY: CouponDeployment = { appId: 774341440, assetId: 774341444 };

// Deterministic stand-in for a Falcon-1024 key (only its bytes matter for address + envelope).
const fakePk = Uint8Array.from({ length: 1793 }, (_, i) => (i * 31 + 7) % 256);
const toHex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const derived = deriveNativePQAddress(fakePk);
const PQ_ACCOUNT: NativePQAccount = { address: derived.address, publicKey: toHex(fakePk), secretKey: "00", salt: derived.salt };
const fakeSigner = async (msg: Uint8Array) => Uint8Array.from({ length: 1230 }, (_, i) => msg[i % msg.length] ^ i % 256);

async function sp() {
  return algod().getTransactionParams().do();
}

describe("pqCoupon", () => {
  it("builds register / print / claim with box refs", async () => {
    const params = await sp();
    const fee = nativePQFee(1000);
    const txns = [
      ...buildRegisterTxns(DEPLOY, PQ_ACCOUNT, BOB, params, fee),
      buildPrintTxn(DEPLOY, PQ_ACCOUNT.address, params, fee, new TextEncoder().encode("print #1")),
      buildClaimTxn(DEPLOY, PQ_ACCOUNT.address, BOB, params, fee * 3),
    ];
    expect(txns.map((t) => wire(t).fee)).toEqual(["int:3000", "int:3000", "int:3000", "int:9000"]);
    expect(txns.map(wire)).toMatchSnapshot();
  });

  it("getPendingCoupons: box value, 404 => null, other errors rethrow", async () => {
    const name = new Uint8Array([0x70, ...algosdk.decodeAddress(ALICE).publicKey]);
    const value = new Uint8Array(40);
    new DataView(value.buffer).setBigUint64(32, 42n);
    chain.addApp({ id: DEPLOY.appId, creator: BOB, boxes: { [boxKey(name)]: value } });
    expect(await getPendingCoupons(algod(), DEPLOY, ALICE)).toBe(42);
    expect(await getPendingCoupons(algod(), DEPLOY, BOB)).toBeNull();
    chain.on("GET", /\/box\?/, () => new FakeResponse(500, { message: "node is sad" }));
    await expect(getPendingCoupons(algod(), DEPLOY, ALICE)).rejects.toBeTruthy();
  });

  it("isOptedIn", async () => {
    chain.addAccount({ address: ALICE, assets: [{ id: DEPLOY.assetId, amount: 0 }] });
    expect(await isOptedIn(algod(), DEPLOY, ALICE)).toBe(true);
    expect(await isOptedIn(algod(), DEPLOY, BOB)).toBe(false);
  });

  it("getTopHolders pages through indexer balances", async () => {
    const appAddr = algosdk.getApplicationAddress(DEPLOY.appId).toString();
    let page = 0;
    chain.on("GET", /testnet-idx\.algonode\.cloud\/v2\/assets\/774341444\/balances/, (req) => {
      page++;
      if (!req.url.searchParams.get("next")) {
        return {
          balances: [
            { address: appAddr, amount: 10_000_000_000, deleted: false, "is-frozen": false },
            { address: ALICE, amount: 3_000_000, deleted: false, "is-frozen": false },
            { address: CAROL, amount: 9_000_000, deleted: true, "is-frozen": false },
          ],
          "current-round": 1,
          "next-token": "page2",
        };
      }
      return { balances: [{ address: BOB, amount: 5_500_000, deleted: false, "is-frozen": false }], "current-round": 1, "next-token": "page3" };
    });
    chain.on("GET", /next=page3/, () => ({ balances: [], "current-round": 1 }));
    const holders = await getTopHolders("testnet", DEPLOY);
    expect(page).toBe(2);
    expect(holders).toEqual([
      { address: BOB, amount: 5.5 },
      { address: ALICE, amount: 3 },
    ]);
  });
});

describe("pqNative", () => {
  it("derives a stable address", () => {
    expect(derived).toMatchSnapshot();
  });

  it("wraps a signature in a pqsig envelope over canonical txn bytes", async () => {
    const params = await sp();
    const txn = buildPrintTxn(DEPLOY, PQ_ACCOUNT.address, params, 3000, new TextEncoder().encode("hello"));
    const signed = await signNativePQTransaction(txn, PQ_ACCOUNT, fakeSigner);
    expect(signed.txID).toBe(txn.txID().toString());
    expect(signed.signatureBytes).toBe(1230);
    const raw = mpDecode(signed.blob) as any;
    expect(Object.keys(raw).sort()).toEqual(["pqsig", "txn"]);
    expect(raw.pqsig.sig).toEqual(await fakeSigner(txn.bytesToSign()));
    expect(b64(signed.blob)).toMatchSnapshot();
    expect(wireRaw(raw.txn)).toEqual((({ txID: _, ...rest }) => rest)(wire(txn)));
  });
});

describe("deadDropCrypto", () => {
  it("extracts signature bytes from decoded signed txns", async () => {
    // Build via app code (not the SDK directly) so this test is SDK-version independent.
    const [optIn] = await createAssetOptInTransactions([5], ALICE, algod());
    const blob = algosdk.signTransaction(optIn, sk("alice")).blob;
    const decoded = algosdk.decodeSignedTransaction(blob);
    const sig = extractSignatureBytes(decoded);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig!.length).toBe(64);
    expect(b64(sig!)).toBe(b64((mpDecode(blob) as any).sig));
    expect(extractSignatureBytes({ pqsig: { sig: new Uint8Array([9, 9]) } })).toEqual(new Uint8Array([9, 9]));
    expect(extractSignatureBytes({ msig: { v: 1, thr: 1, subsig: [{ pk: algosdk.decodeAddress(BOB).publicKey }] } })).toHaveLength(64);
    expect(extractSignatureBytes(null)).toBeNull();
  });

  it("algoAddressToCurve25519B64", () => {
    expect(algoAddressToCurve25519B64(ALICE)).toMatchSnapshot();
  });
});

describe("pqDetection", () => {
  it("counts PQ-signed txns sent by the address across networks", async () => {
    const note = btoa("PQSIG print");
    chain.on("GET", /mainnet-idx\.algonode\.cloud\/v2\/transactions/, () => ({
      "current-round": 1,
      transactions: [
        { id: "A", sender: ALICE, "tx-type": "pay", fee: 1000, "first-valid": 1, "last-valid": 2, note, "confirmed-round": 1 },
        { id: "B", sender: ALICE, "tx-type": "pay", fee: 1000, "first-valid": 1, "last-valid": 2, "confirmed-round": 1 },
        { id: "C", sender: BOB, "tx-type": "pay", fee: 1000, "first-valid": 1, "last-valid": 2, note, "confirmed-round": 1 },
      ],
    }));
    chain.on("GET", /testnet-idx\.algonode\.cloud\/v2\/transactions/, () => ({ "current-round": 1, transactions: [] }));
    const res = await checkIsPQAccount(ALICE, "mainnet", true);
    expect(res).toEqual({ isPQ: true, pqTxCount: 1, reason: "1 PQSIG transactions on mainnet" });
  });
});
