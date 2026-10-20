import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { MdHowToVote } from "react-icons/md";
import { useAppNetwork } from "../hooks/useAppNetwork";
import { Meta } from "../components/Meta";
import { ToolHero } from "../components/cypher/ToolKit";
import { CreateVoteForm } from "../components/VoteTool/CreateVoteForm";
import { VoteDetail } from "../components/VoteTool/VoteDetail";
import { VoteContractSource } from "../components/VoteTool/VoteContractSource";
import { VoteV5Features } from "../components/VoteTool/VoteV5Features";
import { Notice, Panel, roundsToRelative } from "../components/VoteTool/shared";
import {
  MODE_LABELS,
  STATUS,
  getCurrentRound,
  getFactoryInfo,
  getVoteFactoryId,
  getVoteTitle,
  listRegistry,
  toVoteNetwork,
  type RegistryEntry,
} from "../utils/voteTool";

type Tab = "browse" | "create";
type Filter = "live" | "upcoming" | "ended" | "all";

interface Listing extends RegistryEntry {
  title: string | null;
}

function phase(e: RegistryEntry, round: number): Exclude<Filter, "all"> {
  if (e.status !== STATUS.ACTIVE || round > e.endRound) return "ended";
  return round < e.startRound ? "upcoming" : "live";
}

export function VoteTool() {
  const { appId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeNetwork } = useAppNetwork();
  const network = toVoteNetwork(activeNetwork);
  const factoryId = getVoteFactoryId(network);

  const tab = (searchParams.get("tab") as Tab) || "browse";
  const setTab = (t: Tab) => setSearchParams(t === "browse" ? {} : { tab: t });

  const [votes, setVotes] = useState<Listing[]>([]);
  const [round, setRound] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("live");
  const [registryId, setRegistryId] = useState<number>();

  const fetchVotes = useCallback(async () => {
    if (!factoryId) return setLoading(false);
    setLoading(true);
    try {
      const { registry } = await getFactoryInfo(network, factoryId);
      setRegistryId(registry);
      const [entries, r] = await Promise.all([listRegistry(network, registry), getCurrentRound(network)]);
      setRound(r);
      const titled = await Promise.all(
        entries.slice(0, 60).map(async (e) => ({ ...e, title: e.status === STATUS.CLOSED ? null : await getVoteTitle(network, e.appId) }))
      );
      setVotes(titled);
    } catch (err) {
      console.error("Failed to load votes:", err);
      setVotes([]);
    } finally {
      setLoading(false);
    }
  }, [network, factoryId]);

  useEffect(() => {
    if (!appId && tab === "browse") fetchVotes();
  }, [appId, tab, fetchVotes]);

  const visible = useMemo(() => votes.filter((v) => filter === "all" || phase(v, round) === filter), [votes, filter, round]);

  // vote.wen.tools/?vote=<appId> from the original plan
  const legacy = searchParams.get("vote");
  if (!appId && legacy && /^\d+$/.test(legacy)) return <Navigate to={`/vote/${legacy}`} replace />;

  return (
    <div className="bg-primary-black pt-2 flex justify-center flex-col text-white">
      <Meta
        title="On-Chain Vote"
        description="Create an on-chain vote with any Algorand asset or NFT collection. Hard votes with escrowed tokens, or read-only votes weighted by what wallets hold. No database: everything is read from the chain."
      />
      <article className="mx-auto text-white mb-10 flex flex-col items-center max-w-6xl w-full px-4 min-h-screen">
        {appId ? (
          <div className="w-full flex flex-col items-center mt-10">
            <VoteDetail network={network} appId={Number(appId)} />
          </div>
        ) : (
          <>
            <div className="w-full flex flex-col items-center mt-12 mb-8">
              <ToolHero
                icon={<MdHowToVote aria-hidden="true" />}
                tag="vote"
                title="On-Chain Vote"
                description="Set up a vote in a minute. Voters use a token or NFT collection you choose, results update live, and every vote is its own smart contract."
                meta={["AVM v13", "cross-app box reads", "no database", "tokens always returnable"]}
              />
            </div>

            <div className="flex gap-2 mb-8 bg-asset-detail-bg/50 p-1 rounded-2xl border border-white/[0.08]">
              {(
                [
                  ["browse", "Votes"],
                  ["create", "Get started"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${tab === id ? "bg-primary-orange text-black" : "text-gray-400 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="w-full max-w-3xl mb-6">
              <Notice tone="warn">
                <strong>Experimental.</strong> The Vote Tool contracts haven't had an independent audit. Start with small amounts.
              </Notice>
            </div>

            {tab === "create" && <CreateVoteForm network={network} />}

            {tab === "browse" && (
              <div className="w-full">
                {!factoryId && <Notice tone="warn">The Vote Tool isn't deployed on {network} yet.</Notice>}
                <div className="flex gap-2 flex-wrap mb-6">
                  {(["live", "upcoming", "ended", "all"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border capitalize ${
                        filter === f ? "bg-primary-orange/20 border-primary-orange text-primary-orange" : "bg-asset-detail-bg/50 border-white/[0.08] text-gray-400 hover:text-white"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                {loading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-40 rounded-3xl bg-banner-grey/30 animate-pulse" />
                    ))}
                  </div>
                ) : visible.length === 0 ? (
                  <div className="py-20 text-center">
                    <p className="text-neutral-400 font-bold">No {filter === "all" ? "" : filter} votes right now.</p>
                    <button onClick={() => setTab("create")} className="text-primary-orange text-sm font-bold mt-2 hover:underline">
                      Start one →
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {visible.map((v) => {
                      const p = phase(v, round);
                      return (
                        <Link key={v.appId} to={`/vote/${v.appId}`}>
                          <Panel className="h-full hover:border-primary-orange/50 transition-all">
                            <div className="text-[10px] font-black uppercase tracking-wider text-primary-orange">{p}</div>
                            <h3 className="text-lg font-black text-white mt-1 break-words">{v.title ?? `Vote #${v.voteNo}`}</h3>
                            <p className="text-xs text-gray-400 mt-1">{MODE_LABELS[v.mode]}</p>
                            <p className="text-xs text-gray-400 mt-3">
                              {v.voters} voter{v.voters === 1 ? "" : "s"} · {v.totalWeight.toLocaleString()} votes ·{" "}
                              {p === "upcoming" ? `starts ${roundsToRelative(v.startRound, round)}` : p === "live" ? `ends ${roundsToRelative(v.endRound, round)}` : "ended"}
                            </p>
                          </Panel>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <VoteV5Features />
          </>
        )}

        <div className="w-full max-w-4xl mt-10">
          <VoteContractSource network={network} factoryId={factoryId} registryId={registryId} />
        </div>
      </article>
    </div>
  );
}
