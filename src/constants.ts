// INDEXER
export const MAINNET_ALGONODE_INDEXER = "https://mainnet-idx.algonode.cloud";
export const TESTNET_ALGONODE_INDEXER = "https://testnet-idx.algonode.cloud";

// NF
export const MAINNET_NFD_API_BASE_URL = "https://api.nf.domains";
export const TESTNET_NFD_API_BASE_URL = "https://api.testnet.nf.domains";

// ASSET PREVIEW
export const ASSET_PREVIEW = "https://wallet.wen.tools/asset/";

// DONATION WALLETS
export const DONATE_WALLET_1 =
  "O2ZPSV6NJC32ZXQ7PZ5ID6PXRKAWQE2XWFZK5NK3UFULPZT6OKIOROEAPU";
export const DONATE_WALLET_2 =
  "VYPDFMVRXCI2Z4FPC2GHB4QC6PSCTEDAS4EU7GE3W4B3MRHXNZO6BB2RZA";

// MINT FEES
export const MINT_FEE_WALLET =
  "RBZ4GUE7FFDZWCN532FFR5AIYJ6K4V2GKJS5B42JPSWOAVWUT4OHWG57YQ";
export const MINT_FEE_PER_ASA = 0;
export const UPDATE_FEE_PER_ASA = 0;

export const ALGORAND_ZERO_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

export const IPFS_ENDPOINT = "https://ipfs.algonode.dev/ipfs/";

export const CREATOR_WALLETS = [];

export const PREFIXES = [];

