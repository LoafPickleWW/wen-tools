/**
 * cardanoImport.ts
 *
 * Utilities for scanning Cardano NFTs by Policy ID via the **Koios** REST API.
 * Koios is free (5 000 req/day, no API-key required on the public tier).
 *
 * Cardano NFT Standards
 * ─────────────────────
 * ┌──────────┬────────────┬──────────────────────────────────────────────────┐
 * │ Standard │ Mutability │ Description                                      │
 * ├──────────┼────────────┼──────────────────────────────────────────────────┤
 * │ CIP-25   │ Immutable* │ Metadata stored in the minting transaction       │
 * │          │            │ under label "721". Once the policy is locked,    │
 * │          │            │ metadata can never change. (*Technically mutable │
 * │          │            │ while the policy script is still open, but once  │
 * │          │            │ the time-lock passes it becomes permanently      │
 * │          │            │ immutable.)                                      │
 * ├──────────┼────────────┼──────────────────────────────────────────────────┤
 * │ CIP-68   │ Mutable    │ Metadata stored in a UTXO datum attached to a   │
 * │          │            │ "reference NFT" (label 100). The user receives a │
 * │          │            │ separate "user token" (label 222). Because the   │
 * │          │            │ reference NFT lives in a script UTXO, the issuer │
 * │          │            │ can spend & recreate it with updated metadata.   │
 * │          │            │ Can also be made immutable by locking the ref    │
 * │          │            │ NFT at an unspendable script address.            │
 * └──────────┴────────────┴──────────────────────────────────────────────────┘
 *
 * Collection Identifier
 * ─────────────────────
 * Cardano groups NFTs by **Policy ID** – a blake2b-224 hash of the minting
 * policy script. All tokens minted under the same policy belong to the same
 * "collection". This is analogous to XRPL's Taxon ID and Algorand's Unit
 * Name prefix.
 *
 * Koios Endpoints Used
 * ────────────────────
 * • POST /policy_asset_info   → list all assets + on-chain metadata for a policy
 * • GET  /asset_info           → detailed per-asset info (CIP-25 / CIP-68 metadata)
 *
 * The free tier allows 5 000 requests/day with no API key. For higher
 * throughput, users can register at https://koios.rest for 50 000 req/day.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface CardanoNFTRaw {
  asset_name: string;        // hex-encoded asset name
  asset_name_ascii: string;  // human-readable asset name
  policy_id: string;
  fingerprint: string;       // CIP-14 fingerprint (asset1…)
  quantity: string;
  minting_tx_hash: string;
  mint_metadata: Record<string, any> | null;   // CIP-25 metadata from tx label 721
  token_registry_metadata: Record<string, any> | null;
  cip68_metadata: Record<string, any> | null;  // CIP-68 datum metadata (if applicable)
}

export interface ResolvedCardanoNFT {
  asset_id: string;          // policy_id + hex asset_name (unique key)
  policy_id: string;
  asset_name_hex: string;
  name: string;
  description: string;
  image: string;             // resolved gateway URL
  imageResolved: boolean;
  metadataResolved: boolean;
  metadataStandard: "CIP-25" | "CIP-68" | "Unknown";
  fingerprint: string;
  quantity: string;
  raw_metadata: Record<string, any>;
  error?: string;
}

export type CardanoNetwork = "mainnet" | "preprod" | "preview";

// ── Constants ──────────────────────────────────────────────────────────────

const KOIOS_ENDPOINTS: Record<CardanoNetwork, string> = {
  mainnet: "/api/koios-mainnet",
  preprod: "/api/koios-preprod",
  preview: "/api/koios-preview",
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Validate a Cardano Policy ID – 56 hex chars (28 bytes blake2b-224). */
export function isValidPolicyId(id: string): boolean {
  return /^[0-9a-fA-F]{56}$/.test(id.trim());
}

/** Convert IPFS URI → public gateway URL. */
function resolveIpfsUri(uri: string): string {
  if (!uri) return "";
  if (typeof uri !== "string") return "";

  // Handle array case (some CIP-25 metadata stores image as string[])
  const str = Array.isArray(uri) ? uri.join("") : uri;

  if (str.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${str.slice(7)}`;
  }
  if (str.startsWith("Qm") || str.startsWith("bafy")) {
    return `https://ipfs.io/ipfs/${str}`;
  }
  if (str.startsWith("http")) {
    return str;
  }
  return str;
}

/** Extract human-readable name from various metadata locations. */
function extractName(raw: CardanoNFTRaw): string {
  // CIP-68 metadata
  if (raw.cip68_metadata && typeof raw.cip68_metadata === "object") {
    const meta = raw.cip68_metadata;
    if (meta.name) return String(meta.name);
    if (meta.fields && meta.fields.name) return String(meta.fields.name);
  }

  // CIP-25 metadata (nested under policy_id → asset_name)
  if (raw.mint_metadata && typeof raw.mint_metadata === "object") {
    const policyBlock = raw.mint_metadata[raw.policy_id];
    if (policyBlock) {
      const assetBlock = policyBlock[raw.asset_name_ascii] || policyBlock[raw.asset_name];
      if (assetBlock && assetBlock.name) return String(assetBlock.name);
    }
    // Flat structure fallback
    if (raw.mint_metadata.name) return String(raw.mint_metadata.name);
  }

  // Token registry
  if (raw.token_registry_metadata?.name) {
    return String(raw.token_registry_metadata.name);
  }

  return raw.asset_name_ascii || raw.asset_name;
}

