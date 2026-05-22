import { useState, useEffect, useCallback, useMemo } from "react";
import { NetworkId } from "@txnlab/use-wallet-react";
import { IoTrophy, IoSwapVertical, IoTime, IoFlash, IoChevronDown, IoChevronUp } from "react-icons/io5";
import algosdk from "algosdk";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentInfo {
  name: string;
  appId: number;
  category: string;
}

interface AgentLeaderboardEntry {
  walletAddress: string;
  agents: AgentInfo[];
  totalVolumeUSDC: number;   // human-readable (already divided by 1e6)
  totalTransactions: number;
  lastPaymentTimestamp: number; // unix seconds
}

type SortField = "volume" | "transactions";
type TimeFilter = "all" | "30d" | "7d" | "24h";

interface AgentLeaderboardProps {
  network: NetworkId;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const USDC_ASSET_ID: Record<string, number> = {
  mainnet: 31566704,
  testnet: 10458941,
};

const FACTORY_APP_IDS: Record<string, number> = {
  mainnet: Number(import.meta.env.VITE_FACTORY_APP_ID_MAINNET || 3565950332),
  testnet: Number(import.meta.env.VITE_FACTORY_APP_ID_TESTNET || 762952995),
};

function getIndexerBase(network: NetworkId): string {
  return network === NetworkId.TESTNET
    ? "https://testnet-idx.algonode.cloud"
    : "https://mainnet-idx.algonode.cloud";
}

function getAlgodBase(network: NetworkId): string {
  return network === NetworkId.TESTNET
    ? "https://testnet-api.4160.nodely.dev"
    : "https://mainnet-api.4160.nodely.dev";
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToAddress(bytes: Uint8Array): string {
  try {
    return algosdk.encodeAddress(bytes);
  } catch (e) {
    console.error("Failed to encode Algorand address:", e);
  }
  // Fallback: return hex
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function decodeABIString(val: Uint8Array): string {
  if (val.length < 2) return "";
  const length = (val[0] << 8) | val[1];
  try {
    return new TextDecoder().decode(val.subarray(2, 2 + length));
  } catch {
    return "";
  }
}

function decodeGlobalStateForLeaderboard(
  state: Array<{ key: string; value: { type: number; bytes?: string; uint?: number } }>
): { name: string; walletAddress: string; category: string; active: boolean } {
  const kv: Record<string, string | number | Uint8Array> = {};
  for (const entry of state) {
    const key = atob(entry.key);
    if (entry.value.type === 1) {
      kv[key] = base64ToBytes(entry.value.bytes || "");
    } else {
      kv[key] = entry.value.uint ?? 0;
    }
  }

  let name = "";
  const nameVal = kv["name"];
  if (nameVal instanceof Uint8Array) name = decodeABIString(nameVal);
  else if (typeof nameVal === "string") name = nameVal;

  let walletAddress = "";
  const addrVal = kv["wallet_address"];
  if (addrVal instanceof Uint8Array && addrVal.length === 32) {
    walletAddress = bytesToAddress(addrVal);
  }

  let category = "other";
  const catVal = kv["category"];
  if (catVal instanceof Uint8Array) category = decodeABIString(catVal) || "other";
  else if (typeof catVal === "string") category = catVal || "other";

  return {
    name,
    walletAddress,
    category,
    active: kv["active"] === 1,
  };
}

function formatUSDC(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(3)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(3)}K`;
  return `$${amount.toFixed(3)}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return "Never";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

function getTimeFilterCutoff(filter: TimeFilter): number {
  const now = Math.floor(Date.now() / 1000);
  switch (filter) {
    case "24h": return now - 86400;
    case "7d": return now - 604800;
    case "30d": return now - 2592000;
    default: return 0;
  }
}

const RANK_STYLES = [
  "bg-gradient-to-r from-yellow-500/20 to-amber-500/10 border-yellow-500/40 shadow-lg shadow-yellow-500/5",
  "bg-gradient-to-r from-neutral-400/15 to-neutral-500/5 border-neutral-400/30",
  "bg-gradient-to-r from-orange-700/20 to-orange-800/5 border-orange-700/30",
];

const RANK_ICONS = ["🥇", "🥈", "🥉"];

const CATEGORY_COLORS: Record<string, string> = {
  "ai-agent": "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "defi": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "nft": "bg-pink-500/20 text-pink-300 border-pink-500/30",
  "analytics": "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  "oracle": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "utility": "bg-green-500/20 text-green-300 border-green-500/30",
  "infrastructure": "bg-slate-500/20 text-slate-300 border-slate-500/30",
  "social": "bg-rose-500/20 text-rose-300 border-rose-500/30",
  "gaming": "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
};

async function fetchNFDomains(
  addresses: string[],
  network: NetworkId
): Promise<Record<string, string>> {
  const uniqueAddresses = [...new Set(addresses)];
  const results: Record<string, string> = {};
  if (uniqueAddresses.length === 0) return results;

  const apiBase = network === NetworkId.TESTNET
    ? "https://api.testnet.nf.domains"
    : "https://api.nf.domains";

  const bulkSize = 20;
  for (let i = 0; i < uniqueAddresses.length; i += bulkSize) {
    const chunk = uniqueAddresses
      .slice(i, i + bulkSize)
      .map((addr) => `address=${addr}`)
      .join("&");

    try {
      const response = await fetch(`${apiBase}/nfd/lookup?view=tiny&${chunk}`);
      if (response.status === 200) {
        const data = await response.json();
        for (const [addr, details] of Object.entries(data) as [string, any][]) {
          if (details && details.name) {
            results[addr] = details.name;
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch NFDs:", e);
    }
  }

  return results;
}

// ─── Data Fetching ──────────────────────────────────────────────────────────

async function fetchAgentWallets(
  network: NetworkId
): Promise<Array<{ walletAddress: string; name: string; appId: number; category: string }>> {
  const factoryId = FACTORY_APP_IDS[network === NetworkId.TESTNET ? "testnet" : "mainnet"];
  if (!factoryId) return [];

  const indexerBase = getIndexerBase(network);
  const algodBase = getAlgodBase(network);

  // 1. Get all boxes from factory
  const boxesRes = await fetch(`${indexerBase}/v2/applications/${factoryId}/boxes?limit=100`);
  if (!boxesRes.ok) return [];
  const boxesData = await boxesRes.json();
  const boxes: Array<{ name: string }> = boxesData.boxes || [];
  if (boxes.length === 0) return [];

  const agents: Array<{ walletAddress: string; name: string; appId: number; category: string }> = [];

  for (const box of boxes) {
    try {
      const boxNameBytes = new Uint8Array(
        atob(box.name).split("").map(c => c.charCodeAt(0))
      );

      // Read box value → child app ID (uint64)
      const encodedName = encodeURIComponent(
        btoa(String.fromCharCode(...boxNameBytes))
      );
      const boxRes = await fetch(
        `${algodBase}/v2/applications/${factoryId}/box?name=b64:${encodedName}`
      );
      if (!boxRes.ok) continue;
      const boxData = await boxRes.json();
      const valueBytes = new Uint8Array(
        atob(boxData.value).split("").map((c: string) => c.charCodeAt(0))
      );
      const view = new DataView(valueBytes.buffer);
      const childAppId = Number(view.getBigUint64(0));
      if (childAppId === 0) continue;

      // 2. Read child app global state
      const appRes = await fetch(`${indexerBase}/v2/applications/${childAppId}`);
      if (!appRes.ok) continue;
      const appData = await appRes.json();
      const globalState = appData.application?.params?.["global-state"];
      if (!globalState) continue;

      const decoded = decodeGlobalStateForLeaderboard(globalState);
      if (decoded.active && decoded.walletAddress) {
        agents.push({
          walletAddress: decoded.walletAddress,
          name: decoded.name || `Agent #${childAppId}`,
          appId: childAppId,
          category: decoded.category,
        });
      }
    } catch {
      continue;
    }
  }

  return agents;
}

async function fetchUSDCTransactions(
  walletAddress: string,
  network: NetworkId,
  afterTime?: number
): Promise<{ volume: number; count: number; lastTimestamp: number }> {
  const indexerBase = getIndexerBase(network);
  const assetId = USDC_ASSET_ID[network === NetworkId.TESTNET ? "testnet" : "mainnet"];

  let volume = 0;
  let count = 0;
  let lastTimestamp = 0;
  let nextToken: string | undefined;

  const baseUrl = `${indexerBase}/v2/transactions?address=${walletAddress}&asset-id=${assetId}&tx-type=axfer&limit=500`;
  const afterParam = afterTime ? `&after-time=${new Date(afterTime * 1000).toISOString()}` : "";

  do {
    const url = `${baseUrl}${afterParam}${nextToken ? `&next=${nextToken}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    const txns = data.transactions || [];

    for (const txn of txns) {
      const transfer = txn["asset-transfer-transaction"];
      if (!transfer) continue;

      // Only count inbound transfers (receiver is this wallet)
      if (transfer.receiver === walletAddress && transfer.amount > 0) {
        volume += transfer.amount;
        count++;
        const ts = txn["round-time"] || 0;
        if (ts > lastTimestamp) lastTimestamp = ts;
      }
    }

    nextToken = data["next-token"];
    // Safety: limit pagination to avoid runaway requests on free tier
    if (count > 10000) break;
  } while (nextToken);

  return {
    volume: volume / 1_000_000, // Convert from micro-USDC
    count,
    lastTimestamp,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AgentLeaderboard({ network }: AgentLeaderboardProps) {
  const [entries, setEntries] = useState<AgentLeaderboardEntry[]>([]);
  const [nfdNames, setNfdNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [sortBy, setSortBy] = useState<SortField>("volume");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEntries([]);

    try {
      // Step 1: Get all agent wallets from the contract
      const agents = await fetchAgentWallets(network);
      if (agents.length === 0) {
        setEntries([]);
        setLoading(false);
        return;
      }

      // Group agents by walletAddress to avoid double counting same wallet
      const walletGroups: Record<string, typeof agents> = {};
      for (const agent of agents) {
        const addr = agent.walletAddress;
        if (!walletGroups[addr]) {
          walletGroups[addr] = [];
        }
        walletGroups[addr].push(agent);
      }

      const uniqueWallets = Object.keys(walletGroups);
      setLoadingProgress({ current: 0, total: uniqueWallets.length });

      // Fetch NFD names asynchronously
      fetchNFDomains(uniqueWallets, network)
        .then((resolved) => setNfdNames(resolved))
        .catch((e) => console.error("Error fetching NFD names:", e));

      // Step 2: Fetch USDC transactions for each unique wallet
      const cutoff = getTimeFilterCutoff(timeFilter);
      const results: AgentLeaderboardEntry[] = [];

      // Process in parallel batches of 3 to respect rate limits
      const batchSize = 3;
      for (let i = 0; i < uniqueWallets.length; i += batchSize) {
        const batch = uniqueWallets.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map(async (walletAddress) => {
            const { volume, count, lastTimestamp } = await fetchUSDCTransactions(
              walletAddress,
              network,
              cutoff > 0 ? cutoff : undefined
            );
            return {
              walletAddress,
              agents: walletGroups[walletAddress],
              totalVolumeUSDC: volume,
              totalTransactions: count,
              lastPaymentTimestamp: lastTimestamp,
            };
          })
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            results.push(result.value);
          }
        }

        setLoadingProgress({ current: Math.min(i + batchSize, uniqueWallets.length), total: uniqueWallets.length });
        
        // Progressive update: show results as they come in
        setEntries([...results]);
      }

      setEntries(results);
    } catch (err: any) {
      console.error("Leaderboard fetch error:", err);
      setError(err.message || "Failed to load leaderboard data");
    } finally {
      setLoading(false);
    }
  }, [network, timeFilter]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Sort entries
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (sortBy === "volume") return b.totalVolumeUSDC - a.totalVolumeUSDC;
      return b.totalTransactions - a.totalTransactions;
    });
  }, [entries, sortBy]);

  const displayed = expanded ? sorted : sorted.slice(0, 10);

  // Aggregate stats
  const totalVolume = entries.reduce((s, e) => s + e.totalVolumeUSDC, 0);
  const totalTxns = entries.reduce((s, e) => s + e.totalTransactions, 0);
  const totalAgentsCount = entries.reduce((s, e) => s + e.agents.length, 0);
  const activeAgentsCount = entries
    .filter((e) => e.totalTransactions > 0)
    .reduce((s, e) => s + e.agents.length, 0);

  const shortAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <section className="w-full">
      {/* ── Section Header ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-xl border border-orange-500/20">
              <IoTrophy className="text-xl text-orange-400" />
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white">
              Agent Leaderboard
            </h2>
          </div>
          <p className="text-neutral-500 text-sm mt-1.5 ml-[52px]">
            Real-time USDC payment volume indexed from the Algorand ledger
          </p>
        </div>

        {/* ── Controls ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Time filter */}
          {(["all", "30d", "7d", "24h"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTimeFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                timeFilter === t
                  ? "bg-orange-500 text-black shadow-md shadow-orange-500/20"
                  : "bg-neutral-800/80 text-neutral-500 hover:text-neutral-300 border border-secondary-gray/50 hover:border-neutral-600"
              }`}
            >
              {t === "all" ? "All Time" : t}
            </button>
          ))}

          {/* Sort toggle */}
          <button
            onClick={() => setSortBy(sortBy === "volume" ? "transactions" : "volume")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800/80 text-neutral-400 hover:text-white border border-secondary-gray/50 hover:border-neutral-600 text-[10px] font-bold uppercase tracking-wider transition-all"
          >
            <IoSwapVertical className="text-xs" />
            {sortBy === "volume" ? "By Volume" : "By Txns"}
          </button>
        </div>
      </div>

      {/* ── Aggregate Stats Bar ────────────────────────────────────────── */}
      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-banner-grey/40 border border-secondary-gray/40 rounded-xl p-4 text-center">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1">
              Total Volume
            </div>
            <div className="text-lg font-black text-orange-400">
              {formatUSDC(totalVolume)}
            </div>
          </div>
          <div className="bg-banner-grey/40 border border-secondary-gray/40 rounded-xl p-4 text-center">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1">
              Total Transactions
            </div>
            <div className="text-lg font-black text-white">
              {formatCount(totalTxns)}
            </div>
          </div>
          <div className="bg-banner-grey/40 border border-secondary-gray/40 rounded-xl p-4 text-center">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1">
              Active Agents
            </div>
            <div className="text-lg font-black text-white">
              {activeAgentsCount}
            </div>
          </div>
        </div>
      )}

      {/* ── Loading State ──────────────────────────────────────────────── */}
      {loading && (
        <div className="w-full">
          {/* Progress bar */}
          {loadingProgress.total > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-2">
                <span>Indexing agent wallets...</span>
                <span>{loadingProgress.current}/{loadingProgress.total}</span>
              </div>
              <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-orange-400 rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${(loadingProgress.current / loadingProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Skeleton rows while loading */}
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="bg-banner-grey/30 border border-secondary-gray/20 rounded-xl p-4 animate-pulse flex items-center gap-4"
              >
                <div className="w-8 h-8 bg-neutral-800 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-neutral-800 rounded w-1/3" />
                  <div className="h-2 bg-neutral-800/50 rounded w-1/5" />
                </div>
                <div className="h-4 bg-neutral-800 rounded w-20" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error State ────────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="w-full text-center py-10">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button
            onClick={fetchLeaderboard}
            className="px-4 py-2 bg-orange-500/20 text-orange-400 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-orange-500/30 transition-all"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Empty State ────────────────────────────────────────────────── */}
      {!loading && !error && entries.length === 0 && (
        <div className="w-full flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 bg-orange-500/10 rounded-2xl flex items-center justify-center mb-4">
            <IoTrophy className="text-2xl text-orange-500/40" />
          </div>
          <h3 className="text-lg font-bold text-neutral-400 mb-1">No leaderboard data yet</h3>
          <p className="text-sm text-neutral-600 max-w-sm">
            Once agents start receiving x402 USDC payments, they'll appear here ranked by volume.
          </p>
        </div>
      )}

      {/* ── Leaderboard Table ──────────────────────────────────────────── */}
      {!loading && sorted.length > 0 && (
        <div className="space-y-2">
          {/* Column headers */}
          <div className="hidden sm:grid sm:grid-cols-[48px_1fr_120px_100px_100px] gap-2 px-4 py-2 text-[10px] text-neutral-600 uppercase tracking-wider font-bold">
            <span>#</span>
            <span>Agents (Operator Wallet)</span>
            <span className="text-right">Volume</span>
            <span className="text-right">Txns</span>
            <span className="text-right">Last Payment</span>
          </div>

          {displayed.map((entry, idx) => {
            const rank = idx + 1;
            const isTopThree = rank <= 3;

            return (
              <div
                key={entry.walletAddress}
                className={`grid grid-cols-[32px_1fr_auto] sm:grid-cols-[48px_1fr_120px_100px_100px] gap-3 items-center sm:items-start px-3 sm:px-4 py-3 sm:py-3.5 rounded-xl border transition-all duration-200 hover:border-orange-500/20 ${
                  isTopThree
                    ? RANK_STYLES[rank - 1]
                    : "bg-banner-grey/30 border-secondary-gray/30 hover:bg-banner-grey/50"
                }`}
              >
                {/* Rank */}
                <div className="flex items-center justify-center sm:pt-0.5">
                  {isTopThree ? (
                    <span className="text-base sm:text-lg leading-none">{RANK_ICONS[rank - 1]}</span>
                  ) : (
                    <span className="text-xs sm:text-sm font-bold text-neutral-500 font-mono leading-none">
                      {rank}
                    </span>
                  )}
                </div>

                {/* Agent & Wallet info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {nfdNames[entry.walletAddress] ? (
                      <span 
                        className="text-xs sm:text-sm font-black text-orange-400 leading-none truncate max-w-[120px] xs:max-w-[160px] sm:max-w-none"
                        title={entry.walletAddress}
                      >
                        {nfdNames[entry.walletAddress]}
                      </span>
                    ) : (
                      <span className="text-xs sm:text-sm font-black text-white font-mono leading-none">
                        {shortAddr(entry.walletAddress)}
                      </span>
                    )}
                    <a
                      href={`https://explorer.perawallet.app/address/${entry.walletAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-orange-500/50 hover:text-orange-400 transition-colors leading-none"
                      title={nfdNames[entry.walletAddress] ? `View ${entry.walletAddress} on Explorer` : "View Wallet on Explorer"}
                    >
                      ↗
                    </a>
                    {nfdNames[entry.walletAddress] && (
                      <span className="text-[9px] text-neutral-600 font-mono leading-none hidden sm:inline">
                        ({shortAddr(entry.walletAddress)})
                      </span>
                    )}
                  </div>
                  
                  {/* Associated Agents */}
                  <div className="flex flex-wrap gap-1 mt-1.5 sm:mt-2">
                    {entry.agents.map((agent) => {
                      const catClass = CATEGORY_COLORS[agent.category.toLowerCase()] || "bg-neutral-500/20 text-neutral-300 border-neutral-500/30";
                      return (
                        <div 
                          key={agent.appId} 
                          className="flex items-center gap-1 bg-neutral-900/60 border border-secondary-gray/20 px-1.5 py-0.5 rounded"
                        >
                          <span className="text-[9px] sm:text-[10px] font-bold text-neutral-300 max-w-[90px] xs:max-w-[120px] sm:max-w-none truncate">
                            {agent.name}
                          </span>
                          <span className={`text-[6px] sm:text-[7px] font-extrabold uppercase tracking-wider px-1 py-0.2 rounded border ${catClass}`}>
                            {agent.category}
                          </span>
                          <a
                            href={`https://explorer.perawallet.app/application/${agent.appId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[7px] sm:text-[8px] text-orange-500/40 hover:text-orange-400 transition-colors font-mono"
                            title={`App ID: ${agent.appId}`}
                          >
                            #{agent.appId} ↗
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Volume & Txs Stack on Mobile, Volume on Desktop */}
                <div className="text-right sm:pt-0.5 flex flex-col justify-center">
                  <span className={`text-xs sm:text-sm font-black ${
                    isTopThree ? "text-orange-400" : "text-neutral-200"
                  }`}>
                    {formatUSDC(entry.totalVolumeUSDC)}
                  </span>
                  <span className="text-[9px] font-bold text-neutral-500 sm:hidden mt-0.5">
                    {formatCount(entry.totalTransactions)} txs
                  </span>
                </div>

                {/* Transaction count (desktop only) */}
                <div className="text-right pt-0.5 hidden sm:block">
                  <span className="text-sm font-bold text-neutral-400">
                    {formatCount(entry.totalTransactions)}
                  </span>
                </div>

                {/* Last payment (desktop only) */}
                <div className="text-right hidden sm:flex items-center justify-end gap-1 pt-1">
                  {entry.lastPaymentTimestamp > 0 ? (
                    <>
                      <IoTime className="text-[10px] text-neutral-600" />
                      <span className="text-[10px] text-neutral-500 font-mono">
                        {timeAgo(entry.lastPaymentTimestamp)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] text-neutral-700">—</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Expand / Collapse */}
          {sorted.length > 10 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-2 py-3 text-[10px] text-neutral-500 hover:text-orange-400 font-bold uppercase tracking-wider transition-colors"
            >
              {expanded ? (
                <>
                  <IoChevronUp className="text-xs" />
                  Show Top 10
                </>
              ) : (
                <>
                  <IoChevronDown className="text-xs" />
                  Show All {sorted.length} Agents
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="mt-6 flex items-center justify-between text-[10px] text-neutral-700">
        <div className="flex items-center gap-1.5">
          <IoFlash className="text-orange-500/40" />
          <span>
            Indexed via{" "}
            <a
              href="https://nodely.io"
              target="_blank"
              rel="noreferrer"
              className="text-orange-500/60 hover:text-orange-400 transition-colors"
            >
              Nodely
            </a>
            {" "}free tier — USDC ASA #{USDC_ASSET_ID[network === NetworkId.TESTNET ? "testnet" : "mainnet"]}
          </span>
        </div>
        <button
          onClick={fetchLeaderboard}
          disabled={loading}
          className="text-neutral-600 hover:text-orange-400 transition-colors disabled:opacity-30"
        >
          ↻ Refresh
        </button>
      </div>
    </section>
  );
}
