import { useState } from "react";
import { MdCheckCircle, MdCode, MdContentCopy, MdDownload, MdError, MdExpandLess, MdExpandMore } from "react-icons/md";
import { getFactoryId, type SaleNetwork } from "../../utils/wenpadSale";
import { SHUFFLE_CONTRACT_SOURCE, SHUFFLE_TEALSCRIPT_VERSION, verifyFactory } from "../../utils/shuffleVerify";
import { Panel, secondaryButtonClass } from "./shared";

const explorerApp = (network: SaleNetwork, appId: number) =>
  `https://${network === "testnet" ? "testnet." : ""}explorer.perawallet.app/application/${appId}/`;

/** Open-source contract panel: full source, factory IDs, and a one-click on-chain bytecode check. */
export function ShuffleContractSource({ network }: { network: SaleNetwork }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ network: SaleNetwork; ok: boolean } | "checking" | "error" | null>(null);
  const factoryId = getFactoryId(network);

  const copy = async () => {
    await navigator.clipboard.writeText(SHUFFLE_CONTRACT_SOURCE);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([SHUFFLE_CONTRACT_SOURCE], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "WenPadSale.algo.ts";
    a.click();
    URL.revokeObjectURL(url);
  };

  const verify = async () => {
    setResult("checking");
    try {
      setResult({ network, ok: await verifyFactory(network, factoryId) });
    } catch {
      setResult("error");
    }
  };

  return (
    <section className="w-full max-w-3xl mx-auto mt-12 text-left">
      <h2 className="text-2xl font-black text-white mb-4">Open-source contracts</h2>
      <Panel className="space-y-4">
        <p className="text-sm text-gray-400 leading-relaxed">
          Shuffle runs on two TEALScript contracts: the factory (the public index that creates every Shuffle) and the
          sale contract each Shuffle runs. Both are immutable once deployed. Read the full source below, or check that
          what's deployed matches it.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {(["mainnet", "testnet"] as const).map((n) => (
            <div key={n} className="bg-asset-detail-bg/50 border border-white/[0.08] rounded-2xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{n} factory</p>
              {getFactoryId(n) ? (
                <a
                  href={explorerApp(n, getFactoryId(n))}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono font-bold text-primary-orange hover:underline"
                >
                  {getFactoryId(n)}
                </a>
              ) : (
                <span className="text-gray-500">not deployed</span>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={verify} disabled={!factoryId || result === "checking"} className={secondaryButtonClass}>
            {result === "checking" ? "Checking…" : `Verify the ${network} factory against this source`}
          </button>
          {result && typeof result === "object" && (
            <span className={`flex items-center gap-1 text-xs font-bold ${result.ok ? "text-green-400" : "text-red-400"}`}>
              {result.ok ? <MdCheckCircle /> : <MdError />}
              {result.ok
                ? `Factory ${factoryId} runs exactly this code`
                : `Factory ${factoryId} does not match this source (it may be an older build)`}
            </span>
          )}
          {result === "error" && <span className="text-xs text-red-400">Couldn't reach the network. Try again.</span>}
        </div>

        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer font-bold text-gray-300">Verify it yourself</summary>
          <ol className="list-decimal ml-5 mt-2 space-y-1 leading-relaxed">
            <li>
              Save the source as <code className="text-primary-orange">WenPadSale.algo.ts</code> and compile it with
              TEALScript {SHUFFLE_TEALSCRIPT_VERSION}:{" "}
              <code className="text-primary-orange">
                npx @algorandfoundation/tealscript@{SHUFFLE_TEALSCRIPT_VERSION} WenPadSale.algo.ts build/ --skip-algod
              </code>
            </li>
            <li>
              Compile <code>build/WenPadSale.approval.teal</code> with any Algorand node (<code>/v2/teal/compile</code>
              ). That is the program every Shuffle app runs.
            </li>
            <li>
              In <code>build/WenPadSaleFactory.approval.teal</code>, replace the{" "}
              <code>PENDING_COMPILE_APPROVAL/CLEAR: WenPadSale</code> lines with the compiled sale programs as{" "}
              <code>byte base64(...)</code>, then compile it too.
            </li>
            <li>Compare both results with the approval programs of the factory and any Shuffle app on-chain.</li>
          </ol>
        </details>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setOpen(!open)} className={secondaryButtonClass}>
            <MdCode /> {open ? "Hide source" : "View source"} {open ? <MdExpandLess /> : <MdExpandMore />}
          </button>
          <button onClick={copy} className={secondaryButtonClass}>
            <MdContentCopy /> {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={download} className={secondaryButtonClass}>
            <MdDownload /> Download
          </button>
        </div>

        {open && (
          <pre className="bg-black/60 border border-white/[0.08] rounded-2xl p-4 text-[11px] font-mono text-gray-300 max-h-[32rem] overflow-auto leading-relaxed">
            {SHUFFLE_CONTRACT_SOURCE}
          </pre>
        )}
      </Panel>
    </section>
  );
}
