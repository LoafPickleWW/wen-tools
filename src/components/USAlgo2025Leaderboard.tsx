import axios from "axios";
import { formatAddress, getIndexerURL, getOwnerAddressOfAsset } from "../utils";
import { NetworkId } from "@txnlab/use-wallet-react";
import { useEffect, useState } from "react";
import algosdk from "algosdk";

interface AssetHolder {
  [name: string]: number;
}

interface HolderData {
  bronze: [string, number][];
  silver: [string, number][];
  gold: [string, number][];
}

const CREATOR_ADDRESS =
  "USAHT24VO35GF4IBMKKBPJGBPHEY2I2YBBYUGVPLWEOZAE7ATSPNG3Q274";
const MIN_HOLDERS = 3;
const ASSET_TYPES = {
  BRONZE: "USAB",
  SILVER: "USAS",
  GOLD: "USAG",
} as const;

async function getNfdDomain(address: string): Promise<string> {
  try {
    const response = await axios.get(
      `https://api.nf.domains/nfd/lookup?address=${address}&view=tiny`
    );
    return response.data[address]?.name || "";
  } catch {
    return "";
  }
}

async function fetchAllAssets(creatorAddress: string): Promise<any[]> {
  let threshold = 1000;
  const createdAssets = await axios.get(
    `${getIndexerURL(
      NetworkId.MAINNET
    )}/v2/accounts/${creatorAddress}/created-assets?limit=${threshold}`
  );
  while (createdAssets.data.assets.length === threshold) {
    const nextAssets = await axios.get(
      `${getIndexerURL(
        NetworkId.MAINNET
      )}/v2/accounts/${creatorAddress}/created-assets?limit=1000&next=${
        createdAssets.data["next-token"]
      }`
    );
    createdAssets.data.assets = createdAssets.data.assets.concat(
      nextAssets.data.assets
    );
    createdAssets.data["next-token"] = nextAssets.data["next-token"];
    threshold += 1000;
  }

  return createdAssets.data.assets;
}

async function processHolders(assetIds: number[]): Promise<AssetHolder> {
  const holders: AssetHolder = {};

  const addresses = [];

  for (let i = 0; i < assetIds.length; i++) {
    const add = await getOwnerAddressOfAsset(assetIds[i], NetworkId.MAINNET);
    addresses.push(add);
  }

  // Count holdings
  addresses.forEach((holder) => {
    if (algosdk.isValidAddress(holder)) {
      holders[holder] = (holders[holder] || 0) + 1;
    }
  });

  return holders;
}

