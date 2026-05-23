import { Transaction } from "algosdk";

export interface AccountDataType {
  amount: number;
  "min-balance": number;
  "total-assets-opted-in": number;
  "total-created-assets": number;
}

export interface ToolType {
  name: string;
  id: string;
  action?: (selectedAssets: number[]) => Promise<Uint8Array[]> | void;
}

export interface AssetsType {
  amount: number;
  "asset-id": number;
  "opted-in-at-round": number;
}

export interface AccountAssetsDataResponse {
  assets: AssetsType[];
  "next-token": string;
}

export interface AssetParamsType {
  creator: string;
  decimals: number;
  manager: string;
  name: string;
  reserve: string;
  total: number;
  "unit-name": string;
  url: string;
  clawback: string;
  freeze: string;
  "default-frozen"?: boolean;
}

export interface SingleAssetDataResponse {
  index: number;
  "created-at-round"?: number;
  deleted?: boolean;
  params: AssetParamsType;
}

interface AssetTransaction {
  "confirmed-round": number;
  note: string;
}

export interface AssetTransactionsResponse {
  "current-round": number;
  "next-token": string;
  transactions: AssetTransaction[];
}

export interface ToolSelectProps {
  tools: ToolType[];
  setFilteredAssets: React.Dispatch<React.SetStateAction<AssetsType[]>>;
}

export interface AssetTransferType {
  index: number;
  amount: number;
  decimals: number;
  receiver: string;
}

export interface SignTransactionsType {
  txn: Transaction;
  signers: string[];
}

export interface AssetAccountDataResponse {
  amount: number;
  isOptedIn: boolean;
}

interface AssetMetadataType {
  category: string;
  value: string;
}

export interface AssetMetadataResponse {
  traits: AssetMetadataType[];
  filters: AssetMetadataType[];
}
