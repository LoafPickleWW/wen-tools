import { useMemo, useState } from "react";
import { toast } from "react-toastify";
import { IoInformationCircle, IoPaperPlane } from "react-icons/io5";
import { Reticle } from "../components/cypher/Reticle";
import { ToolHero } from "../components/cypher/ToolKit";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";
import { useMidnight } from "../midnight/MidnightContext";
import {
  decimalsFor,
  formatUnits,
  parseRecipients,
  tokenLabel,
} from "../midnight/amounts";
import { CSV_TEMPLATE, csvToRecipientText } from "../midnight/csv";
import { BatchRow, START_BATCH_SIZE, sendInBatches } from "../midnight/send";
import { DesiredOutput, MidnightKind, NIGHT_TOKEN_TYPE } from "../midnight/types";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-primary-black/50 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-violet-400/60 focus:outline-none";

export function MidnightSend() {
  const { api, status, networkId, balances, refresh } = useMidnight();

  const [kind, setKind] = useState<MidnightKind>("unshielded");
  const [tokenType, setTokenType] = useState(NIGHT_TOKEN_TYPE);
  const [recipientsText, setRecipientsText] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<BatchRow[]>([]);

  const held = useMemo(() => balances?.[kind] ?? {}, [balances, kind]);
  const tokenOptions = useMemo(() => {
    const types = Object.keys(held);
    if (kind === "unshielded" && !types.includes(NIGHT_TOKEN_TYPE)) types.unshift(NIGHT_TOKEN_TYPE);
    return types;
  }, [held, kind]);
  // Keep the selection valid when switching between shielded and unshielded
  const selectedType = tokenOptions.includes(tokenType) ? tokenType : tokenOptions[0];
  const decimals = selectedType ? decimalsFor(selectedType) : 0;
  const available = selectedType ? (held[selectedType] ?? 0n) : 0n;

  const parsed = useMemo(
    () => parseRecipients(recipientsText, kind, decimals, amount),
    [recipientsText, kind, decimals, amount],
  );
  const total = parsed.recipients.reduce((sum, r) => sum + r.value, 0n);
  const overspend = total > available;
  // Starting estimate only; oversized batches are split automatically while sending
  const batches = Math.ceil(parsed.recipients.length / START_BATCH_SIZE[kind]);
  const canSend =
    !!api &&
    !sending &&
    !!selectedType &&
    parsed.recipients.length > 0 &&
    parsed.errors.length === 0 &&
    !overspend;

  async function handleSend() {
    if (!api || !selectedType) return;
    const outputs: DesiredOutput[] = parsed.recipients.map((r) => ({
      kind,
      type: selectedType,
      value: r.value,
      recipient: r.recipient,
    }));

    setSending(true);
    toast.info("Approve each transfer in your wallet", { autoClose: 2500 });
    const { failedMessage } = await sendInBatches({
      outputs,
      batchSize: START_BATCH_SIZE[kind],
      makeTransfer: (o) => api.makeTransfer(o, { payFees: true }),
      submit: (tx) => api.submitTransaction(tx),
      onUpdate: setResults,
    });
    setSending(false);
    if (failedMessage) toast.error(`Send stopped: ${failedMessage}`);
    else toast.success("All transfers submitted!");
    refresh().catch(() => {});
  }

  return (
    <div className="pt-4 flex justify-center flex-col text-white min-h-screen">
      <Meta
        title="Midnight Send"
        description="Send NIGHT and other Midnight tokens to many recipients, shielded or unshielded."
        noindex
      />
      <article className="mx-auto text-white mb-16 flex flex-col items-center max-w-4xl w-full px-4">
        <ToolHero
          icon={<IoPaperPlane aria-hidden="true" />}
          tag="midnight"
          title="Midnight Send"
          description="Send NIGHT and other Midnight tokens to one address or a thousand, unshielded or shielded."
          meta={["NIGHT", "shielded", "unshielded", "multi-send"]}
        />

        <div className="w-full bg-asset-detail-bg/90 border border-white/5 rounded-[32px] p-6 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden wt-frame [--wt-r:32px] [--wt-in:12px] flex flex-col items-center gap-6">
          <Reticle />
          {status !== "connected" && <ConnectButton inmain={true} />}

          {status !== "connected" ? (
            <p className="text-sm text-slate-400 text-center">
              Connect a Midnight wallet (1AM or Lace) to send.
            </p>
          ) : (
            <div className="w-full flex flex-col gap-5 text-left">
              <div className="w-full bg-primary-black/40 border border-white/[0.08] rounded-2xl p-4 flex gap-3 text-sm text-slate-300 items-start leading-relaxed">
                <IoInformationCircle className="text-xl text-violet-300 shrink-0 mt-0.5" />
                <div>
                  Connected to <span className="font-bold text-white">{networkId}</span>. Transfers are paid
                  with DUST, which your wallet generates from held NIGHT. Shielded and unshielded tokens are
                  separate pools and recipients need the matching address type.
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-400">
                  Pool
                  <select
                    className={inputClass}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as MidnightKind)}
                  >
                    <option value="unshielded">Unshielded (public)</option>
                    <option value="shielded">Shielded (private)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-400">
                  Token
                  <select
                    className={inputClass}
                    value={selectedType ?? ""}
                    onChange={(e) => setTokenType(e.target.value)}
                    disabled={tokenOptions.length === 0}
                  >
                    {tokenOptions.length === 0 && <option value="">No {kind} tokens held</option>}
                    {tokenOptions.map((t) => (
                      <option key={t} value={t}>
                        {tokenLabel(t)} ({formatUnits(held[t] ?? 0n, decimalsFor(t))})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="wt-btn wt-btn-ghost h-9 px-4 cursor-pointer">
                  Upload CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      const { text, rows, error } = csvToRecipientText(await file.text());
                      if (error) return void toast.error(error);
                      setRecipientsText(text);
                      toast.success(`Loaded ${rows} row${rows === 1 ? "" : "s"}`);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="text-slate-400 underline hover:text-white"
                  onClick={() => {
                    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv" }));
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "midnight_send_template.csv";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download template
                </button>
                <span className="text-slate-500">Columns: receiver, amount (amount optional)</span>
              </div>

              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-400">
                Recipients: one {kind} address per line, optionally followed by a comma and an amount
                <textarea
                  rows={7}
                  className={`${inputClass} font-mono text-xs`}
                  placeholder={kind === "shielded" ? "mn_shield-addr_...\nmn_shield-addr_..., 2.5" : "mn_addr_...\nmn_addr_..., 2.5"}
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-400">
                Default amount per recipient{decimals === 0 ? " (raw units)" : ""}
                <input
                  className={inputClass}
                  inputMode="decimal"
                  placeholder="e.g. 10"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>

              {parsed.errors.length > 0 && (
                <ul className="rounded-xl border border-red-800/50 bg-red-950/30 p-3 text-xs text-red-300 space-y-1">
                  {parsed.errors.slice(0, 8).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {parsed.errors.length > 8 && <li>…and {parsed.errors.length - 8} more</li>}
                </ul>
              )}

              {parsed.recipients.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-primary-black/40 p-3 text-xs text-slate-300 flex flex-wrap gap-x-6 gap-y-1">
                  <span>Recipients: <b className="text-white">{parsed.recipients.length}</b></span>
                  <span>
                    Total:{" "}
                    <b className={overspend ? "text-red-400" : "text-white"}>
                      {formatUnits(total, decimals)} {selectedType ? tokenLabel(selectedType) : ""}
                    </b>
                  </span>
                  <span>Transactions (est.): <b className="text-white">{batches}</b></span>
                  {overspend && <span className="text-red-400">Exceeds your balance</span>}
                </div>
              )}

              <button
                onClick={handleSend}
                disabled={!canSend}
                className="wt-btn wt-btn-primary h-11 px-6 self-center disabled:opacity-40"
              >
                {sending ? "Sending…" : "Send"}
              </button>

              {results.length > 0 && (
                <ul className="rounded-xl border border-white/10 divide-y divide-white/[0.06] text-xs">
                  {results.map((r, i) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>
                        Transfer {i + 1} · {r.count} recipient{r.count === 1 ? "" : "s"}
                      </span>
                      <span
                        className={
                          r.status === "sent"
                            ? "text-emerald-400"
                            : r.status === "failed"
                              ? "text-red-400"
                              : r.status === "waiting"
                                ? "text-amber-400"
                                : "text-slate-500"
                        }
                        title={r.message}
                      >
                        {r.status === "failed" || r.status === "waiting" ? r.message : r.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

export default MidnightSend;
