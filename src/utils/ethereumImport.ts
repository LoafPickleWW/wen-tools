/**
 * ethereumImport.ts
 *
 * Utilities for scanning Ethereum NFTs by Contract Address via the
 * **Alchemy NFT API v3** (free tier: 30 M compute-units / month).
 *
 * Users must supply their own Alchemy API key (free signup at alchemy.com).
 * The key is never stored server-side; it stays in the browser session.
 *
 * Ethereum NFT Standards
 * ──────────────────────
 * ┌───────────┬────────────┬──────────────────────────────────────────────────┐
 * │ Standard  │ Mutability │ Description                                      │
 * ├───────────┼────────────┼──────────────────────────────────────────────────┤
 * │ ERC-721   │ Depends*   │ Each token has a unique uint256 tokenId. The     │
 * │           │            │ tokenURI function returns a metadata URL.        │
 * │           │            │ *Mutability depends on the contract – the URI    │
 * │           │            │ MAY be mutable (spec allows it) or immutable     │
 * │           │            │ (e.g. IPFS-pinned). Most "PFP" collections use  │
 * │           │            │ immutable IPFS URIs, but dynamic/gaming NFTs     │
 * │           │            │ often use mutable HTTP endpoints.                │
 * ├───────────┼────────────┼──────────────────────────────────────────────────┤
 * │ ERC-1155  │ Depends*   │ Multi-token standard. Each tokenId can have a    │
 * │           │            │ supply ≥1 (fungible when >1, NFT when =1). Uses  │
 * │           │            │ a URI pattern with `{id}` substitution. Same     │
 * │           │            │ mutability caveat as ERC-721: depends on whether │
 * │           │            │ the contract points to IPFS or HTTP.             │
 * ├───────────┼────────────┼──────────────────────────────────────────────────┤
 * │ ERC-5192  │ Immutable  │ "Soulbound" extension of ERC-721. Tokens are    │
 * │ (SBT)     │ (locked)   │ non-transferable once minted. The `locked()`    │
 * │           │            │ function returns true. These cannot be imported  │
 * │           │            │ in a meaningful way (ownership can't transfer),  │
 * │           │            │ but metadata can still be read.                  │
 * └───────────┴────────────┴──────────────────────────────────────────────────┘
 *
 * Collection Identifier
 * ─────────────────────
 * Ethereum groups NFTs by **Contract Address** – the address of the deployed
 * ERC-721 or ERC-1155 smart contract. All tokens minted by that contract
 * belong to the same "collection". This is analogous to XRPL's Taxon ID,
 * Cardano's Policy ID, and Algorand's Unit Name prefix.
 *
 * Alchemy Endpoints Used
 * ──────────────────────
 * • GET /nft/v3/{key}/getNFTsForContract  → paginated list of NFTs + metadata
 * • GET /nft/v3/{key}/getNFTMetadata      → single-token metadata lookup
 *
 * The free tier includes 30 million compute units/month with 25 req/sec.
 * Signup: https://dashboard.alchemy.com/signup
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface EthNFTRaw {
  tokenId: string;
  tokenType: "ERC721" | "ERC1155" | string;
  name: string;
  description: string;
  image: {
    cachedUrl: string | null;
    thumbnailUrl: string | null;
    pngUrl: string | null;
    originalUrl: string | null;
  };
  raw: {
    metadata: Record<string, any> | null;
    tokenUri: string | null;
  };
  contract: {
    address: string;
    name: string | null;
    symbol: string | null;
    tokenType: string;
  };
  balance?: string;  // for ERC-1155
}

export interface ResolvedEthNFT {
  token_id: string;
  contract_address: string;
  name: string;
  description: string;
  image: string;
  imageResolved: boolean;
  metadataResolved: boolean;
  tokenType: string;
  tokenUri: string;
  contractName: string;
  contractSymbol: string;
  raw_metadata: Record<string, any>;
  error?: string;
}

export type EthNetwork = "mainnet" | "sepolia" | "goerli";

// ── Constants ──────────────────────────────────────────────────────────────

const ALCHEMY_NETWORK_MAP: Record<EthNetwork, string> = {
  mainnet: "eth-mainnet",
  sepolia: "eth-sepolia",
  goerli: "eth-goerli",
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Validate an Ethereum address – 0x followed by 40 hex chars. */
export function isValidEthAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

/** Resolve an IPFS URI to a public gateway. */
function resolveIpfsUri(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  }
  if (uri.startsWith("ar://")) {
    return `https://arweave.net/${uri.slice(5)}`;
  }
  return uri;
}

