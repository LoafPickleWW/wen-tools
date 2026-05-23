import axios from "axios";

// ─── XRPL Public Endpoints ──────────────────────────────────────────────────
// Using Vercel/Vite proxy to Clio-enabled public nodes for nfts_by_issuer support
export const XRPL_MAINNET_ENDPOINT = "/api/xrpl-mainnet";
export const XRPL_TESTNET_ENDPOINT = "/api/xrpl-testnet";

// IPFS gateways (fallback chain)
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface XRPLNFToken {
  nft_id: string;
  issuer: string;
  owner: string;
  uri: string; // hex-encoded URI from XRPL
  nft_taxon: number;
  nft_serial: number;
  flags: number;
  transfer_fee: number;
  is_burned: boolean;
}

export interface ResolvedNFTMetadata {
  nft_id: string;
  issuer: string;
  owner: string;
  nft_serial: number;
  nft_taxon: number;
  // Decoded URI
  decodedUri: string;
  // Resolved metadata from IPFS/HTTP
  name: string;
  description: string;
  image: string; // resolved IPFS/HTTP URL to the image
  imageIpfsCid: string; // raw IPFS CID of the image (if IPFS)
  external_url: string;
  attributes: { trait_type: string; value: string }[];
  // Raw metadata JSON
  rawMetadata: any;
  // Status
  metadataResolved: boolean;
  imageResolved: boolean;
  error?: string;
}

export type AlgorandARC = "ARC3" | "ARC19" | "ARC69";