async function resolveHolderNames(
  holders: AssetHolder
): Promise<[string, number][]> {
  let validAddresses = Object.entries(holders).filter(
    ([addr]) => algosdk.isValidAddress(addr) && addr !== CREATOR_ADDRESS
  );

  const orderedAddresses = validAddresses.sort(
    ([_, count1], [__, count2]) => count2 - count1
  );

  if (orderedAddresses.length > MIN_HOLDERS) {
    validAddresses = orderedAddresses.slice(0, MIN_HOLDERS);
  } else {
    validAddresses = orderedAddresses;
  }

  // Batch NFD lookups with rate limiting
  const resolvedEntries: [string, number][] = [];
  for (let i = 0; i < validAddresses.length; i++) {
    const [address, count] = validAddresses[i];
    const nfd = await getNfdDomain(address);
    resolvedEntries.push([nfd || formatAddress(address), count]);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  while (resolvedEntries.length < MIN_HOLDERS) {
    resolvedEntries.push(["-", 0]);
  }

  return resolvedEntries;
}

export const USAlgo2025Leaderboard = () => {
  const [holderData, setHolderData] = useState<HolderData>({
    bronze: [],
    silver: [],
    gold: [],
  });

  useEffect(() => {
    async function getLeaderBoard() {
      try {
        // Fetch all assets
        const assets = await fetchAllAssets(CREATOR_ADDRESS);

        // Group assets by type
        const assetGroups = {
          bronze: assets
            .filter((asset) =>
              asset.params["unit-name"].startsWith(ASSET_TYPES.BRONZE)
            )
            .map((asset) => asset.index),
          silver: assets
            .filter((asset) =>
              asset.params["unit-name"].startsWith(ASSET_TYPES.SILVER)
            )
            .map((asset) => asset.index),
          gold: assets
            .filter((asset) =>
              asset.params["unit-name"].startsWith(ASSET_TYPES.GOLD)
            )
            .map((asset) => asset.index),
        };

        // Process all holder types in parallel
        const bronzeHolders = await processHolders(assetGroups.bronze).then(
          resolveHolderNames
        );
        const silverHolders = await processHolders(assetGroups.silver).then(
          resolveHolderNames
        );
        const goldHolders = await processHolders(assetGroups.gold).then(
          resolveHolderNames
        );

        setHolderData({
          bronze: bronzeHolders,
          silver: silverHolders,
          gold: goldHolders,
        });
      } catch (error) {
        console.error("Error fetching leaderboard:", error);
        // Handle error appropriately (e.g., show error message to user)
      }
    }

    getLeaderBoard();
  }, []);

  return (
    <>
      <div className="my-8 w-full">
        <h2 className="text-2xl md:text-4xl font-semibold tracking-tight text-white font-sans mb-6">
          USAlgo 2025 Leaderboard
        </h2>
        <div className="overflow-x-auto w-full">
          <table className="w-full max-w-4xl mx-auto rounded-lg overflow-hidden">
            <thead className="bg-gradient-to-r from-[#E4E808] to-[#FD941D]">
              <tr>
                <th className="px-4 py-2 md:px-6 md:py-3 text-black font-bold text-sm md:text-base">
                  Position
                </th>
                <th className="px-4 py-2 md:px-6 md:py-3 text-black font-bold text-sm md:text-base">
                  1
                </th>
                <th className="px-4 py-2 md:px-6 md:py-3 text-black font-bold text-sm md:text-base">
                  2
                </th>
                <th className="px-4 py-2 md:px-6 md:py-3 text-black font-bold text-sm md:text-base">
                  3
                </th>
              </tr>
            </thead>
            <tbody className="bg-black">
              <tr className="border-b border-gray-700">
                <td className="px-4 py-2 md:px-6 md:py-4 text-[#FFD700] font-bold text-sm md:text-base">
                  Gold
                </td>
                {holderData.gold.map(([name, count], index) => (
                  <td
                    key={index}
                    className="px-4 py-2 md:px-6 md:py-4 text-white text-sm md:text-base"
                  >
                    {name === "-" ? " - " : `${name} (${count})`}
                  </td>
                ))}
                {holderData.gold.length === 0 && (
                  <td
                    colSpan={3}
                    className="px-4 py-2 md:px-6 md:py-4 text-white text-sm md:text-base"
                  >
                    Loading...
                  </td>
                )}
              </tr>
              <tr className="border-b border-gray-700">
                <td className="px-4 py-2 md:px-6 md:py-4 text-[#C0C0C0] font-bold text-sm md:text-base">
                  Silver
                </td>
                {holderData.silver.map(([name, count], index) => (
                  <td
                    key={index}
                    className="px-4 py-2 md:px-6 md:py-4 text-white text-sm md:text-base"
                  >
                    {name === "-" ? " - " : `${name} (${count})`}
                  </td>
                ))}
                {holderData.silver.length === 0 && (
                  <td
                    colSpan={3}
                    className="px-4 py-2 md:px-6 md:py-4 text-white text-sm md:text-base"
                  >
                    Loading...
                  </td>
                )}
              </tr>
              <tr>
                <td className="px-4 py-2 md:px-6 md:py-4 text-[#CD7F32] font-bold text-sm md:text-base">
                  Bronze
                </td>
                {holderData.bronze.map(([name, count], index) => (
                  <td
                    key={index}
                    className="px-4 py-2 md:px-6 md:py-4 text-white text-sm md:text-base"
                  >
                    {name === "-" ? " - " : `${name} (${count})`}
                  </td>
                ))}
                {holderData.bronze.length === 0 && (
                  <td
                    colSpan={3}
                    className="px-4 py-2 md:px-6 md:py-4 text-white text-sm md:text-base"
                  >
                    Loading...
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
