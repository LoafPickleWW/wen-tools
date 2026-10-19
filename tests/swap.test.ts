import { describe, expect, it } from "vitest";
import { buildSwapGroup, claimSwap, createShareTx, fetchSwapFromTxIds, getAccountAssets, type SwapItem } from "../src/utils/swap";
import { ALICE, BOB, signerFor } from "./accounts";
import { b64, wire, wireSigned } from "./wire";

function serveSharedNotes() {
  const byId = () => new Map(chain.sent.map((s) => [s.txID, s.raw.txn]));
  chain.on("GET", /mainnet-idx\.algonode\.cloud\/v2\/transactions\/[A-Z2-7]{52}$/, (req) => {
    const id = req.url.pathname.split("/").pop()!;
    const t = byId().get(id);
    return { transaction: { id, note: t?.note ? b64(t.note) : undefined, group: t?.grp ? b64(t.grp) : undefined }, "current-round": 1 };
  });
  chain.on("GET", /mainnet-idx\.algonode\.cloud\/v2\/transactions\?group-id=/, (req) => {
    const gid = req.url.searchParams.get("group-id");
    const txns = chain.sent
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.raw.txn.grp && b64(s.raw.txn.grp) === gid)
      .map(({ s, i }) => ({ id: s.txID, note: b64(s.raw.txn.note), "intra-round-offset": i }));
    return { transactions: txns.reverse(), "current-round": 1 };
  });
}

describe("swap", () => {
  it("build -> sign -> share -> fetch -> claim round trip", async () => {
    chain.on("GET", /mainnet-idx\.algonode\.cloud\/v2\/assets\/(\d+)/, () => ({
      asset: { index: 555, params: { name: "Wen NFT", decimals: 0, "unit-name": "WEN", url: "ipfs://x", reserve: BOB, total: 1, creator: BOB } },
      "current-round": 1,
    }));
    serveSharedNotes();

    const items: SwapItem[] = [
      { id: 0, sender: ALICE, receiver: BOB, assetId: null, amount: 2.5, txType: "pay" },
      { id: 1, sender: BOB, receiver: BOB, assetId: 555, amount: null, txType: "optin" },
      { id: 2, sender: ALICE, receiver: BOB, assetId: 555, amount: 1, txType: "axfer" },
      { id: 3, sender: BOB, receiver: ALICE, assetId: 1, amount: 1, txType: "pay" },
    ];
    const group = await buildSwapGroup(items);
    expect(group.map(wire)).toMatchSnapshot("group");

    // Alice signs her half; Bob's slots stay as unsigned bytes in the share blob.
    const aliceSigned = await signerFor("alice")(group, [0, 2]);
    const { encodeUnsignedTransaction } = await import("algosdk");
    const shareBlob = [aliceSigned[0], encodeUnsignedTransaction(group[1]), aliceSigned[1], encodeUnsignedTransaction(group[3])];
    const shareIds = await createShareTx(ALICE, shareBlob, signerFor("alice"));
    expect(shareIds.length).toBeGreaterThan(1);

    const decoded = await fetchSwapFromTxIds([shareIds[0].toString()]);
    expect(decoded.map((d) => ({ ...d, bytes: b64(d.bytes) }))).toMatchSnapshot("decoded");
    expect(decoded.map((d) => d.isSigned)).toEqual([true, false, true, false]);

    const before = chain.sent.length;
    const txId = await claimSwap(decoded, signerFor("bob"));
    const claimed = chain.sent.slice(before);
    expect(claimed).toHaveLength(4);
    expect(txId).toBe(group[0].txID().toString());
    expect(claimed.map((s) => wireSigned(s.bytes))).toMatchSnapshot("claimed");
  });

  it("getAccountAssets", async () => {
    chain.on("GET", /mainnet-idx\.algonode\.cloud\/v2\/accounts\/.*\/assets/, () => ({
      assets: [{ "asset-id": 7, amount: 1 }, { "asset-id": 8, amount: 0 }],
      "current-round": 1,
    }));
    expect([...(await getAccountAssets(ALICE))]).toEqual([7, 8]);
  });
});
