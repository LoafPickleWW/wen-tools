// INDEXER
export const MAINNET_ALGONODE_INDEXER = "https://mainnet-idx.algonode.cloud";
export const TESTNET_ALGONODE_INDEXER = "https://testnet-idx.algonode.cloud";

// NF
export const MAINNET_NFD_API_BASE_URL = "https://api.nf.domains";
export const TESTNET_NFD_API_BASE_URL = "https://api.testnet.nf.domains";

// ASSET PREVIEW
export const ASSET_PREVIEW = "/wallet/asset/";

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
export const BEACON_PROTOCOL_ADDRESS = "BEACDGTII2LVPBDX47D64RVYFDIFROF5POBJS6ZYD6UZISP6RRHRLUSY64";

export const IPFS_ENDPOINT = "https://ipfs.algonode.dev/ipfs/";

export const CREATOR_WALLETS = [];

export const PREFIXES = [];

// XGOV
export const XGOV_REGISTRY_APP_IDS = [3147789458];

// TOOLS
export const TOOLS = [
  // ── CREATOR SUITE ──────────────────────────────────────────────────────────
  {
    id: "minting_suite",
    label: "Creator Suite",
    description: "Unified workspace organizing the creator journey from generation (WenPad) to minting, updating, and exporting.",
    path: "/minting-journey",
    category: "creator",
    icon: "/icons/mint.png"
  },
  {
    id: "download_collection_data",
    label: "Download Collection Data",
    description: "Export full collection parameters, metadata, and configuration to CSV.",
    path: "/download-collection-data",
    category: "creator",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  // Sub-routes under Creator Suite (hidden on landing page)
  {
    id: "simple_mint",
    label: "Simple Mint",
    description: "Mint a single asset (NFT or Token) on Algorand. Supports Simple/Custom modes with Pinata and Crust Network.",
    path: "/simple-mint",
    category: "creator",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "really_simple_mint",
    label: "Really Simple Mint",
    description: "Ultra-fast single-click minting for simple assets.",
    path: "/really-simple-mint",
    category: "creator",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "simple_mint_classic",
    label: "Simple Mint Classic",
    description: "Legacy single asset minting tool.",
    path: "/simple-mint-classic",
    category: "creator",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "simple_update",
    label: "Simple Update",
    description: "Update mutable assets (ARC-19/69/Token) on Algorand. Supports Pinata and Crust Network.",
    path: "/simple-update",
    category: "creator",
    icon: "/icons/mintupdate.png",
    hideFromLanding: true
  },
  {
    id: "simple_update_classic",
    label: "Simple Update Classic",
    description: "Legacy single asset updating tool.",
    path: "/simple-update-classic",
    category: "creator",
    icon: "/icons/mintupdate.png",
    hideFromLanding: true
  },
  {
    id: "batch_mint",
    label: "Batch Collection Mint",
    description: "Mint bulk collections in ARC-3, ARC-19, or ARC-69 formats using CSV file uploads or range generation.",
    path: "/batch-collection-mint",
    category: "creator",
    icon: "/icons/arc69m.png",
    hideFromLanding: true
  },
  {
    id: "arc69_collection_mint",
    label: "ARC69 Collection Mint",
    description: "Legacy batch minting for ARC-69 collections.",
    path: "/arc69-collection-mint",
    category: "creator",
    icon: "/icons/arc69m.png",
    hideFromLanding: true
  },
  {
    id: "arc3_collection_mint",
    label: "ARC3 Collection Mint",
    description: "Legacy batch minting for ARC-3 collections.",
    path: "/arc3-collection-mint",
    category: "creator",
    icon: "/icons/arc69m.png",
    hideFromLanding: true
  },
  {
    id: "arc19_collection_mint",
    label: "ARC19 Collection Mint",
    description: "Legacy batch minting for ARC-19 collections.",
    path: "/arc19-collection-mint",
    category: "creator",
    icon: "/icons/arc69m.png",
    hideFromLanding: true
  },
  {
    id: "simple_batch_mint",
    label: "Simple Batch Mint",
    description: "Legacy batch minting for simple assets.",
    path: "/simple-batch-mint",
    category: "creator",
    icon: "/icons/arc69m.png",
    hideFromLanding: true
  },
  {
    id: "batch_update",
    label: "Bulk Update",
    description: "Update metadata notes (ARC-69) or reserve address CIDs (ARC-19) for multiple assets in bulk.",
    path: "/bulk-metadata-update",
    category: "creator",
    icon: "/icons/arc69u.png",
    hideFromLanding: true
  },
  {
    id: "arc69_metadata_update",
    label: "ARC69 Metadata Update",
    description: "Legacy bulk updater for ARC-69 metadata.",
    path: "/arc69-metadata-update",
    category: "creator",
    icon: "/icons/arc69u.png",
    hideFromLanding: true
  },
  {
    id: "arc19_metadata_update",
    label: "ARC19 Metadata Update",
    description: "Legacy bulk updater for ARC-19 metadata.",
    path: "/arc19-metadata-update",
    category: "creator",
    icon: "/icons/arc69u.png",
    hideFromLanding: true
  },
  {
    id: "wen_pad",
    label: "Wen Pad",
    description: "Generate and mint NFT collections for free with automated IPFS pinning.",
    path: "/wen-pad",
    category: "creator",
    icon: "/icons/wenpad.png",
    hideFromLanding: true
  },
  {
    id: "nft_import",
    label: "NFT Import Tool",
    description: "Import your NFTs from other chains (XRP Ledger, etc.) and re-mint them on Algorand.",
    path: "/nft-import",
    category: "creator",
    icon: "/icons/mint.png",
    hideFromLanding: true
  },

  // ── ASSET SUITE (MANAGEMENT & DISTRIBUTION) ────────────────────────────────
  {
    id: "bulk_asset_manager",
    label: "Bulk Asset Manager",
    description: "Consolidated opt-in, opt-out, and destroy manager for Algorand assets.",
    path: "/bulk-asset-manager",
    category: "assets",
    icon: "/icons/manager.png"
  },
  {
    id: "batch_freeze",
    label: "Batch Freeze",
    description: "Freeze or unfreeze assets in bulk across multiple accounts.",
    path: "/bulk-asset-manager?tab=freeze",
    category: "assets",
    icon: "/icons/bulk.png",
    hideFromLanding: true
  },
  {
    id: "batch_clawback",
    label: "Batch Clawback",
    description: "Claw back assets in bulk from target accounts if parameter is set.",
    path: "/bulk-asset-manager?tab=clawback",
    category: "assets",
    icon: "/icons/bulk.png",
    hideFromLanding: true
  },
  {
    id: "token_manager",
    label: "Token Manager",
    description: "Set and manage your token's circulation supply using the ARC62 Standard.",
    path: "/token-manager",
    category: "assets",
    icon: "/icons/manager.png"
  },
  {
    id: "bluk_claim",
    label: "Bulk Claim",
    description: "Claim multiple assets from your asset Inbox & NFD vault in one go.",
    path: "/bulk-claim",
    category: "assets",
    icon: "/icons/bulk.png"
  },
  {
    id: "distribution_suite",
    label: "Distribution Suite",
    description: "Consolidated tool to send and airdrop assets manually, via CSV, to creator wallets, specific asset holders, or NFD vaults.",
    path: "/distribution-suite",
    category: "assets",
    icon: "/icons/devtools.png"
  },
  {
    id: "simple_send",
    label: "Simple Send",
    description: "Send assets to a single address with custom parameters.",
    path: "/distribution-suite?tab=custom&mode=manual",
    category: "assets",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "vault_send",
    label: "Vault Send",
    description: "Send assets securely into NFD vaults or escrow accounts.",
    path: "/distribution-suite?tab=vault",
    category: "assets",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "simple_airdrop",
    label: "Simple Airdrop",
    description: "Frictionless batch sending of Algos or tokens to list of receivers.",
    path: "/distribution-suite?tab=creator-wallet",
    category: "assets",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "airdrop",
    label: "Bulk Airdrop",
    description: "Sophisticated coordinated bulk distribution/airdrop of assets to list of addresses.",
    path: "/distribution-suite?tab=custom&mode=csv",
    category: "assets",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "wen_swap",
    label: "Wen Swap",
    description: "Atomic, peer-to-peer on-chain asset swapping protocol for Algos and custom ASAs.",
    path: "/wen-swap",
    category: "assets",
    icon: "/icons/devtools.png"
  },
  // Sub-routes under Asset Suite (hidden on landing page)
  {
    id: "batch_optin",
    label: "Batch Optin",
    description: "Opt-in to multiple assets in bulk.",
    path: "/batch-optin",
    category: "assets",
    icon: "/icons/bulk.png",
    hideFromLanding: true
  },
  {
    id: "batch_optout",
    label: "Batch Optout",
    description: "Opt-out of multiple assets to recover minimum balance.",
    path: "/batch-optout",
    category: "assets",
    icon: "/icons/bulk.png",
    hideFromLanding: true
  },
  {
    id: "batch_destroy",
    label: "Batch Destroy",
    description: "Destroy multiple assets created by your account.",
    path: "/batch-destroy",
    category: "assets",
    icon: "/icons/bulk.png",
    hideFromLanding: true
  },

  // ── WALLETS & ANALYTICS ────────────────────────────────────────────────────
  {
    id: "wen_wallet",
    label: "Wen Wallet",
    description: "Visual portfolio asset browser with integrated bulk operations including send, opt-in, opt-out, and destroy.",
    path: "/wallet",
    category: "analytics",
    icon: "/icons/wallet.png"
  },
  {
    id: "post_quantum",
    label: "Post-Quantum Wallet",
    description: "Create & manage Falcon-1024 post-quantum secured Algorand accounts.",
    path: "/post-quantum",
    category: "analytics",
    icon: "/icons/pqwallet.png"
  },
  {
    id: "holdings_auditor",
    label: "Holdings Auditor",
    description: "Consolidated auditor to review wallet asset inventories and track distribution balances across multiple assets.",
    path: "/holdings-auditor",
    category: "analytics",
    icon: "/icons/devtools.png"
  },
  {
    id: "wallet_holdings",
    label: "Wallet Holdings",
    description: "Audit and view the asset holdings and balances of any Algorand address.",
    path: "/holdings-auditor?tab=wallet",
    category: "analytics",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "find_collection_holders",
    label: "Find Collection Holders",
    description: "Query and snapshot all current holders of a given NFT collection or asset.",
    path: "/find-collection-holders",
    category: "creator",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "multimint_asset_holders",
    label: "Multimint Asset Holders",
    description: "Find and filter holders across multiple separate mints/collections.",
    path: "/holdings-auditor?tab=asset",
    category: "analytics",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "vanity_address",
    label: "Vanity Address",
    description: "Generate custom Algorand wallet addresses with specific prefixes for your projects and protocols.",
    path: "/vanity",
    category: "analytics",
    icon: "/icons/devtools.png"
  },
  {
    id: "cluster_map",
    label: "Cluster Map",
    description: "Visual explorer to investigate connected Algorand wallets, identify bot networks, and trace transaction flows in real-time.",
    path: "/cluster-map",
    category: "analytics",
    icon: "/icons/devtools.png"
  },
  // Sub-routes under Wallets & Analytics (hidden on landing page)
  {
    id: "download_arc69_collection_data",
    label: "Download ARC69 Collection Data",
    description: "Export CSV of ARC-69 collection metadata.",
    path: "/download-arc69-collection-data",
    category: "analytics",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },
  {
    id: "download_arc19_collection_data",
    label: "Download ARC19 Collection Data",
    description: "Export CSV of ARC-19 collection metadata.",
    path: "/download-arc19-collection-data",
    category: "analytics",
    icon: "/icons/devtools.png",
    hideFromLanding: true
  },

  // ── APPS & SOCIAL ──────────────────────────────────────────────────────────
  {
    id: "agent_marketplace",
    label: "Agent Marketplace",
    description: "Discover and register AI agents on-chain. The decentralized registry for Algorand's agent economy.",
    path: "/agents",
    category: "apps",
    icon: "/icons/devtools.png"
  },
  {
    id: "beacon_chat",
    label: "BEACON Chat",
    description: "Zero-infrastructure, on-chain encrypted chat with serverless P2P signaling via Algorand.",
    path: "/beacon-chat",
    category: "apps",
    icon: "/icons/p2pchat.svg"
  },
  {
    id: "beacon_drop",
    label: "BEACON Drop",
    description: "Serverless, on-chain dead drop powered by the BEACON Protocol.",
    path: "/beacon-drop",
    category: "apps",
    icon: "/icons/drop.png"
  },
  {
    id: "p2p_chat",
    label: "P2P Chat",
    description: "End-to-end encrypted peer-to-peer chat & file transfer via LiquidAuth.",
    path: "/p2p-chat",
    category: "apps",
    icon: "/icons/p2pchat.svg"
  },
  {
    id: "jukebox",
    label: "Jukebox",
    description: "Scan your wallet for music NFTs and play them directly.",
    path: "/jukebox",
    category: "apps",
    icon: "/icons/jukebox.png"
  },
  {
    id: "xgov_dashboard",
    label: "xGov Dashboard",
    description: "Premium dashboard for tracking active xGov proposals, history, and bulk voting.",
    path: "/xgov",
    category: "apps",
    icon: "/icons/xgov.png"
  },

  // ── PROTOCOLS ──────────────────────────────────────────────────────────────
  {
    id: "wen_deploy",
    label: "Wen Deploy",
    description: "Zero-infrastructure, in-browser build & deploy pipeline for GitHub repositories to IPFS & Algorand ARC-19.",
    path: "/deploy",
    category: "protocols",
    icon: "/icons/devtools.png"
  },
  {
    id: "anchor_setup",
    label: "Anchor Setup",
    description: "Generate the integration assets, GitHub Actions, and agent prompts needed to enroll your repository in the ANCHOR protocol.",
    path: "/anchor-setup",
    category: "protocols",
    icon: "/icons/devtools.png"
  }
];
