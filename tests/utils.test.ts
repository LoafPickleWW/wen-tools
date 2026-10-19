import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { NetworkId } from "@txnlab/use-wallet-react";
import {
  createAirdropTransactions,
  createAssetBurnTransactions,
  createAssetConfigArray,
  createAssetDeleteTransactions,
  createAssetMintArray,
  createAssetMintArrayV2,
  createAssetOptInTransactions,
  createAssetOptoutTransactions,
  createARC19AssetMintArrayV2,
  createARC3AssetMintArrayV2,
  createClawbackTransactions,
  createFreezeTransactions,
  createReserveAddressFromIpfsCid,
  getAssetCreatorWallet,
  getAssetDecimals,
  getAssetUrl,
  getBonfireAccountInfo,
  getParticipationStatusOfWallet,
  getTxnGroupFromATC,
  isAccountOptedIn,
  parseAlgodError,
  SignWithMnemonic,
  updateARC19AssetMintArrayV2,
  walletSign,
} from "../src/utils";
import { ALICE, BOB, CAROL, MNEMONICS, algod, signerFor } from "./accounts";
import { FakeResponse } from "./fakeChain";
import { wire, wireSigned } from "./wire";

const CID_V1 = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

function seedAssets() {
  chain
    .addAsset({ index: 31566704, creator: CAROL, name: "USDC", unitName: "USDC", decimals: 6, total: 18446744073709551615n, manager: CAROL, reserve: CAROL, url: "https://www.centre.io/usdc" })
    .addAsset({ index: 1000, creator: BOB, name: "Wen #1", unitName: "WEN1", decimals: 0, total: 1, url: "ipfs://x#arc3" });
}

