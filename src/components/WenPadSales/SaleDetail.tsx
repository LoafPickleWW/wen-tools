import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";
import confetti from "canvas-confetti";
import { verifySaleApp } from "../../utils/shuffleVerify";
import {
  MdArrowBack,
  MdCasino,
  MdCheckCircle,
  MdHourglassEmpty,
  MdImage,
  MdInbox,
  MdOpenInNew,
} from "react-icons/md";
import {
  REVEAL_WINDOW,
  STATUS,
  buildArc59Claim,
  buildCommit,
  buildQueueStep,
  buyerLineItems,
  fetchCollectionJson,
  findRevealForCommit,
  getCommit,
  getCurrentRound,
  getFactoryId,
  getSaleByApp,
  getSaleState,
  holdsAsset,
  ipfsToHttp,
  listCommits,
  parseCommitResult,
  parseRevealedAsset,
  planQueueUpTo,
  requestKeeperClose,
  requestKeeperReveal,
  signAndSend,
  type CollectionJson,
  type CommitInfo,
  type SaleListing,
  type SaleNetwork,
  type SaleState,
} from "../../utils/wenpadSale";
import {
  ExperimentalNotice,
  Notice,
  Panel,
  ProgressBar,
  StatusBadge,
  formatAlgo,
  primaryButtonClass,
  roundsToRelative,
  secondaryButtonClass,
  shortAddr,
} from "./shared";

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "revealing"; commitId: number; targetRound: number }
  | { kind: "manual"; commitId: number; targetRound: number }
  | { kind: "done"; assetId: number; inWallet: boolean };

const explorerAsset = (network: SaleNetwork, assetId: number) =>
  `https://${network === "testnet" ? "testnet." : ""}explorer.perawallet.app/asset/${assetId}/`;

