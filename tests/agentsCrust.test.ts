import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { NetworkId } from "@txnlab/use-wallet-react";
import {
  buildCreateListingTxns,
  buildDeactivateListingTxn,
  buildDeleteListingTxns,
  buildUpdateListingTxns,
  getAllListings,
} from "../src/utils/agentContract";
import { buildCrustPinAtomicTransactionComposer, getPrice, getRandomNode } from "../src/crust";
import { boxKey } from "./fakeChain";
import { ALICE, BOB, CAROL, algod, signerFor } from "./accounts";
import { b64, wire } from "./wire";

const FACTORY = 3565950332;
const enc = (s: string) => new TextEncoder().encode(s);
const abiStr = (s: string) => algosdk.ABIType.from("string").encode(s);
const kv = (k: string, v: { bytes?: Uint8Array; uint?: number }) => ({
  key: b64(enc(k)),
  value: v.bytes ? { type: 1, bytes: b64(v.bytes), uint: 0 } : { type: 2, bytes: "", uint: v.uint },
});

const listingParams = {
  name: "Wen Agent",
  description: "Does things",
  endpointUrl: "https://agent.example/api",
  priceAlgo: 0.25,
  category: "data",
  infoUrl: "https://agent.example",
};

describe("agentContract", () => {
  it("getAllListings decodes factory boxes and child global state", async () => {
    const boxName = new Uint8Array([...algosdk.decodeAddress(ALICE).publicKey, ...algosdk.encodeUint64(3)]);
    chain.addApp({ id: FACTORY, creator: BOB, boxes: { [boxKey(boxName)]: algosdk.encodeUint64(4444) } });
    chain.on("GET", /mainnet-idx\.algonode\.cloud\/v2\/applications\/3565950332\/boxes/, () => ({ boxes: [{ name: b64(boxName) }] }));
    chain.on("GET", /mainnet-idx\.algonode\.cloud\/v2\/applications\/4444$/, () => ({
      application: {
        id: 4444,
        params: {
          "global-state": [
            kv("name", { bytes: abiStr("Wen Agent") }),
            kv("description", { bytes: abiStr("Does things") }),
            kv("endpoint_url", { bytes: abiStr("https://agent.example/api") }),
            kv("category", { bytes: abiStr("data") }),
            kv("wallet_address", { bytes: algosdk.decodeAddress(ALICE).publicKey }),
            kv("price_algo", { uint: 250_000 }),
            kv("active", { uint: 1 }),
          ],
        },
      },
    }));
    expect(await getAllListings(NetworkId.MAINNET)).toMatchSnapshot();
  });

  it("builds create / update / deactivate / delete groups", async () => {
    chain.on("GET", /mainnet-idx\.algonode\.cloud\/v2\/applications\/3565950332$/, () => ({
      application: { id: FACTORY, params: { "global-state": [kv("next_nonce", { uint: 9 })] } },
    }));
    const decode = (blobs: Uint8Array[]) => blobs.map((b) => wire(algosdk.decodeUnsignedTransaction(b)));
    const create = decode(await buildCreateListingTxns(listingParams, ALICE, NetworkId.MAINNET));
    const update = decode(await buildUpdateListingTxns(4444, listingParams, ALICE, NetworkId.MAINNET));
    const deactivate = decode(await buildDeactivateListingTxn(4444, ALICE, NetworkId.MAINNET));
    const del = decode(await buildDeleteListingTxns(4444, 9, ALICE, NetworkId.MAINNET));
    expect(create.map((t) => t.fee)).toEqual(["int:1000", "int:4000"]);
    expect({ create, update, deactivate, del }).toMatchSnapshot();
  });
});

describe("crust", () => {
  function seedCrust() {
    chain.addApp({
      id: 1275319623,
      creator: CAROL,
      globalState: { base_price: 1_000_000, byte_price: 2_000, service_rate: 20, cru_price: 3_000_000, algo_price: 4_000 },
      boxes: { nodes: new Uint8Array([...algosdk.decodeAddress(BOB).publicKey, ...algosdk.decodeAddress(CAROL).publicKey]) },
    });
  }

  it("reads price and node from on-chain state", async () => {
    seedCrust();
    expect(await getPrice(algod(), 10_000)).toMatchSnapshot();
    expect(await getRandomNode(algod())).toBe(BOB);
  });

  it("builds pin order ATCs", async () => {
    seedCrust();
    const atcs = await buildCrustPinAtomicTransactionComposer(["bafycid1"], signerFor("alice"), ALICE, algod());
    const txns = atcs[0].buildGroup().map((t) => t.txn);
    expect(txns.map((t) => wire(t).type)).toEqual(["pay", "appl"]);
    expect(txns.map(wire)).toMatchSnapshot();
  });
});
