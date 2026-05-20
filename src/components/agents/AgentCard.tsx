import { useState } from "react";
import type { AgentListing } from "../../types/agent";
import { IoLink, IoPencil, IoTrash, IoPlay } from "react-icons/io5";
import { toast } from "react-toastify";

interface AgentCardProps {
  listing: AgentListing;
  isOwner: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTestCall?: (listing: AgentListing) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  "ai-agent": "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "defi": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "nft": "bg-pink-500/20 text-pink-300 border-pink-500/30",
  "analytics": "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  "oracle": "bg-amber-500/20 text-amber-300 border-amber-500/30",
  "utility": "bg-green-500/20 text-green-300 border-green-500/30",
  "infrastructure": "bg-slate-500/20 text-slate-300 border-slate-500/30",
  "social": "bg-rose-500/20 text-rose-300 border-rose-500/30",
  "gaming": "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
};

function getCategoryClass(category: string): string {
  return CATEGORY_COLORS[category.toLowerCase()] || "bg-neutral-500/20 text-neutral-300 border-neutral-500/30";
}

export function AgentCard({ listing, isOwner, onEdit, onDelete, onTestCall }: AgentCardProps) {
  const [expanded, setExpanded] = useState(false);

  const handleCopyEndpoint = () => {
    navigator.clipboard.writeText(listing.endpointUrl);
    toast.success("Endpoint copied to clipboard");
  };

  const shortAddr = `${listing.walletAddress.slice(0, 6)}...${listing.walletAddress.slice(-4)}`;

  return (
    <div className="group relative bg-banner-grey/50 border border-secondary-gray rounded-2xl overflow-hidden backdrop-blur-xl transition-all duration-300 hover:border-orange-500/30 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-orange-500/5">
      {/* Subtle gradient accent at top */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-orange-500/0 via-orange-500/40 to-orange-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="p-6 space-y-4">
        {/* Header: Name + Category */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white truncate">{listing.name}</h3>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getCategoryClass(listing.category)}`}>
                {listing.category}
              </span>
              <span className="text-[10px] text-neutral-600 font-mono">{shortAddr}</span>
            </div>
          </div>
          {/* Price badge */}
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-3 py-1.5 text-center flex-shrink-0">
            <div className="text-sm font-black text-orange-400">
              {listing.pricePerCallAlgo === 0 ? "FREE" : `${listing.pricePerCallAlgo} USDC`}
            </div>
            {listing.pricePerCallAlgo > 0 && (
              <div className="text-[9px] text-orange-500/60 uppercase tracking-wider">per call</div>
            )}
          </div>
        </div>

        {/* Description */}
        <p className={`text-sm text-neutral-400 leading-relaxed ${!expanded ? "line-clamp-2" : ""}`}>
          {listing.description}
        </p>
        {listing.description.length > 120 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-orange-400 hover:text-orange-300 font-bold uppercase tracking-wider transition-colors"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-2 pt-2 border-t border-secondary-gray/50">
          <button
            onClick={handleCopyEndpoint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-[10px] font-bold uppercase tracking-wider transition-all"
          >
            <IoLink className="text-xs" />
            Copy Endpoint
          </button>

          {listing.endpointUrl && onTestCall && (
            <button
              onClick={() => onTestCall(listing)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500 hover:text-black text-orange-400 text-[10px] font-bold uppercase tracking-wider transition-all border border-orange-500/30"
            >
              <IoPlay className="text-xs" />
              Test Call
            </button>
          )}

          {listing.infoUrl && (
            <a
              href={listing.infoUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-[10px] font-bold uppercase tracking-wider transition-all"
            >
              ↗ Info
            </a>
          )}

          <a
            href={`https://explorer.perawallet.app/application/${listing.appId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white text-[10px] font-bold uppercase tracking-wider transition-all"
          >
            ↗ Explorer
          </a>

          {isOwner && (
            <>
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-wider transition-all ml-auto"
              >
                <IoPencil className="text-xs" />
                Edit
              </button>
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-wider transition-all"
              >
                <IoTrash className="text-xs" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
