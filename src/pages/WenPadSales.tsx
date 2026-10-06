import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { MdCasino } from "react-icons/md";
import { Meta } from "../components/Meta";
import { ToolHero } from "../components/cypher/ToolKit";
import { SaleCard } from "../components/WenPadSales/SaleCard";
import { SaleDetail } from "../components/WenPadSales/SaleDetail";
import { LaunchSaleWizard } from "../components/WenPadSales/LaunchSaleWizard";
import { MySales } from "../components/WenPadSales/MySales";
import { ShuffleFaq } from "../components/WenPadSales/ShuffleFaq";
import { ShuffleContractSource } from "../components/WenPadSales/ShuffleContractSource";
import { ExperimentalNotice, Notice, inputClass } from "../components/WenPadSales/shared";
import {
  STATUS,
  getCurrentRound,
  getFactoryStats,
  getFactoryId,
  listSales,
  toSaleNetwork,
  type SaleListing,
} from "../utils/wenpadSale";

type Tab = "browse" | "launch" | "mine";
type Filter = "live" | "upcoming" | "ended" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "browse", label: "Live shuffles" },
  { id: "launch", label: "Launch a shuffle" },
  { id: "mine", label: "My shuffles" },
];

export function WenPadSales() {
  const { appId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeNetwork } = useWallet();
  const network = toSaleNetwork(activeNetwork);
  const factoryId = getFactoryId(network);

  const tab = (searchParams.get("tab") as Tab) || "browse";
  const setTab = (t: Tab) => setSearchParams(t === "browse" ? {} : { tab: t });

  const [sales, setSales] = useState<SaleListing[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("live");
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState<{ totalSales: number; totalVolume: number } | null>(null);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    try {
      const [all, round, factoryStats] = await Promise.all([
        listSales(network, factoryId),
        getCurrentRound(network),
        getFactoryStats(network, factoryId).catch(() => null),
      ]);
      setStats(factoryStats);
      setSales(all);
      setCurrentRound(round);
    } catch (err) {
      console.error("Failed to load sales:", err);
      setSales([]);
    } finally {
      setLoading(false);
    }
  }, [network, factoryId]);

  useEffect(() => {
    if (!appId && tab === "browse") fetchSales();
  }, [appId, tab, fetchSales]);

  const visible = useMemo(
    () =>
      sales.filter((s) => {
        const live = s.status === STATUS.LIVE || s.status === STATUS.PAUSED;
        const isEnded = s.status === STATUS.RELEASED || currentRound > s.endRound || s.sold >= s.totalItems;
        const upcoming = live && currentRound < s.startRound;
        const matchesFilter =
          filter === "all"
            ? s.status !== STATUS.SETUP
            : filter === "live"
              ? live && !isEnded && !upcoming
              : filter === "upcoming"
                ? upcoming
                : isEnded;
        const q = search.toLowerCase();
        const matchesSearch =
          !q || s.metadata.name.toLowerCase().includes(q) || s.metadata.unitName.toLowerCase().includes(q);
        return matchesFilter && matchesSearch;
      }),
    [sales, filter, search, currentRound]
  );

  return (
    <div className="bg-primary-black pt-2 flex justify-center flex-col text-white">
      <Meta
        title="Shuffle"
        description="Shuffle: mint random NFTs from live Algorand collections, or launch your own random mint. Non-custodial: a smart contract hands out the NFTs and nobody holds your keys."
      />

      <article className="mx-auto text-white mb-10 flex flex-col items-center max-w-6xl w-full px-4 min-h-screen">
        {appId ? (
          <div className="w-full flex flex-col items-center mt-10">
            <SaleDetail network={network} appId={Number(appId)} />
          </div>
        ) : (
          <>
            <div className="w-full flex flex-col items-center mt-12 mb-8">
              <ToolHero
                icon={<MdCasino aria-hidden="true" />}
                tag="shuffle"
                title="Shuffle"
                description="Mint a random NFT from live collections, or shuffle your own. Every Shuffle is its own smart contract, indexed on-chain so any site can list it."
                meta={[
                  "non-custodial",
                  "on-chain randomness",
                  "ARC-59 delivery",
                  ...(stats ? [`${stats.totalSales} shuffles`, `${Math.round(stats.totalVolume / 1e6).toLocaleString()} ALGO volume`] : []),
                ]}
              />
            </div>

            <div className="flex gap-2 mb-8 bg-asset-detail-bg/50 p-1 rounded-2xl border border-white/[0.08]">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    tab === t.id ? "bg-primary-orange text-black" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab !== "launch" && (
              <div className="w-full max-w-3xl mb-6">
                <ExperimentalNotice compact />
              </div>
            )}

            {!factoryId && tab !== "launch" && (
              <div className="w-full max-w-3xl mb-6">
                <Notice tone="warn">Shuffle is not deployed on {network} yet.</Notice>
              </div>
            )}

            {tab === "browse" && (
              <div className="w-full">
                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                  <input
                    className={`${inputClass} sm:max-w-xs`}
                    placeholder="Search collections"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="flex gap-2 flex-wrap">
                    {(["live", "upcoming", "ended", "all"] as Filter[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border capitalize ${
                          filter === f
                            ? "bg-primary-orange/20 border-primary-orange text-primary-orange"
                            : "bg-asset-detail-bg/50 border-white/[0.08] text-gray-400 hover:text-white"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                {loading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="aspect-[3/4] rounded-3xl bg-banner-grey/30 animate-pulse" />
                    ))}
                  </div>
                ) : visible.length === 0 ? (
                  <div className="py-20 text-center">
                    <p className="text-neutral-400 font-bold">No {filter === "all" ? "" : filter} shuffles right now.</p>
                    <button onClick={() => setTab("launch")} className="text-primary-orange text-sm font-bold mt-2 hover:underline">
                      Launch the first one →
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {visible.map((sale) => (
                      <SaleCard key={sale.appId} sale={sale} currentRound={currentRound} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "launch" && <LaunchSaleWizard network={network} />}
            {tab === "mine" && <MySales network={network} onResume={() => setTab("launch")} />}

            <ShuffleFaq />
            <ShuffleContractSource network={network} />
          </>
        )}
      </article>
    </div>
  );
}
