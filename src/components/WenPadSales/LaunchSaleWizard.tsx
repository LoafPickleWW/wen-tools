import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";
import algosdk from "algosdk";
import confetti from "canvas-confetti";
import { MdCheckCircle, MdHourglassEmpty, MdRefresh, MdWarning } from "react-icons/md";
import {
  ITEM_PAGE_MBR,
  BPS_TOTAL,
  MAX_ITEMS_PER_GROUP,
  MAX_PAYOUTS,
  MIN_DELIVERY_BUDGET,
  MIN_REVEAL_FEE,
  STATUS,
  algoToMicro,
  buildAddItemsGroup,
  buildCreateSale,
  buildRegister,
  dateToRound,
  estimateCreateSaleMbr,
  getAlgod,
  getCurrentRound,
  getFactoryId,
  getSaleState,
  isStaleBoxReference,
  itemPagesFor,
  loadLastMint,
  loadLaunchProgress,
  parseCreateSaleResult,
  saveLaunchProgress,
  signAndSend,
  type CollectionJson,
  type LaunchProgress,
  type PayoutSplit,
  type SaleMetadata,
  type SaleNetwork,
} from "../../utils/wenpadSale";
import { pinJSONToFilebase } from "../../filebase";
import { pinJSONToPinata } from "../../utils";
import {
  hasClawback,
  hasFreeze,
  isNft,
  isSellable,
  loadDistributionAssets,
  parseAssetIds,
  type CandidateAsset,
} from "./assetLoader";
import {
  ExperimentalNotice,
  FieldLabel,
  Notice,
  Panel,
  ProgressBar,
  formatAlgo,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  shortAddr,
} from "./shared";

