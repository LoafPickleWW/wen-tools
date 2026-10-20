import type { VercelRequest, VercelResponse } from "@vercel/node";
import algosdk from "algosdk";
import { keepAll, keepVote, type KeeperSigner } from "../../src/utils/voteKeeper.js";
import type { VoteNetwork } from "../../src/utils/voteCore.js";

/**
 * Vote Tool keeper (logic: src/utils/voteKeeper.ts).
 *
 * POST /api/keeper?job=vote { network, appId }   (old path /api/vote-keeper still works via a rewrite)
 *   Sent by the vote page after every ballot it submits, and when someone opens a vote that has
 *   ended. Live read-only votes: recount ballots whose wallets no longer back them. Ended votes:
 *   finalize, pay out, release every ballot, close.
 *
 * GET /api/keeper (Vercel cron, `Authorization: Bearer $CRON_SECRET`)
 *   Backstop for votes cast without the site: sweeps every vote ending soon, ended, or not closed.
 *
 * Safety: only acts on votes registered in the factory, caps fees per pass, and throttles POSTs
 * per vote. The keeper account only ever pays fees; every step is a method anyone may call.
 *
 * Env: KEEPER_MNEMONIC, CRON_SECRET, VOTE_FACTORY_APP_ID_{MAINNET,TESTNET}
 */

export const config = { maxDuration: 60 };

const FACTORY_IDS: Record<VoteNetwork, number> = {
  mainnet: Number(process.env.VOTE_FACTORY_APP_ID_MAINNET || process.env.VITE_VOTE_FACTORY_APP_ID_MAINNET || 3748290680),
  testnet: Number(process.env.VOTE_FACTORY_APP_ID_TESTNET || process.env.VITE_VOTE_FACTORY_APP_ID_TESTNET || 774611327),
};

/** One POST pass per vote per this many ms (per server instance). */
const THROTTLE_MS = 15_000;
const lastRun = new Map<string, number>();

function keeperSigner(): KeeperSigner | null {
  const mnemonic = process.env.KEEPER_MNEMONIC;
  if (!mnemonic) return null;
  const account = algosdk.mnemonicToSecretKey(mnemonic);
  return { addr: account.addr.toString(), sign: (txns) => txns.map((t) => t.signTxn(account.sk)) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const keeper = keeperSigner();
  if (!keeper) return res.status(503).json({ error: "Keeper not configured" });

  if (req.method === "GET") {
    if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const out: Record<string, unknown> = {};
    for (const network of ["testnet", "mainnet"] as VoteNetwork[]) {
      if (FACTORY_IDS[network]) out[network] = await keepAll(network, FACTORY_IDS[network], keeper);
    }
    return res.status(200).json(out);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
  const network: VoteNetwork = body.network === "testnet" ? "testnet" : "mainnet";
  const appId = Number(body.appId);
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "appId required" });
  const factoryId = FACTORY_IDS[network];
  if (!factoryId) return res.status(503).json({ error: `Vote Tool not deployed on ${network}` });

  const key = `${network}:${appId}`;
  const now = Date.now();
  if (now - (lastRun.get(key) ?? 0) < THROTTLE_MS) return res.status(202).json({ appId, note: "throttled" });
  lastRun.set(key, now);

  try {
    return res.status(200).json(await keepVote(network, factoryId, keeper, appId));
  } catch (err: any) {
    return res.status(500).json({ appId, error: String(err?.message || err).slice(0, 300) });
  }
}
