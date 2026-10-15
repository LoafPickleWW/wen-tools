import { useState } from "react";
import { IoCopy } from "react-icons/io5";
import { toast } from "react-toastify";
// Bundled straight from the repo, so the page always shows the code it was built with.
import contractSource from "../../../contracts/PQCoupon.algo.ts?raw";
import approvalTeal from "../../../contracts/build/PQCoupon.approval.teal?raw";
import type { CouponDeployment } from "../../utils/pqCoupon";
import type { PrinterNetwork } from "../../utils/pqPrinter";

const REPO_FILE = "https://github.com/LoafPickleWW/wen-tools/blob/main/contracts/PQCoupon.algo.ts";
const AUDIT_FILE = "https://github.com/LoafPickleWW/wen-tools/blob/main/contracts/PQCOUPON_AUDIT.md";

type View = "source" | "teal";

/** Open-source view of the PQCoupon contract with links to verify the live deployment. */
export function PQCouponSource({
  network,
  deployment,
}: {
  network: PrinterNetwork;
  deployment: CouponDeployment | null;
}) {
  const [view, setView] = useState<View>("source");
  const code = view === "source" ? contractSource : approvalTeal;

  return (
    <details className="group w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-banner-grey/50">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 marker:hidden">
        <span className="wt-label">( open source · PQCoupon contract )</span>
        <span className="font-mono text-[11px] text-slate-500 group-open:hidden">view code ▾</span>
        <span className="hidden font-mono text-[11px] text-slate-500 group-open:inline">hide ▴</span>
      </summary>

      <div className="border-t border-white/[0.06] px-5 py-4">
        <p className="text-sm leading-relaxed text-slate-400">
          The coupon contract is immutable: no update or delete path, no admin keys on the PQPRINT
          asset. Read it below, compare the compiled TEAL with the program on-chain, and see the{" "}
          <a href={AUDIT_FILE} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary-yellow">
            security review
          </a>{" "}
          (an internal, AI-assisted review, not an independent audit).
        </p>
        <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
          <a href={REPO_FILE} target="_blank" rel="noopener noreferrer" className="rounded-md border border-white/10 px-2 py-1 text-slate-300 hover:border-primary-orange/40 hover:text-primary-orange">
            GitHub ↗
          </a>
          {deployment && (
            <>
              <a
                href={`https://lora.algokit.io/${network}/application/${deployment.appId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-white/10 px-2 py-1 text-slate-300 hover:border-primary-orange/40 hover:text-primary-orange"
              >
                app {deployment.appId} ↗
              </a>
              <a
                href={`https://lora.algokit.io/${network}/asset/${deployment.assetId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-white/10 px-2 py-1 text-slate-300 hover:border-primary-orange/40 hover:text-primary-orange"
              >
                PQPRINT {deployment.assetId} ↗
              </a>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center gap-1">
          {(["source", "teal"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                view === v ? "bg-primary-black/70 text-white" : "text-slate-500 hover:text-white"
              }`}
            >
              {v === "source" ? "TEALScript source" : "Compiled TEAL"}
            </button>
          ))}
          <button
            onClick={() => {
              navigator.clipboard.writeText(code);
              toast.success("Copied");
            }}
            title="Copy"
            className="ml-auto rounded-lg p-2 text-slate-500 transition hover:bg-white/5 hover:text-white"
          >
            <IoCopy />
          </button>
        </div>
        <pre className="mt-2 max-h-[28rem] overflow-auto rounded-xl bg-primary-black/70 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
          <code>{code}</code>
        </pre>
      </div>
    </details>
  );
}