export interface AlgorandMintData {
  asset_name: string;
  unit_name: string;
  total_supply: number;
  decimals: number;
  asset_url: string;
  asset_note?: any;
  ipfs_data?: any;
  has_clawback: string;
  has_freeze: string;
  default_frozen: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decode a hex-encoded XRPL URI to a UTF-8 string
 */
export function decodeHexUri(hexUri: string): string {
  if (!hexUri) return "";
  try {
    const bytes = new Uint8Array(
      hexUri.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return hexUri;
  }
}

/**
 * Extract IPFS CID from various URI formats
 */
export function extractIpfsCid(uri: string): string | null {
  if (!uri) return null;

  // ipfs://CID or ipfs://CID/filename
  const ipfsMatch = uri.match(/^ipfs:\/\/(.+)/);
  if (ipfsMatch) return ipfsMatch[1];

  // https://ipfs.io/ipfs/CID or similar gateway URLs
  const gatewayMatch = uri.match(/\/ipfs\/(.+)/);
  if (gatewayMatch) return gatewayMatch[1];

  return null;
}

/**
 * Resolve an IPFS CID to a gateway URL, trying multiple gateways
 */
export function ipfsCidToUrl(cidOrPath: string): string {
  // Already an HTTP URL
  if (cidOrPath.startsWith("http")) return cidOrPath;

  // Strip ipfs:// prefix
  const cleaned = cidOrPath.replace(/^ipfs:\/\//, "");

  return `${IPFS_GATEWAYS[0]}${cleaned}`;
}

/**
 * Resolve a URI (IPFS, HTTP, or data:) to a fetchable URL
 */
export function resolveUri(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("data:")) return uri;
  if (uri.startsWith("http")) return uri;
  if (uri.startsWith("ipfs://")) return ipfsCidToUrl(uri);
  // Bare CID
  if (uri.match(/^(Qm|bafy)/i)) return ipfsCidToUrl(uri);
  return uri;
}

/**
 * Fetch JSON from a URI with IPFS gateway fallback
 */
async function fetchJsonWithFallback(uri: string): Promise<any> {
  const cidOrPath = extractIpfsCid(uri);

  if (cidOrPath) {
    // Try each gateway
    for (const gateway of IPFS_GATEWAYS) {
      try {
        const resp = await axios.get(`${gateway}${cidOrPath}`, {
          timeout: 15000,
        });
        return resp.data;
      } catch {
        continue;
      }
    }
    throw new Error(`Failed to fetch from all IPFS gateways: ${cidOrPath}`);
  }

  // Regular HTTP
  const resp = await axios.get(resolveUri(uri), { timeout: 15000 });
  return resp.data;
}

// ─── XRPL API Calls ─────────────────────────────────────────────────────────

/**
 * Fetch all NFTs issued by a given XRPL account using nfts_by_issuer (Clio)
 */
export async function fetchNFTsByIssuer(
  issuerAddress: string,
  onProgress?: (loaded: number) => void,
  endpoint: string = XRPL_MAINNET_ENDPOINT
): Promise<XRPLNFToken[]> {
  const allNfts: XRPLNFToken[] = [];
  let marker: any = undefined;
  let page = 0;

  do {
    const payload: any = {
      method: "nfts_by_issuer",
      params: [
        {
          issuer: issuerAddress,
          limit: 100,
          ...(marker ? { marker } : {}),
        },
      ],
    };

    const resp = await axios.post(endpoint, payload, {
      timeout: 30000,
    });

    if (resp.data.result?.status !== "success") {
      // Fallback: try account_nfts on standard endpoint
      if (page === 0) {
        return fetchNFTsByOwner(issuerAddress, onProgress, endpoint);
      }
      throw new Error(
        resp.data.result?.error_message || "Failed to fetch NFTs from XRPL"
      );
    }

    const nfts = resp.data.result.nfts || [];
    for (const nft of nfts) {
      allNfts.push({
        nft_id: nft.nft_id,
        issuer: nft.issuer,
        owner: nft.owner,
        uri: nft.uri || "",
        nft_taxon: nft.nft_taxon,
        nft_serial: nft.nft_serial,
        flags: nft.flags,
        transfer_fee: nft.transfer_fee,
        is_burned: nft.is_burned,
      });
    }

    marker = resp.data.result.marker;
    page++;
    onProgress?.(allNfts.length);
  } while (marker);

  return allNfts.filter((n) => !n.is_burned);
}

/**
 * Fallback: fetch NFTs owned by (not necessarily issued by) an account
 * using account_nfts on a standard rippled node
 */
export async function fetchNFTsByOwner(
  ownerAddress: string,
  onProgress?: (loaded: number) => void,
  endpoint: string = XRPL_MAINNET_ENDPOINT
): Promise<XRPLNFToken[]> {
  const allNfts: XRPLNFToken[] = [];
  let marker: any = undefined;

  do {
    const payload: any = {
      method: "account_nfts",
      params: [
        {
          account: ownerAddress,
          limit: 100,
          ...(marker ? { marker } : {}),
        },
      ],
    };

    const resp = await axios.post(endpoint, payload, {
      timeout: 30000,
    });

    if (resp.data.result?.status !== "success" && !resp.data.result?.account_nfts) {
      throw new Error(
        resp.data.result?.error_message || "Failed to fetch NFTs from XRPL"
      );
    }

    const nfts = resp.data.result.account_nfts || [];
    for (const nft of nfts) {
      allNfts.push({
        nft_id: nft.NFTokenID,
        issuer: nft.Issuer,
        owner: ownerAddress,
        uri: nft.URI || "",
        nft_taxon: nft.NFTokenTaxon,
        nft_serial: nft.nft_serial,
        flags: nft.Flags,
        transfer_fee: nft.TransferFee || 0,
        is_burned: false,
      });
    }

    marker = resp.data.result.marker;
    onProgress?.(allNfts.length);
  } while (marker);

  return allNfts;
}

// ─── Metadata Resolution ────────────────────────────────────────────────────

/**
 * Resolve metadata for a single XRPL NFT
 */
export async function resolveNFTMetadata(
  nft: XRPLNFToken
): Promise<ResolvedNFTMetadata> {
  const decodedUri = decodeHexUri(nft.uri);

  const result: ResolvedNFTMetadata = {
    nft_id: nft.nft_id,
    issuer: nft.issuer,
    owner: nft.owner,
    nft_serial: nft.nft_serial,
    nft_taxon: nft.nft_taxon,
    decodedUri,
    name: `XRPL NFT #${nft.nft_serial}`,
    description: "",
    image: "",
    imageIpfsCid: "",
    external_url: "",
    attributes: [],
    rawMetadata: null,
    metadataResolved: false,
    imageResolved: false,
  };

  if (!decodedUri) {
    result.error = "No URI on this NFT";
    return result;
  }

  try {
    // Check if the URI points directly to an image
    const isDirectImage = /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm)(\?.*)?$/i.test(
      decodedUri
    );

    if (isDirectImage) {
      result.image = resolveUri(decodedUri);
      result.imageIpfsCid = extractIpfsCid(decodedUri) || "";
      result.imageResolved = true;
      result.name = `XRPL NFT #${nft.nft_serial}`;
      return result;
    }

    // Try to fetch as JSON metadata
    const metadata = await fetchJsonWithFallback(decodedUri);
    result.rawMetadata = metadata;
    result.metadataResolved = true;

    // Extract fields (handle both ERC-721 and XLS-24 formats)
    result.name =
      metadata.name || metadata.title || `XRPL NFT #${nft.nft_serial}`;
    result.description = metadata.description || "";
    result.external_url = metadata.external_url || metadata.external_link || "";

    // Image field (various formats)
    const imageField =
      metadata.image || metadata.image_url || metadata.media || metadata.animation_url;
    if (imageField) {
      result.image = resolveUri(imageField);
      result.imageIpfsCid = extractIpfsCid(imageField) || "";
      result.imageResolved = true;
    }

    // Attributes/traits (ERC-721 format or XRPL-specific)
    if (Array.isArray(metadata.attributes)) {
      result.attributes = metadata.attributes.map((attr: any) => ({
        trait_type: attr.trait_type || attr.name || attr.key || "Unknown",
        value: String(attr.value || ""),
      }));
    } else if (metadata.properties && typeof metadata.properties === "object") {
      // Some XRP NFTs use { properties: { trait: value } }
      result.attributes = Object.entries(metadata.properties)
        .filter(([key]) => key !== "files" && key !== "category")
        .map(([key, val]) => ({
          trait_type: key,
          value: String(val),
        }));
    }
  } catch (err: any) {
    result.error = `Metadata fetch failed: ${err.message || "Unknown error"}`;
  }

  return result;
}

/**
 * Resolve metadata for multiple NFTs with concurrency control
 */
export async function resolveAllMetadata(
  nfts: XRPLNFToken[],
  concurrency: number = 5,
  onProgress?: (resolved: number, total: number) => void
): Promise<ResolvedNFTMetadata[]> {
  const results: ResolvedNFTMetadata[] = [];
  let resolved = 0;

  // Process in batches
  for (let i = 0; i < nfts.length; i += concurrency) {
    const batch = nfts.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((nft) => resolveNFTMetadata(nft))
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        // Create error entry
        const nft = batch[results.length - resolved];
        results.push({
          nft_id: nft?.nft_id || "unknown",
          issuer: nft?.issuer || "",
          owner: nft?.owner || "",
          nft_serial: nft?.nft_serial || 0,
          nft_taxon: nft?.nft_taxon || 0,
          decodedUri: "",
          name: "Error",
          description: "",
          image: "",
          imageIpfsCid: "",
          external_url: "",
          attributes: [],
          rawMetadata: null,
          metadataResolved: false,
          imageResolved: false,
          error: r.reason?.message || "Unknown error",
        });
      }
      resolved++;
      onProgress?.(resolved, nfts.length);
    }
  }

  return results;
}