export function SaleDetail({ network, appId }: { network: SaleNetwork; appId: number }) {
  const { activeAddress, transactionSigner } = useWallet();
  const factoryId = getFactoryId(network);

  const [sale, setSale] = useState<SaleListing | null>(null);
  const [state, setState] = useState<SaleState | null>(null);
  const [collection, setCollection] = useState<CollectionJson | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [myCommits, setMyCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [verified, setVerified] = useState<boolean | null>(null);

  // Does this Shuffle app run exactly the published, open-source sale program?
  useEffect(() => {
    let cancelled = false;
    verifySaleApp(network, appId)
      .then((ok) => !cancelled && setVerified(ok))
      .catch(() => !cancelled && setVerified(null));
    return () => {
      cancelled = true;
    };
  }, [network, appId]);

  const refresh = useCallback(async () => {
    try {
      const [listing, saleState, round] = await Promise.all([
        getSaleByApp(network, factoryId, appId),
        getSaleState(network, appId),
        getCurrentRound(network),
      ]);
      // The keeper closes a Shuffle right after its last delivery; keep showing the last
      // known details so the buyer's result and claim button stay on screen
      if (listing || !sale) setSale(listing);
      setState(saleState);
      setCurrentRound(round);
      if (listing && !collection) setCollection(await fetchCollectionJson(listing.metadata.metadataUrl, appId));
      if (activeAddress) setMyCommits(await listCommits(network, appId, activeAddress));
    } catch (err) {
      // A closed Shuffle's app no longer exists; keep the last known state
      if (!state) console.error("Failed to load sale:", err);
    } finally {
      setLoading(false);
    }
  }, [network, factoryId, appId, activeAddress, collection, sale, state]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, appId, activeAddress]);

  const finish = async (assetId: number) => {
    const inWallet = activeAddress ? await holdsAsset(network, activeAddress, assetId) : false;
    setPhase({ kind: "done", assetId, inWallet });
    confetti({ particleCount: 180, spread: 100, origin: { y: 0.6 } });
    refresh();
  };

  /** Keeper first; if it cannot reveal, check whether it already did, else hand over to the buyer. */
  const revealViaKeeper = async (commitId: number, targetRound: number) => {
    setPhase({ kind: "revealing", commitId, targetRound });
    const result = await requestKeeperReveal(network, appId, commitId);
    if (result?.assetId) return finish(result.assetId);

    const found = await findRevealForCommit(network, appId, commitId, targetRound);
    if (found) return finish(found.assetId);
    setPhase({ kind: "manual", commitId, targetRound });
  };

  const handleMint = async () => {
    if (!activeAddress || !state) return;
    setPhase({ kind: "signing" });
    try {
      const txns = await buildCommit(network, activeAddress, state);
      const confirmation = await signAndSend(network, txns, transactionSigner);
      const { commitId, targetRound } = parseCommitResult(confirmation);
      toast.success("Mint reserved! Drawing your NFT…");
      await revealViaKeeper(commitId, targetRound);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Mint failed");
      setPhase({ kind: "idle" });
    }
  };

  const [claiming, setClaiming] = useState(false);
  const handleClaim = async (assetId: number) => {
    if (!activeAddress) return;
    setClaiming(true);
    try {
      await signAndSend(network, await buildArc59Claim(network, activeAddress, assetId), transactionSigner);
      toast.success("Claimed! The NFT is now in your wallet.");
      setPhase({ kind: "done", assetId, inWallet: true });
    } catch (err: any) {
      toast.error(err?.message || "Claim failed");
    } finally {
      setClaiming(false);
    }
  };

  /**
   * Resolve one of my mints from my own wallet. Mints resolve in order, so any earlier pending
   * mints (anyone's) are resolved first, one signature each; expired ones are cancelled and refunded.
   */
  const resolveMine = async (commitId: number) => {
    if (!activeAddress) return;
    try {
      const commit = await getCommit(network, appId, commitId);
      if (!commit) {
        const found = await findRevealForCommit(network, appId, commitId, 0);
        if (found) return finish(found.assetId);
        throw new Error("This mint was already resolved");
      }
      const steps = await planQueueUpTo(network, appId, commitId);
      if (steps.length > 1) {
        toast.info(`${steps.length - 1} earlier mint(s) must be delivered first: ${steps.length} signatures in total.`);
      }
      let confirmation: any = null;
      for (const step of steps) {
        confirmation = await signAndSend(network, await buildQueueStep(network, activeAddress, appId, step), transactionSigner);
      }
      const mine = steps[steps.length - 1];
      // If this sold the Shuffle out, let the keeper close it and pay everyone out
      requestKeeperClose(network, appId);
      if (mine?.action === "cancel") {
        toast.success("Expired mint cancelled and refunded");
        refresh();
        return;
      }
      const revealed = confirmation ? parseRevealedAsset(confirmation.logs) : null;
      if (revealed) await finish(revealed.assetId);
      else {
        toast.info("No deliverable item was left; your payment was refunded.");
        setPhase({ kind: "idle" });
        refresh();
      }
    } catch (err: any) {
      toast.error(err?.message || "Reveal failed");
    }
  };

  const handleManualReveal = resolveMine;
  const handleCancelExpired = resolveMine;

  if (loading) {
    return <div className="w-full max-w-5xl h-96 rounded-3xl bg-banner-grey/30 animate-pulse" />;
  }

  if (!sale || !state) {
    return (
      <Panel className="max-w-xl text-center">
        <p className="text-gray-300 font-bold">This Shuffle has closed, or it isn't in the wen.tools Shuffle registry.</p>
        <Link to="/shuffle" className="text-primary-orange text-sm font-bold hover:underline mt-3 inline-block">
          ← Back to Shuffle
        </Link>
      </Panel>
    );
  }

  const items = buyerLineItems(state);
  const ended = currentRound > state.endRound;
  const notStarted = currentRound < state.startRound;
  const soldOut = state.remaining - state.pending <= 0;
  const canMint =
    !!activeAddress && state.status === STATUS.LIVE && !ended && !notStarted && !soldOut && phase.kind === "idle";
  const image = ipfsToHttp(collection?.image || sale.metadata.metadataUrl || "");
  const busy = phase.kind === "signing" || phase.kind === "revealing";

  return (
    <div className="w-full max-w-5xl flex flex-col gap-6 text-left">
      <Link to="/shuffle" className="flex items-center gap-1 text-sm text-gray-400 hover:text-white w-fit">
        <MdArrowBack /> All shuffles
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Collection */}
        <div className="flex flex-col gap-4">
          <div className="aspect-square rounded-3xl overflow-hidden bg-asset-detail-bg/60 border border-white/[0.12] flex items-center justify-center">
            {image ? (
              <img src={image} alt={sale.metadata.name} className="w-full h-full object-cover" />
            ) : (
              <MdImage size={64} className="text-gray-700" />
            )}
          </div>
          <Panel className="space-y-2 text-sm">
            <Row label="Creator" value={shortAddr(state.admin)} />
            <Row label="Standard" value={sale.metadata.standard} />
            <Row label="Shuffle app" value={String(appId)} />
            <Row
              label="Contract"
              value={verified === null ? "checking…" : verified ? "✓ matches open-source code" : "✗ does not match published source"}
            />
            <Row label="Distribution wallet" value={shortAddr(state.distribution)} />
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {collection?.external_url && (
                <a
                  href={collection.external_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-primary-orange font-bold text-xs hover:underline"
                >
                  Website <MdOpenInNew />
                </a>
              )}
              {collection?.socials?.twitter && (
                <a
                  href={
                    collection.socials.twitter.startsWith("http")
                      ? collection.socials.twitter
                      : `https://x.com/${collection.socials.twitter.replace(/^@/, "")}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-primary-orange font-bold text-xs hover:underline"
                >
                  X / Twitter <MdOpenInNew />
                </a>
              )}
              {collection?.socials?.discord && (
                <a
                  href={
                    collection.socials.discord.startsWith("http")
                      ? collection.socials.discord
                      : `https://discord.gg/${collection.socials.discord}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-primary-orange font-bold text-xs hover:underline"
                >
                  Discord <MdOpenInNew />
                </a>
              )}
            </div>
          </Panel>
        </div>

        {/* Mint */}
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-black text-white">{sale.metadata.name}</h2>
              <StatusBadge status={state.status} ended={ended} />
            </div>
            {collection?.description && (
              <p className="text-sm text-gray-400 mt-2 leading-relaxed whitespace-pre-line">{collection.description}</p>
            )}
          </div>

          <Panel className="space-y-3">
            <div className="flex justify-between text-xs font-bold text-gray-400">
              <span>
                {state.sold} / {state.total} minted{sale.volume > 0 && ` · ${formatAlgo(sale.volume, 2)} volume`}
              </span>
              <span>
                {ended
                  ? `Ended ${roundsToRelative(state.endRound, currentRound)}`
                  : notStarted
                    ? `Starts ${roundsToRelative(state.startRound, currentRound)}`
                    : `Ends ${roundsToRelative(state.endRound, currentRound)}`}
              </span>
            </div>
            <ProgressBar value={state.sold} total={state.total} />
          </Panel>

          {/* Line items */}
          <Panel className="space-y-3">
            <p className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em]">What you pay per mint</p>
            <LineItem label="Mint price" sub="Goes to the creator" value={items.price} />
            <LineItem label="Delivery fee" sub="Covers the network fees to send you the NFT" value={items.revealFee} />
            <LineItem label="Storage deposit" sub="Refundable — returned with your NFT" value={items.storageDeposit} />
            <LineItem
              label="Delivery deposit (ARC-59)"
              sub="Refundable — see below"
              value={items.deliveryDeposit}
            />
            <div className="border-t border-white/[0.08] pt-3 flex justify-between items-baseline">
              <span className="font-black text-white">Total</span>
              <span className="font-black text-xl text-primary-orange">{formatAlgo(items.total)}</span>
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Your {formatAlgo(items.refundable, 3)} deposit comes back to you. If you are already opted in to the
              NFT you draw, it is refunded straight to your wallet. Otherwise the NFT is sent to your ARC-59 inbox:
              part of the deposit pays the one-time inbox setup (up to about 0.33 ALGO, less if you already have an
              inbox) and the rest travels with the NFT, returned to you when you claim it.
            </p>
          </Panel>

          <ExperimentalNotice compact />
          {state.status === STATUS.PAUSED && <Notice tone="warn">Minting is paused by the creator.</Notice>}
          {state.status === STATUS.SETUP && <Notice tone="info">This Shuffle has not gone live yet.</Notice>}
          {soldOut && state.status !== STATUS.RELEASED && <Notice tone="info">All items are reserved or sold.</Notice>}

          {phase.kind === "idle" && (
            <button onClick={handleMint} disabled={!canMint} className={`${primaryButtonClass} py-4 text-base`}>
              <MdCasino size={22} />
              {activeAddress ? `Mint a random NFT · ${formatAlgo(items.total, 3)}` : "Connect a wallet to mint"}
            </button>
          )}

          {busy && (
            <Panel className="flex items-center gap-3">
              <MdHourglassEmpty className="animate-spin text-primary-orange" size={22} />
              <div className="text-sm">
                <p className="font-bold text-white">
                  {phase.kind === "signing" ? "Confirm in your wallet…" : "Drawing your NFT…"}
                </p>
                <p className="text-xs text-gray-500">
                  {phase.kind === "signing"
                    ? "One signature reserves your mint."
                    : "The draw uses the next block's seed, so it takes a few seconds."}
                </p>
              </div>
            </Panel>
          )}

          {phase.kind === "manual" && (
            <Panel className="space-y-3">
              <p className="text-sm text-gray-300">
                Your NFT has been drawn, but automatic delivery didn't go through. Confirm once more to have it sent
                to you. You get the delivery fee back for doing it yourself.
              </p>
              <button onClick={() => handleManualReveal(phase.commitId)} className={primaryButtonClass}>
                Receive my NFT
              </button>
            </Panel>
          )}

          {phase.kind === "done" && (
            <Panel className="space-y-3 border-green-500/30">
              <div className="flex items-center gap-2 text-green-300 font-black">
                <MdCheckCircle size={22} /> You got asset #{phase.assetId}!
              </div>
              {phase.inWallet ? (
                <p className="text-sm text-gray-300">It is in your wallet, and your deposit has been refunded.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-300 flex items-start gap-2">
                    <MdInbox className="mt-0.5 shrink-0 text-primary-orange" />
                    It's waiting in your ARC-59 inbox with the rest of your deposit. Claim it now to move it into your
                    wallet (this opts you in and returns the leftover deposit).
                  </p>
                  <button onClick={() => handleClaim(phase.assetId)} disabled={claiming} className={primaryButtonClass}>
                    <MdInbox /> {claiming ? "Claiming…" : "Claim my NFT"}
                  </button>
                  <p className="text-[11px] text-gray-500">
                    You can also claim later from your wallet (Pera shows the inbox) or the{" "}
                    <Link to="/bulk-claim" className="text-primary-orange font-bold hover:underline">
                      claim tool
                    </Link>
                    .
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Link to={`/wallet/asset/${phase.assetId}`} className={secondaryButtonClass}>
                  View NFT
                </Link>
                <a href={explorerAsset(network, phase.assetId)} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                  Explorer <MdOpenInNew />
                </a>
                <button onClick={() => setPhase({ kind: "idle" })} className={secondaryButtonClass}>
                  Mint another
                </button>
              </div>
            </Panel>
          )}

          {/* Pending mints left over from a previous visit */}
          {myCommits.length > 0 && phase.kind === "idle" && (
            <Panel className="space-y-3">
              <p className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em]">Your pending mints</p>
              {myCommits.map((c) => {
                const expired = currentRound > c.targetRound + REVEAL_WINDOW;
                return (
                  <div key={c.commitId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-gray-300">Mint #{c.commitId}</span>
                    {expired ? (
                      <button onClick={() => handleCancelExpired(c.commitId)} className={secondaryButtonClass}>
                        Cancel & refund
                      </button>
                    ) : (
                      <button onClick={() => handleManualReveal(c.commitId)} className={secondaryButtonClass}>
                        Receive NFT
                      </button>
                    )}
                  </div>
                );
              })}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200 font-bold font-mono text-xs">{value}</span>
    </div>
  );
}

function LineItem({ label, sub, value }: { label: string; sub: string; value: number }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <div>
        <p className="text-sm font-bold text-white">{label}</p>
        <p className="text-[11px] text-gray-500">{sub}</p>
      </div>
      <span className="text-sm font-bold text-gray-200 whitespace-nowrap">{formatAlgo(value)}</span>
    </div>
  );
}
