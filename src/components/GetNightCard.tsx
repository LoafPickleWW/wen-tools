import { toast } from "react-toastify";
import { SwapNightCard } from "./SwapNightCard";

const MIDNIGHT_DOCS = "https://docs.midnight.network/tokens/overview";

/**
 * Two-step guide to getting NIGHT. Step 1 swaps ADA for cNIGHT on Cardano through DexHunter's
 * API; step 2 points at Midnight's own flow for moving it across.
 */
export function GetNightCard({ unshieldedAddress }: { unshieldedAddress: string | null }) {
  return (
    <section className="w-full rounded-xl border border-white/10 bg-primary-black/40 p-4 text-xs leading-relaxed text-slate-400">
      <div className="mb-1 font-semibold text-slate-200">Getting NIGHT</div>
      <p>
        There is no direct ADA to NIGHT swap. NIGHT bought on a Cardano DEX or exchange is cNIGHT on
        Cardano, and Midnight's docs say most NIGHT reaches Midnight through the cross-chain path, which
        takes about 12 hours to finalize.
      </p>

      <ol className="mt-3 space-y-4">
        <li>
          <div className="font-semibold text-slate-200">1. Swap ADA for cNIGHT on Cardano</div>
          <p className="mt-1">
            You need a Cardano wallet with ADA. 1AM includes one.
          </p>
          <SwapNightCard />
        </li>

        <li>
          <div className="font-semibold text-slate-200">2. Move it to Midnight</div>
          <p className="mt-1">
            Follow Midnight's official flow (see the{" "}
            <a className="text-slate-200 underline" href={MIDNIGHT_DOCS} target="_blank" rel="noreferrer">
              docs
            </a>
            ). Use your <b className="text-slate-300">unshielded</b> address as the destination.
          </p>
          {unshieldedAddress && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">
                {unshieldedAddress}
              </span>
              <button
                className="shrink-0 text-slate-400 underline hover:text-white"
                onClick={() => {
                  navigator.clipboard.writeText(unshieldedAddress);
                  toast.success("Address copied!");
                }}
              >
                Copy
              </button>
            </div>
          )}
        </li>
      </ol>
    </section>
  );
}
