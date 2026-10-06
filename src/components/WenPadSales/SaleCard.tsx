import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MdImage } from "react-icons/md";
import {
  STATUS,
  fetchCollectionJson,
  ipfsToHttp,
  type CollectionJson,
  type SaleListing,
} from "../../utils/wenpadSale";
import { ProgressBar, StatusBadge, formatAlgo, roundsToRelative } from "./shared";

export function SaleCard({ sale, currentRound }: { sale: SaleListing; currentRound: number }) {
  const [collection, setCollection] = useState<CollectionJson | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCollectionJson(sale.metadata.metadataUrl).then((c) => !cancelled && setCollection(c));
    return () => {
      cancelled = true;
    };
  }, [sale.metadata.metadataUrl]);

  const ended = currentRound > 0 && currentRound > sale.endRound;
  const notStarted = currentRound > 0 && currentRound < sale.startRound;
  const image = ipfsToHttp(collection?.image || "");

  return (
    <Link
      to={`/shuffle/${sale.appId}`}
      className="group bg-banner-grey/30 border border-white/[0.12] rounded-3xl overflow-hidden hover:border-primary-orange/50 transition-all flex flex-col"
    >
      <div className="aspect-square bg-asset-detail-bg/60 flex items-center justify-center overflow-hidden">
        {image ? (
          <img
            src={image}
            alt={sale.metadata.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <MdImage size={48} className="text-gray-700" />
        )}
      </div>
      <div className="p-5 flex flex-col gap-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-black text-white truncate">{sale.metadata.name || `Shuffle #${sale.saleId}`}</h3>
            <p className="text-xs text-gray-500">
              {sale.metadata.unitName} · {sale.metadata.standard}
            </p>
          </div>
          <StatusBadge status={sale.status} ended={ended} />
        </div>

        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Price</p>
            <p className="text-lg font-black text-primary-orange">{formatAlgo(sale.price, 3)}</p>
          </div>
          <p className="text-xs text-gray-400 font-bold">
            {sale.sold} / {sale.totalItems} minted{sale.volume > 0 && ` · ${formatAlgo(sale.volume, 2)} vol`}
          </p>
        </div>
        <ProgressBar value={sale.sold} total={sale.totalItems} />

        {currentRound > 0 && sale.status === STATUS.LIVE && (
          <p className="text-[11px] text-gray-500">
            {notStarted
              ? `Starts ${roundsToRelative(sale.startRound, currentRound)}`
              : ended
                ? `Ended ${roundsToRelative(sale.endRound, currentRound)}`
                : `Ends ${roundsToRelative(sale.endRound, currentRound)}`}
          </p>
        )}
      </div>
    </Link>
  );
}
