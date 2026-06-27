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
 * • GET /nft/v3/{key}/getNFTsForOwner     → NFTs owned by a wallet (filtered by contract)
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
  opensea_url?: string;
  error?: string;
}

export type EthNetwork = "mainnet" | "sepolia" | "goerli";

// ── Constants ──────────────────────────────────────────────────────────────

const ALCHEMY_NETWORK_MAP: Record<EthNetwork, string> = {
  mainnet: "eth-mainnet",
  sepolia: "eth-sepolia",
  goerli: "eth-goerli",
};

/**
 * Well-known shared / universal contracts where millions of creators mint
 * under a single contract address. Querying all NFTs from these contracts
 * is impractical — users must supply their own wallet address to filter.
 */
export const KNOWN_SHARED_CONTRACTS: Record<string, string> = {
  "0x495f947276749ce646f68ac8c248420045cb7b5e": "OpenSea Shared Storefront (ERC-1155)",
  "0x2953399124f0cbb46d2cbacd8a89cf0599974963": "OpenSea Shared Storefront (Polygon)",
  "0xf4910c763ed4e47a585e2d34baa9a4b611ae1e62": "OpenSea Shared Storefront V2",
};

/** Check if a contract address is a known shared / universal contract. */
export function isSharedContract(address: string): string | null {
  return KNOWN_SHARED_CONTRACTS[address.trim().toLowerCase()] || null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Validate an Ethereum address – 0x followed by 40 hex chars. */
export function isValidEthAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/i.test(addr.trim());
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

function rewriteDeadSeadnUrl(url: string, contractAddress: string): string {
  if (!url) return "";
  if (url.includes("i.seadn.io/gcs/files/")) {
    const match = url.match(/\/gcs\/files\/([a-f0-9]{32})\.([a-z0-9]+)/i);
    if (match) {
      const hash = match[1];
      const ext = match[2];
      return `https://raw2.seadn.io/ethereum/${contractAddress.toLowerCase()}/${hash.substring(2)}/${hash}.${ext}`;
    }
  }
  return url;
}

/** Pick the best available image URL from Alchemy's response. */
function pickBestImage(nft: EthNFTRaw): string {
  const img = nft.image;
  const meta = nft.raw?.metadata;
  const contract = nft.contract.address;

  const getBest = () => {
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
  };

  return rewriteDeadSeadnUrl(getBest(), contract);
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
 * Fetch ALL NFTs owned by a wallet (no contract filter).
 * Used to scan the wallet broadly and then filter client-side.
 *
 * @param ownerAddress   0x-prefixed wallet address
 * @param alchemyApiKey  Free API key from dashboard.alchemy.com
 * @param network        Ethereum network (defaults to mainnet)
 * @param onProgress     Optional callback reporting how many NFTs found
 */
export async function fetchAllNFTsForOwner(
  ownerAddress: string,
  alchemyApiKey: string,
  network: EthNetwork = "mainnet",
  onProgress?: (count: number) => void
): Promise<EthNFTRaw[]> {
  const chain = ALCHEMY_NETWORK_MAP[network];
  const base = `https://${chain}.g.alchemy.com/nft/v3/${alchemyApiKey}`;
  const allNFTs: EthNFTRaw[] = [];
  let pageKey: string | undefined;

  while (true) {
    let url = `${base}/getNFTsForOwner?owner=${encodeURIComponent(ownerAddress.trim())}&withMetadata=true&pageSize=100`;
    if (pageKey) url += `&pageKey=${encodeURIComponent(pageKey)}`;

    console.log("[ETH Import] getNFTsForOwner URL:", url.replace(alchemyApiKey, "***"));

    const res = await fetch(url);

    if (!res.ok) {
      const errText = await res.text();
      console.error("[ETH Import] API error:", res.status, errText);
      if (res.status === 401 || res.status === 403) {
        throw new Error("Invalid Alchemy API key. Get a free key at dashboard.alchemy.com");
      }
      throw new Error(`Alchemy API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    console.log("[ETH Import] Response — ownedNfts count:", data.ownedNfts?.length ?? 0, "totalCount:", data.totalCount ?? "N/A");

    const rawNfts = data.ownedNfts || [];
    const nfts: EthNFTRaw[] = rawNfts.map((n: any) => ({
      tokenId: n.tokenId,
      tokenType: n.tokenType || n.contract?.tokenType || "ERC721",
      name: n.name || n.raw?.metadata?.name || "",
      description: n.description || n.raw?.metadata?.description || "",
      image: n.image || { cachedUrl: null, thumbnailUrl: null, pngUrl: null, originalUrl: null },
      raw: n.raw || { metadata: null, tokenUri: null },
      contract: n.contract || { address: "", name: null, symbol: null, tokenType: "ERC721" },
      balance: n.balance,
    }));

    allNFTs.push(...nfts);
    onProgress?.(allNFTs.length);

    pageKey = data.pageKey;
    if (!pageKey || rawNfts.length === 0) break;
  }

  console.log("[ETH Import] Total NFTs fetched for owner:", allNFTs.length);
  return allNFTs;
}

/**
 * Fetch NFTs owned by a specific wallet, filtered to a single contract.
 *
 * Scans the wallet for ALL NFTs first (using getNFTsForOwner without
 * contract filters to avoid API encoding quirks), then filters client-side
 * by the target contract address. If 0 results match, logs which contracts
 * the wallet actually holds NFTs on for debugging.
 *
 * @param ownerAddress     0x-prefixed wallet address of the creator/owner
 * @param contractAddress  0x-prefixed contract to filter by
 * @param alchemyApiKey    Free API key from dashboard.alchemy.com
 * @param network          Ethereum network (defaults to mainnet)
 * @param onProgress       Optional callback reporting how many NFTs found
 */
export async function fetchNFTsByOwnerForContract(
  ownerAddress: string,
  contractAddress: string,
  alchemyApiKey: string,
  network: EthNetwork = "mainnet",
  onProgress?: (count: number) => void
): Promise<EthNFTRaw[]> {
  // Scan the wallet broadly — no server-side contract filter
  const allNFTs = await fetchAllNFTsForOwner(ownerAddress, alchemyApiKey, network, onProgress);

  // Filter client-side by the target contract
  const targetAddr = contractAddress.trim().toLowerCase();
  const matched = allNFTs.filter(
    (n) => n.contract.address.toLowerCase() === targetAddr
  );

  console.log(`[ETH Import] Filtered ${allNFTs.length} total NFTs → ${matched.length} on contract ${targetAddr.slice(0, 10)}…`);

  // If 0 matched, log which contracts the wallet actually holds NFTs on
  if (matched.length === 0 && allNFTs.length > 0) {
    const contractMap = new Map<string, number>();
    allNFTs.forEach((n) => {
      const addr = n.contract.address.toLowerCase();
      contractMap.set(addr, (contractMap.get(addr) || 0) + 1);
    });
    console.log("[ETH Import] Wallet holds NFTs on these contracts:");
    contractMap.forEach((count, addr) => {
      const contractName = allNFTs.find((n) => n.contract.address.toLowerCase() === addr)?.contract.name || "Unknown";
      console.log(`  → ${addr} (${contractName}): ${count} NFTs`);
    });
  }

  return matched;
}

/**
 * Fetch NFTs **created by** a specific wallet on the OpenSea Shared Storefront.
 *
 * On the OpenSea Shared Storefront (ERC-1155), the creator's address is
 * encoded in the **upper 160 bits** of each token ID:
 *
 *   tokenId = (creatorAddress << 96) | tokenIndex
 *
 * This means we can calculate the exact token ID range for any creator
 * and scan only that range via `getNFTsForContract` with `startToken`.
 * This finds NFTs the creator minted even if they've been sold/transferred.
 *
 * @param creatorAddress   0x-prefixed wallet address of the NFT creator
 * @param contractAddress  0x-prefixed shared contract (e.g. OpenSea Shared Storefront)
 * @param alchemyApiKey    Free API key from dashboard.alchemy.com
 * @param network          Ethereum network (defaults to mainnet)
 * @param onProgress       Optional callback reporting how many NFTs found
 */
export async function fetchNFTsByCreatorOnSharedContract(
  creatorAddress: string,
  contractAddress: string,
  alchemyApiKey: string,
  network: EthNetwork = "mainnet",
  onProgress?: (count: number) => void
): Promise<EthNFTRaw[]> {
  // Calculate the token ID range for this creator.
  // Upper 160 bits = creator address, lower 96 bits = token index.
  const creatorBigInt = BigInt(creatorAddress.trim().toLowerCase());
  const rangeStart = creatorBigInt << 96n;
  const rangeEnd = rangeStart + (1n << 96n) - 1n;

  console.log(`[ETH Import] Creator token ID range:`);
  console.log(`  Start: ${rangeStart}`);
  console.log(`  End:   ${rangeEnd}`);
  console.log(`  Creator: ${creatorAddress.trim()}`);

  const chain = ALCHEMY_NETWORK_MAP[network];
  const base = `https://${chain}.g.alchemy.com/nft/v3/${alchemyApiKey}`;
  const allNFTs: EthNFTRaw[] = [];
  let pageKey: string | undefined;
  let isFirstRequest = true;

  while (true) {
    const params = new URLSearchParams({
      contractAddress: contractAddress.trim(),
      withMetadata: "true",
      limit: "100",
    });

    if (isFirstRequest) {
      // Start scanning from the beginning of this creator's token range
      params.set("startToken", rangeStart.toString());
      isFirstRequest = false;
    } else if (pageKey) {
      params.set("startToken", pageKey);
    } else {
      break;
    }

    console.log(`[ETH Import] Scanning shared contract from startToken (page ${Math.floor(allNFTs.length / 100) + 1})...`);

    const res = await fetch(`${base}/getNFTsForContract?${params.toString()}`);

    if (!res.ok) {
      const errText = await res.text();
      console.error("[ETH Import] API error:", res.status, errText);
      if (res.status === 401 || res.status === 403) {
        throw new Error("Invalid Alchemy API key. Get a free key at dashboard.alchemy.com");
      }
      throw new Error(`Alchemy API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const nfts: EthNFTRaw[] = data.nfts || [];

    console.log(`[ETH Import] Page returned ${nfts.length} NFTs`);

    if (nfts.length === 0) break;

    // Filter to only tokens within the creator's range
    const inRange = nfts.filter((n) => {
      try {
        const tid = BigInt(n.tokenId);
        return tid >= rangeStart && tid <= rangeEnd;
      } catch {
        return false;
      }
    });

    allNFTs.push(...inRange);
    onProgress?.(allNFTs.length);

    // If some tokens were outside our range, we've passed the creator's section
    if (inRange.length < nfts.length) {
      console.log(`[ETH Import] Reached end of creator's token range (${nfts.length - inRange.length} out-of-range tokens found)`);
      break;
    }

    pageKey = data.pageKey;
    if (!pageKey) break;
  }

  console.log(`[ETH Import] Total NFTs by creator on shared contract: ${allNFTs.length}`);
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

export interface OpenSeaNFTRaw {
  identifier: string;
  collection: string;
  contract: string;
  token_standard: string;
  name: string;
  description: string;
  image_url?: string;
  display_image_url?: string;
  original_image_url?: string;
  metadata_url?: string;
  opensea_url?: string;
  traits?: Array<{
    trait_type: string;
    display_type?: string;
    max_value?: string;
    value: any;
  }>;
}

export interface OpenSeaAPIResponse {
  nfts: OpenSeaNFTRaw[];
  next?: string;
}

/**
 * Fetch all NFTs in a collection from OpenSea using the collection slug via our secure proxy.
 *
 * @param slug        The OpenSea collection slug (e.g. "d3ath5t4r-you-are-a-flower")
 * @param onProgress  Optional callback reporting how many NFTs found so far
 */
export async function fetchNFTsFromOpenSea(
  slug: string,
  onProgress?: (count: number) => void
): Promise<ResolvedEthNFT[]> {
  const allNFTs: ResolvedEthNFT[] = [];
  let nextCursor: string | undefined;

  while (true) {
    const params = new URLSearchParams({ slug: slug.trim() });
    if (nextCursor) {
      params.append("next", nextCursor);
    }

    const res = await fetch(`/api/opensea?${params.toString()}`);

    if (!res.ok) {
      const errText = await res.text();
      console.error("[OpenSea Import] Proxy error:", res.status, errText);
      throw new Error(`OpenSea API proxy error (${res.status}): ${errText}`);
    }

    const data: OpenSeaAPIResponse = await res.json();
    const rawNfts = data.nfts || [];

    if (rawNfts.length === 0) break;

    const mapped = rawNfts.map((n) => {
      const name = n.name || `#${n.identifier}`;
      const image = n.original_image_url || n.image_url || n.display_image_url || "";
      return {
        token_id: n.identifier,
        contract_address: n.contract,
        name,
        description: n.description || "",
        image,
        imageResolved: !!image,
        metadataResolved: !!n.name,
        tokenType: n.token_standard?.toUpperCase() || "ERC1155",
        tokenUri: n.metadata_url || "",
        contractName: "OpenSea Shared Storefront",
        contractSymbol: "OPENSTORE",
        opensea_url: n.opensea_url,
        raw_metadata: {
          name: n.name,
          description: n.description,
          image,
          attributes: n.traits?.map(t => ({ trait_type: t.trait_type, value: t.value })) || []
        }
      };
    });

    allNFTs.push(...mapped);
    onProgress?.(allNFTs.length);

    nextCursor = data.next;
    if (!nextCursor) break;
  }

  return allNFTs;
}
