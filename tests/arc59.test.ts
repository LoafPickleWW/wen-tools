import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { NetworkId } from "@txnlab/use-wallet-react";
import { createArc59GroupTxns, generateARC59ClaimTxns, getAssetsInAssetInbox } from "../src/arc59-helpers";
import { createAssetSendTransactions } from "../src/utils/wallet";
import { ALICE, BOB, CAROL, algod, signerFor } from "./accounts";
import { b64, plain, wire } from "./wire";

const ROUTER = 2449590623;
const RETURN_PREFIX = new Uint8Array([0x15, 0x1f, 0x7c, 0x75]);
const INBOX = algosdk.encodeAddress(new Uint8Array(32).fill(0xab));

const sel = (sig: string) => b64(algosdk.ABIMethod.fromSignature(sig).getSelector());
const SEND_INFO = sel("arc59_getSendAssetInfo(address,uint64)(uint64,uint64,bool,bool,uint64,uint64)");
const GET_INBOX = sel("arc59_getInbox(address)address");
const SEND_INFO_TYPE = algosdk.ABIType.from("(uint64,uint64,bool,bool,uint64,uint64)");
const ret = (bytes: Uint8Array) => new Uint8Array([...RETURN_PREFIX, ...bytes]);

/** Fake the router's readonly methods. `info` maps receiver -> getSendAssetInfo tuple. */
function fakeRouter(info: Record<string, [number, number, boolean, boolean, number, number]>, inbox = INBOX) {
  chain.addApp({ id: ROUTER, creator: CAROL });
  chain.simulateHook = (group) => ({
    txns: group.map((s) => {
      const args: Uint8Array[] = s.txn.apaa ?? [];
      if (!args.length) return {};
      const selector = b64(args[0]);
      if (selector === SEND_INFO) {
        const receiver = algosdk.encodeAddress(args[1]);
        return { logs: [ret(SEND_INFO_TYPE.encode(info[receiver]))] };
      }
      if (selector === GET_INBOX) return { logs: [ret(algosdk.decodeAddress(inbox).publicKey)] };
      return {};
    }),
  });
}

describe("arc59-helpers", () => {
  it("createArc59GroupTxns: direct send when opted in, router send otherwise", async () => {
    fakeRouter({
      [BOB]: [0, 0, true, true, 0, 0],
      [CAROL]: [2, 228_100, false, false, 201_000, 0],
    });
    const txns = await createAssetSendTransactions(
      [
        { index: 555, amount: 1, decimals: 0, receiver: BOB },
        { index: 556, amount: 1, decimals: 0, receiver: CAROL },
      ] as any,
      ALICE,
      algod()
    );
    const info = await createArc59GroupTxns(txns, { addr: ALICE, signer: signerFor("alice") }, ALICE, algod(), NetworkId.MAINNET);
    expect(info.atomicTxns).toHaveLength(2);
    expect(info.atomicTxns[0].buildGroup()).toHaveLength(1);
    const routed = info.atomicTxns[1].buildGroup().map((t) => t.txn);
    expect(routed.map((t) => wire(t).type)).toEqual(["pay", "appl", "axfer", "appl"]);
    expect(plain(info.logDataArray)).toMatchSnapshot("log");
    expect(info.grandTotal).toMatchSnapshot("total");
    expect(info.csv).toMatchSnapshot("csv");
    expect(routed.map(wire)).toMatchSnapshot("routed");
  });

  it("getAssetsInAssetInbox filters frozen/deleted/empty holdings", async () => {
    fakeRouter({});
    chain.on("GET", new RegExp(`mainnet-idx\\.algonode\\.cloud/v2/accounts/${INBOX}/assets`), (req) =>
      req.url.searchParams.get("next")
        ? { assets: [{ "asset-id": 3, amount: 1, "is-frozen": false, deleted: false }], "current-round": 1 }
        : {
            assets: [
              { "asset-id": 1, amount: 2, "is-frozen": false, deleted: false },
              { "asset-id": 2, amount: 1, "is-frozen": true, deleted: false },
              { "asset-id": 4, amount: 0, "is-frozen": false, deleted: false },
            ],
            "next-token": "n2",
            "current-round": 1,
          }
    );
    expect(await getAssetsInAssetInbox(BOB, algod(), NetworkId.MAINNET)).toEqual([
      { assetId: 1, amount: 2, type: "inbox" },
      { assetId: 3, amount: 1, type: "inbox" },
    ]);
  });

  it("generateARC59ClaimTxns adds an opt-in only when needed", async () => {
    fakeRouter({});
    chain.addAccount({ address: BOB, assets: [{ id: 555, amount: 0 }] });
    const opted = await generateARC59ClaimTxns(555n, BOB, algod(), NetworkId.MAINNET);
    const notOpted = await generateARC59ClaimTxns(556n, BOB, algod(), NetworkId.MAINNET);
    expect(opted.map((t) => wire(t).type)).toEqual(["appl"]);
    expect(notOpted.map((t) => wire(t).type)).toEqual(["axfer", "appl"]);
    expect({ opted: opted.map(wire), notOpted: notOpted.map(wire) }).toMatchSnapshot();
  });
});
