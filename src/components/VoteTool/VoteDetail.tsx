import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";
import { MdArrowBack, MdContentCopy, MdLock, MdWarning } from "react-icons/md";
import {
  KNOWN_VOTE_TEMPLATES,
  MODE,
  MODE_LABELS,
  RETURN,
  RETURN_LABELS,
  STATUS,
  buildAction,
  buildClose,
  buildRecount,
  buildRecountNfts,
  buildRelease,
  buildReleaseNfts,
  buildVoteEscrow,
  buildVoteHeld,
  buildVoteNft,
  getAssetBalance,
  getCurrentRound,
  getHeldCollectionPieces,
  getVoteFactoryId,
  getVoteState,
  listBallots,
  listNftVotes,
  planSettlement,
  requestVoteKeeper,
  signAndSend,
  verifyVote,
  type BallotInfo,
  type NftVote,
  type VoteNetwork,
  type VoteState,
} from "../../utils/voteTool";
import {
  Notice,
  OPTION_COLORS,
  Panel,
  PieChart,
  formatUnits,
  inputClass,
  lookupNfds,
  primaryButtonClass,
  roundsToRelative,
  secondaryButtonClass,
  shortAddr,
  useAssetInfo,
} from "./shared";

const algodSafe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

function statusLabel(s: VoteState, round: number) {
  if (s.status === STATUS.CANCELLED) return "Cancelled";
  if (s.status === STATUS.FINALIZED) return "Final";
  if (s.status === STATUS.CLOSED) return "Closed";
  if (round < s.startRound) return "Upcoming";
  if (round > s.endRound) return "Ended";
  return "Live";
}

