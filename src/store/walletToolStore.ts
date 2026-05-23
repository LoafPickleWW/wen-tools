import { create } from "zustand";
import { ToolType } from "../types/wallet";

interface ToolState {
  tool: ToolType | null;
  setTool: (tool: ToolType | null) => void;
  selectedAssets: number[];
  addSelectedAsset: (assetId: number) => void;
  removeSelectedAsset: (assetId: number) => void;
  clearSelectedAssets: () => void;
}

const useWalletToolStore = create<ToolState>((set) => ({
  tool: null,
  setTool: (tool) => set({ tool }),
  selectedAssets: [],
  addSelectedAsset: (assetId) =>
    set((state) => ({ selectedAssets: [...state.selectedAssets, assetId] })),
  removeSelectedAsset: (assetId) =>
    set((state) => ({
      selectedAssets: state.selectedAssets.filter((id) => id !== assetId),
    })),
  clearSelectedAssets: () => set({ selectedAssets: [] }),
}));

export default useWalletToolStore;