describe("utils.ts transaction builders", () => {
  it("createAssetOptInTransactions groups opt-ins in chunks of 16", async () => {
    const ids = Array.from({ length: 18 }, (_, i) => 100 + i);
    const groups = await createAssetOptInTransactions(ids, ALICE, algod());
    expect(groups.map((g) => g.length)).toEqual([16, 2]);
    expect(groups.map((g) => g.map(wire))).toMatchSnapshot();
  });

  it("createAirdropTransactions builds ALGO and ASA transfers", async () => {
    chain.on("GET", /idx\.algonode\.cloud\/v2\/accounts\/.*\/assets/, () => ({ assets: [], "current-round": chain.round }));
    const txns = await createAirdropTransactions(
      [
        { receiver: BOB, asset_id: "1", amount: "1.5", note: "hello" },
        { receiver: CAROL, asset_id: "31566704", amount: "2.25" },
      ],
      { 31566704: 6 },
      ALICE,
      algod(),
      NetworkId.MAINNET
    );
    expect(txns).toHaveLength(2);
    expect(txns.map((t) => wire(t!))).toMatchSnapshot();
  });

  it("createClawbackTransactions sets revocation target", async () => {
    const groups = await createClawbackTransactions(
      [{ asset_id: "31566704", amount: "3", clawback_from: BOB, receiver: CAROL }],
      { 31566704: 6 },
      ALICE,
      algod()
    );
    expect(groups.flat().map(wire)).toMatchSnapshot();
  });

  it("createFreezeTransactions", async () => {
    const groups = await createFreezeTransactions(
      [
        { asset_id: "1000", frozen: "Y", wallet: BOB },
        { asset_id: "1000", frozen: "N ", wallet: CAROL },
      ],
      ALICE,
      algod()
    );
    expect(groups.flat().map(wire)).toMatchSnapshot();
  });

  it("createAssetOptoutTransactions closes to the creator", async () => {
    seedAssets();
    const groups = await createAssetOptoutTransactions([1000], ALICE, algod());
    expect(groups.flat()).toHaveLength(1);
    expect(groups.flat().map(wire)).toMatchSnapshot();
  });

  it("createAssetDeleteTransactions pairs destroy with a fee payment", async () => {
    const groups = await createAssetDeleteTransactions([1000, 1001], ALICE, algod());
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.map(wire))).toMatchSnapshot();
  });

  it("createAssetConfigArray", async () => {
    const groups = await createAssetConfigArray(
      [
        { asset_id: "1000", note: { standard: "arc69", description: "x" } },
        { asset_id: "1001", note: { standard: "arc69" }, freeze: BOB, clawback: CAROL },
      ],
      ALICE,
      algod()
    );
    expect(groups.map((g) => g.map(wire))).toMatchSnapshot();
  });

  const mintRow = {
    asset_name: "Wen Test #1",
    unit_name: "WT1",
    total_supply: "1",
    decimals: "0",
    has_freeze: "N",
    has_clawback: "Y",
    default_frozen: "N",
    asset_url: "ipfs://abc",
    asset_note: { standard: "arc69", properties: { a: 1 } },
  };

  it("createAssetMintArray", async () => {
    const groups = await createAssetMintArray([mintRow, { ...mintRow, total_supply: "1000", decimals: "2", has_freeze: "Y" }], ALICE, algod());
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.map(wire))).toMatchSnapshot();
  });

  it("createAssetMintArrayV2 with extra fee", async () => {
    const { atc } = await createAssetMintArrayV2([mintRow], ALICE, algod(), signerFor("alice"), [], 5000, BOB);
    const txns = getTxnGroupFromATC(atc);
    expect(txns).toHaveLength(3);
    expect(txns.map(wire)).toMatchSnapshot();
  });

  it("createARC3AssetMintArrayV2 via pinata", async () => {
    chain.on("POST", /api\.pinata\.cloud\/pinning\/pinFileToIPFS/, () => ({ IpfsHash: CID_V1 }));
    const { atc } = await createARC3AssetMintArrayV2(
      [{ ...mintRow, ipfs_data: { name: "Wen Test #1" } }],
      ALICE,
      algod(),
      signerFor("alice"),
      "pinata",
      "jwt-token"
    );
    const txns = getTxnGroupFromATC(atc);
    expect(txns).toHaveLength(2);
    expect(txns.map(wire)).toMatchSnapshot();
  });

  it("createARC19AssetMintArrayV2 via pinata", async () => {
    chain.on("POST", /api\.pinata\.cloud\/pinning/, () => ({ IpfsHash: CID_V1 }));
    const { atc } = await createARC19AssetMintArrayV2(
      [{ ...mintRow, ipfs_data: { name: "Wen Test #1" } }],
      ALICE,
      algod(),
      signerFor("alice"),
      "pinata",
      "jwt-token"
    );
    const txns = getTxnGroupFromATC(atc);
    expect(txns.length).toBeGreaterThan(0);
    expect(txns.map(wire)).toMatchSnapshot();
  });

  it("updateARC19AssetMintArrayV2 via pinata", async () => {
    chain.addAsset({ index: 1000, creator: ALICE, unitName: "WT1", url: "template-ipfs://{ipfscid:1:raw:reserve:sha2-256}", manager: ALICE, reserve: BOB });
    chain.on("POST", /api\.pinata\.cloud\/pinning/, () => ({ IpfsHash: CID_V1 }));
    const res: any = await updateARC19AssetMintArrayV2(
      [{ asset_id: 1000, ipfs_data: { name: "Updated" }, decimals: 0, freeze: "", clawback: "" }],
      ALICE,
      algod(),
      signerFor("alice"),
      "pinata",
      "jwt-token"
    );
    const txns = getTxnGroupFromATC(res.atc);
    expect(txns).toHaveLength(2);
    expect(txns.map(wire)).toMatchSnapshot();
  });

  it("createAssetBurnTransactions opts Bonfire in when needed", async () => {
    const bonfire = algosdk.getApplicationAddress(1257620981).toString();
    chain.addAccount({ address: bonfire, amount: 1_000_000, minBalance: 900_000, assets: [{ id: 31566704, amount: 0 }] });
    const groups = await createAssetBurnTransactions(
      [
        { id: 31566704, amountToBurn: 10, closeAsset: false },
        { id: 1000, amountToBurn: 1, closeAsset: true, totalSupply: 1 },
        { id: 1001, amountToBurn: 1, closeAsset: false, totalSupply: 1 },
      ],
      "mainnet",
      ALICE,
      algod()
    );
    expect(groups.map((g) => g.length)).toEqual([1, 2, 3]);
    expect(groups.map((g) => g.map(wire))).toMatchSnapshot();
  });
});

