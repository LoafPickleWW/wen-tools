import { useEffect, useState } from "react";
import { MdCheck, MdHourglassEmpty, MdPhotoLibrary } from "react-icons/md";
import { ipfsFallbackSrc, ipfsToUrl } from "../../utils/wallet";
import { ipfsToHttp } from "../../utils/wenpadSale";
import type { CandidateAsset } from "./assetLoader";

export function CollectionFeatureCard({
  asset,
  isSelected,
  onSelect,
}: {
  asset: CandidateAsset;
  isSelected: boolean;
  onSelect: (asset: CandidateAsset, imageUrl: string) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!asset.url) {
          if (!cancelled) setLoading(false);
          return;
        }
        const url = await ipfsToUrl(asset.url, asset.reserve || "");
        if (!cancelled) {
          setImageUrl(url);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.url, asset.reserve]);

  const displaySrc = ipfsToHttp(imageUrl || asset.url || "");

  return (
    <button
      type="button"
      onClick={() => onSelect(asset, imageUrl || asset.url || "")}
      className={`relative group flex flex-col p-2 rounded-2xl border text-left transition-all cursor-pointer ${
        isSelected
          ? "border-primary-orange bg-primary-orange/15 shadow-lg shadow-orange-500/10"
          : "border-white/[0.08] bg-asset-detail-bg/50 hover:border-white/20 hover:bg-asset-detail-bg/80"
      }`}
    >
      <div className="w-full aspect-square rounded-xl bg-asset-detail-bg/80 overflow-hidden flex items-center justify-center relative">
        {loading ? (
          <MdHourglassEmpty className="animate-spin text-gray-500 text-lg" />
        ) : displaySrc ? (
          <img
            src={displaySrc}
            alt={asset.name || `ASA #${asset.id}`}
            loading="lazy"
            onError={(e) => {
              const fallback = ipfsFallbackSrc(displaySrc);
              if (fallback && e.currentTarget.src !== fallback) {
                e.currentTarget.src = fallback;
              }
            }}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <MdPhotoLibrary className="text-gray-600 text-2xl" />
        )}
        {isSelected && (
          <div className="absolute top-1.5 right-1.5 bg-primary-orange text-black rounded-full p-0.5 shadow-md">
            <MdCheck size={14} className="stroke-[2]" />
          </div>
        )}
      </div>
      <div className="mt-1.5 w-full min-w-0">
        <p className="text-xs font-bold text-white truncate">{asset.name || `ASA #${asset.id}`}</p>
        <p className="text-[10px] text-gray-400 truncate">
          {asset.unitName ? `${asset.unitName} · ` : ""}#{asset.id}
        </p>
      </div>
    </button>
  );
}
