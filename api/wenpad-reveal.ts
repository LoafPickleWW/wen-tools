import type { VercelRequest, VercelResponse } from "@vercel/node";
import algosdk from "algosdk";
import {
  buildReveal,
  getAlgod,
  getCommit,
  getSaleByApp,
  parseRevealedAsset,
  waitForRound,
  type SaleNetwork,
} from "../src/utils/wenpadSaleCore";

/**
 * POST /api/wenpad-reveal { network, appId, commitId }
 *
 * Keeper for WenPad random sales: waits for the commit's target round, then submits
 * reveal(commitId) from the keeper account so buyers only sign once. The keeper only holds
 * ALGO for fees and earns each commit's reveal bounty; it never holds creator keys.
 *
 * Safety: only reveals for sale apps registered in the WenPad factory, and only when the
 * pooled fees are covered by the commit's reveal bounty.
 *
 * Env: KEEPER_MNEMONIC, WENPAD_SALE_FACTORY_APP_ID_{MAINNET,TESTNET}
 */

export const config = { maxDuration: 30 };

const FACTORY_IDS: Record<SaleNetwork, number> = {
  mainnet: Number(
    process.env.WENPAD_SALE_FACTORY_APP_ID_MAINNET || process.env.VITE_WENPAD_SALE_FACTORY_APP_ID_MAINNET || 3732147516
  ),
  testnet: Number(
    process.env.WENPAD_SALE_FACTORY_APP_ID_TESTNET || process.env.VITE_WENPAD_SALE_FACTORY_APP_ID_TESTNET || 773809724
  ),
};

const isPositiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { network, appId, commitId } = (req.body || {}) as Record<string, unknown>;
  if (network !== "mainnet" && network !== "testnet") return res.status(400).json({ error: "Invalid network" });
  if (!isPositiveInt(appId) || !isPositiveInt(commitId)) return res.status(400).json({ error: "Invalid appId or commitId" });

  const mnemonic = process.env.KEEPER_MNEMONIC;
  const factoryId = FACTORY_IDS[network];
  if (!mnemonic || !factoryId) return res.status(503).json({ error: "Keeper not configured" });

  try {
    const sale = await getSaleByApp(network, factoryId, appId);
    if (!sale) return res.status(404).json({ error: "Not a WenPad sale" });

    const commit = await getCommit(network, appId, commitId);
    if (!commit) return res.status(404).json({ error: "Commit not found (already revealed or cancelled)" });

    const algod = getAlgod(network);
    await waitForRound(algod, commit.targetRound, 20_000);

    const keeper = algosdk.mnemonicToSecretKey(mnemonic);
    const txns = await buildReveal(network, keeper.addr, appId, commitId);

    const totalFee = txns.reduce((n, t) => n + Number(t.fee), 0);
    if (totalFee > commit.revealFee) {
      return res.status(402).json({ error: "Reveal fees exceed the bounty; reveal from your own wallet" });
    }

    const signed = txns.map((t) => t.signTxn(keeper.sk));
    await algod.sendRawTransaction(signed).do();
    const revealTxn = txns[txns.length - 1];
    const confirmation = await algosdk.waitForConfirmation(algod, revealTxn.txID(), 6);
    const revealed = parseRevealedAsset(confirmation.logs);

    return res.status(200).json({ txId: revealTxn.txID(), assetId: revealed?.assetId ?? 0 });
  } catch (err: any) {
    console.error("wenpad-reveal error:", err);
    return res.status(500).json({ error: err?.message || "Reveal failed" });
  }
}
