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

// Verified snapshots (inclusive of the given height/round). Without persistent storage,
// a fresh instance restarts here, so keep these recent.
// QRL: non-coinbase txns in blocks 1..height (genesis allocations in block 0 excluded);
// full backfill to 4,380,664 = 1,968,668, advanced by the live counter since.
const QRL_BASELINE = { height: 4_391_155, pqTxs: 1_969_452 };
// Algorand: native pqsig txns since v42 activation (round 64,318,659). Independently
// recounted at 66,018,837 (1,796,849), advanced by the verified live counter since.
const ALGO_BASELINE = { round: 66_237_955, pqTxs: 3_271_530 };

/** Per-request work budgets, to stay well within the function timeout. */
const QRL_MAX_CHUNKS = 5; // × 90 blocks
const ALGO_MAX_PAGES = 12; // × 1000 txns
/** Round span per indexer query; the pqsig filter needs a bounded range to stay fast. */
const ALGO_MAX_WINDOW = 5_000;
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

// Starknet: Falcon-512 account contracts. Signature checks live in the account contract,
// so accounts are found by scanning each block's state diff for contracts deployed with
// (or upgraded to) a Falcon account class. An account's nonce is the number of
// transactions it has sent (deploy + invokes), each validated by its Falcon verifier.
const STARKNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet";
/**
 * Falcon-512 *account* classes found by scanning every deployment since 2026-07-01 and
 * checking each class's ABI (verifier-only and pool contracts excluded).
 */
const STARKNET_FALCON_CLASSES = new Set<string>(
  [
    "0x37aa162d80f39ec8db3396695459924d2e38e2e50922ffe3664158aad6192b9", // OpenZeppelin Falcon512ShakeAccount
    "0x4916072375da17b9c6b318c5f68006a68f0ae573fce4346ad002933d4f9c0cd", // OpenZeppelin Falcon512ShakeDirectAccount
    "0x37c7626b50ba517835c9556b53bce57cb6633704bb702f8c2f13a44cf151d5", // falcon_account::FalconAccount
    "0x71cb7d75ee7ae3441bef6ba9924a16a2739a63d069c7b8e72ea7ef789804536", // card_account_pq::FalconCardAccount
    "0x5cb43a69613df29680ca55bf89df4352051185dc1848033523117b33b57c357", // falcon512_account::Falcon512Account
    "0x474590555aa5f1bd048e900091dc49cc2d1391e474726ab34286258c9fff811", // falcon512_account::Falcon512Account
  ].map(normalizeFelt),
);
/** Backfill snapshot: every Falcon account deployed up to and including `block`. */
const STARKNET_BASELINE = {
  block: 16_781_518,
  accounts: [
    "0x5a7b1f5e3ddf5e4c1a80ce0dd1a1dc14762cb2ffb2181433ab1e49d02c8b5de",
    "0x6109c682b36e28cf7ac61a43110f9e0c4706a50fafd23251ee094e83ff27b25",
    "0xbae840ed469a094e3888e5ea7115839847a591eafad4c80c3035327857b132",
    "0x545858ba12aa9633f454fe9834e4c40942ba0facd9ba17c3943399f37f61ea2",
    "0x150c359e87fddc78e73e51309a6c73d9a80356552fe535d5c096b2e699a8f04",
    "0x560fede1168a47a89e658ca6f7c786b5a164bd461f92ed45b6181b6676eaaea",
    "0x7f80929b0da7e6eb1e9bf4aabb5a571f63d3eb2831400728486cfabb9758873",
    "0x72c61328a6e14c5754f0944077957aa4de49ebb8b399943e8774e264e9d355b",
    "0x4797cda1c7e902a6e916d842d992ea652af5fd5b5e562745e83a545d76035b6",
    "0x3e09d3ffd4af3aa4d0cc265bdb8b75b3039ab7a90da27210194d35a4291540e",
    "0x6f7daa1c87db56eba01a6f32410e64cb4e598096779b9f5a6856368386f7c66",
    "0x39c9fdd4c82ba1a65cacb70571f49fce762f55fce9b25b07b4af1e28f457c57",
    "0x581a0a7b657c3d7c2504fcf29dba3a690016f86d42288b1e7699dbaa84ec524",
    "0x472c09bf246c1c586920cc982fe2d09858559ab68b00932c29afa239fe59f67",
    "0x630ecbe2754715b1be3f00aa9f3d4b8e7b9b4cadf58c869f30b7e35eb2e91d5",
    "0x47bf2c67194eedfe591a3fa3d16055f360d0c10258c43f82a684e88c8f3c36f",
    "0x77d621f424d90c3740602d659094488a6fd696a65fcbe4fcf9f24afc22dcb2a",
    "0x242c285d921a3858cae8921a0a2209a9fe75f87edb11d0a47a371eba4f11363",
    "0x6f0ca2198acd41f9cb6309077d2c34896e2c6d23dd1c71c1042b87c01282aa5",
    "0x4c85c2b84315a7dd96b0e9e24edbd816d0078dfd7c06a7b83ee664bc1fd12a0",
  ].map(normalizeFelt),
};
/** State updates fetched per request (× 50 blocks); Starknet adds ~14 blocks per 30 s. */
const STARKNET_MAX_BATCHES = 4;
const STARKNET_BATCH_BLOCKS = 50;