/** Pick the best available image URL from Alchemy's response. */
function pickBestImage(nft: EthNFTRaw): string {
  const img = nft.image;
  const meta = nft.raw?.metadata;

  // Prefer original IPFS or Arweave links if they exist
  if (img.originalUrl && (img.originalUrl.startsWith("ipfs://") || img.originalUrl.includes("ipfs") || img.originalUrl.startsWith("ar://"))) {
    return img.originalUrl;
  }
  if (meta?.image && (typeof meta.image === "string") && (meta.image.startsWith("ipfs://") || meta.image.includes("ipfs") || meta.image.startsWith("ar://"))) {
    return meta.image;
  }
  if (meta?.image_url && (typeof meta.image_url === "string") && (meta.image_url.startsWith("ipfs://") || meta.image_url.includes("ipfs") || meta.image_url.startsWith("ar://"))) {
    return meta.image_url;
  }

  // Fallbacks:
  if (img.cachedUrl) return img.cachedUrl;
  if (img.pngUrl) return img.pngUrl;
  if (img.thumbnailUrl) return img.thumbnailUrl;
  if (img.originalUrl) return resolveIpfsUri(img.originalUrl);
  if (meta?.image) return resolveIpfsUri(meta.image);
  if (meta?.image_url) return resolveIpfsUri(meta.image_url);
  if (meta?.animation_url) return resolveIpfsUri(meta.animation_url);

  return "";
}

// ── API Functions ──────────────────────────────────────────────────────────

/**
 * Fetch all NFTs for a given contract address from Alchemy.
 * Handles pagination via the startToken / pageKey pattern.
 *
 * @param contractAddress  0x-prefixed Ethereum contract address
 * @param alchemyApiKey    Free API key from dashboard.alchemy.com
 * @param network          Ethereum network (defaults to mainnet)
 * @param onProgress       Optional callback reporting how many NFTs found
 */
export async function fetchNFTsByContract(
  contractAddress: string,
  alchemyApiKey: string,
  network: EthNetwork = "mainnet",
  onProgress?: (count: number) => void
): Promise<EthNFTRaw[]> {
  const chain = ALCHEMY_NETWORK_MAP[network];
  const base = `https://${chain}.g.alchemy.com/nft/v3/${alchemyApiKey}`;
  const allNFTs: EthNFTRaw[] = [];
  let pageKey: string | undefined;

  while (true) {
    const params = new URLSearchParams({
      contractAddress: contractAddress.trim(),
      withMetadata: "true",
      limit: "100",
    });
    if (pageKey) params.set("startToken", pageKey);

    const res = await fetch(`${base}/getNFTsForContract?${params.toString()}`);

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 401 || res.status === 403) {
        throw new Error("Invalid Alchemy API key. Get a free key at dashboard.alchemy.com");
      }
      throw new Error(`Alchemy API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const nfts: EthNFTRaw[] = data.nfts || [];

    allNFTs.push(...nfts);
    onProgress?.(allNFTs.length);

    pageKey = data.pageKey;
    if (!pageKey || nfts.length === 0) break;
  }

  return allNFTs;
}

/**
 * Resolve metadata for a batch of Alchemy NFT results into a standardised shape.
 * Since Alchemy already returns full metadata, this is mainly a normalisation step.
 */
export async function resolveEthMetadata(
  nfts: EthNFTRaw[],
  onProgress?: (done: number, total: number) => void
): Promise<ResolvedEthNFT[]> {
  const results: ResolvedEthNFT[] = [];

  for (let i = 0; i < nfts.length; i++) {
    const nft = nfts[i];
    try {
      const image = pickBestImage(nft);
      const name = nft.name || nft.raw?.metadata?.name || `#${nft.tokenId}`;
      const description =
        nft.description || nft.raw?.metadata?.description || "";

      results.push({
        token_id: nft.tokenId,
        contract_address: nft.contract.address,
        name,
        description,
        image,
        imageResolved: !!image,
        metadataResolved: !!(name && name !== `#${nft.tokenId}`),
        tokenType: nft.tokenType || nft.contract.tokenType || "ERC721",
        tokenUri: nft.raw?.tokenUri || "",
        contractName: nft.contract.name || "",
        contractSymbol: nft.contract.symbol || "",
        raw_metadata: nft.raw?.metadata || {},
      });
    } catch (err: any) {
      results.push({
        token_id: nft.tokenId,
        contract_address: nft.contract.address,
        name: `#${nft.tokenId}`,
        description: "",
        image: "",
        imageResolved: false,
        metadataResolved: false,
        tokenType: nft.tokenType || "ERC721",
        tokenUri: "",
        contractName: "",
        contractSymbol: "",
        raw_metadata: {},
        error: err.message,
      });
    }

    onProgress?.(i + 1, nfts.length);
  }

  return results;
}
