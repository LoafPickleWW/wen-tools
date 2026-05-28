import { useState } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import { GraphNode } from "../../types/analytics";
import { MdContentCopy, MdOutlineOpenInNew, MdZoomOutMap } from "react-icons/md";
import { toast } from "react-toastify";

interface NodeInspectorProps {
  node: GraphNode | null;
  onExpand: (address: string) => Promise<void>;
  onClose: () => void;
  loading: boolean;
}

export function NodeInspector({ node, onExpand, onClose, loading }: NodeInspectorProps) {
  const { activeNetwork } = useWallet();
  const [expanding, setExpanding] = useState(false);

  if (!node) return null;

  const explorerBase = activeNetwork === "testnet"
    ? "https://testnet.explorer.perawallet.app"
    : "https://explorer.perawallet.app";

  const copyAddress = () => {
    navigator.clipboard.writeText(node.id);
    toast.success("Address copied to clipboard!");
  };

  const handleExpand = async () => {
    setExpanding(true);
    try {
      await onExpand(node.id);
      toast.success(`Expanded connections for ${node.label}`);
    } catch {
      toast.error("Failed to expand connections.");
    } finally {
      setExpanding(false);
    }
  };

  const flowPercentage = node.totalCount > 0 
    ? Math.round((node.sentCount / node.totalCount) * 100) 
    : 50;

  return (
    <div className="w-full lg:w-96 bg-secondary-black border border-secondary-gray rounded-2xl p-5 shadow-2xl flex flex-col gap-4 animate-fade-in">
      <div className="flex justify-between items-start border-b border-secondary-gray/50 pb-3">
        <div>
          <h3 className="text-md font-bold text-white font-mono break-all">{node.label}</h3>
          <span className="text-[10px] text-slate-400 capitalize tracking-wider">{node.type} Wallet</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors p-1"
        >
          &times;
        </button>
      </div>

      {/* Address Details */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Wallet Address</span>
        <div className="flex items-center justify-between gap-2 bg-banner-grey border border-secondary-gray px-3 py-2 rounded-xl text-xs font-mono text-slate-300">
          <span className="truncate flex-1 select-all">{node.id}</span>
          <button
            onClick={copyAddress}
            className="text-slate-400 hover:text-amber-400 transition-colors p-0.5"
            title="Copy address"
          >
            <MdContentCopy className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Flow Details & Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-banner-grey/50 border border-secondary-gray/40 p-2.5 rounded-xl">
          <div className="text-[9px] uppercase font-bold text-purple-400">Sent</div>
          <div className="text-md font-bold text-white mt-0.5">{node.sentCount}</div>
        </div>
        <div className="bg-banner-grey/50 border border-secondary-gray/40 p-2.5 rounded-xl">
          <div className="text-[9px] uppercase font-bold text-green-400">Received</div>
          <div className="text-md font-bold text-white mt-0.5">{node.recvCount}</div>
        </div>
        <div className="bg-banner-grey/50 border border-secondary-gray/40 p-2.5 rounded-xl">
          <div className="text-[9px] uppercase font-bold text-amber-400">Total</div>
          <div className="text-md font-bold text-white mt-0.5">{node.totalCount}</div>
        </div>
      </div>

      {/* Flow Ratio Indicator */}
      <div className="flex flex-col gap-1 mt-1">
        <div className="flex justify-between text-[9px] uppercase font-bold text-slate-500">
          <span>Sent Ratio ({flowPercentage}%)</span>
          <span>Received ({100 - flowPercentage}%)</span>
        </div>
        <div className="w-full bg-banner-grey h-2 rounded-full overflow-hidden flex">
          <div className="bg-purple-500 h-full transition-all duration-500" style={{ width: `${flowPercentage}%` }} />
          <div className="bg-green-500 h-full transition-all duration-500" style={{ width: `${100 - flowPercentage}%` }} />
        </div>
      </div>

      {/* Special Highlights (e.g. First Bonded) */}
      {node.isFirstBonded && (
        <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl flex flex-col gap-1 text-xs text-red-300">
          <span className="font-bold flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            First Bonded Address (Funder)
          </span>
          <span className="text-[10px] text-slate-400 leading-normal">
            This account funded the minimum balance or performed the initial opt-in transaction for one of the seed wallets. This is a high-signal cluster indicator.
          </span>
        </div>
      )}

      {/* Action Area */}
      <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-secondary-gray/40">
        {!node.isExpanded ? (
          <button
            onClick={handleExpand}
            disabled={expanding || loading}
            className="w-full bg-amber-400 hover:bg-amber-500 disabled:bg-amber-400/40 text-black font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-sm shadow-md"
          >
            {expanding ? "Expanding..." : <><MdZoomOutMap className="w-4 h-4" /> Expand Node Connections</>}
          </button>
        ) : (
          <div className="text-center py-2 text-xs text-slate-400 italic bg-banner-grey/30 border border-dashed border-secondary-gray/30 rounded-xl">
            Connection network already expanded
          </div>
        )}

        <a
          href={`${explorerBase}/address/${node.id}`}
          target="_blank"
          rel="noreferrer"
          className="w-full bg-banner-grey hover:bg-secondary-gray/60 text-slate-300 hover:text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-sm border border-secondary-gray shadow-inner"
        >
          <MdOutlineOpenInNew className="w-4 h-4" /> View in Pera Explorer
        </a>
      </div>
    </div>
  );
}
