import {
  Algodv2,
  Transaction,
  computeGroupID,
  decodeAddress,
  makeAssetDestroyTxnWithSuggestedParamsFromObject,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  waitForConfirmation,
} from "algosdk";
import axios from "axios";
import { CID } from "multiformats/cid";
import * as digest from "multiformats/hashes/digest";
import * as mfsha2 from "multiformats/hashes/sha2";
import { toast } from "react-toastify";
import { decode } from "uint8-to-base64";
import useWalletAssetStore from "../store/walletAssetStore";
import {
  AccountAssetsDataResponse,
  AccountDataType,
  AssetAccountDataResponse,
  AssetMetadataResponse,
  AssetTransactionsResponse,
  AssetTransferType,
  AssetsType,
  SingleAssetDataResponse,
} from "../types/wallet";

export const IPFS_ENDPOINT = "https://ipfs.io/ipfs";
export const PAGE_SIZE = 64;
export const MAX_SELECT_COUNT = 64;
export const TX_NOTE = "via wen.tools | wen wallet";

export function getIndexerUrl(activeNetwork: string) {
  return activeNetwork === "testnet"
    ? "https://testnet-idx.algonode.cloud"
    : "https://mainnet-idx.algonode.cloud";
}

export function getNodeUrl(activeNetwork: string) {
  return activeNetwork === "testnet"
    ? "https://testnet-api.algonode.cloud"
    : "https://mainnet-api.algonode.cloud";
}

export const shortenAddress = (walletAddress: string, count: number = 4) => {
  return (
    walletAddress.substring(0, count) +
    "..." +
    walletAddress.substring(walletAddress.length - count)
  );
};

export async function getAccountData(
  walletAddress: string,
  nodeUrl: string
): Promise<AccountDataType> {
  const response = await axios.get(
    nodeUrl + `/v2/accounts/${walletAddress}?exclude=all`
  );
  return response.data as AccountDataType;
}

export function getAssetDirectionUrl(assetId: number) {
  return "/wallet/asset/" + assetId;
}

export function getWalletDirectionUrl(walletAddress: string) {
  return "/wallet/account/" + walletAddress;
}

export async function getAssetTraitData(
  assetData: SingleAssetDataResponse
): Promise<AssetMetadataResponse> {
  try {
    const assetFormat = findAssetFormat(assetData.params.url);
    const metadata: AssetMetadataResponse = {
      filters: [],
      traits: [],
    };

    let assetMetadata;

    if (assetFormat === "ARC19") {
      assetMetadata = await getARC19AssetMetadataData(
        assetData.params["url"],
        assetData.params["reserve"]
      );
    } else if (assetFormat === "ARC69" || assetFormat === "Token") {
      assetMetadata = await getArc69Metadata(assetData.index, "https://mainnet-idx.algonode.cloud");
    } else if (assetFormat === "ARC3") {
      if (assetData.params["url"].startsWith("ipfs://")) {
        assetMetadata = await axios
          .get(
            `${IPFS_ENDPOINT}/${assetData.params["url"].replace("ipfs://", "")}`
          )
          .then((res) => res.data);
      } else {
        assetMetadata = await axios
          .get(assetData.params["url"])
          .then((res) => res.data);
      }
    }

    if (assetMetadata.attributes && !assetMetadata.properties) {
      assetMetadata.properties = assetMetadata.attributes;
      delete assetMetadata.attributes;
    }

    for (const filter in assetMetadata.properties.filters) {
      metadata.filters = [
        ...metadata.filters,
        {
          category: filter,
          value: assetMetadata.properties.filters[filter],
        },
      ];
    }

    if (assetMetadata.properties) {
      if (Object.keys(assetMetadata.properties).includes("traits")) {
        assetMetadata.properties = assetMetadata.properties.traits;
      }
      for (const key in assetMetadata.properties) {
        if (typeof assetMetadata.properties[key] === "object") {
          for (const subKey in assetMetadata.properties[key]) {
            metadata.traits = [
              ...metadata.traits,
              {
                category: subKey,
                value: assetMetadata.properties[key][subKey],
              },
            ];
          }
        } else {
          if (!key.includes("image_static")) {
            metadata.traits = [
              ...metadata.traits,
              {
                category: key,
                value: assetMetadata.properties[key],
              },
            ];
          }
        }
      }
    }
    if (assetMetadata.description) {
      metadata.traits = [
        ...metadata.traits,
        {
          category: "description",
          value: assetMetadata.description,
        },
      ];
    }
    if (assetMetadata.external_url) {
      metadata.traits = [
        ...metadata.traits,
        {
          category: "external_url",
          value: assetMetadata.external_url,
        },
      ];
    }
    return metadata;
  } catch (error) {
    console.error(error);
    return {
      filters: [],
      traits: [],
    };
  }
}

