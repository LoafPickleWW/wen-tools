/**
 * Vote Tool keeper: keeps read-only votes honest and settles finished votes, so voters never have
 * to come back.
 *
 * One pass over a vote (`keepVote`):
 *   Live, read-only mode (tokens held / NFT): re-read every ballot's wallet and recount the ones it
 *     no longer backs (tokens moved away, NFT transferred). Runs after every ballot cast on the site,
 *     so moving tokens to a second wallet and voting again is caught as soon as that vote lands.
 *   Ended: finalize → payout (or switch to refunds once the grace period passes) → release every
 *     ballot and NFT record (tokens + deposits go back to voters) → closeVote (creator's deposit back).
 *
 * Every step is an "anyone can call" contract method; the keeper only pays fees. Costs are capped
 * per pass, and work left over is picked up by the next pass. Voters and creators can always run
 * any step themselves from the vote page.
 *
 * Framework-agnostic: used by api/_keepers/vote.ts (served at /api/keeper?job=vote) and the tests.
 */

import algosdk from "algosdk";
import {
  MODE,
  STATUS,
  buildAction,
  buildClose,
  buildRecount,
  buildRecountNfts,
  buildRelease,
  buildReleaseNfts,
  getAlgod,
  getAssetBalance,
  getFactoryInfo,
  getVoteState,
  listBallots,
  listNftVotes,
  listRegistry,
  verifyVote,
  type VoteNetwork,
  type VoteState,
} from "./voteCore.js";
import { getCurrentRound } from "./wenpadSaleCore.js";

export interface KeeperSigner {
  addr: string;
  sign: (txns: algosdk.Transaction[]) => Uint8Array[];
}

export interface KeeperReport {
  appId: number;
  actions: string[];
  /** µALGO the keeper spent on fees this pass. */
  fees: number;
  /** Why the pass stopped early (fee cap, payout not deliverable yet…), if it did. */
  note?: string;
}

/** Most fees one pass spends (a release with refund is ~3 txn fees). Leftover work waits for the next pass. */
export const MAX_FEES_PER_PASS = 200_000;
/** Cron: recount live read-only votes that end within this many rounds (~1.5 h). */
export const END_WINDOW = 2_000;

const sum = (txns: algosdk.Transaction[]) => txns.reduce((n, t) => n + Number(t.fee), 0);

/** Read-only modes: ballots/pieces whose wallet no longer backs them. */
export async function findStale(network: VoteNetwork, state: VoteState) {
  if (state.mode === MODE.HELD) {
    const ballots = await listBallots(network, state.appId);
    const stale: string[] = [];
    for (const b of ballots) {
      const bal = (await getAssetBalance(network, b.voter, state.asset)) ?? 0n;
      if (bal / state.amountPerVote < b.weight) stale.push(b.voter);
    }
    return { voters: stale, pieces: [] as number[] };
  }
  if (state.mode === MODE.NFT) {
    const pieces: number[] = [];
    for (const n of await listNftVotes(network, state.appId)) {
      if (((await getAssetBalance(network, n.voter, n.assetId)) ?? 0n) === 0n) pieces.push(n.assetId);
    }
    return { voters: [] as string[], pieces };
  }
  return { voters: [] as string[], pieces: [] as number[] };
}

