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
const REFRESH_MS = 30_000;

const STATE_KEY = "pqlb:v1";

interface State {
  qrl: { height: number; pqTxs: number };
  algo: { round: number; pqTxs: number };
  updatedAt: number;
}

let memoryState: State | null = null;

function baseline(): State {
  return { qrl: { ...QRL_BASELINE }, algo: { ...ALGO_BASELINE }, updatedAt: 0 };
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
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
  let window = 50_000;

  while (algo.round < tip && pagesLeft > 0) {
    const from = algo.round + 1;
    const to = Math.min(tip, algo.round + window);
    const r = await countAlgoRange(from, to, pagesLeft);
    if (!r) {
      // Busy stretch: shrink the window and try again.
      if (window <= 250) break;
      window = Math.floor(window / 4);
      continue;
    }
    pagesLeft -= r.pages;
    algo.round = to;
    algo.pqTxs += r.count;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function withRedis<T>(fn: (client: ReturnType<typeof createClient> | null) => Promise<T>) {
  const url = process.env.KV_URL || process.env.REDIS_URL || process.env.STORAGE_URL;
  if (!url) return fn(null);
  const client = createClient({ url });
  client.on("error", (err) => console.error("Redis Client Error", err));
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const state = await withRedis(async (client) => {
      const stored = client ? await client.get(STATE_KEY) : null;
      let s: State = stored ? JSON.parse(stored.toString()) : memoryState ?? baseline();

      // A redeploy with newer baselines supersedes an older stored cursor.
      if (s.qrl.height < QRL_BASELINE.height) s.qrl = { ...QRL_BASELINE };
      if (s.algo.round < ALGO_BASELINE.round) s.algo = { ...ALGO_BASELINE };

      if (Date.now() - s.updatedAt > REFRESH_MS) {
        s = structuredClone(s);
        await Promise.all([
          advanceQrl(s.qrl).catch((e) => console.error("QRL advance failed", e)),
          advanceAlgo(s.algo).catch((e) => console.error("Algorand advance failed", e)),
        ]);
        s.updatedAt = Date.now();
        if (client) await client.set(STATE_KEY, JSON.stringify(s));
      }
      memoryState = s;
      return s;
    });

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
    return res.status(200).json({
      updatedAt: state.updatedAt,
      chains: [
        {
          id: "qrl",
          name: "QRL",
          scheme: "XMSS",
          since: "2018-06-26",
          pqTxs: state.qrl.pqTxs,
          cursor: state.qrl.height,
          cursorLabel: "block",
        },
        {
          id: "algorand",
          name: "Algorand",
          scheme: "Falcon-1024",
          since: "2026-08-22",
          pqTxs: state.algo.pqTxs,
          cursor: state.algo.round,
          cursorLabel: "round",
        },
      ],
    });
  } catch (err: any) {
    console.error("pq-leaderboard error", err);
    return res.status(500).json({ error: err?.message ?? String(err) });
  }
}
