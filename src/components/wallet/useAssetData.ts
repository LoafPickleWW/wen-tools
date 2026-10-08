import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import { SingleAssetDataResponse } from "../../types/wallet";
import {
  getAssetData,
  getIndexerUrl,
  ipfsToUrl,
  MAX_SELECT_COUNT,
} from "../../utils/wallet";
import useWalletAssetStore from "../../store/walletAssetStore";
import useWalletToolStore from "../../store/walletToolStore";

// Loads asset params (cached in the asset store) and resolves its image url.
export function useAssetData(assetId: number) {
  const { activeNetwork } = useWallet();
  const [assetData, setAssetData] = useState<SingleAssetDataResponse>();
  const [assetUrl, setAssetUrl] = useState<string>("/images/wallet/loading.gif");

  const indexerUrl = getIndexerUrl(activeNetwork);

  useEffect(() => {
    async function getData() {
      const stateData = useWalletAssetStore
        .getState()
        .assets.find((a) => a.index === assetId);
      if (stateData) {
        setAssetData(stateData);
        const url = await ipfsToUrl(
          stateData.params.url,
          stateData.params.reserve
        );
        setAssetUrl(url);
        return;
      }
      const response = await getAssetData(assetId, indexerUrl);
      setAssetData(response);
      useWalletAssetStore.getState().addAsset(response);
      const url = await ipfsToUrl(response.params.url, response.params.reserve);
      setAssetUrl(url);
    }
    if (!assetId) return;
    getData();
  }, [assetId, indexerUrl]);

  return { assetData, assetUrl, setAssetUrl, indexerUrl };
}

export function toggleAssetSelection(assetId: number) {
  const toolState = useWalletToolStore.getState();
  if (toolState.selectedAssets.includes(assetId)) {
    toolState.removeSelectedAsset(assetId);
    return;
  }
  if (toolState.selectedAssets.length < MAX_SELECT_COUNT) {
    toolState.addSelectedAsset(assetId);
  } else {
    toast.info(`You can only select ${MAX_SELECT_COUNT} assets at a time.`);
  }
}
