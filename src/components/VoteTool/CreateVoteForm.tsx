import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";
import { MdAdd, MdClose } from "react-icons/md";
import algosdk from "algosdk";
import {
  MAX_CREATORS,
  MAX_OPTIONS,
  MODE,
  MODE_LABELS,
  MODE_SUMMARY,
  RETURN,
  REGISTRY_ENTRY_MBR,
  RETURN_LABELS,
  buildCreateVote,
  estimateCreateVoteFunding,
  getCurrentRound,
  getVoteState,
  getVoteFactoryId,
  parseCreateVoteResult,
  signAndSend,
  validateCreateVote,
  type CreateVoteParams,
  type VoteNetwork,
} from "../../utils/voteTool";
import {
  FieldLabel,
  Notice,
  Panel,
  inputClass,
  parseUnits,
  primaryButtonClass,
  resolveNfd,
  secondaryButtonClass,
  useAssetInfo,
} from "./shared";

const ROUNDS_PER_HOUR = Math.round(3600 / 2.8);
const LENGTH_PRESETS = [
  { label: "1 hour", rounds: ROUNDS_PER_HOUR },
  { label: "1 day", rounds: ROUNDS_PER_HOUR * 24 },
  { label: "3 days", rounds: ROUNDS_PER_HOUR * 72 },
  { label: "1 week", rounds: ROUNDS_PER_HOUR * 168 },
];

type Gate = "anyone" | "list" | "previous";

interface OptionDraft {
  title: string;
  description: string;
  recipient: string;
}

/** Address or NFD name → address (null if it can't be resolved). */
async function toAddress(network: VoteNetwork, value: string): Promise<string | null> {
  const v = value.trim();
  if (algosdk.isValidAddress(v)) return v;
  if (/\.algo$/i.test(v)) return resolveNfd(network, v);
  return null;
}

