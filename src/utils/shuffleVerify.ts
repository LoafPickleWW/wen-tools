/**
 * Shuffle contract source + on-chain verification.
 *
 * The page bundles the exact contract source and its compiled TEAL (contracts/), compiles the
 * TEAL with an Algorand node, and compares the bytecode with what is deployed on-chain. Anyone can
 * repeat this independently: compile contracts/WenPadSale.algo.ts with TEALScript 0.107.2.
 */

import algosdk from "algosdk";
import contractSource from "../../contracts/WenPadSale.algo.ts?raw";
import saleApprovalTeal from "../../contracts/build/WenPadSale.approval.teal?raw";
import saleClearTeal from "../../contracts/build/WenPadSale.clear.teal?raw";
import factoryApprovalTeal from "../../contracts/build/WenPadSaleFactory.approval.teal?raw";
import { getAlgod, type SaleNetwork } from "./wenpadSaleCore";

export const SHUFFLE_CONTRACT_SOURCE = contractSource;
export const SHUFFLE_TEALSCRIPT_VERSION = "0.107.2";

const compile = async (algod: algosdk.Algodv2, teal: string) =>
  new Uint8Array(Buffer.from((await algod.compile(teal).do()).result, "base64"));

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

let compiled: Promise<{ sale: Uint8Array; factory: Uint8Array }> | null = null;

/** Compile the bundled TEAL (the factory embeds the sale program, as the deploy script does). */
function compiledPrograms(network: SaleNetwork) {
  if (!compiled) {
    compiled = (async () => {
      const algod = getAlgod(network);
      const sale = await compile(algod, saleApprovalTeal);
      const clear = await compile(algod, saleClearTeal);
      const factoryTeal = factoryApprovalTeal
        .replace("PENDING_COMPILE_APPROVAL: WenPadSale", `byte base64(${Buffer.from(sale).toString("base64")})`)
        .replace("PENDING_COMPILE_CLEAR: WenPadSale", `byte base64(${Buffer.from(clear).toString("base64")})`);
      return { sale, factory: await compile(algod, factoryTeal) };
    })().catch((err) => {
      compiled = null;
      throw err;
    });
  }
  return compiled;
}

async function onChainApproval(network: SaleNetwork, appId: number) {
  const app = await getAlgod(network).getApplicationByID(appId).do();
  return new Uint8Array(Buffer.from(app.params["approval-program"], "base64"));
}

/** Does the deployed factory run exactly the published source? */
export async function verifyFactory(network: SaleNetwork, factoryId: number): Promise<boolean> {
  const [{ factory }, deployed] = await Promise.all([compiledPrograms(network), onChainApproval(network, factoryId)]);
  return equalBytes(factory, deployed);
}

/** Does a Shuffle app run exactly the published sale program? */
export async function verifySaleApp(network: SaleNetwork, appId: number): Promise<boolean> {
  const [{ sale }, deployed] = await Promise.all([compiledPrograms(network), onChainApproval(network, appId)]);
  return equalBytes(sale, deployed);
}
