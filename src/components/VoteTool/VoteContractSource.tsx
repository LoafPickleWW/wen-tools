import { useState } from "react";
import { IoCopy } from "react-icons/io5";
import { toast } from "react-toastify";
// Bundled straight from the repo, so the page always shows the code it was built with.
import contractSource from "../../../contracts/VoteTool.algo.ts?raw";
import voteTeal from "../../../contracts/build/vote/Vote.approval.teal?raw";
import factoryTeal from "../../../contracts/build/vote/VoteFactory.approval.teal?raw";
import registryTeal from "../../../contracts/build/vote/VoteRegistry.approval.teal?raw";
import listTeal from "../../../contracts/build/vote/VoterList.approval.teal?raw";
import { KNOWN_VOTE_TEMPLATES, type VoteNetwork } from "../../utils/voteTool";

const REPO_FILE = "https://github.com/LoafPickleWW/wen-tools/blob/main/contracts/VoteTool.algo.ts";
const SPEC_FILE = "https://github.com/LoafPickleWW/wen-tools/blob/main/docs/VOTE_TOOL_SPEC.md";

const VIEWS = {
  source: { label: "Algorand TypeScript source", code: contractSource },
  vote: { label: "Vote (TEAL)", code: voteTeal },
  factory: { label: "Factory (TEAL)", code: factoryTeal },
  registry: { label: "Registry (TEAL)", code: registryTeal },
  list: { label: "Voter list (TEAL)", code: listTeal },
} as const;
type View = keyof typeof VIEWS;

const linkClass =
  "rounded-md border border-white/10 px-2 py-1 text-slate-300 hover:border-primary-orange/40 hover:text-primary-orange";

/** Open-source view of the Vote Tool contracts, with links to verify the live deployment. */
export function VoteContractSource({ network, factoryId, registryId }: { network: VoteNetwork; factoryId: number; registryId?: number }) {
  const [view, setView] = useState<View>("source");
  const code = VIEWS[view].code;

  return (
    <details id="contract-source" className="group w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-banner-grey/50">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 marker:hidden">
        <span className="wt-label">( open source · Vote Tool contracts )</span>
        <span className="font-mono text-[11px] text-slate-500 group-open:hidden">view code ▾</span>
        <span className="hidden font-mono text-[11px] text-slate-500 group-open:inline">hide ▴</span>
      </summary>

      <div className="border-t border-white/[0.06] px-5 py-4">
        <div className="text-sm leading-relaxed text-slate-400 flex flex-col gap-2">
          <p>
            Four contracts, written in Algorand TypeScript and compiled for AVM v13:
          </p>
          <ul className="list-disc pl-5">
            <li>
              <strong className="text-slate-200">Factory:</strong> creates every vote.
            </li>
            <li>
              <strong className="text-slate-200">Registry:</strong> the on-chain list of votes.
            </li>
            <li>
              <strong className="text-slate-200">Vote:</strong> one app per poll.
            </li>
            <li>
              <strong className="text-slate-200">Voter list:</strong> an optional allowlist.
            </li>
          </ul>
          <p>
            The factory can be upgraded by its admin, and an upgrade only changes the template for <em>new</em> votes. Each vote locks
            its rules when voting starts: after that, no one can change it. Its creator can only edit it before then. Escrowed tokens
            can only go back to voters or to the payout chosen at creation.
          </p>
          <p>
            The vote page checks each vote's program hash against the {KNOWN_VOTE_TEMPLATES.length} published template
            {KNOWN_VOTE_TEMPLATES.length === 1 ? "" : "s"} below. If a creator changed the program before voting started, the page shows a
            warning. These contracts haven't had an independent audit.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
          <a href={REPO_FILE} target="_blank" rel="noopener noreferrer" className={linkClass}>
            GitHub ↗
          </a>
          <a href={SPEC_FILE} target="_blank" rel="noopener noreferrer" className={linkClass}>
            design spec ↗
          </a>
          {factoryId > 0 && (
            <a href={`https://lora.algokit.io/${network}/application/${factoryId}`} target="_blank" rel="noopener noreferrer" className={linkClass}>
              factory {factoryId} ↗
            </a>
          )}
          {!!registryId && (
            <a href={`https://lora.algokit.io/${network}/application/${registryId}`} target="_blank" rel="noopener noreferrer" className={linkClass}>
              registry {registryId} ↗
            </a>
          )}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer font-mono text-[11px] text-slate-500 hover:text-slate-300">vote template hashes (sha512_256 of "Program" ‖ approval)</summary>
          <ul className="mt-2 font-mono text-[10px] text-slate-500 break-all">
            {KNOWN_VOTE_TEMPLATES.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </details>

        <div className="mt-4 flex flex-wrap items-center gap-1">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                view === v ? "bg-primary-black/70 text-white" : "text-slate-500 hover:text-white"
              }`}
            >
              {VIEWS[v].label}
            </button>
          ))}
          <button
            onClick={() => {
              navigator.clipboard.writeText(code);
              toast.success("Copied");
            }}
            title="Copy"
            aria-label="Copy code"
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
