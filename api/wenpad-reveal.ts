import type { VercelRequest, VercelResponse } from "@vercel/node";
import algosdk from "algosdk";
import {
  buildQueueStep,
  getAlgod,
  getCommit,
  getSaleByApp,
  getSaleState,
  parseRevealedAsset,
  planCollect,
  planQueueUpTo,
  STATUS,
  waitForRound,
  type SaleNetwork,
} from "../src/utils/wenpadSaleCore.js";

/**
 * POST /api/wenpad-reveal { network, appId, commitId? }
 *
 * Keeper for WenPad random sales: waits for the commit's target round, then submits
 * reveal(commitId) from the keeper account so buyers only sign once. Commits resolve strictly in
 * order, so it first resolves any earlier pending commits (revealing them, or cancelling expired
 * ones). The keeper only holds
 * ALGO for fees and earns each commit's reveal bounty; it never holds creator keys.
 *
 * Afterwards (or when called without commitId) it closes the Shuffle if it has been released
 * with nothing pending, e.g. right after its last delivery: proceeds go to the payout split and
 * every deposit back to the collection wallet, so creators don't have to collect by hand.
 *
 * Safety: only acts on sale apps registered in the WenPad factory, caps the fees of each step
 * (a reveal normally costs less than its bounty, but one costly reveal must not stall the queue),
 * caps the steps per request, and caps what a close may cost.
 *
 * Env: KEEPER_MNEMONIC, WENPAD_SALE_FACTORY_APP_ID_{MAINNET,TESTNET}
 */

export const config = { maxDuration: 60 };

const FACTORY_IDS: Record<SaleNetwork, number> = {
  mainnet: Number(
    process.env.WENPAD_SALE_FACTORY_APP_ID_MAINNET || process.env.VITE_WENPAD_SALE_FACTORY_APP_ID_MAINNET || 3732791636
  ),
  testnet: Number(
    process.env.WENPAD_SALE_FACTORY_APP_ID_TESTNET || process.env.VITE_WENPAD_SALE_FACTORY_APP_ID_TESTNET || 773855125
  ),
};

const isPositiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

/** Most the keeper spends on fees for one reveal or cancel */
const MAX_STEP_FEE = 60_000;
/** Most queue steps resolved in one request (each waits for confirmation) */
const MAX_STEPS = 8;

/** Most the keeper spends on fees to close one Shuffle (a sold-out close is ~6 transactions) */
const MAX_CLOSE_FEE = 20_000;

/**
 * Close a released Shuffle with nothing pending. Only single-group closes (no large leftover
 * item list), so the keeper's cost stays bounded. Returns whether it closed.
 */
async function autoClose(network: SaleNetwork, factoryId: number, keeper: algosdk.Account, appId: number, saleId: number) {
  const state = await getSaleState(network, appId);
  if (state.status !== STATUS.RELEASED || state.pending > 0) return false;

  const steps = await planCollect(network, factoryId, keeper.addr, { appId, saleId });
  if (steps.length !== 1) return false;
  const txns = await steps[0]();
  if (txns.reduce((n, t) => n + Number(t.fee), 0) > MAX_CLOSE_FEE) return false;

  const algod = getAlgod(network);
  await algod.sendRawTransaction(txns.map((t) => t.signTxn(keeper.sk))).do();
  await algosdk.waitForConfirmation(algod, txns[txns.length - 1].txID(), 6);
  return true;
}

/** Best-effort close: a failure here never fails the reveal it follows. */
async function tryAutoClose(...args: Parameters<typeof autoClose>) {
  try {
    return await autoClose(...args);
  } catch (err) {
    console.error("wenpad auto-close error:", err);
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { network, appId, commitId: rawCommitId } = (req.body || {}) as Record<string, unknown>;
  if (network !== "mainnet" && network !== "testnet") return res.status(400).json({ error: "Invalid network" });
  if (!isPositiveInt(appId) || (rawCommitId !== undefined && !isPositiveInt(rawCommitId))) {
    return res.status(400).json({ error: "Invalid appId or commitId" });
  }
  // Omitted commitId = only close the Shuffle if it is finished
  const commitId = rawCommitId as number | undefined;

  const mnemonic = process.env.KEEPER_MNEMONIC;
  const factoryId = FACTORY_IDS[network];
  if (!mnemonic || !factoryId) return res.status(503).json({ error: "Keeper not configured" });

  try {
    const sale = await getSaleByApp(network, factoryId, appId);
    if (!sale) return res.status(404).json({ error: "Not a WenPad sale" });

    const keeper = algosdk.mnemonicToSecretKey(mnemonic);
    if (commitId === undefined) {
      return res.status(200).json({ closed: await tryAutoClose(network, factoryId, keeper, appId, sale.saleId) });
    }

    const commit = await getCommit(network, appId, commitId);
    if (!commit) return res.status(404).json({ error: "Commit not found (already revealed or cancelled)" });

    const algod = getAlgod(network);
    await waitForRound(algod, commit.targetRound, 20_000);

    // Resolve the queue up to this commit, in order
    const steps = await planQueueUpTo(network, appId, commitId);
    if (steps.length > MAX_STEPS) {
      return res.status(429).json({ error: "Too many earlier mints are pending; try again shortly" });
    }
    let result: { txId: string; assetId: number } | null = null;
    for (const step of steps) {
      await waitForRound(algod, step.targetRound, 20_000);
      const txns = await buildQueueStep(network, keeper.addr, appId, step);
      if (txns.reduce((n, t) => n + Number(t.fee), 0) > MAX_STEP_FEE) {
        return res.status(402).json({ error: "Reveal fees too high for the keeper; reveal from your own wallet" });
      }
      await algod.sendRawTransaction(txns.map((t) => t.signTxn(keeper.sk))).do();
      const last = txns[txns.length - 1];
      const confirmation = await algosdk.waitForConfirmation(algod, last.txID(), 6);
      if (step.commitId === commitId) {
        result = { txId: last.txID(), assetId: parseRevealedAsset(confirmation.logs)?.assetId ?? 0 };
      }
    }
    if (!result) return res.status(404).json({ error: "Commit not found (already revealed or cancelled)" });

    const closed = await tryAutoClose(network, factoryId, keeper, appId, sale.saleId);

    return res.status(200).json({ ...result, closed });
  } catch (err: any) {
    console.error("wenpad-reveal error:", err);
    return res.status(500).json({ error: err?.message || "Reveal failed" });
  }
}