describe("utils.ts signing", () => {
  it("SignWithMnemonic and walletSign produce identical signed bytes", async () => {
    const groups = await createAssetOptInTransactions([1, 2, 3], ALICE, algod());
    const viaMnemonic = SignWithMnemonic(groups.flat(), MNEMONICS.alice);
    const viaWallet = await walletSign(groups, signerFor("alice"));
    const viaLedger = await walletSign(groups, signerFor("alice"), true);
    expect(viaWallet).toEqual(viaMnemonic);
    expect(viaLedger).toEqual(viaMnemonic);
    expect(viaMnemonic.map(wireSigned)).toMatchSnapshot();
  });
});

describe("utils.ts chain queries", () => {
  it("asset lookups", async () => {
    seedAssets();
    expect(await getAssetCreatorWallet(1000, algod())).toBe(BOB);
    expect(await getAssetDecimals(31566704, algod())).toBe(6);
    expect(await getAssetUrl(31566704, algod())).toBe("https://www.centre.io/usdc");
    allowConsoleErrors();
    expect(await getAssetCreatorWallet(424242, algod())).toBe("");
  });

  it("isAccountOptedIn", async () => {
    chain.addAccount({ address: ALICE, assets: [{ id: 5, amount: 3 }] });
    expect(await isAccountOptedIn(algod(), ALICE, 5)).toBe(true);
    expect(await isAccountOptedIn(algod(), ALICE, 6)).toBe(false);
  });

  it("getParticipationStatusOfWallet", async () => {
    chain.addAccount({ address: ALICE, amount: 5 });
    expect(await getParticipationStatusOfWallet(ALICE, algod())).toBe(false);
  });

  it("getBonfireAccountInfo returns the Bonfire account balance", async () => {
    const bonfire = algosdk.getApplicationAddress(1257620981).toString();
    chain.addAccount({ address: bonfire, amount: 1_234_567, minBalance: 200_000 });
    const info: any = await getBonfireAccountInfo("mainnet", algod());
    expect(Number(info.amount)).toBe(1_234_567);
    // algosdk v3 returns a typed Account (minBalance); v2 returned raw JSON (min-balance)
    expect(Number(info.minBalance ?? info["min-balance"])).toBe(200_000);
  });
});

describe("utils.ts pure helpers", () => {
  it("createReserveAddressFromIpfsCid", () => {
    expect(createReserveAddressFromIpfsCid(CID_V1)).toMatchSnapshot();
    expect(createReserveAddressFromIpfsCid(`${CID_V1}/meta.json`).assetURL).toContain("/meta.json");
  });

  it("parseAlgodError handles a real algod 400 from sendRawTransaction", async () => {
    chain.on("POST", /\/v2\/transactions$/, () => {
      return new FakeResponse(400, {
        message: "TransactionPool.Remember: transaction ABC: overspend (account X, data {_struct:{} Status:Offline})",
      });
    });
    const [txn] = (await createAssetOptInTransactions([1], ALICE, algod()))[0];
    const signed = SignWithMnemonic([txn], MNEMONICS.alice);
    let caught: any;
    try {
      await algod().sendRawTransaction(signed).do();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(parseAlgodError(caught)).toMatch(/Insufficient ALGO/);
  });

  it("parseAlgodError strips go struct dumps", () => {
    expect(
      parseAlgodError(new Error("TransactionPool.Remember: transaction ABC: logic eval error: assert failed pc=12 {_struct:{} Sig:[1 2]}"))
    ).toBe("logic eval error: assert failed pc=12");
  });
});
