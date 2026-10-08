import { Checkbox } from "@mui/material";
import { AssetsType } from "../../types/wallet";
import { ipfsFallbackSrc } from "../../utils/wallet";
import useWalletToolStore from "../../store/walletToolStore";
import { toggleAssetSelection, useAssetData } from "./useAssetData";

interface AssetListRowProps {
  asset: AssetsType;
}

// Compact row for the mobile list view: thumbnail, name, ASA id and a select checkbox.
const AssetListRow = ({ asset }: AssetListRowProps) => {
  const assetId = asset["asset-id"];
  const { assetData, assetUrl, setAssetUrl } = useAssetData(assetId);
  const isSelected = useWalletToolStore((state) =>
    state.selectedAssets.includes(assetId)
  );

  const name = assetData?.deleted
    ? "Deleted asset"
    : assetData?.params.name || assetData?.params["unit-name"] || "…";

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => toggleAssetSelection(assetId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleAssetSelection(assetId);
          }
        }}
        className={`w-full cursor-pointer select-none flex items-center gap-3 px-2 py-1.5 rounded-xl border text-left transition ${
          isSelected
            ? "bg-primary-orange/10 border-primary-orange/50"
            : "bg-[#1c191c] border-[#2d292d]"
        }`}
      >
        <img
          src={assetUrl || "/images/wallet/404.webp"}
          alt={name}
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-md object-cover bg-black/30"
          onError={(e) => {
            const fallback = ipfsFallbackSrc((e.currentTarget as HTMLImageElement).src);
            setAssetUrl(fallback ?? "/images/wallet/404.webp");
          }}
        />
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-sm font-medium ${
              assetData?.deleted ? "text-red-500" : "text-secondary-orange"
            }`}
          >
            {name}
          </p>
          <p className="truncate font-mono text-xs text-slate-400">{assetId}</p>
        </div>
        <Checkbox
          checked={isSelected}
          tabIndex={-1}
          size="small"
          sx={{
            p: 0.5,
            color: "rgb(148 163 184)",
            "&.Mui-checked": { color: "var(--pq-primary, #f57b14)" },
          }}
          inputProps={{ "aria-label": `Select asset ${assetId}` }}
        />
      </div>
    </li>
  );
};

export default AssetListRow;