// TOOLS
export const TOOLS = [
  {
    id: "simple_batch_mint",
    // label: "🌿 Simple Batch Mint",
    label: "Simple Batch Mint",
    description: "Easily Mint a collection in bulk using Crust Network.",
    path: "/simple-batch-mint",
    category: "mint",
    icon:"/icons/mint.png"
    
  },
  {
    id: "simple_mint",
    // label: "🌿 Simple Mint",
    label: "Simple Mint",
    description: "Easily mint a token or NFT using Crust Network",
    path: "/simple-mint",
    category: "mint",
    icon:"/icons/devtools.png"
  },
  {
    id: "simple_update",
    // label: "⬆️ Simple Update",
    label: "Simple Update",
    description: "Easily update your Mutable Asset using Crust Network",
    path: "/simple-update",
    category: "mint",
    icon:"/icons/mintupdate.png"
  },
  {
    id: "batch_mint",
    // label: "🌿 ARC-69 Collection Mint",
    label: "ARC-69 Collection Mint",
    description: "Mint an ARC-69 collection in bulk.",
    path: "/arc69-collection-mint",
    category: "mint",
    icon:"/icons/arc69m.png"
  },
  {
    id: "batch_update",
    // label: "⬆️ ARC-69 Collection Metadata Update",
    label: "ARC-69 Collection Metadata Update",
    description: "Update the metadata for an ARC-69 collection in bulk.",
    path: "/arc69-metadata-update",
    category: "mint",
    icon:"/icons/arc69u.png"
  },
  {
    id: "collection_data",
    // label: "⬇️ Download ARC-69 Collection Data",
    label: "Download ARC-69 Collection Data",
    description: "Download ARC-69 data for a collection in CSV format.",
    path: "/download-arc69-collection-data",
    category: "mint",
    icon:"/icons/arc69d.png"
  },
  {
    id: "arc19_batch_mint",
    // label: "🌿 ARC-19 Collection Mint",
    label: "ARC-19 Collection Mint",
    description: "Mint an ARC-19 collection in bulk.",
    path: "/arc19-collection-mint",
    category: "mint",
    icon:"/icons/arc19m.png"
  },
  {
    id: "arc19_batch_update",
    // label: "⬆️ ARC-19 Collection Metadata Update",
    label: "ARC-19 Collection Metadata Update",
    description: "Update the metadata for an ARC-19 collection in bulk.",
    path: "/arc19-metadata-update",
    category: "mint",
    icon:"/icons/arc19u.png"
  },
  {
    id: "arc19_collection_data",
    // label: "⬇️ Download ARC-19 Collection Data",
    label: "Download ARC-19 Collection Data",
    description: "Download ARC-19 data for a collection in CSV format.",
    path: "/download-arc19-collection-data",
    category: "mint",
    icon:"/icons/arc19d.png"
  },
  {
    id: "arc3_batch_mint",
    // label: "🌿 ARC-3 Collection Mint",
    label: "ARC-3 Collection Mint",
    description: "Mint an ARC-3 collection in bulk.",
    path: "/arc3-collection-mint",
    category: "mint",
    icon:"/icons/arc3m.png"
  },
  {
    id: "batch_optin",
    // label: "➕ Asset Add",
    label: "Asset Add",
    description: "Optin assets in bulk.",
    path: "/batch-optin",
    category: "asset",
    icon:"/icons/optin.png"
  },
  {
    id: "simple_send_tool",
    // label: "📨 Simple Send",
    label: "Simple Send",
    description:
      "Easily mass send assets to a single or an asset to multiple wallets.",
    path: "/simple-send",
    category: "asset",
    icon:"/icons/send.png"
  },
  {
    id: "vault_send_tool",
    // label: "💼 Vault Send",
    label: "Vault Send",
    description:
      "Easily mass send assets to a single or an asset to multiple NFD vaults.",
    path: "/vault-send",
    category: "asset",
    icon:"/icons/vault.png"
  },
  {
    id: "batch_optout",
    // label: "➖ Asset Remove",
    label: "Asset Remove",
    description: "Optout assets in bulk.",
    path: "/batch-optout",
    category: "asset",
    icon:"/icons/optout.png"
  },
  {
    id: "batch_destroy",
    // label: "❌ Asset Destroy",
    label: "Asset Destroy",
    description: "Destroy (Delete) assets in bulk.",
    path: "/batch-destroy",
    category: "asset",
    icon:"/icons/bin.png"
  },
  {
    id: "simple_airdrop_tool",
    // label: "🪂 Simple Airdrop",
    label: "Simple Airdrop",
    description:
      "Premium Tool - Easily Airdrop a Token of any amount to holders from a creator wallet.",
    path: "/simple-airdrop",
    category: "asset",
    icon:"/icons/drop.png"
  },
  {
    id: "airdrop_tool",
    // label: "🪂 Asset Send/Airdrop",
    label: "Airdrop",
    description: "Airdrop/Send assets/ALGO to a list of addresses.",
    path: "/airdrop",
    category: "asset",
    icon:"/icons/drops.png"
  },
  {
    id: "batch_clawback",
    // label: "🔙 Asset Clawback",
    label: "Asset Clawback",
    description: "Clawback assets in bulk.",
    path: "/batch-clawback",
    category: "asset",
    icon:"/icons/clawback.png"
  },
  {
    id: "batch_freeze",
    // label: "🧊 Asset Freeze",
    label: "Asset Freeze",
    description: "Freeze/Unfreeze assets in bulk.",
    path: "/batch-freeze",
    category: "asset",
    icon:"/icons/freeze.png"
  },
  {
    id: "wallet_holdings",
    // label: "💼 Wallet Holdings",
    label: "Wallet Holdings",
    description: "View the assets data of a wallet in CSV format.",
    path: "/wallet-holdings",
    category: "asset",
    icon:"/icons/wallet.png"
  },
  {
    id: "collection_snapshot",
    // label: "🔎 Find Collection Holders",
    label: "Find Collection Holders",
    description: "Download all the holders for a collection in CSV format.",
    path: "/find-collection-holders",
    category: "asset",
    icon:"/icons/group.png"
  },
  {
    id: "multimint_asset_holders",
    // label: "🌌 Multimint Asset Holders",
    label: "Multimint Asset Holders",
    description: "View the holders of a multimint asset list in CSV format.",
    path: "/multimint-asset-holders",
    category: "asset",
    icon:"/icons/multihold.png"
  },
  {
    id: "simple_mint_classic",
    // label: "🌿 Simple Mint Classic",
    label: "Simple Mint Classic",
    description: "Easily Mint an Asset on Algorand using Pinata",
    path: "/simple-mint-classic",
    category: "mint",
    icon:"/icons/smint.png"
  },
  {
    id: "simple_update_classic",
    // label: "⬆️ Simple Update Classic",
    label: "Simple Update Classic",
    description: "Easily update your Mutable Assets using Pinata",
    path: "/simple-update-classic",
    category: "mint",
    icon:"/icons/mintupdate.png"
  },
  {
    id: "bluk_claim",
    label: "Bulk Claim",
    description:
      "Claim multiple assets from your asset Inbox & NFD vault in one go",
    path: "/bulk-claim",
    category: "asset",
    icon:"/icons/bulk.png"
  },
  {
    id: "token_manager",
    label: "Token Manager",
    description:
      "Set and manage your token's circulation supply using the ARC62 Standard",
    path: "/token-manager",
    category: "asset",
    icon:"/icons/manager.png"
  },
  {
    id: "usalgo_2025_tracker",
    label: "USAlgo 2025 Tracker",
    description:
      "Track your collections from USAlgo 2025",
    path: "/usalgo-2025-tracker",
    category: "asset",
    icon:"/icons/track.png"
  },
];
