import { useState } from "react";
import { IoCopy, IoEye, IoEyeOff } from "react-icons/io5";
import { toast } from "react-toastify";

/**
 * Optional backup of the printer's 25-word recovery phrase. Hidden until asked
 * for, so it isn't on screen while printing or screen-sharing.
 */
export function RecoveryPhrase({ mnemonic, storageOk }: { mnemonic?: string; storageOk: boolean }) {
  const [shown, setShown] = useState(false);

  return (
    <section className="mt-4 w-full rounded-2xl border border-white/[0.07] bg-banner-grey/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="wt-label">( recovery phrase )</span>
        {mnemonic && (
          <button
            onClick={() => setShown((s) => !s)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/5"
          >
            {shown ? <IoEyeOff /> : <IoEye />} {shown ? "Hide" : "Show"} 25 words
          </button>
        )}
      </div>

      {!storageOk && (
        <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-sm text-red-200">
          This browser isn't saving site data (private browsing or blocked storage), so the printer is
          forgotten when you leave or reload. Write the recovery phrase down before you fund it.
        </p>
      )}

      {mnemonic ? (
        <>
          <p className="mt-2 text-sm text-slate-400">
            Optional backup. These words re-create this printer's key in any browser via “restore”, and
            work with <code className="text-slate-300">algokey pq import</code>. Anyone with them can spend
            the printer's ALGO, so keep them private.
          </p>
          {shown && (
            <div className="mt-3">
              <ol className="grid grid-cols-2 gap-1.5 rounded-xl bg-primary-black/70 p-3 font-mono text-xs sm:grid-cols-5">
                {mnemonic.split(" ").map((w, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="w-5 shrink-0 text-right text-slate-600">{i + 1}</span>
                    <span className="text-slate-200">{w}</span>
                  </li>
                ))}
              </ol>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(mnemonic);
                  toast.success("Recovery phrase copied");
                }}
                className="mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-white"
              >
                <IoCopy /> Copy
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-400">
          This printer was created before recovery phrases, so it can only be backed up as a file. Use{" "}
          <strong className="text-slate-300">Backup key</strong> below.
        </p>
      )}
    </section>
  );
}