async function getARC19AssetMetadataData(
  url: string,
  reserve: string
): Promise<any> {
  try {
    const chunks = url.split("://");
    if (chunks[0] === "template-ipfs" && chunks[1].startsWith("{ipfscid:")) {
      const cidComponents = chunks[1].split(":");
      const cidVersion = cidComponents[1];
      const cidCodec = cidComponents[2];
      let cidCodecCode;
      if (cidCodec === "raw") {
        cidCodecCode = 0x55;
      } else if (cidCodec === "dag-pb") {
        cidCodecCode = 0x70;
      } else throw new Error("Unknown codec");
      const addr = decodeAddress(reserve);
      const mhdigest = digest.create(mfsha2.sha256.code, addr.publicKey);
      if (cidVersion === "1") {
        const cid = CID.createV1(cidCodecCode, mhdigest);
        const response = await axios.get(`${IPFS_ENDPOINT}/${cid}`);
        return response.data;
      } else {
        const cid = CID.createV0(mhdigest);
        const response = await axios.get(`${IPFS_ENDPOINT}/${cid}`);
        return response.data;
      }
    }
    return {};
  } catch {
    return {};
  }
}

export async function getOwnerAddressOfAsset(assetId: number, indexerUrl: string) {
  try {
    const url = `${indexerUrl}/v2/assets/${assetId}/balances?currency-greater-than=0`;
    const response = await axios.get(url);
    return response.data.balances[0].address;
  } catch {
    return "";
  }
}

export async function getAccountAssetData(
  assetId: number,
  wallet: string,
  indexerUrl: string
): Promise<AssetAccountDataResponse> {
  try {
    const url = `${indexerUrl}/v2/accounts/${wallet}/assets?asset-id=${assetId}&include-all=false`;
    const response = await axios.get(url);
    if (response.data.assets.length === 0) {
      return { amount: 0, isOptedIn: false } as AssetAccountDataResponse;
    } else {
      return {
        amount: response.data.assets[0].amount,
        isOptedIn: true,
      } as AssetAccountDataResponse;
    }
  } catch {
    return { amount: 0, isOptedIn: false } as AssetAccountDataResponse;
  }
}

export function findAssetFormat(url: string) {
  if (!url) {
    return "Token";
  }
  if (url.includes("template-ipfs")) {
    return "ARC19";
  } else if (url.includes("#arc3")) {
    return "ARC3";
  } else if (url.includes("ipfs://") || url.includes("ipfs/")) {
    return "ARC69";
  } else {
    return "Token";
  }
}

export async function getAssetsFromAddress(
  walletAddress: string,
  indexerUrl: string
): Promise<AssetsType[]> {
  let threshold = 1000;
  const userAssets = await axios.get<AccountAssetsDataResponse>(
    `${indexerUrl}/v2/accounts/${walletAddress}/assets?include-all=false`
  );
  while (userAssets.data.assets.length === threshold) {
    const nextAssets = await axios.get(
      `${indexerUrl}/v2/accounts/${walletAddress}/assets?include-all=false&next=${userAssets.data["next-token"]}`
    );
    userAssets.data.assets = userAssets.data.assets.concat(
      nextAssets.data.assets
    );
    userAssets.data["next-token"] = nextAssets.data["next-token"];
    threshold += 1000;
  }
  return userAssets.data.assets.sort(
    (a, b) => b["opted-in-at-round"] - a["opted-in-at-round"]
  );
}

export async function getCreatedAssetsFromAddress(
  walletAddress: string,
  indexerUrl: string
): Promise<SingleAssetDataResponse[]> {
  let threshold = 1000;
  const createdAssets = await axios.get(
    `${indexerUrl}/v2/accounts/${walletAddress}/created-assets?include-all=false`
  );
  while (createdAssets.data.assets.length === threshold) {
    const nextAssets = await axios.get(
      `${indexerUrl}/v2/accounts/${walletAddress}/created-assets?include-all=false&next=${createdAssets.data["next-token"]}`
    );
    createdAssets.data.assets = createdAssets.data.assets.concat(
      nextAssets.data.assets
    );
    createdAssets.data["next-token"] = nextAssets.data["next-token"];
    threshold += 1000;
  }
  return createdAssets.data.assets;
}

