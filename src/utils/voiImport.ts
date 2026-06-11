/**
 * voiImport.ts — Voi Network ARC-72 NFT scanning via Mimir API
 *
 * Voi is an AVM-based blockchain (Algorand fork) that uses:
 *   - ARC-72: Smart contract NFT standard (like ERC-721)
 *   - ARC-200: Smart contract fungible token standard (like ERC-20)
 *
 * Collection identifier: **Contract ID** (Application ID of the ARC-72 smart contract)
 *
 * API: Mimir API — https://voi-mainnet-mimirapi.nftnavigator.xyz
 *   - Free, no API key required, no documented rate limit
 *   - Follows ARC-74 (NFT Indexer API) spec
 *   - GET /nft-indexer/v1/tokens?contractId=<appId>
 *   - GET /nft-indexer/v1/collections
 *
 * Metadata: ARC-72 stores a tokenURI on-chain that resolves to JSON metadata
 *   (usually on IPFS). The Mimir API returns the metadata pre-resolved.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RawVoiNFT {
  contractId: number;
  tokenId: number;
  owner: string;
  approved: string;
  tokenIndex: number;
  metadata: string;  // JSON string from ARC-72 tokenURI
  mintRound: number;
  metadataURI?: string;
  // Parsed from metadata JSON
  _parsed?: {
    name?: string;
    description?: string;
    image?: string;
    image_integrity?: string;
    image_mimetype?: string;
    properties?: Record<string, any>;
    [key: string]: any;
  };
}

export interface ResolvedVoiNFT {
  contractId: number;
  tokenId: number;
  tokenIndex: number;
  owner: string;
  mintRound: number;
  name: string;
  description: string;
  image: string;
  imageResolved: boolean;
  metadataResolved: boolean;
  metadataURI: string;
  properties: Record<string, any>;
  raw_metadata: Record<string, any>;
}

// Mimir API response shape for /nft-indexer/v1/tokens
interface MimirTokensResponse {
  tokens: RawVoiNFT[];
  ["current-round"]?: number;
  ["next-token"]?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MIMIR_BASE_URL = "https://voi-mainnet-mimirapi.nftnavigator.xyz";

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate an ARC-72 Contract ID (Application ID on Voi).
 * Must be a positive integer.
 */
export function isValidContractId(input: string): boolean {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const num = parseInt(trimmed, 10);
  return num > 0 && num <= Number.MAX_SAFE_INTEGER;
}

// ─── IPFS helpers ────────────────────────────────────────────────────────────

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

// ─── Fetch Voi collections by creator ────────────────────────────────────────

/**
 * Fetches all collection contract IDs for a given creator address on Voi.
 */
export async function fetchCollectionsByCreator(
  creatorAddress: string
): Promise<number[]> {
  const url = `${MIMIR_BASE_URL}/nft-indexer/v1/collections?creator=${creatorAddress.trim()}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch Voi collections: ${text}`);
  }
  const data = await response.json();
  const collections = data.collections || [];
  return collections.map((c: any) => c.contractId);
}

// ─── Fetch all ARC-72 tokens by contract ID ──────────────────────────────────

/**
 * Fetches all ARC-72 NFTs for a given contract (application) ID from Mimir API.
 * Handles pagination via the `next` token.
 */
export async function fetchNFTsByContractId(
  contractId: string,
  onProgress?: (count: number) => void
): Promise<RawVoiNFT[]> {
  const allTokens: RawVoiNFT[] = [];
  let nextToken: string | undefined;
  const limit = 200; // Mimir default page size

  do {
    const params = new URLSearchParams({
      contractId: contractId.trim(),
      limit: String(limit),
    });
    if (nextToken) params.set("next-token", nextToken);

    const url = `${MIMIR_BASE_URL}/nft-indexer/v1/tokens?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Mimir API error (${response.status}): ${text}`);
    }

    const data: MimirTokensResponse = await response.json();
    const tokens = data.tokens || [];

    // Parse the metadata JSON string for each token
    for (const token of tokens) {
      try {
        if (token.metadata && typeof token.metadata === "string") {
          token._parsed = JSON.parse(token.metadata);
        }
      } catch {
        // metadata might not be valid JSON
        token._parsed = undefined;
      }
    }

    allTokens.push(...tokens);
    onProgress?.(allTokens.length);

    nextToken = data["next-token"];
  } while (nextToken);

  return allTokens;
}

// ─── Resolve metadata into a normalized shape ────────────────────────────────

/**
 * Converts raw Mimir API tokens into resolved NFT objects.
 * Metadata is already embedded in the API response (pre-resolved by indexer),
 * so no additional HTTP calls are needed — just parsing and image URL resolution.
 */
export function resolveVoiMetadata(
  nfts: RawVoiNFT[],
  onProgress?: (done: number, total: number) => void
): ResolvedVoiNFT[] {
  const results: ResolvedVoiNFT[] = [];

  for (let i = 0; i < nfts.length; i++) {
    const nft = nfts[i];
    const meta = nft._parsed || {};

    const name = meta.name || `Voi ARC-72 #${nft.tokenId}`;
    const description = meta.description || "";

    // Resolve image — check image, image_url, animation_url fields
    const rawImage = meta.image || meta.image_url || meta.animation_url || "";
    const imageResolved = !!rawImage;
    const image = resolveIpfsUri(rawImage);

    // Properties / attributes
    let properties: Record<string, any> = {};
    if (meta.properties && typeof meta.properties === "object") {
      properties = meta.properties;
    } else if (meta.attributes && Array.isArray(meta.attributes)) {
      // OpenSea-style attributes array → key/value
      for (const attr of meta.attributes) {
        if (attr.trait_type) {
          properties[attr.trait_type] = attr.value;
        }
      }
    }

    results.push({
      contractId: nft.contractId,
      tokenId: nft.tokenId,
      tokenIndex: nft.tokenIndex,
      owner: nft.owner,
      mintRound: nft.mintRound,
      name,
      description,
      image,
      imageResolved,
      metadataResolved: !!nft._parsed,
      metadataURI: nft.metadataURI || "",
      properties,
      raw_metadata: meta,
    });

    onProgress?.(i + 1, nfts.length);
  }

  return results;
}
