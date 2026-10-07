import { useEffect, useRef, useState } from "react";
import { MdPhotoLibrary } from "react-icons/md";
import { ipfsFallbackSrc, ipfsToUrl } from "../../utils/wallet";
import type { CandidateAsset } from "./assetLoader";

/**
 * Small NFT image preview. Resolves the image (ARC-3 / ARC-19 / ARC-69) only once the thumbnail
 * scrolls into view, so long item lists don't fire hundreds of metadata requests up front.
 */
export function AssetThumb({ asset, size = 40 }: { asset: Pick<CandidateAsset, "url" | "reserve" | "name">; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !asset.url) return;
    let cancelled = false;
    ipfsToUrl(asset.url, asset.reserve || "").then((url) => !cancelled && setSrc(url));
    return () => {
      cancelled = true;
    };
  }, [visible, asset.url, asset.reserve]);

  return (
    <div
      ref={ref}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-lg overflow-hidden bg-asset-detail-bg/80 border border-white/[0.06] flex items-center justify-center"
    >
      {src ? (
        <img
          src={src}
          alt={asset.name || ""}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            const fallback = ipfsFallbackSrc(src);
            if (fallback && e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
          }}
        />
      ) : (
        <MdPhotoLibrary className="text-gray-600" size={size / 2.5} />
      )}
    </div>
  );
}