/** Extract image from metadata. */
function extractImage(raw: CardanoNFTRaw): string {
  // CIP-68
  if (raw.cip68_metadata) {
    const meta = raw.cip68_metadata;
    if (meta.image) return resolveIpfsUri(meta.image);
    if (meta.fields?.image) return resolveIpfsUri(meta.fields.image);
  }

  // CIP-25
  if (raw.mint_metadata) {
    const policyBlock = raw.mint_metadata[raw.policy_id];
    if (policyBlock) {
      const assetBlock = policyBlock[raw.asset_name_ascii] || policyBlock[raw.asset_name];
      if (assetBlock?.image) return resolveIpfsUri(assetBlock.image);
    }
    if (raw.mint_metadata.image) return resolveIpfsUri(raw.mint_metadata.image);
  }

  // Token registry
  if (raw.token_registry_metadata?.logo) {
    return `data:image/png;base64,${raw.token_registry_metadata.logo}`;
  }

  return "";
}

/** Extract description. */
function extractDescription(raw: CardanoNFTRaw): string {
  if (raw.cip68_metadata?.description) return String(raw.cip68_metadata.description);
  if (raw.cip68_metadata?.fields?.description) return String(raw.cip68_metadata.fields.description);

  if (raw.mint_metadata) {
    const policyBlock = raw.mint_metadata[raw.policy_id];
    if (policyBlock) {
      const assetBlock = policyBlock[raw.asset_name_ascii] || policyBlock[raw.asset_name];
      if (assetBlock?.description) {
        const d = assetBlock.description;
        return Array.isArray(d) ? d.join("") : String(d);
      }
    }
    if (raw.mint_metadata.description) return String(raw.mint_metadata.description);
  }

  if (raw.token_registry_metadata?.description) {
    return String(raw.token_registry_metadata.description);
  }

  return "";
}

/** Determine whether the asset uses CIP-25 or CIP-68. */
function detectStandard(raw: CardanoNFTRaw): "CIP-25" | "CIP-68" | "Unknown" {
  if (raw.cip68_metadata && Object.keys(raw.cip68_metadata).length > 0) return "CIP-68";
  if (raw.mint_metadata && Object.keys(raw.mint_metadata).length > 0) return "CIP-25";
  return "Unknown";
}

// ── API Functions ──────────────────────────────────────────────────────────

/**
 * Fetch all assets under a given Policy ID from Koios.
 * Uses POST /policy_asset_info which returns asset details + on-chain metadata.
 * Handles pagination automatically (1000 assets per page).
 */
export async function fetchNFTsByPolicy(
  policyId: string,
  network: CardanoNetwork = "mainnet",
  onProgress?: (count: number) => void
): Promise<CardanoNFTRaw[]> {
  const base = KOIOS_ENDPOINTS[network];
  const allAssets: CardanoNFTRaw[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const res = await fetch(`${base}/policy_asset_info?limit=${limit}&offset=${offset}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _asset_policy: policyId,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Koios API error (${res.status}): ${errText}`);
    }

    const data: any[] = await res.json();
    if (!data || data.length === 0) break;

    for (const asset of data) {
      // Skip fungible tokens – NFTs have quantity "1"
      // (we still keep >1 in case the user wants to see all)
      allAssets.push({
        asset_name: asset.asset_name || "",
        asset_name_ascii: asset.asset_name_ascii || "",
        policy_id: asset.policy_id || policyId,
        fingerprint: asset.fingerprint || "",
        quantity: asset.total_supply || asset.quantity || "1",
        minting_tx_hash: asset.minting_tx_hash || "",
        mint_metadata: asset.minting_tx_metadata?.[721] || asset.minting_tx_metadata || null,
        token_registry_metadata: asset.token_registry_metadata || null,
        cip68_metadata: asset.cip68_metadata || null,
      });
    }

    onProgress?.(allAssets.length);

    // If we got fewer than the limit, we've reached the end
    if (data.length < limit) break;
    offset += limit;
  }

  return allAssets;
}

/**
 * Resolve metadata for a batch of raw Cardano NFTs into a standardised shape.
 */
export async function resolveCardanoMetadata(
  nfts: CardanoNFTRaw[],
  _concurrency: number = 10,
  onProgress?: (done: number, total: number) => void
): Promise<ResolvedCardanoNFT[]> {
  const results: ResolvedCardanoNFT[] = [];

  for (let i = 0; i < nfts.length; i++) {
    const raw = nfts[i];
    try {
      const name = extractName(raw);
      const image = extractImage(raw);
      const description = extractDescription(raw);
      const standard = detectStandard(raw);

      results.push({
        asset_id: raw.policy_id + raw.asset_name,
        policy_id: raw.policy_id,
        asset_name_hex: raw.asset_name,
        name,
        description,
        image,
        imageResolved: !!image,
        metadataResolved: !!(name && name !== raw.asset_name),
        metadataStandard: standard,
        fingerprint: raw.fingerprint,
        quantity: raw.quantity,
        raw_metadata: {
          ...(raw.mint_metadata || {}),
          ...(raw.cip68_metadata || {}),
        },
      });
    } catch (err: any) {
      results.push({
        asset_id: raw.policy_id + raw.asset_name,
        policy_id: raw.policy_id,
        asset_name_hex: raw.asset_name,
        name: raw.asset_name_ascii || raw.asset_name,
        description: "",
        image: "",
        imageResolved: false,
        metadataResolved: false,
        metadataStandard: "Unknown",
        fingerprint: raw.fingerprint,
        quantity: raw.quantity,
        raw_metadata: {},
        error: err.message,
      });
    }

    onProgress?.(i + 1, nfts.length);
  }

  return results;
}
