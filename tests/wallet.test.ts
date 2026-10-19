import { describe, expect, it } from "vitest";
import {
  createAssetDestroyTransactions,
  createAssetOptInTransactions,
  createAssetOptoutTransactions,
  createAssetSendTransactions,
  createAssetTransferTransactions,
  createDeletedAssetOptoutTransactions,
  getAccountData,
  sendSignedTransaction,
} from "../src/utils/wallet";
import { SignWithMnemonic } from "../src/utils";
import { ALGOD_URL, ALICE, BOB, CAROL, MNEMONICS, algod } from "./accounts";
import { wire } from "./wire";

const IDX = "https://mainnet-idx.algonode.cloud";

const indexerAsset = (index: number, creator: string) => ({
  asset: { index, deleted: false, "created-at-round": 1, params: { creator, decimals: 0, total: 1, "unit-name": "X", name: "X" } },
  "current-round": 1,
});

describe("wallet.ts builders", () => {
  it("opt-in / deleted opt-out", async () => {
    const optIn = await createAssetOptInTransactions([10, 11], ALICE, algod());
    const optOut = await createDeletedAssetOptoutTransactions([12], ALICE, algod());
    expect([...optIn, ...optOut].map(wire)).toMatchSnapshot();
  });

  it("opt-out and destroy resolve the creator via indexer", async () => {
    chain.on("GET", /idx\.algonode\.cloud\/v2\/assets\/(\d+)/, (req) => {
      const id = Number(req.url.pathname.split("/").pop());
      return indexerAsset(id, id === 20 ? BOB : CAROL);
    });
    const optOut = await createAssetOptoutTransactions([20, 21], ALICE, algod(), IDX);
    const destroy = await createAssetDestroyTransactions([20], ALICE, algod(), IDX);
    expect(optOut).toHaveLength(2);
    expect(destroy).toHaveLength(1);
    expect([...optOut, ...destroy].map(wire)).toMatchSnapshot();
  });

  it("send and transfer (opt-in + send pairs)", async () => {
    const assets: any[] = [
      { index: 30, amount: 2, decimals: 0, receiver: BOB },
      { index: 31, amount: 1.5, decimals: 2, receiver: CAROL },
    ];
    const send = await createAssetSendTransactions(assets, ALICE, algod());
    const transfer = await createAssetTransferTransactions(assets, ALICE, algod());
    expect(send.map(wire)).toMatchSnapshot();
    expect(transfer.map((g) => g.map(wire))).toMatchSnapshot();
  });

  it("rejects empty selections", async () => {
    await expect(createAssetOptInTransactions([], ALICE, algod())).rejects.toThrow(/select an asset/);
  });
});

describe("wallet.ts network", () => {
  it("getAccountData reads raw algod JSON", async () => {
    chain.addAccount({ address: ALICE, amount: 7_000_000 });
    const data = await getAccountData(ALICE, ALGOD_URL);
    expect(data.amount).toBe(7_000_000);
    expect((data as any)["min-balance"]).toBe(100_000);
  });

  it("sendSignedTransaction submits and waits for confirmation", async () => {
    const txns = await createAssetOptInTransactions([10], ALICE, algod());
    const signed = SignWithMnemonic(txns, MNEMONICS.alice);
    const txId = await sendSignedTransaction(signed, algod());
    expect(txId).toBe(txns[0].txID().toString());
    expect(chain.sent).toHaveLength(1);
    expect(chain.requests.some((r) => r.includes(`/v2/transactions/pending/${txId}`))).toBe(true);
  });
});
