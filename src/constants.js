// NODE
export const MAINNET_ALGONODE_NODE = "https://mainnet-api.algonode.cloud";
export const TESTNET_ALGONODE_NODE = "https://testnet-api.algonode.cloud";

// INDEXER
export const MAINNET_ALGONODE_INDEXER = "https://mainnet-idx.algonode.cloud";
export const TESTNET_ALGONODE_INDEXER = "https://testnet-idx.algonode.cloud";

// DONATION WALLETS
export const DONATE_WALLET_1 =
  "O2ZPSV6NJC32ZXQ7PZ5ID6PXRKAWQE2XWFZK5NK3UFULPZT6OKIOROEAPU";
export const DONATE_WALLET_2 =
  "VYPDFMVRXCI2Z4FPC2GHB4QC6PSCTEDAS4EU7GE3W4B3MRHXNZO6BB2RZA";

// MINT FEES
export const MINT_FEE_WALLET =
  "RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ";
export const MINT_FEE_PER_ASA = 0.1;
export const UPDATE_FEE_PER_ASA = 0.05;

export const IPFS_ENDPOINT = "https://ipfs.algonode.xyz/ipfs/";

export const CREATOR_WALLETS = [
  "GLOW7AKCAZXWQRPI6Q7OCVAO75H45AIYMTDEH3VNPETKYFXMNHAMQOVMS4",
  "STPD5WZ7DMF2RBBGROROWS6U2HNKC4SOHZXTFDTRIWHTXQ46TA7HU3A2SI",
  "2INYXKE3I465ED7HGFELKC2WDSA3R4V3A7BEZDJ7RWFNSFU2OQW44WZBAM",
  "TINYGXPTQUIKUFF6HOUK5SDTTK4EZ3HJOBUCCWNDZ6QJYSZMXQTUSQPQZY",
  "TINYGNROP4U5RO444XQHM4HKVMYDFAVHIRLYPCXM7DBOF6CS2OZM7OMOMI",
];

export const PREFIXES = ["HORSE", "PONY", "tiny", "2INY"];

// TOOLS
export const TOOLS = [
  {
    id: "simple_mint",
    label: "🖨️ Simple Mint",
    description: "Easily Inscribe an Asset on Algorand",
    path: "/simple-mint",
    category: "mint",
  },
  {
    id: "simple_update",
    label: "⬆️ Simple Update",
    description: "Easily update your Mutable Inscriptions",
    path: "/simple-update",
    category: "mint",
  },
  {
    id: "batch_mint",
    label: "🖨️ ARC-69 Collection Mint",
    description: "Inscribe an ARC-69 collection in bulk.",
    path: "/arc69-collection-mint",
    category: "mint",
  },
  {
    id: "batch_update",
    label: "⬆️ ARC-69 Collection Metadata Update",
    description: "Update the metadata for an ARC-69 collection in bulk.",
    path: "/arc69-metadata-update",
    category: "mint",
  },
  {
    id: "collection_data",
    label: "⬇️ Download ARC-69 Collection Data",
    description: "Download ARC-69 data for a collection in CSV format.",
    path: "/download-arc69-collection-data",
    category: "mint",
  },
  {
    id: "arc19_batch_mint",
    label: "🖨️ ARC-19 Collection Mint",
    description: "Inscribe an ARC-19 collection in bulk.",
    path: "/arc19-collection-mint",
    category: "mint",
  },
  {
    id: "arc19_batch_update",
    label: "⬆️ ARC-19 Collection Metadata Update",
    description: "Update the metadata for an ARC-19 collection in bulk.",
    path: "/arc19-metadata-update",
    category: "mint",
  },
  {
    id: "arc19_collection_data",
    label: "⬇️ Download ARC-19 Collection Data",
    description: "Download ARC-19 data for a collection in CSV format.",
    path: "/download-arc19-collection-data",
    category: "mint",
  },
  {
    id: "arc3_batch_mint",
    label: "🖨️ ARC-3 Collection Mint",
    description: "Inscribe an ARC-3 collection in bulk.",
    path: "/arc3-collection-mint",
    category: "mint",
  },
  {
    id: "batch_optin",
    label: "➕ Asset Add",
    description: "Optin assets in bulk.",
    path: "/batch-optin",
    category: "asset",
  },
  {
    id: "simple_send_tool",
    label: "📨 Simple Send",
    description:
      "Easily mass send assets to a single or an asset to multiple wallets.",
    path: "/simple-send",
    category: "asset",
  },
  {
    id: "batch_optout",
    label: "➖ Asset Remove",
    description: "Optout assets in bulk.",
    path: "/batch-optout",
    category: "asset",
  },
  {
    id: "batch_destroy",
    label: "❌ Asset Destroy",
    description: "Destroy (Delete) assets in bulk.",
    path: "/batch-destroy",
    category: "asset",
  },
  {
    id: "simple_airdrop_tool",
    label: "🪂 Simple Airdrop",
    description:
      "Premium Tool - Easily Airdrop a Token of any amount to holders from a creator wallet.",
    path: "/simple-airdrop",
    category: "asset",
  },
  {
    id: "airdrop_tool",
    label: "🪂 Asset Send/Airdrop",
    description: "Airdrop/Send assets/ALGO to a list of addresses.",
    path: "/airdrop",
    category: "asset",
  },  
  {
    id: "batch_clawback",
    label: "🔙 Asset Clawback",
    description: "Clawback assets in bulk.",
    path: "/batch-clawback",
    category: "asset",
  },
  {
    id: "batch_freeze",
    label: "🧊 Asset Freeze",
    description: "Freeze/Unfreeze assets in bulk.",
    path: "/batch-freeze",
    category: "asset",
  },
  {
    id: "wallet_holdings",
    label: "💼 Wallet Holdings",
    description: "View the assets data of a wallet in CSV format.",
    path: "/wallet-holdings",
    category: "asset",
  },
  {
    id: "collection_snapshot",
    label: "🔎 Find Collection Holders",
    description: "Download all the holders for a collection in CSV format.",
    path: "/find-collection-holders",
    category: "asset",
  },  
  {
    id: "multimint_asset_holders",
    label: "🌌 Multimint Asset Holders",
    description: "View the holders of a multimint asset list in CSV format.",
    path: "/multimint-asset-holders",
    category: "asset",
  },
//  {
//    id: "ipfs_upload",
//    label: "📁 IPFS Collection Upload",
//    description: "Upload a collection images to IPFS.",
//    path: "/ipfs-upload",
//    category: "asset",
//  },
];

