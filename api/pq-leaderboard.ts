import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "redis";

/**
 * Post-Quantum Transaction Leaderboard
 *
 * Counts transactions authorized by post-quantum signatures, per chain:
 *  - QRL: every transaction is XMSS-signed except the one coinbase per block,
 *    so PQ txns = all txns − coinbase. Per-type counts come from block headers.
 *  - Algorand: transactions carrying a native `pqsig` (Falcon-1024) envelope,
 *    live since consensus v42 (round 64,318,659).
 *
 * Totals start from one-time backfilled baselines and advance incrementally
 * from a cursor stored in Redis, so each request only scans new blocks.
 */

const ZEUS = "https://zeus-proxy.automated.theqrl.org/grpc/mainnet";
const ALGO_INDEXER = "https://mainnet-idx.algonode.cloud";

/** QRL transaction type tag for coinbase in header transaction counts. */
const QRL_COINBASE_TYPE = "2";
/** QRL is proof-of-work: only count blocks this deep, so reorgs can't double count. */
const QRL_CONFIRMATIONS = 10;
/** Blocks per header request (max 100 returned) and padding on each side of it. */
const QRL_CHUNK = 90;
const QRL_SLACK = 5;

// One-time backfill snapshots (inclusive of the given height/round).
// QRL: non-coinbase txns in blocks 1..4,380,664 (genesis allocations in block 0 excluded).
const QRL_BASELINE = { height: 4_380_664, pqTxs: 1_968_668 };
const ALGO_BASELINE = { round: 66_012_077, pqTxs: 1_602_448 };

/** Per-request work budgets, to stay well within the function timeout. */
const QRL_MAX_CHUNKS = 5; // × 90 blocks
const ALGO_MAX_PAGES = 12; // × 1000 txns
/** Round span per indexer query; the pqsig filter needs a bounded range to stay fast. */
const ALGO_MAX_WINDOW = 100_000;
const REFRESH_MS = 30_000;
/**
 * Hard wall-clock budget for catching up. Vercel kills the function at 10s, and a
 * killed run saves nothing, so stop early and keep whatever progress was made.
 */
const WORK_BUDGET_MS = 6_000;
/** Redis is optional: give up on it quickly rather than hang the request. */
const REDIS_TIMEOUT_MS = 1_500;

const STATE_KEY = "pqlb:v1";

// Solana: Blueshift WinterWallet (Winternitz one-time signatures, verified on-chain).
// Counts successful transactions that invoke the program; failed txns and program deploys excluded.
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const WINTERWALLET_PROGRAM = "winter5vMwvf51xrSVPTxbAAD6qiSTmPeRTSizMCQCa";
const SOLANA_BASELINE = {
  until: "4YzekaMAyB7Det5v9v5WqfDarJWLmrmjfh2jAVCbGA6zbfdLkybHBs27RkW9jC2udPytVv8PZLZzzJBqtt2zuvP6",
  pqTxs: 9,
};
/** New program signatures classified per request (each needs a getTransaction call). */
const SOLANA_MAX_CLASSIFY = 15;

interface State {
  qrl: { height: number; pqTxs: number };
  algo: { round: number; pqTxs: number };
  sol?: { until: string; pqTxs: number };
  updatedAt: number;
}

let memoryState: State | null = null;

function baseline(): State {
  return { qrl: { ...QRL_BASELINE }, algo: { ...ALGO_BASELINE }, updatedAt: 0 };
}

/** Absolute time (ms) after which no new upstream work starts. Set per request. */
let deadline = 0;
const timeLeft = () => deadline - Date.now();

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms)),
  ]);
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const ms = Math.min(4_000, timeLeft());
  if (ms < 500) throw new Error("work budget exhausted");
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

