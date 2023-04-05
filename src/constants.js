// NODE
export const MAINNET_ALGOEXPLORER_NODE = "https://node.algoexplorerapi.io";
export const MAINNET_ALGONODE_NODE = "https://mainnet-api.algonode.cloud";
export const TESTNET_ALGOEXPLORER_NODE =
  "https://node.testnet.algoexplorerapi.io";
export const TESTNET_ALGONODE_NODE = "https://testnet-api.algonode.cloud";

// INDEXER
export const MAINNET_ALGOEXPLORER_INDEXER =
  "https://algoindexer.algoexplorerapi.io";
export const MAINNET_ALGONODE_INDEXER = "https://mainnet-idx.algonode.cloud";
export const TESTNET_ALGOEXPLORER_INDEXER =
  "https://algoindexer.testnet.algoexplorerapi.io";
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

// TOOLS
export const TOOLS = [
  {
    id: "collection_data",
    label: "⬇️ Download Collection Data",
    description: "Download all the data for a collection in CSV format.",
    path: "/download-collection-data",
  },
  {
    id: "collection_snapshot",
    label: "🔎 Find Collection Holders",
    description: "Download all the holders for a collection in CSV format.",
    path: "/find-collection-holders",
  },
  {
    id: "batch_update",
    label: "⬆️ Collection Metadata Update",
    description: "Update the metadata for an ARC-69 collection in bulk.",
    path: "/batch-metadata-update",
  },
  {
    id: "batch_mint",
    label: "🖨️ Collection Mint",
    description: "Mint an ARC-69 collection in bulk.",
    path: "/batch-collection-mint",
  },

  {
    id: "batch_optin",
    label: "➕ Asset Add",
    description: "Optin assets in bulk.",
    path: "/batch-optin",
  },
  {
    id: "batch_optout",
    label: "➖ Asset Remove",
    description: "Optout assets in bulk.",
    path: "/batch-optout",
  },
  {
    id: "airdrop_tool",
    label: "🪂 Asset Send/Airdrop",
    description: "Airdrop assets/ALGO to a list of addresses.",
    path: "/airdrop",
  },
  {
    id: "wallet_holdings",
    label: "💼 Wallet Holdings",
    description: "View the assets data of a wallet in CSV format.",
    path: "/wallet-holdings",
  },
  {
    id: "multimint_asset_holders",
    label: "🌌 Multimint Asset Holders",
    description: "View the holders of a multimint asset list in CSV format.",
    path: "/multimint-asset-holders",
  },
  {
    id: "ipfs_upload",
    label: "📁 IPFS Collection Upload",
    description: "Upload a collection images to IPFS.",
    path: "/ipfs-upload",
  },
];