export function VoteDetail({ network, appId }: { network: VoteNetwork; appId: number }) {
  const { activeAddress, transactionSigner } = useWallet();
  const factoryId = getVoteFactoryId(network);

  const [state, setState] = useState<VoteState | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [ballots, setBallots] = useState<BallotInfo[]>([]);
  const [nfts, setNfts] = useState<NftVote[]>([]);
  const [round, setRound] = useState(0);
  const [names, setNames] = useState<Record<string, string>>({});
  const [myBalance, setMyBalance] = useState<bigint | null>(null);
  const [myPieces, setMyPieces] = useState<number[]>([]);
  const [votes, setVotes] = useState("1");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keeperPinged = useRef(false);

  const asset = useAssetInfo(network, state?.mode === MODE.NFT ? 0 : state?.asset ?? 0);
  const decimals = asset?.decimals ?? 0;

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([getVoteState(network, appId), getCurrentRound(network)]);
      setState(s);
      setRound(r);
      setError(null);
      // An ended vote that isn't closed yet: let the keeper settle it (throttled server-side).
      const unsettled = (s.status === STATUS.ACTIVE && r > s.endRound) || s.status === STATUS.FINALIZED || s.status === STATUS.CANCELLED;
      if (unsettled && !keeperPinged.current) {
        keeperPinged.current = true;
        requestVoteKeeper(network, appId);
      }
      const [b, n, ok] = await Promise.all([
        algodSafe(listBallots(network, appId), [] as BallotInfo[]),
        s.mode === MODE.NFT ? algodSafe(listNftVotes(network, appId), [] as NftVote[]) : Promise.resolve([] as NftVote[]),
        factoryId ? algodSafe(verifyVote(network, factoryId, s), false) : Promise.resolve(false),
      ]);
      setBallots(b);
      setNfts(n);
      setVerified(ok);
      lookupNfds(network, b.map((x) => x.voter)).then(setNames);
    } catch (err: any) {
      setError(err?.message || "This vote could not be loaded.");
    }
  }, [network, appId, factoryId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!activeAddress || !state) return;
    if (state.mode === MODE.NFT) {
      getHeldCollectionPieces(network, activeAddress, state.collections, state.unitPrefix).then(setMyPieces).catch(() => setMyPieces([]));
    } else {
      getAssetBalance(network, activeAddress, state.asset).then(setMyBalance);
    }
  }, [activeAddress, state?.mode, state?.asset, state?.collections.join(), state?.unitPrefix, network, ballots.length]);

  const myBallot = useMemo(() => ballots.find((b) => b.voter === activeAddress) ?? null, [ballots, activeAddress]);
  const counted = useMemo(() => new Set(nfts.map((n) => n.assetId)), [nfts]);
  const freshPieces = myPieces.filter((id) => !counted.has(id));
  const plan = useMemo(() => (state ? planSettlement(state, ballots, nfts, round) : null), [state, ballots, nfts, round]);

  async function run(label: string, groups: () => Promise<any[][] | any[]>) {
    if (!activeAddress) return toast.info("Connect a wallet first.");
    setBusy(label);
    try {
      const built = await groups();
      const list: any[][] = Array.isArray(built[0]) ? (built as any[][]) : [built as any[]];
      for (const g of list) await signAndSend(network, g, transactionSigner);
      toast.success(`${label}: done`);
      // Every ballot cast triggers a keeper pass: wallets that moved tokens after voting get recounted.
      if (label === "Vote") requestVoteKeeper(network, appId);
      await load();
    } catch (err: any) {
      toast.error(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="w-full max-w-3xl">
        <Notice tone="error">{error}</Notice>
      </div>
    );
  }
  if (!state || !plan) return <div className="w-full max-w-3xl h-64 rounded-3xl bg-banner-grey/30 animate-pulse" />;

  const label = statusLabel(state, round);
  const live = label === "Live";
  const locked = round >= state.startRound;
  const customRules = !KNOWN_VOTE_TEMPLATES.includes(state.programHash);
  const isCreator = activeAddress === state.creator;
  const unitLabel = state.mode === MODE.NFT ? "pieces" : asset?.unitName || "units";
  const weightLabel = (w: bigint) => `${w.toLocaleString()} vote${w === 1n ? "" : "s"}`;
  const shareUrl = `${window.location.origin}/vote/${appId}`;
  const canFallback = state.payoutPending && round > state.endRound + state.payoutGrace;

  const vote = (option: number) => {
    if (!activeAddress) return toast.info("Connect a wallet first.");
    if (state.mode === MODE.ESCROW) {
      const n = Number(votes);
      if (!Number.isInteger(n) || n <= 0) return toast.error("Enter a whole number of votes.");
      return run("Vote", () => buildVoteEscrow(network, state, activeAddress, option, n, !!myBallot));
    }
    if (state.mode === MODE.HELD) return run("Vote", () => buildVoteHeld(network, state, activeAddress, option, !!myBallot));
    if (freshPieces.length === 0 && !myBallot) return toast.error("You don't hold any uncounted pieces of this collection.");
    return run("Vote", () => buildVoteNft(network, state, activeAddress, option, freshPieces, !!myBallot));
  };

  /** Read-only modes: find ballots whose wallets no longer hold what they voted with. */
  const recountMoved = () =>
    run("Recount", async () => {
      if (state.mode === MODE.HELD) {
        const stale: string[] = [];
        for (const b of ballots) {
          const bal = (await getAssetBalance(network, b.voter, state.asset)) ?? 0n;
          if (bal / state.amountPerVote < b.weight) stale.push(b.voter);
        }
        if (!stale.length) throw new Error("Every ballot is still backed by its wallet.");
        return buildRecount(network, appId, activeAddress!, stale);
      }
      const stale: number[] = [];
      for (const n of nfts) if (((await getAssetBalance(network, n.voter, n.assetId)) ?? 0n) === 0n) stale.push(n.assetId);
      if (!stale.length) throw new Error("Every counted piece is still in its voter's wallet.");
      return buildRecountNfts(network, appId, activeAddress!, stale);
    });

  return (
    <div className="w-full max-w-4xl flex flex-col gap-6">
      <Link to="/vote" className="text-xs font-bold text-gray-400 hover:text-white flex items-center gap-1">
        <MdArrowBack /> All votes
      </Link>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-primary-orange/40 text-primary-orange">{label}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{MODE_LABELS[state.mode]}</span>
          {locked && state.status === STATUS.ACTIVE && (
            <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1" title="The rules can no longer be changed">
              <MdLock /> Rules locked
            </span>
          )}
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-white break-words">{state.title || `Vote #${state.voteNo}`}</h1>
        {state.description && <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap break-words">{state.description}</p>}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400 mt-4">
          <span>
            {round < state.startRound ? `Starts ${roundsToRelative(state.startRound, round)}` : live ? `Ends ${roundsToRelative(state.endRound, round)}` : `Ended round ${state.endRound.toLocaleString()}`}
          </span>
          {state.mode !== MODE.NFT && asset && (
            <span>
              {formatUnits(state.amountPerVote, decimals)} {asset.unitName} = 1 vote
            </span>
          )}
          {state.mode === MODE.NFT && (
            <span title={state.collections.join("\n")}>
              1 piece = 1 vote · minted by {state.collections.length === 1 ? shortAddr(state.collections[0]) : `${state.collections.length} wallets`}
              {state.unitPrefix && ` · unit name starts with "${state.unitPrefix}"`}
            </span>
          )}
          {state.mode === MODE.ESCROW && <span>Tokens go: {RETURN_LABELS[state.returnMode]}</span>}
          {state.gateApp !== 0 && <span>Voters must be listed in app {state.gateApp}</span>}
          <button className="flex items-center gap-1 hover:text-white" onClick={() => navigator.clipboard.writeText(shareUrl).then(() => toast.success("Link copied"))}>
            <MdContentCopy /> Share link
          </button>
        </div>
        <div className="flex flex-col gap-2 mt-4">
          {verified === false && <Notice tone="error">This app isn't listed in the Vote Tool registry. It may be a look-alike. Don't send tokens to it.</Notice>}
          {customRules && (
            <Notice tone="warn">
              <MdWarning className="inline mr-1" />
              The creator upgraded this vote's program before voting started, so it doesn't match the published Vote Tool code. Review it before sending tokens.
            </Notice>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {state.options.map((o) => {
          const share = state.totalWeight > 0n ? Number((o.weight * 10_000n) / state.totalWeight) / 100 : 0;
          return (
            <Panel key={o.index} className={state.winner === o.index ? "!border-primary-orange" : ""}>
              <div className="flex items-start gap-3">
                <span className="w-3 h-3 rounded-full mt-1.5 shrink-0" style={{ background: OPTION_COLORS[o.index] }} />
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-black text-white break-words">
                    {o.title} {state.winner === o.index && <span className="text-primary-orange text-xs align-middle">WINNER</span>}
                  </h2>
                  {o.description && <p className="text-sm text-gray-400 break-words">{o.description}</p>}
                  {state.mode === MODE.ESCROW && state.returnMode === RETURN.WINNER && (
                    <p className="text-[11px] text-gray-500 mt-1">Pool goes to {shortAddr(o.recipient)} if this wins</p>
                  )}
                  <p className="text-xs text-gray-300 mt-2">
                    {weightLabel(o.weight)} · {share}%
                  </p>
                </div>
              </div>
              {live && (
                <button className={`${primaryButtonClass} w-full mt-4`} disabled={!!busy || !activeAddress} onClick={() => vote(o.index)}>
                  {myBallot?.option === o.index ? "Add / refresh my vote" : myBallot ? "Move my vote here" : "Vote"}
                </button>
              )}
            </Panel>
          );
        })}
      </div>

      {live && activeAddress && (
        <Panel>
          {state.mode === MODE.ESCROW && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="text-xs text-gray-400 shrink-0">Votes to cast</label>
              <input className={`${inputClass} sm:max-w-[140px]`} value={votes} inputMode="numeric" onChange={(e) => setVotes(e.target.value.replace(/\D/g, ""))} />
              <span className="text-xs text-gray-400">
                = {formatUnits(BigInt(Number(votes) || 0) * state.amountPerVote, decimals)} {asset?.unitName} sent to the vote
                {myBalance !== null && ` (you hold ${formatUnits(myBalance, decimals)})`}
              </span>
            </div>
          )}
          {state.mode === MODE.HELD && (
            <p className="text-xs text-gray-400">
              Your weight: {myBalance === null ? "not opted in" : weightLabel(myBalance / state.amountPerVote)}. Nothing is sent. Keep the tokens in this wallet until
              the vote ends, or anyone can recount you.
            </p>
          )}
          {state.mode === MODE.NFT && (
            <p className="text-xs text-gray-400">
              You hold {myPieces.length} piece{myPieces.length === 1 ? "" : "s"} of this collection; {freshPieces.length} not counted yet. Nothing is sent.
            </p>
          )}
          {myBallot && (
            <p className="text-xs text-gray-300 mt-2">
              Your ballot: {state.options[myBallot.option]?.title} · {weightLabel(myBallot.weight)}
            </p>
          )}
        </Panel>
      )}

      <Panel>
        <h2 className="text-lg font-black text-white mb-4">Results</h2>
        <div className="flex flex-col sm:flex-row gap-6 items-center">
          <PieChart values={state.options.map((o) => ({ label: o.title, value: Number(o.weight) }))} />
          <ul className="flex-1 w-full flex flex-col gap-2">
            {state.options.map((o) => (
              <li key={o.index} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: OPTION_COLORS[o.index] }} />
                <span className="flex-1 truncate text-gray-200">{o.title}</span>
                <span className="text-gray-400 tabular-nums">{o.weight.toLocaleString()}</span>
              </li>
            ))}
            <li className="text-xs text-gray-500 pt-2 border-t border-white/[0.08]">
              {state.voters.toLocaleString()} voter{state.voters === 1 ? "" : "s"} · {state.totalWeight.toLocaleString()} total votes
              {state.mode === MODE.ESCROW && ` · ${formatUnits(state.totalEscrow, decimals)} ${unitLabel} held`}
            </li>
          </ul>
        </div>

        {ballots.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="py-2 pr-3">Option</th>
                  <th className="py-2 pr-3">Voter</th>
                  <th className="py-2 text-right">Weight</th>
                </tr>
              </thead>
              <tbody>
                {ballots.map((b) => (
                  <tr key={b.voter} className="border-t border-white/[0.06]">
                    <td className="py-2 pr-3">
                      <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: OPTION_COLORS[b.option] }} />
                      {state.options[b.option]?.title}
                    </td>
                    <td className="py-2 pr-3">
                      <a className="hover:text-primary-orange" href={`https://allo.info/account/${b.voter}`} target="_blank" rel="noreferrer">
                        {names[b.voter] ?? shortAddr(b.voter)}
                      </a>
                    </td>
                    <td className="py-2 text-right tabular-nums">{b.weight.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <h2 className="text-lg font-black text-white mb-2">Ending &amp; returns</h2>
        <p className="text-xs text-gray-400 mb-4">
          Anyone can run these steps once the vote ends. Every ballot's deposit goes back to its voter
          {state.mode === MODE.ESCROW && state.returnMode === RETURN.SENDERS ? ", together with their tokens" : ""}.
        </p>
        {plan.payout && (
          <p className="text-xs text-gray-300 mb-3">
            Payout: {formatUnits(plan.payout.amount, decimals)} {unitLabel} → {shortAddr(plan.payout.to)}
            {state.paidTo !== "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" && " (paid)"}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {plan.blocking === "finalize" && (
            <button className={primaryButtonClass} disabled={!!busy} onClick={() => run("Finalize", () => buildAction(network, appId, activeAddress!, "finalize"))}>
              Finalize results
            </button>
          )}
          {plan.blocking === "payout" && (
            <button className={primaryButtonClass} disabled={!!busy} onClick={() => run("Payout", () => buildAction(network, appId, activeAddress!, "payout"))}>
              Send payout
            </button>
          )}
          {canFallback && (
            <button className={secondaryButtonClass} disabled={!!busy} onClick={() => run("Switch to refunds", () => buildAction(network, appId, activeAddress!, "fallbackToRefunds"))}>
              Payout undeliverable: refund voters
            </button>
          )}
          {!plan.blocking && myBallot && state.status !== STATUS.ACTIVE && (
            <button className={primaryButtonClass} disabled={!!busy} onClick={() => run("Claim", () => buildRelease(network, appId, activeAddress!, [activeAddress!]))}>
              Claim my {state.mode === MODE.ESCROW && state.returnMode === RETURN.SENDERS ? "tokens + " : ""}deposit
            </button>
          )}
          {!plan.blocking && state.status !== STATUS.ACTIVE && (ballots.length > 0 || nfts.length > 0) && (
            <button
              className={secondaryButtonClass}
              disabled={!!busy}
              onClick={() =>
                run("Return everyone's", async () => [
                  ...(ballots.length ? await buildRelease(network, appId, activeAddress!, ballots.map((b) => b.voter)) : []),
                  ...(nfts.length ? await buildReleaseNfts(network, appId, activeAddress!, nfts.map((n) => n.assetId)) : []),
                ])
              }
            >
              Return everyone's ({ballots.length + nfts.length})
            </button>
          )}
          {plan.closable && (
            <button className={secondaryButtonClass} disabled={!!busy} onClick={() => run("Close", () => buildClose(network, factoryId, appId, activeAddress!))}>
              Close vote (creator gets storage deposit back)
            </button>
          )}
          {live && state.mode !== MODE.ESCROW && ballots.length > 0 && (
            <button className={secondaryButtonClass} disabled={!!busy} onClick={recountMoved}>
              Recount moved {state.mode === MODE.NFT ? "pieces" : "tokens"}
            </button>
          )}
          {isCreator && state.status === STATUS.ACTIVE && round <= state.endRound && (
            <button className={secondaryButtonClass} disabled={!!busy} onClick={() => run("Cancel", () => buildAction(network, appId, activeAddress!, "cancel"))}>
              Cancel vote
            </button>
          )}
        </div>
        {busy && <p className="text-xs text-primary-orange mt-3">{busy}… confirm in your wallet</p>}
      </Panel>

      <Panel>
        <h2 className="text-lg font-black text-white mb-2">Use this result in your own contract</h2>
        <p className="text-xs text-gray-400 mb-3">
          This vote lets any app read its boxes (Algorand v5 <code>ForeignBoxReads</code>). A DAO treasury can release funds only if a vote passed, with no oracle:
        </p>
        <pre className="text-[11px] bg-black/40 rounded-xl p-3 overflow-x-auto text-gray-300">{`// Algorand TypeScript (AVM v13)
const voteApp = Application(${appId})
const [tally] = op.AppBox.get(voteApp, Bytes('t'))   // 16 × uint64, one per option
const [winner] = op.AppGlobal.getExUint64(voteApp, Bytes('winner'))
const [status] = op.AppGlobal.getExUint64(voteApp, Bytes('status')) // 1 = final`}</pre>
        <p className="text-[11px] text-gray-500 mt-2">
          App {appId} · registry entry v{state.voteNo} in app {state.registry} · ballots: box <code>b</code>+address
        </p>
      </Panel>
    </div>
  );
}