export async function getAssetData(
  assetId: number,
  indexerUrl: string
): Promise<SingleAssetDataResponse> {
  const data = await axios.get(
    `${indexerUrl}/v2/assets/${assetId}?include-all=true`
  );
  return data.data.asset as SingleAssetDataResponse;
}

export async function getNfdDomain(wallet: string): Promise<string> {
  try {
    const nfdDomain = await axios.get(
      "https://api.nf.domains/nfd/lookup?address=" + wallet
    );
    if (nfdDomain.status === 200) {
      return nfdDomain.data[wallet].name;
    } else {
      return wallet;
    }
  } catch {
    return wallet;
  }
}

export async function getWalletAddressFromNfDomain(
  domain: string
): Promise<string> {
  try {
    const response = await axios.get(
      `https://api.nf.domains/nfd/${domain}?view=tiny&poll=false&nocache=false`
    );
    if (response.status === 200) {
      return response.data.depositAccount;
    } else {
      return "";
    }
  } catch {
    return "";
  }
}

export const ipfsToUrl = async (
  assetUrl: string,
  assetReserve: string,
  forDetail = false
): Promise<string> => {
  if (!assetUrl) return "";
  try {
    const optimizer = !forDetail ? "?optimizer=image&width=450&quality=70" : "";
    if (assetUrl.includes("template-ipfs")) {
      const { data, cid } = await getARC19AssetData(assetUrl, assetReserve);
      const url = data.image
        ? data.image
        : `${IPFS_ENDPOINT}/${cid}${optimizer}`;
      if (url.startsWith("ipfs://"))
        return `${IPFS_ENDPOINT}/${url.slice(7)}${optimizer}`;
      if (url !== "") return url;
      return "";
    }
    if (assetUrl.endsWith("#arc3")) {
      const url = assetUrl.slice(0, -5);
      if (url.startsWith("ipfs://")) {
        const response = await axios.get(`${IPFS_ENDPOINT}/${url.slice(7)}`);
        if (response.data.image.startsWith("ipfs://")) {
          return `${IPFS_ENDPOINT}/${response.data.image.slice(7)}${optimizer}`;
        }
        return response.data.image;
      } else {
        const response = await axios.get(url);
        if (response.data.image.startsWith("ipfs://")) {
          return `${IPFS_ENDPOINT}/${response.data.image.slice(7)}${optimizer}`;
        }
        return response.data.image;
      }
    }
    if (assetUrl.startsWith("https://") && assetUrl.includes("ipfs")) {
      return `${IPFS_ENDPOINT}/${assetUrl.split("/ipfs/")[1]}${optimizer}`;
    }
    if (assetUrl.startsWith("ipfs://")) {
      return `${IPFS_ENDPOINT}/${assetUrl.slice(7)}${optimizer}`;
    }
    return assetUrl;
  } catch {
    return "";
  }
};

export async function getARC19AssetData(url: string, reserve: string) {
  try {
    const chunks = url.split("://");
    if (chunks[0] === "template-ipfs" && chunks[1].startsWith("{ipfscid:")) {
      const cidComponents = chunks[1].split(":");
      const cidVersion = parseInt(cidComponents[1]);
      const cidCodec = cidComponents[2];
      let cidCodecCode;
      if (cidCodec === "raw") {
        cidCodecCode = 0x55;
      } else if (cidCodec === "dag-pb") {
        cidCodecCode = 0x70;
      } else {
        throw new Error("Unknown codec");
      }
      const addr = decodeAddress(reserve);
      const mhdigest = digest.create(mfsha2.sha256.code, addr.publicKey);
      const cid =
        cidVersion === 1
          ? CID.createV1(cidCodecCode, mhdigest)
          : CID.createV0(mhdigest);
      const response = await axios.get(`${IPFS_ENDPOINT}/${cid}`);
      return { data: response.data, cid: cid };
    } else {
      throw new Error("invalid url" + url);
    }
  } catch {
    throw new Error("invalid url" + url);
  }
}