function zeus(method: string, body: object = {}) {
  return fetchJson(`${ZEUS}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// QRL
// ---------------------------------------------------------------------------

async function advanceQrl(qrl: State["qrl"]): Promise<void> {
  const tip = Number((await zeus("GetHeight")).height);
  const target = tip - QRL_CONFIRMATIONS;
  if (target <= qrl.height) return;

  const chunks: [number, number][] = [];
  for (let s = qrl.height + 1; s <= target && chunks.length < QRL_MAX_CHUNKS; s += QRL_CHUNK) {
    chunks.push([s, Math.min(s + QRL_CHUNK - 1, target)]);
  }

  // Headers are addressed by offset from the serving node's tip, and the proxy's
  // nodes can disagree by a block or two. Request a padded window, then keep
  // exactly the blocks we want by number.
  const results = await Promise.all(
    chunks.map(async ([start, end]) => {
      const res = await zeus("GetLatestData", {
        filter: "BLOCKHEADERS",
        offset: tip - (end + QRL_SLACK),
        quantity: 100,
      });
      const seen = new Set<number>();
      let pq = 0;
      for (const h of res.blockheaders ?? []) {
        const n = Number(h.header?.block_number);
        if (n < start || n > end || seen.has(n)) continue;
        seen.add(n);
        for (const [type, count] of Object.entries(h.transaction_count?.count ?? {})) {
          if (type !== QRL_COINBASE_TYPE) pq += Number(count);
        }
      }
      return seen.size === end - start + 1 ? { end, pq } : null;
    }),
  );

  // Only advance through contiguous complete chunks.
  for (const r of results) {
    if (!r) break;
    qrl.height = r.end;
    qrl.pqTxs += r.pq;
  }
}

// ---------------------------------------------------------------------------
// Algorand
// ---------------------------------------------------------------------------

/** Count pqsig txns in [min, max], or null if it needs more than `maxPages` pages. */
async function countAlgoRange(min: number, max: number, maxPages: number) {
  let count = 0;
  let pages = 0;
  let next = "";
  do {
    if (pages >= maxPages) return null;
    const url =
      `${ALGO_INDEXER}/v2/transactions?sig-type=pqsig&min-round=${min}&max-round=${max}&limit=1000` +
      (next ? `&next=${next}` : "");
    const res = await fetchJson(url);
    pages++;
    count += res.transactions?.length ?? 0;
    next = res.transactions?.length ? res["next-token"] : "";
  } while (next);
  return { count, pages };
}

async function advanceAlgo(algo: State["algo"]): Promise<void> {
  const tip = Number((await fetchJson(`${ALGO_INDEXER}/health`)).round);
  let pagesLeft = ALGO_MAX_PAGES;

  // Results come back in round order. After each full page, everything before the
  // page's last round is complete, so commit it and resume from that round: progress
  // is saved page by page, however dense a burst of printing is.
  while (algo.round < tip && pagesLeft > 0 && timeLeft() > 1_000) {
    const from = algo.round + 1;
    const to = Math.min(tip, algo.round + ALGO_MAX_WINDOW);
    const res = await fetchJson(
      `${ALGO_INDEXER}/v2/transactions?sig-type=pqsig&min-round=${from}&max-round=${to}&limit=1000`,
    );
    pagesLeft--;
    const txns: { "confirmed-round": number }[] = res.transactions ?? [];

    if (txns.length < 1000) {
      algo.pqTxs += txns.length;
      algo.round = to;
      continue;
    }

    const first = txns[0]["confirmed-round"];
    const last = txns[txns.length - 1]["confirmed-round"];
    if (first === last) {
      // A single round holds 1000+ PQ txns: page through just that round.
      const r = await countAlgoRange(last, last, pagesLeft);
      if (!r) break;
      pagesLeft -= r.pages;
      algo.pqTxs += r.count;
      algo.round = last;
      continue;
    }
    algo.pqTxs += txns.filter((t) => t["confirmed-round"] < last).length;
    algo.round = last - 1;
  }
}

// ---------------------------------------------------------------------------
// Solana (WinterWallet)
// ---------------------------------------------------------------------------

function jsonRpc(url: string, method: string, params: unknown[]) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => {
    if (r.error) throw new Error(`${method}: ${r.error.message}`);
    return r.result;
  });
}

async function advanceSolana(sol: NonNullable<State["sol"]>): Promise<void> {
  // Newest first; everything after our cursor.
  const sigs: { signature: string; err: unknown }[] = await jsonRpc(SOLANA_RPC, "getSignaturesForAddress", [
    WINTERWALLET_PROGRAM,
    { until: sol.until, limit: 1000 },
  ]);
  // Process oldest first so the cursor can stop partway and resume next time.
  for (const s of sigs.reverse().slice(0, SOLANA_MAX_CLASSIFY)) {
    if (timeLeft() < 1_000) break;
    if (!s.err) {
      const tx = await jsonRpc(SOLANA_RPC, "getTransaction", [
        s.signature,
        { encoding: "json", maxSupportedTransactionVersion: 0 },
      ]);
      if (!tx) break; // not yet available from this node: retry later
      const keys: string[] = [
        ...tx.transaction.message.accountKeys,
        ...(tx.meta?.loadedAddresses?.writable ?? []),
        ...(tx.meta?.loadedAddresses?.readonly ?? []),
      ];
      const invokes = (ix: { programIdIndex: number }) => keys[ix.programIdIndex] === WINTERWALLET_PROGRAM;
      const invoked =
        tx.transaction.message.instructions.some(invokes) ||
        (tx.meta?.innerInstructions ?? []).some((g: any) => g.instructions.some(invokes));
      if (invoked) sol.pqTxs += 1; // deploys/upgrades reference the program without invoking it
    }
    sol.until = s.signature;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

type Redis = ReturnType<typeof createClient>;

function closeRedis(client: Redis) {
  try {
    client.destroy();
  } catch {
    // already closed (e.g. the connect attempt failed)
  }
}

/** Connect to Redis if configured and reachable, else null. Never hangs. */
async function connectRedis(): Promise<Redis | null> {
  const url = process.env.KV_URL || process.env.REDIS_URL || process.env.STORAGE_URL;
  if (!url) return null;
  const client = createClient({
    url,
    socket: { connectTimeout: REDIS_TIMEOUT_MS, reconnectStrategy: false },
  });
  client.on("error", (err) => console.error("Redis Client Error", err));
  try {
    await withTimeout(client.connect(), REDIS_TIMEOUT_MS, "redis connect");
    return client;
  } catch (err) {
    console.error("Redis unavailable, using in-memory state", err);
    closeRedis(client);
    return null;
  }
}

async function loadState(client: Redis | null): Promise<State> {
  let s = memoryState ?? baseline();
  if (client) {
    try {
      const stored = await withTimeout(client.get(STATE_KEY), REDIS_TIMEOUT_MS, "redis get");
      if (stored) {
        const fromRedis: State = JSON.parse(stored.toString());
        // Prefer whichever copy is further along.
        if (fromRedis.algo.round >= s.algo.round) s = fromRedis;
      }
    } catch (err) {
      console.error("Redis read failed", err);
    }
  }
  // A redeploy with newer baselines supersedes an older stored cursor.
  if (s.qrl.height < QRL_BASELINE.height) s.qrl = { ...QRL_BASELINE };
  if (s.algo.round < ALGO_BASELINE.round) s.algo = { ...ALGO_BASELINE };
  s.sol ??= { ...SOLANA_BASELINE };
  return s;
}

async function getState(): Promise<State> {
  deadline = Date.now() + WORK_BUDGET_MS;
  const client = await connectRedis();
  try {
    let s = await loadState(client);
    if (Date.now() - s.updatedAt > REFRESH_MS) {
      s = structuredClone(s);
      await Promise.all([
        advanceQrl(s.qrl).catch((e) => console.error("QRL advance failed", e)),
        advanceAlgo(s.algo).catch((e) => console.error("Algorand advance failed", e)),
        advanceSolana(s.sol!).catch((e) => console.error("Solana advance failed", e)),
      ]);
      s.updatedAt = Date.now();
      if (client) {
        await withTimeout(client.set(STATE_KEY, JSON.stringify(s)), REDIS_TIMEOUT_MS, "redis set").catch(
          (err) => console.error("Redis write failed", err),
        );
      }
    }
    memoryState = s;
    return s;
  } finally {
    if (client) closeRedis(client);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const state = await getState();

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
    return res.status(200).json({
      updatedAt: state.updatedAt,
      chains: [
        {
          id: "qrl",
          name: "QRL",
          scheme: "XMSS",
          since: "2018-06-26",
          status: "live",
          pqTxs: state.qrl.pqTxs,
          cursor: state.qrl.height,
          cursorLabel: "block",
          note: "Every transaction except the one coinbase per block (all others are XMSS-signed).",
          source: "https://explorer.theqrl.org",
        },
        {
          id: "algorand",
          name: "Algorand",
          scheme: "Falcon-1024",
          since: "2026-08-22",
          status: "live",
          pqTxs: state.algo.pqTxs,
          cursor: state.algo.round,
          cursorLabel: "round",
          note: "Native pqsig transactions since Algorand 5.0 (consensus v42).",
          source: "https://algorand.co/blog/getting-ahead-of-the-elliptic-curve-whats-in-the-next-consensus-upgrade",
        },
        {
          id: "solana",
          name: "Solana",
          scheme: "Winternitz",
          since: "2026-04-27",
          status: "live",
          pqTxs: state.sol!.pqTxs,
          note: "Successful calls to Blueshift's WinterWallet program (winter5vMw…CQCa).",
          source: `https://solscan.io/account/${WINTERWALLET_PROGRAM}`,
        },
        {
          id: "bitcoin",
          name: "Bitcoin",
          scheme: "QSB (hash-based)",
          since: "2026-08-26",
          status: "fixed",
          pqTxs: 1,
          note: "StarkWare's experimental quantum-safe transaction, block 964,199.",
          source: "https://mempool.space/tx/305a24ffea912b9cf428f29ebf952321c96dab5bab284fc0d0801562f5abab07",
        },
      ],
    });
  } catch (err: any) {
    console.error("pq-leaderboard error", err);
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
}
