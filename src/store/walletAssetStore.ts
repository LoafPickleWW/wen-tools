import { create } from "zustand";
import { SingleAssetDataResponse } from "../types/wallet";

interface AssetState {
  assets: SingleAssetDataResponse[];
  setAssets: (assets: SingleAssetDataResponse[]) => void;
  addAsset: (asset: SingleAssetDataResponse) => void;
}

const useWalletAssetStore = create<AssetState>((set) => ({
  assets: [],
  setAssets: (assets: SingleAssetDataResponse[]) => set({ assets }),
  addAsset: (asset: SingleAssetDataResponse) =>
    set((state) => ({ assets: [...state.assets, asset] })),
}));

export default useWalletAssetStore;