export async function keepVote(network: VoteNetwork, factoryId: number, keeper: KeeperSigner, appId: number): Promise<KeeperReport> {
  const algod = getAlgod(network);
  const report: KeeperReport = { appId, actions: [], fees: 0 };

  const send = async (label: string, txns: algosdk.Transaction[]) => {
    const fee = sum(txns);
    if (report.fees + fee > MAX_FEES_PER_PASS) {
      report.note = "fee cap reached; the next pass continues";
      return false;
    }
    await algod.sendRawTransaction(keeper.sign(txns)).do();
    await algosdk.waitForConfirmation(algod, txns[txns.length - 1].txID(), 6);
    report.fees += fee;
    report.actions.push(label);
    return true;
  };

  let state: VoteState;
  try {
    state = await getVoteState(network, appId);
  } catch (err: any) {
    // closeVote deletes the app: nothing left to do.
    if (/does not exist|404/i.test(String(err?.message || err))) {
      report.note = "vote closed";
      return report;
    }
    throw err;
  }
  // Only ever act on real votes from this factory (a look-alike app could burn keeper fees).
  if (!(await verifyVote(network, factoryId, state))) {
    report.note = "not a vote from this factory";
    return report;
  }
  const round = await getCurrentRound(network);

  if (state.status === STATUS.ACTIVE && round >= state.startRound && round <= state.endRound) {
    const { voters, pieces } = await findStale(network, state);
    for (const g of voters.length ? await buildRecount(network, appId, keeper.addr, voters) : []) {
      if (!(await send(`recount ${g.length} ballot(s)`, g))) return report;
    }
    for (const g of pieces.length ? await buildRecountNfts(network, appId, keeper.addr, pieces) : []) {
      if (!(await send(`recount ${g.length} piece(s)`, g))) return report;
    }
    return report;
  }

  if (state.status === STATUS.ACTIVE && round > state.endRound) {
    if (!(await send("finalize", await buildAction(network, appId, keeper.addr, "finalize")))) return report;
    state = await getVoteState(network, appId);
  }

  if (state.status !== STATUS.FINALIZED && state.status !== STATUS.CANCELLED) return report;

  if (state.payoutPending) {
    try {
      if (!(await send("payout", await buildAction(network, appId, keeper.addr, "payout")))) return report;
    } catch {
      // Target can't receive (not opted in). After the grace period, voters get refunds instead.
      if (round > state.endRound + state.payoutGrace) {
        if (!(await send("fallback to refunds", await buildAction(network, appId, keeper.addr, "fallbackToRefunds")))) return report;
      } else {
        report.note = "payout target can't receive yet; refunds unlock after the grace period";
        return report;
      }
    }
  }

  const ballots = await listBallots(network, appId);
  for (const g of ballots.length ? await buildRelease(network, appId, keeper.addr, ballots.map((b) => b.voter)) : []) {
    // A voter who opted out of the asset can't receive a refund; skip their group, others continue.
    try {
      if (!(await send(`release ${g.length} ballot(s)`, g))) return report;
    } catch (err: any) {
      report.note = `some releases failed: ${String(err?.message || err).slice(0, 120)}`;
    }
  }
  const nfts = await listNftVotes(network, appId);
  for (const g of nfts.length ? await buildReleaseNfts(network, appId, keeper.addr, nfts.map((n) => n.assetId)) : []) {
    if (!(await send(`release ${g.length} NFT record(s)`, g))) return report;
  }

  const [leftBallots, leftNfts] = await Promise.all([listBallots(network, appId), listNftVotes(network, appId)]);
  if (leftBallots.length === 0 && leftNfts.length === 0) {
    await send("close", await buildClose(network, factoryId, appId, keeper.addr));
  }
  return report;
}

/** Cron pass: every vote that needs attention (ending soon, ended, or finished but not closed). */
export async function keepAll(network: VoteNetwork, factoryId: number, keeper: KeeperSigner, maxVotes = 10) {
  const { registry } = await getFactoryInfo(network, factoryId);
  const round = await getCurrentRound(network);
  const due = (await listRegistry(network, registry)).filter((e) => {
    if (e.status === STATUS.CLOSED) return false;
    if (e.status !== STATUS.ACTIVE) return true; // finalized/cancelled, not closed yet
    if (round > e.endRound) return true;
    return e.mode !== MODE.ESCROW && round >= e.startRound && e.endRound - round <= END_WINDOW;
  });
  const reports: KeeperReport[] = [];
  for (const e of due.slice(0, maxVotes)) {
    try {
      reports.push(await keepVote(network, factoryId, keeper, e.appId));
    } catch (err: any) {
      reports.push({ appId: e.appId, actions: [], fees: 0, note: String(err?.message || err).slice(0, 200) });
    }
  }
  return reports;
}