function normalizeFelt(hex: string): string {
  return "0x" + BigInt(hex).toString(16);
}

interface State {
  qrl: { height: number; pqTxs: number };
  algo: { round: number; pqTxs: number };
  sol?: { until: string; pqTxs: number };
  stark?: { block: number; accounts: string[]; pqTxs: number };
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

/** Several JSON-RPC calls in one HTTP request; results in call order. */
async function jsonRpcBatch(url: string, calls: [string, unknown[]][]): Promise<any[]> {
  if (!calls.length) return [];
  const res = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params }))),
  });
  if (!Array.isArray(res)) throw new Error("batch RPC not supported");
  const byId = new Map(res.map((r: any) => [r.id, r]));
  return calls.map(([method], id) => {
    const r = byId.get(id);
    if (!r || r.error) throw new Error(`${method}: ${r?.error?.message ?? "missing result"}`);
    return r.result;
  });
}

async function advanceStarknet(stark: NonNullable<State["stark"]>): Promise<void> {
  const tip = Number(await jsonRpc(STARKNET_RPC, "starknet_blockNumber", []));
  const known = new Set(stark.accounts.map(normalizeFelt));

  // Discover new Falcon accounts block by block; each batch commits on its own.
  for (let b = 0; b < STARKNET_MAX_BATCHES && stark.block < tip && timeLeft() > 1_500; b++) {
    const from = stark.block + 1;
    const to = Math.min(tip, from + STARKNET_BATCH_BLOCKS - 1);
    const blocks = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const updates = await jsonRpcBatch(
      STARKNET_RPC,
      blocks.map((n) => ["starknet_getStateUpdate", [{ block_number: n }]]),
    );
    for (const u of updates) {
      const diff = u?.state_diff ?? {};
      for (const c of [...(diff.deployed_contracts ?? []), ...(diff.replaced_classes ?? [])]) {
        const address = normalizeFelt(c.address ?? c.contract_address);
        if (STARKNET_FALCON_CLASSES.has(normalizeFelt(c.class_hash)) && !known.has(address)) {
          known.add(address);
          stark.accounts.push(address);
        }
      }
    }
    stark.block = to;
  }

  const nonces = await jsonRpcBatch(
    STARKNET_RPC,
    stark.accounts.map((a) => ["starknet_getNonce", ["latest", a]]),
  );
  stark.pqTxs = nonces.reduce((n: number, hex: string) => n + Number(BigInt(hex)), 0);
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
  const url = process.env.wentools_REDIS_URL || process.env.KV_URL || process.env.REDIS_URL || process.env.STORAGE_URL;
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
  if (!s.stark || s.stark.block < STARKNET_BASELINE.block) {
    s.stark = { block: STARKNET_BASELINE.block, accounts: [...STARKNET_BASELINE.accounts], pqTxs: 0 };
  }
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
        advanceStarknet(s.stark!).catch((e) => console.error("Starknet advance failed", e)),
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
          id: "starknet",
          name: "Starknet",
          scheme: "Falcon-512",
          since: "2026-07-21",
          status: "live",
          pqTxs: state.stark!.pqTxs,
          cursor: state.stark!.block,
          cursorLabel: "block",
          note: `Transactions sent by Falcon-512 account contracts (${state.stark!.accounts.length} found by scanning every block's deployments since July).`,
          source: "https://github.com/OpenZeppelin/cairo-pq-verifiers",
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
