import { Panel } from "./shared";

interface Feature {
  tag: string;
  title: string;
  what: string;
  here: string;
}

/** What go-algorand v5 / AVM v13 added, and where the Vote Tool uses it. */
const FEATURES: Feature[] = [
  {
    tag: "app_box_* · ForeignBoxReads",
    title: "Contracts can read each other's storage",
    what: "Before v5, an app's box storage was private to that app. Now an app can let any other contract read its boxes, using new opcodes that take the other app's ID.",
    here: "Each ballot is checked against another app's storage: a voter list, or the ballots of a previous vote. Every vote's results are readable too, so a DAO treasury can release funds only if a vote passed, with no oracle.",
  },
  {
    tag: "FamilyBoxAccess",
    title: "Sibling apps can write to a shared index",
    what: "Apps created by the same account form a family. An app can let its family read and write its boxes directly.",
    here: "Every vote is created by the factory, so votes and the registry are family. Each vote writes its live totals and final result straight into the registry. That's why the vote list above needs no database or indexer.",
  },
  {
    tag: "larger apps",
    title: "Room to upgrade without redeploying",
    what: "v5 doubled the app size limit. A program can now have up to 7 extra pages, 16 KB in total.",
    here: "The factory was created at the full 16 KB, with spare state slots, so new features ship as in-place upgrades. Existing votes keep the rules they started with.",
  },
  {
    tag: "Falcon-1024 accounts",
    title: "Post-quantum wallets vote like any other",
    what: "v5 builds Falcon-1024 signatures into the protocol, so a quantum-resistant account works without a LogicSig wrapper.",
    here: "The contracts don't care how a ballot was signed, so Falcon accounts can create votes, vote and claim refunds with no special handling.",
  },
];

export function VoteV5Features() {
  return (
    <section className="w-full mt-12" aria-labelledby="v5-heading">
      <h2 id="v5-heading" className="text-xl font-black text-white">
        Built on Algorand v5
      </h2>
      <p className="text-sm text-gray-400 mt-1 mb-5 max-w-3xl">
        go-algorand v5.0 (August 2026) moved smart contracts to AVM v13. This tool is a working demo of what that made possible:
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {FEATURES.map((f) => (
          <Panel key={f.tag}>
            <div className="font-mono text-[10px] text-primary-orange uppercase tracking-wider">{f.tag}</div>
            <h3 className="text-base font-black text-white mt-1">{f.title}</h3>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">{f.what}</p>
            <p className="text-xs text-gray-200 mt-2 leading-relaxed">
              <span className="font-bold text-primary-orange">Here: </span>
              {f.here}
            </p>
          </Panel>
        ))}
      </div>
    </section>
  );
}