// ─── Algorand Formatting ────────────────────────────────────────────────────

/**
 * Format a resolved XRPL NFT into Algorand ARC-69 mint data
 */
export function formatAsARC69(
  nft: ResolvedNFTMetadata,
  collectionName: string = ""
): AlgorandMintData {
  const arc69Note: any = {
    standard: "arc69",
    description: nft.description,
    external_url: nft.external_url,
    mime_type: guessMimeType(nft.image),
    properties: {} as Record<string, string>,
  };

  // Convert attributes to properties
  for (const attr of nft.attributes) {
    arc69Note.properties[attr.trait_type] = attr.value;
  }

  return {
    asset_name: sanitizeAssetName(nft.name),
    unit_name: sanitizeUnitName(collectionName || nft.name),
    total_supply: 1,
    decimals: 0,
    asset_url: nft.image, // ARC-69 puts media URL in asset_url
    asset_note: arc69Note,
    has_clawback: "N",
    has_freeze: "N",
    default_frozen: "N",
  };
}

/**
 * Format a resolved XRPL NFT into Algorand ARC-3 mint data
 * (metadata JSON is pinned to IPFS, asset_url points to metadata)
 */
export function formatAsARC3(
  nft: ResolvedNFTMetadata,
  collectionName: string = ""
): { mintData: AlgorandMintData; metadataJson: any } {
  const metadata: any = {
    name: nft.name,
    description: nft.description,
    image: nft.image.startsWith("ipfs://")
      ? nft.image
      : nft.imageIpfsCid
        ? `ipfs://${nft.imageIpfsCid}`
        : nft.image,
    image_mimetype: guessMimeType(nft.image),
    external_url: nft.external_url,
    properties: {} as Record<string, string>,
  };

  for (const attr of nft.attributes) {
    metadata.properties[attr.trait_type] = attr.value;
  }

  return {
    mintData: {
      asset_name: sanitizeAssetName(nft.name),
      unit_name: sanitizeUnitName(collectionName || nft.name),
      total_supply: 1,
      decimals: 0,
      asset_url: "", // will be filled after IPFS pinning
      has_clawback: "N",
      has_freeze: "N",
      default_frozen: "N",
    },
    metadataJson: metadata,
  };
}