export function getAssetType(url: string) {
  if (!url || !url.includes("ipfs")) return "-";
  if (url.startsWith("template-ipfs")) {
    return "ARC19";
  } else if (url.endsWith("#arc3")) {
    return "ARC3";
  } else if (url.includes("ipfs") && !url.endsWith("#arc3")) {
    return "ARC69";
  }
  return "Token";
}

export const getArc69Metadata = async (
  assetId: number,
  indexerUrl: string
): Promise<Record<string, string>> => {
  const response = await axios.get<AssetTransactionsResponse>(
    `${indexerUrl}/v2/assets/${assetId}/transactions?tx-type=acfg`
  );
  response.data.transactions.sort(
    (a, b) => a["confirmed-round"] - b["confirmed-round"]
  );
  const encodedMetadata =
    response.data.transactions[response.data.transactions.length - 1].note;
  const text = new TextDecoder().decode(decode(encodedMetadata));
  const metadata = JSON.parse(text);
  return metadata;
};

async function getCreatorWalletOfAsset(assetId: number, indexerUrl: string) {
  const assetData = useWalletAssetStore
    .getState()
    .assets.find((a) => a.index === assetId);
  if (assetData) {
    return assetData.params.creator;
  } else {
    const asset = await getAssetData(assetId, indexerUrl);
    return asset.params.creator;
  }
}

export async function sendSignedTransaction(signedTxns: Uint8Array[], algodClient: Algodv2) {
  const { txId } = await algodClient.sendRawTransaction(signedTxns).do();
  await waitForConfirmation(algodClient, txId, 3);
  return txId;
}

export const copyAssetIds = (assets: number[]) => {
  if (assets.length === 0) return;
  if (assets.length === 1) {
    navigator.clipboard.writeText(assets[0].toString());
  } else {
    const text = assets.join(",");
    navigator.clipboard.writeText(text);
  }
  toast.success("Copied!");
};

export async function createAssetOptInTransactions(
  assets: number[],
  walletAddress: string,
  algodClient: Algodv2
) {
  if (assets.length === 0) throw new Error("Please select an asset!");
  if (assets.length > MAX_SELECT_COUNT) {
    throw new Error(
      `You can only select ${MAX_SELECT_COUNT} assets at a time!`
    );
  }
  const params = await algodClient.getTransactionParams().do();
  const txnsArray: Transaction[] = [];
  for (let i = 0; i < assets.length; i++) {
    const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: walletAddress.trim(),
      to: walletAddress.trim(),
      amount: 0,
      assetIndex: assets[i],
      suggestedParams: params,
      note: new TextEncoder().encode(TX_NOTE),
    });
    txnsArray.push(tx);
  }
  return txnsArray;
}

export async function createAssetOptoutTransactions(
  assets: number[],
  walletAddress: string,
  algodClient: Algodv2,
  indexerUrl: string
) {
  if (assets.length === 0) throw new Error("Please select an asset!");
  if (assets.length > MAX_SELECT_COUNT) {
    throw new Error(
      `You can only select ${MAX_SELECT_COUNT} assets at a time!`
    );
  }
  const params = await algodClient.getTransactionParams().do();
  const txnsArray: Transaction[] = [];
  for (let i = 0; i < assets.length; i++) {
    const creatorAddress = await getCreatorWalletOfAsset(assets[i], indexerUrl);
    if (creatorAddress !== "") {
      const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: walletAddress.trim(),
        to: creatorAddress.trim(),
        amount: 0,
        assetIndex: assets[i],
        suggestedParams: params,
        closeRemainderTo: creatorAddress.trim(),
        note: new TextEncoder().encode(TX_NOTE),
      });
      txnsArray.push(tx);
    }
  }
  return txnsArray;
}

export async function createDeletedAssetOptoutTransactions(
  assets: number[],
  walletAddress: string,
  algodClient: Algodv2
) {
  if (assets.length === 0) throw new Error("Please select an asset!");
  if (assets.length > MAX_SELECT_COUNT) {
    throw new Error(
      `You can only select ${MAX_SELECT_COUNT} assets at a time!`
    );
  }
  const params = await algodClient.getTransactionParams().do();
  const txnsArray: Transaction[] = [];
  for (let i = 0; i < assets.length; i++) {
    const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: walletAddress.trim(),
      to: walletAddress.trim(),
      amount: 0,
      assetIndex: assets[i],
      suggestedParams: params,
      closeRemainderTo: walletAddress.trim(),
      note: new TextEncoder().encode(TX_NOTE),
    });
    txnsArray.push(tx);
  }
  return txnsArray;
}