export function CreateVoteForm({ network }: { network: VoteNetwork }) {
  const { activeAddress, transactionSigner } = useWallet();
  const navigate = useNavigate();
  const factoryId = getVoteFactoryId(network);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<number>(MODE.ESCROW);
  const [assetId, setAssetId] = useState("");
  const [amountPerVote, setAmountPerVote] = useState("1");
  const [collections, setCollections] = useState<string[]>([""]);
  const [unitPrefix, setUnitPrefix] = useState("");
  const [options, setOptions] = useState<OptionDraft[]>([
    { title: "", description: "", recipient: "" },
    { title: "", description: "", recipient: "" },
  ]);
  const [startNow, setStartNow] = useState(true);
  const [startRound, setStartRound] = useState("");
  const [length, setLength] = useState(String(ROUNDS_PER_HOUR * 24));
  const [returnMode, setReturnMode] = useState<number>(RETURN.SENDERS);
  const [returnTo, setReturnTo] = useState("");
  const [gate, setGate] = useState<Gate>("anyone");
  const [gateApp, setGateApp] = useState("");
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);

  const asset = useAssetInfo(network, mode === MODE.NFT ? 0 : Number(assetId) || 0);

  useEffect(() => {
    getCurrentRound(network).then(setRound).catch(() => setRound(0));
  }, [network]);

  const setOption = (i: number, patch: Partial<OptionDraft>) =>
    setOptions((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const funding = useMemo(
    () =>
      estimateCreateVoteFunding({
        mode,
        title,
        description,
        options,
        collections: collections.filter((c) => c.trim()),
        unitPrefix,
      }),
    [mode, title, description, options, collections, unitPrefix]
  );

  async function create() {
    if (!activeAddress) return toast.info("Connect a wallet first.");
    setBusy(true);
    try {
      const start = startNow ? 0 : Number(startRound);
      const base = start || round;
      const apv = mode === MODE.NFT ? 0n : parseUnits(amountPerVote, asset?.decimals ?? 0);
      if (mode !== MODE.NFT && apv === null) throw new Error("Amount per vote isn't a valid number for this asset.");

      let returnAddress = "";
      if (mode === MODE.ESCROW && returnMode === RETURN.ADDRESS) {
        returnAddress = (await toAddress(network, returnTo)) ?? "";
        if (!returnAddress) throw new Error("Couldn't resolve the return address or NFD.");
      }
      const resolvedOptions = await Promise.all(
        options.map(async (o) => ({
          title: o.title.trim(),
          description: o.description.trim(),
          recipient: mode === MODE.ESCROW && returnMode === RETURN.WINNER ? (await toAddress(network, o.recipient)) ?? "" : "",
        }))
      );

      let creatorAddrs: string[] = [];
      if (mode === MODE.NFT) {
        const entries = collections.map((c) => c.trim()).filter(Boolean);
        creatorAddrs = await Promise.all(
          entries.map(async (c) => {
            const a = await toAddress(network, c);
            if (!a) throw new Error(`Couldn't resolve collection wallet "${c}".`);
            return a;
          })
        );
        creatorAddrs = [...new Set(creatorAddrs)];
      }

      let gateAppId = 0;
      if (gate !== "anyone") {
        gateAppId = Number(gateApp);
        if (!gateAppId) throw new Error("Enter the voter list or previous vote app ID.");
        if (gate === "previous") {
          // Must be a vote whose ballots are readable by other apps.
          await getVoteState(network, gateAppId).catch(() => {
            throw new Error(`App ${gateAppId} isn't a vote.`);
          });
        }
      }

      const params: CreateVoteParams = {
        mode,
        asset: mode === MODE.NFT ? 0 : Number(assetId),
        collections: mode === MODE.NFT ? creatorAddrs : undefined,
        unitPrefix: mode === MODE.NFT ? unitPrefix.trim() : undefined,
        amountPerVote: apv ?? 0n,
        startRound: start,
        endRound: base + Number(length),
        returnMode: mode === MODE.ESCROW ? returnMode : RETURN.SENDERS,
        returnAddress,
        gateApp: gateAppId,
        gatePrefix: "b",
        title: title.trim(),
        description: description.trim(),
        options: resolvedOptions,
      };
      const problem = validateCreateVote(params, round);
      if (problem) throw new Error(problem);

      const txns = await buildCreateVote(network, factoryId, activeAddress, params);
      const confirmation = await signAndSend(network, txns, transactionSigner);
      const appId = parseCreateVoteResult(confirmation);
      toast.success("Vote created!");
      navigate(`/vote/${appId}`);
    } catch (err: any) {
      toast.error(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-3xl flex flex-col gap-6">
      <Panel>
        <FieldLabel>Title</FieldLabel>
        <input className={inputClass} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="What are we deciding?" />
        <div className="h-4" />
        <FieldLabel>Description</FieldLabel>
        <textarea className={`${inputClass} min-h-[80px]`} value={description} maxLength={400} onChange={(e) => setDescription(e.target.value)} />
      </Panel>

      <Panel>
        <FieldLabel>How do people vote?</FieldLabel>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[MODE.ESCROW, MODE.HELD, MODE.NFT].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`text-left p-4 rounded-2xl border transition-all ${
                mode === m ? "border-primary-orange bg-primary-orange/10" : "border-white/[0.08] bg-asset-detail-bg/50 hover:border-white/20"
              }`}
            >
              <div className="text-sm font-black text-white">{MODE_LABELS[m]}</div>
              <div className="text-xs text-gray-400 mt-1">{MODE_SUMMARY[m]}</div>
            </button>
          ))}
        </div>

        <div className="h-5" />
        {mode === MODE.NFT ? (
          <>
            <FieldLabel hint={`${collections.length}/${MAX_CREATORS} wallets`}>Collection creator wallets</FieldLabel>
            <div className="flex flex-col gap-2">
              {collections.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={inputClass}
                    value={c}
                    placeholder={i === 0 ? "Wallet (or NFD) that minted the collection" : "Another minting wallet"}
                    onChange={(e) => setCollections((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  {collections.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove creator wallet ${i + 1}`}
                      className={secondaryButtonClass}
                      onClick={() => setCollections((cs) => cs.filter((_, j) => j !== i))}
                    >
                      <MdClose />
                    </button>
                  )}
                </div>
              ))}
              {collections.length < MAX_CREATORS && (
                <button type="button" className={secondaryButtonClass} onClick={() => setCollections((cs) => [...cs, ""])}>
                  <MdAdd /> Add a minting wallet
                </button>
              )}
            </div>
            <div className="h-4" />
            <FieldLabel hint="optional">Unit name starts with</FieldLabel>
            <input
              className={`${inputClass} sm:max-w-[200px]`}
              value={unitPrefix}
              maxLength={8}
              placeholder="e.g. WEN"
              onChange={(e) => setUnitPrefix(e.target.value)}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              A piece counts when one of these wallets created it{unitPrefix ? ` and its unit name starts with "${unitPrefix}"` : ""}. Use the prefix when
              a wallet minted more than one collection.
            </p>
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <FieldLabel hint={asset ? `${asset.name} (${asset.unitName || "no unit"})` : undefined}>Asset ID used to vote</FieldLabel>
              <input className={inputClass} value={assetId} inputMode="numeric" onChange={(e) => setAssetId(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div>
              <FieldLabel hint={mode === MODE.HELD ? "held per 1 vote" : "sent per 1 vote"}>Amount per vote</FieldLabel>
              <input className={inputClass} value={amountPerVote} inputMode="decimal" onChange={(e) => setAmountPerVote(e.target.value)} />
            </div>
          </div>
        )}
        {mode !== MODE.ESCROW && (
          <p className="text-xs text-gray-500 mt-3">
            Nothing leaves voters' wallets. Until the vote ends, anyone can recount a voter who moved their {mode === MODE.NFT ? "pieces" : "tokens"}, so
            hopping between wallets doesn't count twice.
          </p>
        )}
      </Panel>

      <Panel>
        <FieldLabel hint={`${options.length}/${MAX_OPTIONS}`}>Options</FieldLabel>
        <div className="flex flex-col gap-3">
          {options.map((o, i) => (
            <div key={i} className="p-3 rounded-2xl border border-white/[0.08] bg-asset-detail-bg/30 flex flex-col gap-2">
              <div className="flex gap-2">
                <input className={inputClass} value={o.title} maxLength={60} placeholder={`Option ${i + 1} title`} onChange={(e) => setOption(i, { title: e.target.value })} />
                {options.length > 2 && (
                  <button type="button" aria-label={`Remove option ${i + 1}`} className={secondaryButtonClass} onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}>
                    <MdClose />
                  </button>
                )}
              </div>
              <input className={inputClass} value={o.description} maxLength={200} placeholder="Description (optional)" onChange={(e) => setOption(i, { description: e.target.value })} />
              {mode === MODE.ESCROW && returnMode === RETURN.WINNER && (
                <input className={inputClass} value={o.recipient} placeholder="Recipient if this option wins (address or NFD)" onChange={(e) => setOption(i, { recipient: e.target.value })} />
              )}
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <button type="button" className={secondaryButtonClass} onClick={() => setOptions((os) => [...os, { title: "", description: "", recipient: "" }])}>
              <MdAdd /> Add option
            </button>
          )}
        </div>
      </Panel>

      <Panel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel hint={round ? `now: ${round.toLocaleString()}` : undefined}>Starting round</FieldLabel>
            <div className="flex gap-2">
              <button type="button" className={`${secondaryButtonClass} ${startNow ? "!border-primary-orange text-primary-orange" : ""}`} onClick={() => setStartNow(true)}>
                Now
              </button>
              <input
                className={inputClass}
                value={startNow ? "" : startRound}
                placeholder="Future round"
                inputMode="numeric"
                onFocus={() => setStartNow(false)}
                onChange={(e) => setStartRound(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <p className="text-[11px] text-gray-500 mt-1">1,000 rounds ≈ 45 minutes</p>
          </div>
          <div>
            <FieldLabel hint={`≈ ${(Number(length) * 2.8 / 3600).toFixed(1)} h`}>Vote length (rounds)</FieldLabel>
            <input className={inputClass} value={length} inputMode="numeric" onChange={(e) => setLength(e.target.value.replace(/\D/g, ""))} />
            <div className="flex gap-2 mt-2 flex-wrap">
              {LENGTH_PRESETS.map((p) => (
                <button key={p.label} type="button" className="text-[11px] font-bold text-gray-400 hover:text-primary-orange" onClick={() => setLength(String(p.rounds))}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {mode === MODE.ESCROW && (
        <Panel>
          <FieldLabel>Where do the tokens go when the vote ends?</FieldLabel>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[RETURN.SENDERS, RETURN.ADDRESS, RETURN.WINNER].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReturnMode(r)}
                className={`p-3 rounded-2xl border text-sm font-bold ${
                  returnMode === r ? "border-primary-orange bg-primary-orange/10 text-white" : "border-white/[0.08] text-gray-400"
                }`}
              >
                {RETURN_LABELS[r]}
              </button>
            ))}
          </div>
          {returnMode === RETURN.ADDRESS && (
            <input className={`${inputClass} mt-3`} value={returnTo} onChange={(e) => setReturnTo(e.target.value)} placeholder="Address or NFD (must be opted in to the asset)" />
          )}
          {returnMode === RETURN.WINNER && (
            <p className="text-xs text-gray-400 mt-3">
              The whole pool goes to the winning option's recipient (a grant, a charity, a project). Voters never get back more than they put in. A tie or no votes
              refunds everyone.
            </p>
          )}
          <p className="text-[11px] text-gray-500 mt-3">
            If the payout address can't receive the asset, anyone can switch the vote to refunds about a week after it ends.
          </p>
        </Panel>
      )}

      <Panel>
        <FieldLabel>Who can vote?</FieldLabel>
        <div className="flex gap-2 flex-wrap">
          {(
            [
              ["anyone", "Anyone"],
              ["list", "Voter list"],
              ["previous", "Voters of a previous vote"],
            ] as [Gate, string][]
          ).map(([g, label]) => (
            <button key={g} type="button" onClick={() => setGate(g)} className={`${secondaryButtonClass} ${gate === g ? "!border-primary-orange text-primary-orange" : ""}`}>
              {label}
            </button>
          ))}
        </div>
        {gate !== "anyone" && (
          <>
            <input className={`${inputClass} mt-3`} value={gateApp} inputMode="numeric" placeholder="App ID" onChange={(e) => setGateApp(e.target.value.replace(/\D/g, ""))} />
            <p className="text-xs text-gray-500 mt-2">
              The vote checks the voter against this app's storage on every ballot: a cross-contract box read, new in Algorand v5. The previous vote must still be open
              or not yet closed.
            </p>
          </>
        )}
      </Panel>

      <Panel>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-xs text-gray-400">
            Deposit: <span className="text-white font-bold">{(funding / 1e6).toFixed(4)} ALGO</span> for storage. You get it back when the vote is closed, except{" "}
            {(REGISTRY_ENTRY_MBR / 1e6).toFixed(4)} ALGO that keeps the vote and its result listed on-chain for good.
          </div>
          <button className={primaryButtonClass} disabled={busy || !factoryId} onClick={create}>
            {busy ? "Creating…" : "Create vote"}
          </button>
        </div>
        {!factoryId && (
          <div className="mt-3">
            <Notice tone="warn">The Vote Tool isn't deployed on {network} yet.</Notice>
          </div>
        )}
      </Panel>
    </div>
  );
}