/**
 * Format a resolved XRPL NFT into Algorand ARC-19 mint data
 * (uses reserve address to encode IPFS CID)
 */
export function formatAsARC19(
  nft: ResolvedNFTMetadata,
  collectionName: string = ""
): { mintData: AlgorandMintData; metadataJson: any } {
  const metadata: any = {
    name: nft.name,
    description: nft.description,
    image: nft.image.startsWith("ipfs://")
      ? nft.image
      : nft.imageIpfsCid
        ? `ipfs://${nft.imageIpfsCid}`
        : nft.image,
    image_mimetype: guessMimeType(nft.image),
    external_url: nft.external_url,
    properties: {} as Record<string, string>,
  };

  for (const attr of nft.attributes) {
    metadata.properties[attr.trait_type] = attr.value;
  }

  return {
    mintData: {
      asset_name: sanitizeAssetName(nft.name),
      unit_name: sanitizeUnitName(collectionName || nft.name),
      total_supply: 1,
      decimals: 0,
      asset_url: "", // template-ipfs:// URL generated during mint
      ipfs_data: metadata,
      has_clawback: "N",
      has_freeze: "N",
      default_frozen: "N",
    },
    metadataJson: metadata,
  };
}

// ─── String Helpers ─────────────────────────────────────────────────────────

function sanitizeAssetName(name: string): string {
  // Algorand asset name max 32 bytes
  return name.substring(0, 32);
}

function sanitizeUnitName(name: string): string {
  // Algorand unit name max 8 bytes, uppercase, no spaces
  return name
    .replace(/[^a-zA-Z0-9]/g, "")
    .substring(0, 8)
    .toUpperCase();
}

function guessMimeType(url: string): string {
  if (!url) return "image/png";
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".svg")) return "image/svg+xml";
  if (lower.includes(".mp4")) return "video/mp4";
  if (lower.includes(".webm")) return "video/webm";
  return "image/png";
}

/**
 * Validate an XRP address (basic format check)
 */
export function isValidXRPAddress(address: string): boolean {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
}