export async function createAssetDestroyTransactions(
  assets: number[],
  walletAddress: string,
  algodClient: Algodv2,
  indexerUrl: string
) {
  if (assets.length === 0) throw new Error("Please select an asset!");
  if (assets.length > MAX_SELECT_COUNT) {
    throw new Error(
      `You can only select ${MAX_SELECT_COUNT} assets at a time!`
    );
  }
  const params = await algodClient.getTransactionParams().do();
  const txnsArray: Transaction[] = [];
  for (let i = 0; i < assets.length; i++) {
    const creatorAddress = await getCreatorWalletOfAsset(assets[i], indexerUrl);
    if (creatorAddress !== "") {
      const tx = makeAssetDestroyTxnWithSuggestedParamsFromObject({
        from: walletAddress.trim(),
        suggestedParams: params,
        assetIndex: assets[i],
        note: new TextEncoder().encode(TX_NOTE),
      });
      txnsArray.push(tx);
    }
  }
  return txnsArray;
}

export async function createAssetSendTransactions(
  assets: AssetTransferType[],
  walletAddress: string,
  algodClient: Algodv2
) {
  if (assets.length === 0) throw new Error("Please select an asset!");
  if (assets.length > MAX_SELECT_COUNT) {
    throw new Error(
      `You can only select ${MAX_SELECT_COUNT} assets at a time!`
    );
  }
  const params = await algodClient.getTransactionParams().do();
  const txnsArray: Transaction[] = [];
  for (let i = 0; i < assets.length; i++) {
    const tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: walletAddress.trim(),
      to: assets[i].receiver.trim(),
      amount: assets[i].amount * 10 ** assets[i].decimals,
      assetIndex: assets[i].index,
      suggestedParams: params,
      note: new TextEncoder().encode(TX_NOTE),
    });
    txnsArray.push(tx);
  }
  return txnsArray;
}

export async function createAssetTransferTransactions(
  assets: AssetTransferType[],
  walletAddress: string,
  algodClient: Algodv2
) {
  if (assets.length === 0) throw new Error("Please select an asset!");
  if (assets.length > MAX_SELECT_COUNT / 2) {
    throw new Error(
      `You can only select ${MAX_SELECT_COUNT / 2} assets at a time!`
    );
  }
  const params = await algodClient.getTransactionParams().do();
  const txnsArray: Transaction[][] = [];
  for (let i = 0; i < assets.length; i++) {
    const optin_tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: assets[i].receiver.trim(),
      to: assets[i].receiver.trim(),
      amount: 0,
      assetIndex: assets[i].index,
      suggestedParams: params,
      note: new TextEncoder().encode(TX_NOTE),
    });
    const send_tx = makeAssetTransferTxnWithSuggestedParamsFromObject({
      from: walletAddress.trim(),
      to: assets[i].receiver.trim(),
      amount: assets[i].amount * 10 ** assets[i].decimals,
      assetIndex: assets[i].index,
      suggestedParams: params,
      note: new TextEncoder().encode(TX_NOTE),
    });
    const groupID = computeGroupID([optin_tx, send_tx]);
    optin_tx.group = groupID;
    send_tx.group = groupID;
    txnsArray.push([optin_tx, send_tx]);
  }
  return txnsArray;
}

export function formatWithCommas(input: number): string {
  if (isNaN(input)) {
    return input.toString();
  }
  return input.toLocaleString("en-US");
}

export const fuseSearchOptions = {
  includeScore: true,
  keys: ["asset-id"],
  distance: 1,
  threshold: 0,
};

export const orderByOptions = [
  {
    label: "Newest",
    value: "newest",
  },
  {
    label: "Oldest",
    value: "oldest",
  },
  {
    label: "ASA Id (Asc.)",
    value: "asset-id-asc",
  },
  {
    label: "ASA Id (Desc.)",
    value: "asset-id-desc",
  },
];

export const filterByOptions = [
  {
    label: "Show All",
    value: "showAll",
  },
  {
    label: "Zero Balances",
    value: "showZero",
  },
  {
    label: "Non-Zero Balances",
    value: "showNonZero",
  },
  {
    label: "Created Assets",
    value: "showCreated",
  },
  {
    label: "Non-Created Assets",
    value: "showNonCreated",
  },
];