const STEPS = ["Wallets", "Collection", "Items", "Shuffle settings", "Launch"];
const byteLength = (s: string) => new TextEncoder().encode(s).length;

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function LaunchSaleWizard({ network }: { network: SaleNetwork }) {
  const { activeAddress, transactionSigner } = useWallet();
  const factoryId = getFactoryId(network);
  const lastMint = useMemo(() => {
    const m = loadLastMint();
    return m && m.network === network ? m : null;
  }, [network]);

  const [step, setStep] = useState(0);

  // Wallets: the connected wallet is the collection (distribution) wallet and signs the launch
  const [resumedDistribution, setResumedDistribution] = useState("");
  const distribution = resumedDistribution || activeAddress || "";
  const [payouts, setPayouts] = useState<{ address: string; percent: string }[]>([{ address: "", percent: "100" }]);
  const [managerIsFirstPayout, setManagerIsFirstPayout] = useState(true);
  const [managerInput, setManagerInput] = useState("");
  const admin = managerIsFirstPayout ? payouts[0]?.address.trim() || "" : managerInput.trim();
  const [walletCheck, setWalletCheck] = useState<{ ok: boolean; message: string } | null>(null);

  // Collection
  const [name, setName] = useState(lastMint?.name || "");
  const [unitName, setUnitName] = useState(lastMint?.unitName || "");
  const [standard, setStandard] = useState(lastMint?.standard || "ARC19");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [banner, setBanner] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [discord, setDiscord] = useState("");
  const [metadataMode, setMetadataMode] = useState<"pin" | "url">("pin");
  const [metadataUrl, setMetadataUrl] = useState("");
  const [pinProvider, setPinProvider] = useState<"Filebase" | "Pinata">("Filebase");
  const [pinToken, setPinToken] = useState(
    () => localStorage.getItem("filebaseToken") || localStorage.getItem("authBasic") || ""
  );
  const [pinning, setPinning] = useState(false);

  // Items
  const [candidates, setCandidates] = useState<CandidateAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState("");
  const [unitFilter, setUnitFilter] = useState(lastMint?.unitName || "");
  const [nameFilter, setNameFilter] = useState("");
  const [nftOnly, setNftOnly] = useState(true);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [itemMode, setItemMode] = useState<"wallet" | "paste">("wallet");
  const [pasted, setPasted] = useState("");

  // Sale settings
  const [priceAlgo, setPriceAlgo] = useState("5");
  const [startMode, setStartMode] = useState<"now" | "scheduled">("now");
  const [startAt, setStartAt] = useState(toLocalInput(new Date(Date.now() + 3600_000)));
  const [endAt, setEndAt] = useState(toLocalInput(new Date(Date.now() + 7 * 86_400_000)));
  const [revealFeeAlgo, setRevealFeeAlgo] = useState("0.025");
  const [deliveryAlgo, setDeliveryAlgo] = useState("0.4");

  // Launch
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const [busy, setBusy] = useState("");
  const [live, setLive] = useState(false);

  // The connected wallet gets rekeyed, so it must not already be rekeyed elsewhere
  useEffect(() => {
    setWalletCheck(null);
    if (!activeAddress || resumedDistribution) return;
    let cancelled = false;
    getAlgod(network)
      .accountInformation(activeAddress)
      .do()
      .then((info) => {
        if (cancelled) return;
        setWalletCheck(
          info["auth-addr"]
            ? { ok: false, message: "This wallet is rekeyed to another account, so it cannot be handed to a sale." }
            : { ok: true, message: `Holds ${info["total-assets-opted-in"] ?? 0} assets` }
        );
      })
      .catch(() => !cancelled && setWalletCheck({ ok: false, message: "Account not found on this network" }));
    return () => {
      cancelled = true;
    };
  }, [activeAddress, network, resumedDistribution]);

  // Resume an in-progress launch saved on this device
  useEffect(() => {
    const saved = loadLaunchProgress();
    if (saved && saved.network === network) {
      setProgress(saved);
      setResumedDistribution(saved.distribution);
      setStep(4);
    }
  }, [network]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const filtered = useMemo(
    () =>
      candidates.filter(
        (a) =>
          isSellable(a) &&
          (!nftOnly || isNft(a)) &&
          (!unitFilter || a.unitName.toLowerCase().startsWith(unitFilter.toLowerCase())) &&
          (!nameFilter || a.name.toLowerCase().includes(nameFilter.toLowerCase()))
      ),
    [candidates, nftOnly, unitFilter, nameFilter]
  );

  const selectedIds = useMemo(() => {
    if (itemMode === "paste") {
      const heldIds = new Set(candidates.filter(isSellable).map((a) => a.id));
      return parseAssetIds(pasted).filter((id) => candidates.length === 0 || heldIds.has(id));
    }
    return filtered.filter((a) => !excluded.has(a.id)).map((a) => a.id);
  }, [itemMode, pasted, candidates, filtered, excluded]);

  const selectedAssets = useMemo(() => {
    const byId = new Map(candidates.map((a) => [a.id, a]));
    return selectedIds.map((id) => byId.get(id)).filter((a): a is CandidateAsset => !!a);
  }, [selectedIds, candidates]);

  const clawbackCount = selectedAssets.filter(hasClawback).length;
  const freezeCount = selectedAssets.filter(hasFreeze).length;

  const metadata: SaleMetadata = { name, unitName, standard, metadataUrl };
  const factoryDeposit = estimateCreateSaleMbr(metadata);
  const itemStorage = itemPagesFor(progress?.assetIds.length ?? selectedIds.length) * ITEM_PAGE_MBR;

  // The collection wallet pays the launch: sale deposit + item storage + network fees. NFT deliveries
  // cost it nothing (inner transfers use fee 0; the revealer pays), so nothing extra is reserved for them.
  const itemGroups = Math.ceil((progress?.assetIds.length ?? selectedIds.length) / MAX_ITEMS_PER_GROUP);
  const launchFees = 10_000 + itemGroups * 20_000 + 10_000;
  const launchCost = (progress ? 0 : factoryDeposit) + itemStorage + launchFees;
  const [walletSpendable, setWalletSpendable] = useState<number | null>(null);
  useEffect(() => {
    if (step !== 4 || !distribution) return;
    let cancelled = false;
    getAlgod(network)
      .accountInformation(distribution)
      .do()
      .then((info) => !cancelled && setWalletSpendable(Number(info.amount) - Number(info["min-balance"])))
      .catch(() => !cancelled && setWalletSpendable(null));
    return () => {
      cancelled = true;
    };
  }, [step, distribution, network, progress?.itemsAdded, progress?.appId]);
  const fundsShort = walletSpendable !== null && !progress && walletSpendable < launchCost;

  // ── Step validation ────────────────────────────────────────────────────────

  const payoutSplits: PayoutSplit[] = payouts.map((p) => ({
    address: p.address.trim(),
    bps: Math.round((Number(p.percent) || 0) * 100),
  }));
  const totalBps = payoutSplits.reduce((n, p) => n + p.bps, 0);
  const payoutErrors = [
    payoutSplits.some((p) => !algosdk.isValidAddress(p.address)) && "Every payout needs a valid address.",
    payoutSplits.some((p) => p.bps <= 0) && "Every share must be above 0%.",
    totalBps !== BPS_TOTAL && `Shares add up to ${totalBps / 100}%, not 100%.`,
    new Set(payoutSplits.map((p) => p.address)).size !== payoutSplits.length && "Each payout address can only appear once.",
  ].filter(Boolean) as string[];
  const managerError = !algosdk.isValidAddress(admin)
    ? "Enter a valid manager address."
    : admin === distribution
      ? "The manager must be a different wallet: once the collection wallet is rekeyed it cannot sign."
      : "";

  const [riskAccepted, setRiskAccepted] = useState(false);
  const walletsValid =
    !!distribution && walletCheck?.ok === true && payoutErrors.length === 0 && !managerError && riskAccepted;

  const collectionValid =
    name.trim().length > 0 &&
    byteLength(name) <= 64 &&
    unitName.trim().length > 0 &&
    byteLength(unitName) <= 8 &&
    metadataUrl.length > 0 &&
    byteLength(metadataUrl) <= 256;

  const price = algoToMicro(Number(priceAlgo) || 0);
  const revealFee = algoToMicro(Number(revealFeeAlgo) || 0);
  const deliveryBudget = algoToMicro(Number(deliveryAlgo) || 0);
  const settingsValid =
    Number(priceAlgo) >= 0 &&
    revealFee >= MIN_REVEAL_FEE &&
    deliveryBudget >= MIN_DELIVERY_BUDGET &&
    new Date(endAt).getTime() > (startMode === "now" ? Date.now() : new Date(startAt).getTime());

  // ── Step 0: wallet checks ──────────────────────────────────────────────────

  const updatePayout = (i: number, patch: Partial<{ address: string; percent: string }>) =>
    setPayouts((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // ── Step 1: metadata pinning ───────────────────────────────────────────────

  const collectionJson: CollectionJson = {
    name,
    description,
    image,
    banner_image: banner || undefined,
    external_url: website || undefined,
    unit_name: unitName,
    standard,
    creator: distribution,
    socials: { twitter: twitter || undefined, discord: discord || undefined },
  };

  const handlePin = async () => {
    if (!pinToken) return toast.error(`Enter your ${pinProvider} token`);
    setPinning(true);
    try {
      const json = JSON.stringify(collectionJson);
      const cid =
        pinProvider === "Filebase" ? await pinJSONToFilebase(pinToken, json) : await pinJSONToPinata(pinToken, json);
      localStorage.setItem(pinProvider === "Filebase" ? "filebaseToken" : "pinataToken", pinToken);
      setMetadataUrl(`ipfs://${cid}`);
      toast.success("Collection metadata pinned");
    } catch (err: any) {
      toast.error(err?.message || "Pinning failed");
    } finally {
      setPinning(false);
    }
  };

  // ── Step 2: load assets ────────────────────────────────────────────────────

  const handleLoadAssets = async () => {
    try {
      setLoadingAssets("Loading…");
      setCandidates(await loadDistributionAssets(network, distribution, setLoadingAssets));
    } catch (err: any) {
      toast.error(err?.message || "Failed to load assets");
    } finally {
      setLoadingAssets("");
    }
  };

  useEffect(() => {
    if (step === 2 && candidates.length === 0 && algosdk.isValidAddress(distribution)) handleLoadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Step 4: launch ─────────────────────────────────────────────────────────

  const handleCreateSale = async () => {
    if (!activeAddress || activeAddress !== distribution) return toast.error("Connect the collection wallet");
    setBusy("Creating your Shuffle…");
    try {
      const currentRound = await getCurrentRound(network);
      const startRound = startMode === "now" ? currentRound : dateToRound(new Date(startAt), currentRound);
      const endRound = dateToRound(new Date(endAt), currentRound);
      const params = {
        admin,
        payouts: payoutSplits,
        price,
        startRound,
        endRound,
        revealFee,
        deliveryBudget,
        metadata,
      };
      // Another sale created at the same moment makes the box references stale; rebuild and retry
      let confirmation: any;
      for (let attempt = 1; ; attempt++) {
        try {
          confirmation = await signAndSend(
            network,
            await buildCreateSale(network, factoryId, distribution, params),
            transactionSigner
          );
          break;
        } catch (err) {
          if (!isStaleBoxReference(err) || attempt >= 3) throw err;
          toast.info("Another Shuffle was created at the same moment. Please sign again.");
        }
      }
      const { saleId, appId } = parseCreateSaleResult(confirmation);
      const next: LaunchProgress = { network, admin, distribution, saleId, appId, assetIds: selectedIds, itemsAdded: 0 };
      setProgress(next);
      saveLaunchProgress(next);
      toast.success(`Shuffle #${saleId} created`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to create Shuffle");
    } finally {
      setBusy("");
    }
  };

  const handleAddItems = async () => {
    if (!progress || !activeAddress) return;
    if (activeAddress !== progress.distribution && activeAddress !== progress.admin) {
      return toast.error("Connect the collection wallet");
    }
    try {
      // The chain is the source of truth for how many items are already loaded
      let added = (await getSaleState(network, progress.appId)).total;
      while (added < progress.assetIds.length) {
        const chunk = progress.assetIds.slice(added, added + MAX_ITEMS_PER_GROUP);
        setBusy(`Adding items ${added + 1}–${added + chunk.length} of ${progress.assetIds.length}…`);
        const txns = await buildAddItemsGroup(network, activeAddress, progress.appId, chunk, added);
        await signAndSend(network, txns, transactionSigner);
        added += chunk.length;
        const next = { ...progress, itemsAdded: added };
        setProgress(next);
        saveLaunchProgress(next);
      }
      toast.success("All items loaded");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to add items");
    } finally {
      setBusy("");
    }
  };

  const handleGoLive = async () => {
    if (!progress) return;
    if (activeAddress !== progress.distribution) return toast.error("Connect the collection wallet");
    setBusy("Rekeying the collection wallet and going live…");
    try {
      const txns = await buildRegister(network, progress.distribution, progress.appId);
      // Confirm on the register call (the rekey payment is last)
      await signAndSend(network, txns, transactionSigner, txns.length - 2);
      const state = await getSaleState(network, progress.appId);
      if (state.status !== STATUS.LIVE) throw new Error("Shuffle did not go live");
      setLive(true);
      saveLaunchProgress(null);
      confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 } });
      toast.success("Your Shuffle is live!");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to go live");
    } finally {
      setBusy("");
    }
  };

  const abandonLaunch = () => {
    if (!confirm("Forget this in-progress launch? The Shuffle stays on-chain; manage it from My shuffles.")) return;
    saveLaunchProgress(null);
    setProgress(null);
    setResumedDistribution("");
    setStep(0);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (live && progress) {
    return (
      <Panel className="max-w-2xl mx-auto text-center space-y-4">
        <MdCheckCircle size={56} className="mx-auto text-green-400" />
        <h3 className="text-2xl font-black text-white">Your Shuffle is live</h3>
        <p className="text-sm text-gray-400">
          Your collection wallet is now controlled by Shuffle app {progress.appId}. It is returned automatically when
          the collection sells out, and the manager can release it any time from My shuffles.
        </p>
        <Link to={`/shuffle/${progress.appId}`} className={`${primaryButtonClass} w-fit mx-auto`}>
          Open your Shuffle
        </Link>
      </Panel>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6 text-left">
      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {STEPS.map((label, i) => (
          <button
            key={label}
            onClick={() => !progress && i < step && setStep(i)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border ${
              i === step
                ? "bg-primary-orange text-black border-primary-orange"
                : i < step
                  ? "bg-primary-orange/10 text-primary-orange border-primary-orange/30 cursor-pointer"
                  : "bg-asset-detail-bg/50 text-gray-500 border-white/[0.08]"
            }`}
          >
            <span>{i + 1}</span> {label}
          </button>
        ))}
      </div>

      {!factoryId && (
        <Notice tone="warn">
          Shuffle is not deployed on {network} yet. You can prepare your Shuffle, but it cannot be created until
          the factory is deployed.
        </Notice>
      )}
      {!activeAddress && <Notice tone="info">Connect your wallet to launch a sale.</Notice>}

      {/* ── Step 0: Wallets ─────────────────────────────────────────────── */}
      {step === 0 && (
        <Panel className="space-y-5">
          <div>
            <FieldLabel hint="Holds the NFTs, signs the launch">Collection wallet (connected)</FieldLabel>
            <input className={inputClass} value={distribution} readOnly placeholder="Connect the wallet that holds your collection" />
            {walletCheck && (
              <p className={`text-xs mt-1.5 ml-1 ${walletCheck.ok ? "text-green-400" : "text-red-400"}`}>
                {walletCheck.message}
              </p>
            )}
          </div>

          <div>
            <FieldLabel hint={`Up to ${MAX_PAYOUTS} · fixed once the Shuffle is created`}>Payouts</FieldLabel>
            {managerIsFirstPayout && (
              <p className="text-[11px] text-primary-orange/90 mb-2 ml-1">
                The first payout address is also the Shuffle manager: it can pause the Shuffle, change the price or end
                date, and release your collection wallet. Pick a different manager below if you prefer.
              </p>
            )}
            <div className="space-y-2">
              {payouts.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      className={`${inputClass} ${i === 0 && managerIsFirstPayout ? "pr-28" : ""}`}
                      value={row.address}
                      onChange={(e) => updatePayout(i, { address: e.target.value })}
                      placeholder={i === 0 && managerIsFirstPayout ? "Payout + manager address" : "Address that receives proceeds"}
                    />
                    {i === 0 && managerIsFirstPayout && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-orange/15 text-primary-orange border border-primary-orange/30">
                        Also manager
                      </span>
                    )}
                  </div>
                  <div className="relative w-28 shrink-0">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className={`${inputClass} pr-8`}
                      value={row.percent}
                      onChange={(e) => updatePayout(i, { percent: e.target.value })}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">%</span>
                  </div>
                  {payouts.length > 1 && (
                    <button
                      onClick={() => setPayouts((rows) => rows.filter((_, j) => j !== i))}
                      className={secondaryButtonClass}
                      aria-label="Remove payout"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button
                disabled={payouts.length >= MAX_PAYOUTS}
                onClick={() => setPayouts((rows) => [...rows, { address: "", percent: "" }])}
                className={secondaryButtonClass}
              >
                + Add a split
              </button>
              <span className={`text-xs font-bold ${totalBps === BPS_TOTAL ? "text-green-400" : "text-amber-300"}`}>
                Total {totalBps / 100}%
              </span>
            </div>
            {payoutErrors.length > 0 && payouts.some((p) => p.address) && (
              <p className="text-xs text-red-400 mt-1.5 ml-1">{payoutErrors[0]}</p>
            )}
          </div>

          <div>
            <FieldLabel hint="Pause, price, end date, release">Shuffle manager</FieldLabel>
            <label className="flex items-center gap-2 text-sm text-gray-300 mb-2">
              <input
                type="checkbox"
                checked={managerIsFirstPayout}
                onChange={(e) => setManagerIsFirstPayout(e.target.checked)}
              />
              Use the first payout address as the manager
            </label>
            {!managerIsFirstPayout && (
              <input
                className={inputClass}
                value={managerInput}
                onChange={(e) => setManagerInput(e.target.value)}
                placeholder="Wallet that manages the Shuffle while it is live"
              />
            )}
            {admin && managerError && <p className="text-xs text-red-400 mt-1.5 ml-1">{managerError}</p>}
            <p className="text-[11px] text-gray-500 mt-1.5 ml-1">
              While the Shuffle is live, your collection wallet is controlled by the Shuffle contract and cannot sign, so a
              second wallet you control manages the sale.
            </p>
          </div>

          <Notice tone="info">
            <strong>How custody works:</strong> when your Shuffle goes live, your collection wallet is rekeyed to the
            Shuffle's smart contract. wen.tools never holds any keys. The contract can only send listed NFTs to buyers,
            and the wallet is rekeyed back to itself when the manager releases it, when the collection sells out, or by
            anyone once the Shuffle has ended. Use a wallet that only holds this collection.
          </Notice>

          <ExperimentalNotice />
          <label className="flex items-start gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              className="mt-1"
              checked={riskAccepted}
              onChange={(e) => setRiskAccepted(e.target.checked)}
            />
            I understand Shuffle is experimental, that my collection wallet will be rekeyed to a smart contract, and
            that a bug could make the wallet or its assets unrecoverable. This wallet holds no high-value assets.
          </label>

          <div className="flex justify-end">
            <button disabled={!walletsValid} onClick={() => setStep(1)} className={primaryButtonClass}>
              Next
            </button>
          </div>
        </Panel>
      )}

      {/* ── Step 1: Collection ──────────────────────────────────────────── */}
      {step === 1 && (
        <Panel className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel hint={`${byteLength(name)}/64`}>Collection name</FieldLabel>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <FieldLabel hint={`${byteLength(unitName)}/8`}>Unit name</FieldLabel>
              <input className={inputClass} value={unitName} onChange={(e) => setUnitName(e.target.value)} />
            </div>
          </div>

          <div>
            <FieldLabel>NFT standard</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {["ARC3", "ARC19", "ARC69"].map((s) => (
                <button
                  key={s}
                  onClick={() => setStandard(s)}
                  className={`h-11 rounded-2xl border text-xs font-black ${
                    standard === s
                      ? "bg-primary-orange text-black border-primary-orange"
                      : "bg-asset-detail-bg/50 border-white/[0.08] text-gray-500"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            {(["pin", "url"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetadataMode(m)}
                className={`${secondaryButtonClass} ${metadataMode === m ? "!border-primary-orange !text-primary-orange" : ""}`}
              >
                {m === "pin" ? "Build & pin collection metadata" : "I already have a metadata URL"}
              </button>
            ))}
          </div>

          {metadataMode === "pin" ? (
            <div className="space-y-4">
              <div>
                <FieldLabel>Description</FieldLabel>
                <textarea
                  rows={4}
                  className={inputClass}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Cover image URL</FieldLabel>
                  <input className={inputClass} value={image} onChange={(e) => setImage(e.target.value)} placeholder="ipfs://… or https://…" />
                </div>
                <div>
                  <FieldLabel>Banner image URL</FieldLabel>
                  <input className={inputClass} value={banner} onChange={(e) => setBanner(e.target.value)} placeholder="optional" />
                </div>
                <div>
                  <FieldLabel>Website</FieldLabel>
                  <input className={inputClass} value={website} onChange={(e) => setWebsite(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>X / Twitter</FieldLabel>
                  <input className={inputClass} value={twitter} onChange={(e) => setTwitter(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>Discord</FieldLabel>
                  <input className={inputClass} value={discord} onChange={(e) => setDiscord(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <FieldLabel>Pin with</FieldLabel>
                  <select
                    className={inputClass}
                    value={pinProvider}
                    onChange={(e) => {
                      const p = e.target.value as "Filebase" | "Pinata";
                      setPinProvider(p);
                      setPinToken(localStorage.getItem(p === "Filebase" ? "filebaseToken" : "pinataToken") || "");
                    }}
                  >
                    <option>Filebase</option>
                    <option>Pinata</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel>{pinProvider} token</FieldLabel>
                  <input type="password" className={inputClass} value={pinToken} onChange={(e) => setPinToken(e.target.value)} />
                </div>
              </div>
              <button onClick={handlePin} disabled={pinning || !name} className={secondaryButtonClass}>
                {pinning ? "Pinning…" : "Pin collection metadata"}
              </button>
            </div>
          ) : null}

          <div>
            <FieldLabel hint={`${byteLength(metadataUrl)}/256`}>Collection metadata URL</FieldLabel>
            <input
              className={inputClass}
              value={metadataUrl}
              onChange={(e) => setMetadataUrl(e.target.value.trim())}
              placeholder="ipfs://… (JSON with name, description, image, links)"
            />
            <p className="text-[11px] text-gray-500 mt-1.5 ml-1">
              Stored in the wen.tools Shuffle index so marketplaces and other sites can display your Shuffle.
            </p>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(0)} className={secondaryButtonClass}>
              Back
            </button>
            <button disabled={!collectionValid} onClick={() => setStep(2)} className={primaryButtonClass}>
              Next
            </button>
          </div>
        </Panel>
      )}

      {/* ── Step 2: Items ───────────────────────────────────────────────── */}
      {step === 2 && (
        <Panel className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              {(["wallet", "paste"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setItemMode(m)}
                  className={`${secondaryButtonClass} ${itemMode === m ? "!border-primary-orange !text-primary-orange" : ""}`}
                >
                  {m === "wallet" ? "From your collection wallet" : "Paste asset IDs"}
                </button>
              ))}
            </div>
            <button onClick={handleLoadAssets} disabled={!!loadingAssets} className={secondaryButtonClass}>
              <MdRefresh /> Reload
            </button>
          </div>

          {loadingAssets && (
            <p className="text-xs text-gray-400 flex items-center gap-2">
              <MdHourglassEmpty className="animate-spin" /> {loadingAssets}
            </p>
          )}

          {itemMode === "wallet" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <FieldLabel>Unit name starts with</FieldLabel>
                  <input className={inputClass} value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>Name contains</FieldLabel>
                  <input className={inputClass} value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300 mt-6">
                  <input type="checkbox" checked={nftOnly} onChange={(e) => setNftOnly(e.target.checked)} />
                  NFTs only (supply 1)
                </label>
              </div>

              <div className="max-h-80 overflow-y-auto rounded-2xl border border-white/[0.08] divide-y divide-white/[0.05]">
                {filtered.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">No matching assets in your collection wallet.</p>
                ) : (
                  filtered.slice(0, 500).map((a) => (
                    <label key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-white/[0.02]">
                      <input
                        type="checkbox"
                        checked={!excluded.has(a.id)}
                        onChange={() => {
                          const next = new Set(excluded);
                          if (next.has(a.id)) next.delete(a.id);
                          else next.add(a.id);
                          setExcluded(next);
                        }}
                      />
                      <span className="text-gray-200 truncate flex-1">{a.name || "(unnamed)"}</span>
                      <span className="text-gray-500 font-mono text-xs">{a.unitName}</span>
                      <span className="text-gray-600 font-mono text-xs">{a.id}</span>
                    </label>
                  ))
                )}
                {filtered.length > 500 && (
                  <p className="p-3 text-xs text-gray-500">Showing 500 of {filtered.length}. All matching assets are included.</p>
                )}
              </div>
            </>
          ) : (
            <div>
              <FieldLabel>Asset IDs</FieldLabel>
              <textarea
                rows={8}
                className={`${inputClass} font-mono`}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="One per line, or comma separated"
              />
              <p className="text-[11px] text-gray-500 mt-1.5 ml-1">
                Duplicates and assets your collection wallet does not hold are removed automatically.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between text-sm">
            <span className="font-bold text-white">{selectedIds.length} items selected</span>
            <span className="text-gray-500">Item storage: {formatAlgo(itemStorage, 3)} (refundable)</span>
          </div>

          {(clawbackCount > 0 || freezeCount > 0) && (
            <Notice tone="warn">
              <MdWarning className="inline mr-1" />
              {clawbackCount > 0 && `${clawbackCount} selected assets have a clawback address. `}
              {freezeCount > 0 && `${freezeCount} selected assets have a freeze address. `}
              Buyers will see this. Assets clawed back or frozen during the Shuffle are skipped by the draw.
            </Notice>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className={secondaryButtonClass}>
              Back
            </button>
            <button disabled={selectedIds.length === 0} onClick={() => setStep(3)} className={primaryButtonClass}>
              Next
            </button>
          </div>
        </Panel>
      )}

      {/* ── Step 3: Shuffle settings ───────────────────────────────────────── */}
      {step === 3 && (
        <Panel className="space-y-5">
          <div>
            <FieldLabel>Mint price (ALGO)</FieldLabel>
            <input type="number" min={0} step="0.1" className={inputClass} value={priceAlgo} onChange={(e) => setPriceAlgo(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Start</FieldLabel>
              <div className="flex gap-2 mb-2">
                {(["now", "scheduled"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setStartMode(m)}
                    className={`${secondaryButtonClass} ${startMode === m ? "!border-primary-orange !text-primary-orange" : ""}`}
                  >
                    {m === "now" ? "As soon as live" : "Scheduled"}
                  </button>
                ))}
              </div>
              {startMode === "scheduled" && (
                <input type="datetime-local" className={inputClass} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              )}
            </div>
            <div>
              <FieldLabel hint="Required">End</FieldLabel>
              <input type="datetime-local" className={inputClass} value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              <p className="text-[11px] text-gray-500 mt-1.5 ml-1">
                After the end, anyone can return the collection wallet to you. You can extend it later.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel hint={`min ${MIN_REVEAL_FEE / 1e6}`}>Reveal fee (ALGO)</FieldLabel>
              <input type="number" step="0.005" className={inputClass} value={revealFeeAlgo} onChange={(e) => setRevealFeeAlgo(e.target.value)} />
              <p className="text-[11px] text-gray-500 mt-1.5 ml-1">Paid by buyers to whoever reveals their draw. Covers network fees.</p>
            </div>
            <div>
              <FieldLabel hint={`min ${MIN_DELIVERY_BUDGET / 1e6}`}>Delivery deposit (ALGO)</FieldLabel>
              <input type="number" step="0.05" className={inputClass} value={deliveryAlgo} onChange={(e) => setDeliveryAlgo(e.target.value)} />
              <p className="text-[11px] text-gray-500 mt-1.5 ml-1">
                Refundable. Covers the buyer's ARC-59 inbox if they are not opted in; the rest returns to them.
              </p>
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className={secondaryButtonClass}>
              Back
            </button>
            <button disabled={!settingsValid} onClick={() => setStep(4)} className={primaryButtonClass}>
              Review
            </button>
          </div>
        </Panel>
      )}

      {/* ── Step 4: Launch ──────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          {!progress && (
            <Panel className="space-y-2 text-sm">
              <p className="text-[10px] font-black text-primary-orange uppercase tracking-[0.2em] mb-2">Review</p>
              <ReviewRow label="Collection" value={`${name} (${unitName}, ${standard})`} />
              <ReviewRow label="Items" value={String(selectedIds.length)} />
              <ReviewRow label="Price" value={formatAlgo(price)} />
              <ReviewRow label="Collection wallet" value={shortAddr(distribution)} />
              <ReviewRow label="Manager" value={shortAddr(admin)} />
              {payoutSplits.map((p) => (
                <ReviewRow key={p.address} label={`Payout ${p.bps / 100}%`} value={shortAddr(p.address)} />
              ))}
              <div className="border-t border-white/[0.08] my-2" />
              <ReviewRow label="Registry & contract deposit" value={`~${formatAlgo(factoryDeposit, 3)} (refundable)`} />
              <ReviewRow label="Item storage" value={`${formatAlgo(itemStorage, 3)} (refundable)`} />
              <p className="text-[11px] text-gray-500 pt-1">
                Deposits are returned to your collection wallet when you close the sale. Network fees are extra.
                Delivering NFTs costs your wallet nothing: whoever reveals a mint pays those fees.
              </p>
              <div className="border-t border-white/[0.08] my-2" />
              <ReviewRow label="Needed in your collection wallet" value={`~${formatAlgo(launchCost, 3)}`} />
              <ReviewRow
                label="Available (above its minimum balance)"
                value={walletSpendable === null ? "…" : formatAlgo(walletSpendable, 3)}
              />
              {fundsShort && (
                <Notice tone="error">
                  Your collection wallet needs about {formatAlgo(launchCost - walletSpendable!, 3)} more ALGO to
                  launch. Send ALGO to {shortAddr(distribution)} and come back; nothing has been signed yet.
                </Notice>
              )}
            </Panel>
          )}

          <LaunchStage
            n={1}
            title="Create the Shuffle contract"
            who="Collection wallet"
            done={!!progress}
            active={!progress}
            busy={!!busy && !progress}
          >
            <button
              onClick={handleCreateSale}
              disabled={!!busy || !factoryId || !walletsValid || fundsShort || activeAddress !== distribution}
              className={primaryButtonClass}
            >
              Create Shuffle
            </button>
          </LaunchStage>

          <LaunchStage
            n={2}
            title={`Load ${progress?.assetIds.length ?? selectedIds.length} items`}
            who="Collection wallet"
            done={!!progress && progress.itemsAdded >= progress.assetIds.length}
            active={!!progress && progress.itemsAdded < progress.assetIds.length}
            busy={!!busy && !!progress && progress.itemsAdded < progress.assetIds.length}
          >
            {progress && (
              <>
                <ProgressBar value={progress.itemsAdded} total={progress.assetIds.length} />
                <p className="text-[11px] text-gray-500">
                  One signature per {MAX_ITEMS_PER_GROUP} items.
                </p>
                <button
                  onClick={handleAddItems}
                  disabled={!!busy || (activeAddress !== progress.distribution && activeAddress !== progress.admin)}
                  className={primaryButtonClass}
                >
                  {progress.itemsAdded > 0 ? "Continue loading items" : "Load items"}
                </button>
              </>
            )}
          </LaunchStage>

          <LaunchStage
            n={3}
            title="Rekey your collection wallet & go live"
            who="Collection wallet"
            done={live}
            active={!!progress && progress.itemsAdded >= progress.assetIds.length}
            busy={!!busy && !!progress && progress.itemsAdded >= progress.assetIds.length}
          >
            {progress && (
              <>
                <p className="text-xs text-gray-400">
                  Sign one group from your collection wallet ({shortAddr(progress.distribution)}). Your wallet will
                  warn that this rekeys the account. That is expected: it hands control to Shuffle app {progress.appId}.
                </p>
                <ExperimentalNotice compact />
                {activeAddress !== progress.distribution && (
                  <Notice tone="info">
                    Reconnect the collection wallet ({shortAddr(progress.distribution)}) to finish. Your progress is
                    saved on this device.
                  </Notice>
                )}
                <button
                  onClick={handleGoLive}
                  disabled={!!busy || activeAddress !== progress.distribution}
                  className={primaryButtonClass}
                >
                  Rekey & go live
                </button>
              </>
            )}
          </LaunchStage>

          {busy && (
            <p className="text-xs text-gray-400 flex items-center gap-2">
              <MdHourglassEmpty className="animate-spin" /> {busy}
            </p>
          )}

          <div className="flex justify-between">
            {!progress ? (
              <button onClick={() => setStep(3)} className={secondaryButtonClass}>
                Back
              </button>
            ) : (
              <button onClick={abandonLaunch} className={secondaryButtonClass}>
                Forget this launch
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200 font-bold text-right">{value}</span>
    </div>
  );
}

function LaunchStage({
  n,
  title,
  who,
  done,
  active,
  busy,
  children,
}: {
  n: number;
  title: string;
  who: string;
  done: boolean;
  active: boolean;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <Panel className={`space-y-3 ${active ? "border-primary-orange/40" : done ? "" : "opacity-50"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${
              done ? "bg-green-500 text-black" : "bg-primary-orange/15 text-primary-orange"
            }`}
          >
            {done ? <MdCheckCircle /> : n}
          </span>
          <div>
            <p className="font-black text-white text-sm">{title}</p>
            <p className="text-[11px] text-gray-500">{who}</p>
          </div>
        </div>
        {busy && <MdHourglassEmpty className="animate-spin text-primary-orange" />}
      </div>
      {active && !done && children}
    </Panel>
  );
}
