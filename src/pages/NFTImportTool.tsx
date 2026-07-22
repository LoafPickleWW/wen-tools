import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import { Meta } from "../components/Meta";
import ConnectButton from "../components/ConnectButton";
import {
  isValidXRPAddress,
  fetchNFTsByIssuer,
  resolveAllMetadata,
  formatAsARC3,
  formatAsARC19,
  formatAsARC69,
  extractIpfsCid,
  XRPL_MAINNET_ENDPOINT,
  XRPL_TESTNET_ENDPOINT,
  type ResolvedNFTMetadata,
  type AlgorandARC,
} from "../utils/xrplImport";
import {
  isValidPolicyId,
  fetchNFTsByPolicy,
  resolveCardanoMetadata,
  type ResolvedCardanoNFT,
  type CardanoNetwork,
} from "../utils/cardanoImport";
import {
  isValidEthAddress,
  fetchNFTsByContract,
  fetchNFTsByOwnerForContract,
  fetchAllNFTsForOwner,
  fetchNFTsByCreatorOnSharedContract,
  isSharedContract,
  resolveEthMetadata,
  fetchNFTsFromOpenSea,
  type ResolvedEthNFT,
  type EthNetwork,
} from "../utils/ethereumImport";
import {
  isValidContractId,
  fetchNFTsByContractId,
  resolveVoiMetadata,
  type ResolvedVoiNFT,
  fetchCollectionsByCreator,
} from "../utils/voiImport";
import {
  sliceIntoChunks,
  walletSign,
  createReserveAddressFromIpfsCid,
} from "../utils";
import { TOOLS, MINT_FEE_WALLET } from "../constants";
import FaqSectionComponent from "../components/FaqSectionComponent";

type ImportStep = "input" | "scanning" | "resolving" | "preview" | "minting" | "done";
type SourceChain = "xrpl" | "cardano" | "ethereum" | "voi";

/** Unified shape so the preview grid + minting pipeline can be chain-agnostic. */
interface UnifiedNFT {
  id: string;
  name: string;
  description: string;
  image: string;
  imageResolved: boolean;
  metadataResolved: boolean;
  // Source-chain specifics shown in the grid
  serialOrId: string;       // Token serial (XRPL), asset_name_hex (ADA), tokenId (ETH)
  sortKey: number;          // Numeric mint-order key (serial / tokenId) used for sorting
  collectionTag: string;    // Taxon (XRPL), Policy ID prefix (ADA), Contract symbol (ETH)
  metadataStandard?: string; // CIP-25/CIP-68 (ADA), ERC-721/ERC-1155 (ETH)
  metadataIpfsCid?: string;
  decodedUri?: string;
  // Keep the raw source data for minting formatting
  _xrpl?: ResolvedNFTMetadata;
  _cardano?: ResolvedCardanoNFT;
  _eth?: ResolvedEthNFT;
  _voi?: ResolvedVoiNFT;
}

/**
 * Extracts a trailing number from an NFT name, e.g. "Dork City #123" -> 123.
 * Returns Number.MAX_SAFE_INTEGER when no number is found so un-numbered
 * items sort to the end.
 */
function extractTrailingNumber(name: string): number {
  const m = (name || "").match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

function resolveDisplayUri(uri: string, contractAddress?: string): string {
  if (!uri) return "";

  // Rewrite dead i.seadn.io /gcs/files/ paths to working raw2.seadn.io contract-nested paths
  if (uri.includes("i.seadn.io/gcs/files/")) {
    const match = uri.match(/\/gcs\/files\/([a-f0-9]{32})\.([a-z0-9]+)/i);
    if (match) {
      const hash = match[1];
      const ext = match[2];
      const contract = contractAddress || "0x495f947276749ce646f68ac8c248420045cb7b5e";
      return `https://raw2.seadn.io/ethereum/${contract.toLowerCase()}/${hash.substring(2)}/${hash}.${ext}`;
    }
  }

  if (uri.startsWith("ipfs://")) {
    const path = uri.slice(7);
    if (path.startsWith("ipfs/")) {
      return `https://ipfs.io/${path}`;
    }
    return `https://ipfs.io/ipfs/${path}`;
  }
  if (uri.startsWith("ar://")) {
    return `https://arweave.net/${uri.slice(5)}`;
  }
  return uri;
}

function truncateStringToBytes(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");
  const encoded = encoder.encode(str);
  if (encoded.length <= maxBytes) return str;

  const sliced = encoded.slice(0, maxBytes);
  let decoded = decoder.decode(sliced);
  
  // Strip trailing replacement characters if truncation happened in the middle of a UTF-8 character
  while (decoded.endsWith("\uFFFD") && decoded.length > 0) {
    decoded = decoded.slice(0, -1);
  }
  return decoded;
}

function appendMediaFragment(url: string, mimeType?: string): string {
  if (!url) return "";
  if (url.includes("#")) return url;
  if (mimeType) {
    if (mimeType.startsWith("video/")) return `${url}#v`;
    if (mimeType.startsWith("audio/")) return `${url}#a`;
    if (mimeType.startsWith("application/pdf")) return `${url}#p`;
    if (mimeType.startsWith("text/html")) return `${url}#h`;
  }
  return `${url}#i`;
}

function tryCompressUrl(url: string): string {
  if (!url || url.length <= 90) return url;

  const origin = window.location.origin.includes("localhost") || window.location.origin.includes("127.0.0.1")
    ? "https://wen.tools"
    : window.location.origin;

  const fragment = url.includes("#") ? url.substring(url.indexOf("#")) : "";

  // Pattern 1: Contract-nested OpenSea URL
  const nestedMatch = url.match(/https:\/\/(raw2|i2c)\.seadn\.io\/ethereum\/(0x[a-f0-9]{40})\/([a-f0-9]{30,32})\/([a-f0-9]{32})\.([a-z0-9]+)/i);
  if (nestedMatch) {
    const subdomain = nestedMatch[1];
    const contract = nestedMatch[2];
    const hash2 = nestedMatch[4];
    const ext = nestedMatch[5];

    try {
      const contractClean = contract.toLowerCase().replace(/^0x/, "");
      const contractBytes = new Uint8Array(contractClean.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
      const hash2Bytes = new Uint8Array(hash2.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));

      const combined = new Uint8Array(37);
      combined[0] = subdomain === "raw2" ? 0 : 1;
      combined.set(contractBytes, 1);
      combined.set(hash2Bytes, 21);

      const base64 = btoa(String.fromCharCode(...combined))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      return `${origin}/api/r?d=${base64}&e=${ext}${fragment}`;
    } catch (e) {
      console.debug("Failed to compress nested OpenSea URL:", e);
    }
  }

  // Pattern 2: Flat OpenSea URL
  const flatMatch = url.match(/https:\/\/i\.seadn\.io\/gcs\/files\/([a-f0-9]{32})\.([a-z0-9]+)/i);
  if (flatMatch) {
    const hash = flatMatch[1];
    const ext = flatMatch[2];

    try {
      const hashBytes = new Uint8Array(hash.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
      const combined = new Uint8Array(17);
      combined[0] = 2;
      combined.set(hashBytes, 1);

      const base64 = btoa(String.fromCharCode(...combined))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      return `${origin}/api/r?d=${base64}&e=${ext}${fragment}`;
    } catch (e) {
      console.debug("Failed to compress flat OpenSea URL:", e);
    }
  }

  return url;
}

function buildAndTruncateNote(noteObj: any): Uint8Array {
  const encoder = new TextEncoder();
  let jsonString = JSON.stringify(noteObj);
  let bytes = encoder.encode(jsonString);
  if (bytes.length <= 1024) return bytes;

  // Clone note object to avoid mutating input params
  const tempNote = JSON.parse(JSON.stringify(noteObj));

  // Step 1: Truncate description (if present)
  const desc = String(tempNote.description || "");
  if (desc.length > 0) {
    for (let len = desc.length - 10; len >= 0; len -= 10) {
      tempNote.description = desc.substring(0, len) + "...";
      jsonString = JSON.stringify(tempNote);
      bytes = encoder.encode(jsonString);
      if (bytes.length <= 1024) return bytes;
    }
    tempNote.description = "";
    jsonString = JSON.stringify(tempNote);
    bytes = encoder.encode(jsonString);
    if (bytes.length <= 1024) return bytes;
  }

  // Step 2: Remove duplicate image field if present
  if (tempNote.image) {
    delete tempNote.image;
    jsonString = JSON.stringify(tempNote);
    bytes = encoder.encode(jsonString);
    if (bytes.length <= 1024) return bytes;
  }

  // Step 3: Remove external_url if present
  if (tempNote.external_url) {
    delete tempNote.external_url;
    jsonString = JSON.stringify(tempNote);
    bytes = encoder.encode(jsonString);
    if (bytes.length <= 1024) return bytes;
  }

  // Step 4: Remove properties one by one
  if (tempNote.properties) {
    const keys = Object.keys(tempNote.properties);
    for (const key of keys) {
      delete tempNote.properties[key];
      jsonString = JSON.stringify(tempNote);
      bytes = encoder.encode(jsonString);
      if (bytes.length <= 1024) return bytes;
    }
  }

  return bytes;
}

function generalizeIpfsCid(cidOrPath: string, tokenId: string): string {
  if (!cidOrPath) return "";
  const parts = cidOrPath.split("/");
  const cidString = parts[0];
  let pathStr = parts.slice(1).join("/");

  if (pathStr && pathStr.includes("{id}")) {
    pathStr = pathStr.replace(/{id}/gi, tokenId);
  }

  return pathStr ? `${cidString}/${pathStr}` : cidString;
}

const TOOL_META = TOOLS.find((t) => t.id === "nft_import") || {
  label: "NFT Import Tool",
  description: "Import NFTs from other chains (XRP Ledger, Cardano, Ethereum) and mint them on Algorand.",
};

export function NFTImportTool() {
  const { activeAddress, algodClient, transactionSigner, activeNetwork } = useWallet();

  // ── Step state ──
  const [step, setStep] = useState<ImportStep>("input");

  // ── Input state ──
  const [sourceChain, setSourceChain] = useState<SourceChain>("xrpl");

  // XRPL-specific
  const [xrpAddress, setXrpAddress] = useState("");
  const [taxonId, setTaxonId] = useState("");
  const [xrplNetwork, setXrplNetwork] = useState<"mainnet" | "testnet">("mainnet");

  // Cardano-specific
  const [cardanoPolicyId, setCardanoPolicyId] = useState("");
  const [cardanoNetwork, setCardanoNetwork] = useState<CardanoNetwork>("mainnet");

  // Ethereum-specific
  const [ethContractAddress, setEthContractAddress] = useState("");
  const [ethOwnerAddress, setEthOwnerAddress] = useState("");
  const [ethNetwork, setEthNetwork] = useState<EthNetwork>("mainnet");
  const [alchemyApiKey, setAlchemyApiKey] = useState((import.meta.env.VITE_ALCHEMY_API_KEY as string) || "");
  const [ethScanMode, setEthScanMode] = useState<"blockchain" | "opensea">("blockchain");
  const [ethCollectionSlug, setEthCollectionSlug] = useState("");

  // Voi-specific
  const [voiContractId, setVoiContractId] = useState("");
  const [voiTraitInput, setVoiTraitInput] = useState("");
  const [isGeneratingCsv, setIsGeneratingCsv] = useState(false);

  // Shared
  const [startIndex, setStartIndex] = useState("0");
  const [endIndex, setEndIndex] = useState("500");
  const [arcFormat, setArcFormat] = useState<AlgorandARC>("ARC19");
  const [collectionName, setCollectionName] = useState("");

  // Sync network state when active wallet connects
  const hasSyncedNetwork = useRef(false);
  useEffect(() => {
    if (activeNetwork && !hasSyncedNetwork.current) {
      setXrplNetwork(activeNetwork === "testnet" ? "testnet" : "mainnet");
      hasSyncedNetwork.current = true;
    }
  }, [activeNetwork]);

  // ── Scan / Resolve state ──
  const [scanProgress, setScanProgress] = useState(0);
  const [totalScanned, setTotalScanned] = useState(0);
  const [resolveProgress, setResolveProgress] = useState({ done: 0, total: 0 });

  // ── Preview state (unified) ──
  const [unifiedNFTs, setUnifiedNFTs] = useState<UnifiedNFT[]>([]);
  const [selectedNFTs, setSelectedNFTs] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState("");

  // ── Mint state ──
  const [mintProgress, setMintProgress] = useState({ done: 0, total: 0 });
  const [mintedAssets, setMintedAssets] = useState<number[]>([]);
  const [preserveMintOrder, setPreserveMintOrder] = useState(true);
  const abortRef = useRef(false);

  // ─── Convert source-chain results into UnifiedNFT[] ───────────────────────

  function unifyXrpl(nfts: ResolvedNFTMetadata[]): UnifiedNFT[] {
    return nfts.map((n) => ({
      id: n.nft_id,
      name: n.name,
      description: n.description,
      image: n.image,
      imageResolved: n.imageResolved,
      metadataResolved: n.metadataResolved,
      serialOrId: String(n.nft_serial),
      sortKey: Number(n.nft_serial) || extractTrailingNumber(n.name),
      collectionTag: `T: ${n.nft_taxon}`,
      metadataIpfsCid: n.metadataIpfsCid,
      decodedUri: n.decodedUri,
      _xrpl: n,
    }));
  }

  function unifyCardano(nfts: ResolvedCardanoNFT[]): UnifiedNFT[] {
    return nfts.map((n) => ({
      id: n.asset_id,
      name: n.name,
      description: n.description,
      image: n.image,
      imageResolved: n.imageResolved,
      metadataResolved: n.metadataResolved,
      serialOrId: n.fingerprint.slice(0, 12) + "…",
      sortKey: extractTrailingNumber(n.name),
      collectionTag: n.metadataStandard,
      metadataStandard: n.metadataStandard,
      _cardano: n,
    }));
  }

  function unifyEth(nfts: ResolvedEthNFT[]): UnifiedNFT[] {
    return nfts.map((n) => ({
      id: `${n.contract_address}:${n.token_id}`,
      name: n.name,
      description: n.description,
      image: n.image,
      imageResolved: n.imageResolved,
      metadataResolved: n.metadataResolved,
      serialOrId: `#${n.token_id}`,
      sortKey: Number(n.token_id) >= 0 && Number.isFinite(Number(n.token_id)) ? Number(n.token_id) : extractTrailingNumber(n.name),
      collectionTag: n.tokenType,
      metadataStandard: n.tokenType,
      decodedUri: n.tokenUri,
      _eth: n,
    }));
  }

  function unifyVoi(nfts: ResolvedVoiNFT[]): UnifiedNFT[] {
    return nfts.map((n) => ({
      id: `voi-${n.contractId}-${n.tokenId}`,
      name: n.name,
      description: n.description,
      image: n.image,
      imageResolved: n.imageResolved,
      metadataResolved: n.metadataResolved,
      serialOrId: `#${n.tokenId}`,
      sortKey: n.tokenId,
      collectionTag: `ARC-72`,
      metadataStandard: "ARC-72",
      decodedUri: n.metadataURI,
      _voi: n,
    }));
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleScan = useCallback(async () => {
    abortRef.current = false;
    setStep("scanning");
    setScanProgress(0);
    setUnifiedNFTs([]);
    setSelectedNFTs(new Set());
    setTotalScanned(0);

    try {
      let unified: UnifiedNFT[] = [];

      // ── XRPL ──
      if (sourceChain === "xrpl") {
        if (!xrpAddress.trim()) { toast.error("Please enter an XRP wallet address"); setStep("input"); return; }
        if (!isValidXRPAddress(xrpAddress.trim())) { toast.error("Invalid XRP address format. Addresses start with 'r'."); setStep("input"); return; }

        toast.info("Scanning XRPL for NFTs...");
        const endpoint = xrplNetwork === "testnet" ? XRPL_TESTNET_ENDPOINT : XRPL_MAINNET_ENDPOINT;
        const nfts = await fetchNFTsByIssuer(xrpAddress.trim(), (count) => setScanProgress(count), endpoint);

        if (nfts.length === 0) { toast.warning("No NFTs found for this address"); setStep("input"); return; }
        setTotalScanned(nfts.length);

        let filteredNfts = nfts;
        if (taxonId.trim() !== "") {
          const taxonNum = parseInt(taxonId.trim(), 10);
          if (!isNaN(taxonNum)) filteredNfts = nfts.filter((nft) => nft.nft_taxon === taxonNum);
        }
        if (filteredNfts.length === 0) { toast.warning(`No NFTs found matching Taxon ID ${taxonId}`); setStep("input"); return; }

        const start = Math.max(0, parseInt(startIndex, 10) || 0);
        const end = endIndex.trim() !== "" ? Math.max(start, parseInt(endIndex, 10)) : filteredNfts.length;
        const slicedNfts = filteredNfts.slice(start, end);
        if (slicedNfts.length === 0) { toast.warning(`No NFTs found within range ${start} to ${end}`); setStep("input"); return; }

        toast.info(`Found ${filteredNfts.length} matching NFTs. Resolving metadata for range ${start} to ${start + slicedNfts.length}...`);
        setStep("resolving");
        setResolveProgress({ done: 0, total: slicedNfts.length });

        const resolved = await resolveAllMetadata(slicedNfts, 25, (done, total) => setResolveProgress({ done, total }));
        unified = unifyXrpl(resolved);
      }

      // ── CARDANO ──
      if (sourceChain === "cardano") {
        if (!cardanoPolicyId.trim()) { toast.error("Please enter a Cardano Policy ID"); setStep("input"); return; }
        if (!isValidPolicyId(cardanoPolicyId.trim())) { toast.error("Invalid Policy ID format. Must be 56 hex characters."); setStep("input"); return; }

        toast.info("Scanning Cardano for NFTs via Koios...");
        const rawNfts = await fetchNFTsByPolicy(cardanoPolicyId.trim(), cardanoNetwork, (count) => setScanProgress(count));

        if (rawNfts.length === 0) { toast.warning("No assets found for this Policy ID"); setStep("input"); return; }
        setTotalScanned(rawNfts.length);

        const start = Math.max(0, parseInt(startIndex, 10) || 0);
        const end = endIndex.trim() !== "" ? Math.max(start, parseInt(endIndex, 10)) : rawNfts.length;
        const slicedNfts = rawNfts.slice(start, end);
        if (slicedNfts.length === 0) { toast.warning(`No NFTs found within range ${start} to ${end}`); setStep("input"); return; }

        toast.info(`Found ${rawNfts.length} assets. Resolving metadata for range ${start} to ${start + slicedNfts.length}...`);
        setStep("resolving");
        setResolveProgress({ done: 0, total: slicedNfts.length });

        const resolved = await resolveCardanoMetadata(slicedNfts, 10, (done, total) => setResolveProgress({ done, total }));
        unified = unifyCardano(resolved);
      }

      // ── ETHEREUM ──
      if (sourceChain === "ethereum") {
        let resolved: ResolvedEthNFT[] = [];

        if (ethScanMode === "opensea") {
          if (!ethCollectionSlug.trim()) {
            toast.error("Please enter an OpenSea Collection Slug");
            setStep("input");
            return;
          }
          toast.info("Scanning OpenSea Collection for NFTs (including lazy mints)...");
          const allNfts = await fetchNFTsFromOpenSea(
            ethCollectionSlug.trim(),
            (count) => setScanProgress(count)
          );

          if (allNfts.length === 0) {
            toast.warning("No NFTs found for this collection slug on OpenSea.");
            setStep("input");
            return;
          }
          setTotalScanned(allNfts.length);

          const start = Math.max(0, parseInt(startIndex, 10) || 0);
          const end = endIndex.trim() !== "" ? Math.max(start, parseInt(endIndex, 10)) : allNfts.length;
          resolved = allNfts.slice(start, end);
          if (resolved.length === 0) {
            toast.warning(`No NFTs found within range ${start} to ${end}`);
            setStep("input");
            return;
          }

          // OpenSea already has fully resolved metadata
          unified = unifyEth(resolved);
        } else {
          if (!ethContractAddress.trim()) { toast.error("Please enter an Ethereum contract address"); setStep("input"); return; }
          if (!isValidEthAddress(ethContractAddress.trim())) { toast.error("Invalid Ethereum address. Must start with 0x followed by 40 hex chars."); setStep("input"); return; }
          if (!alchemyApiKey.trim()) { toast.error("Ethereum import is not configured. Please define VITE_ALCHEMY_API_KEY in your env variables."); setStep("input"); return; }

          // Detect shared / universal contracts (e.g. OpenSea Shared Storefront)
          const sharedLabel = isSharedContract(ethContractAddress.trim());
          const hasWalletFilter = ethOwnerAddress.trim() !== "";

          // If it's a shared contract, require the wallet address
          if (sharedLabel && !hasWalletFilter) {
            toast.error(`This is a shared contract (${sharedLabel}). Please enter the creator's ETH wallet address.`);
            setStep("input");
            return;
          }

          // Validate wallet address if provided
          if (hasWalletFilter && !isValidEthAddress(ethOwnerAddress.trim())) {
            toast.error("Invalid ETH Wallet Address. Must start with 0x followed by 40 hex chars.");
            setStep("input");
            return;
          }

          let rawNfts;
          if (sharedLabel && hasWalletFilter) {
            // SHARED CONTRACT: Scan by creator address encoded in token IDs
            // This finds NFTs the creator minted even if they've been sold/transferred
            toast.info(`Scanning for NFTs created by ${ethOwnerAddress.trim().slice(0, 10)}… on ${sharedLabel}…`);
            rawNfts = await fetchNFTsByCreatorOnSharedContract(ethOwnerAddress.trim(), ethContractAddress.trim(), alchemyApiKey.trim(), ethNetwork, (count) => setScanProgress(count));

            if (rawNfts.length === 0) {
              toast.warning("No NFTs found created by this wallet on the shared contract. Verify the creator wallet address is correct.", { autoClose: 8000 });
              setStep("input");
              return;
            }
          } else if (hasWalletFilter) {
            // NORMAL CONTRACT: Scan wallet for owned NFTs, filter by contract
            toast.info(`Scanning wallet ${ethOwnerAddress.trim().slice(0, 10)}… for NFTs…`);
            rawNfts = await fetchNFTsByOwnerForContract(ethOwnerAddress.trim(), ethContractAddress.trim(), alchemyApiKey.trim(), ethNetwork, (count) => setScanProgress(count));

            if (rawNfts.length === 0) {
              const allWalletNfts = await fetchAllNFTsForOwner(ethOwnerAddress.trim(), alchemyApiKey.trim(), ethNetwork);
              if (allWalletNfts.length === 0) {
                toast.warning("This wallet doesn't hold any NFTs on Ethereum.");
              } else {
                const contractMap = new Map<string, { name: string; count: number }>();
                allWalletNfts.forEach((n) => {
                  const addr = n.contract.address.toLowerCase();
                  const existing = contractMap.get(addr);
                  if (existing) { existing.count++; }
                  else { contractMap.set(addr, { name: n.contract.name || "Unknown", count: 1 }); }
                });
                const topContracts = Array.from(contractMap.entries())
                  .sort((a, b) => b[1].count - a[1].count)
                  .slice(0, 5)
                  .map(([addr, info]) => `${info.name} (${addr.slice(0, 8)}…): ${info.count}`)
                  .join(", ");
                toast.warning(
                  `Wallet has ${allWalletNfts.length} NFTs but none on the specified contract. Found NFTs on: ${topContracts}`,
                  { autoClose: 12000 }
                );
              }
              setStep("input");
              return;
            }
          } else {
            // Standard contract scan (no wallet filter)
            toast.info("Scanning Ethereum for NFTs via Alchemy...");
            rawNfts = await fetchNFTsByContract(ethContractAddress.trim(), alchemyApiKey.trim(), ethNetwork, (count) => setScanProgress(count));
            if (rawNfts.length === 0) { toast.warning("No NFTs found for this contract"); setStep("input"); return; }
          }
          setTotalScanned(rawNfts.length);

          const start = Math.max(0, parseInt(startIndex, 10) || 0);
          const end = endIndex.trim() !== "" ? Math.max(start, parseInt(endIndex, 10)) : rawNfts.length;
          const slicedNfts = rawNfts.slice(start, end);
          if (slicedNfts.length === 0) { toast.warning(`No NFTs found within range ${start} to ${end}`); setStep("input"); return; }

          toast.info(`Found ${rawNfts.length} NFTs. Resolving metadata for range ${start} to ${start + slicedNfts.length}...`);
          setStep("resolving");
          setResolveProgress({ done: 0, total: slicedNfts.length });

          resolved = await resolveEthMetadata(slicedNfts, (done, total) => setResolveProgress({ done, total }));
          unified = unifyEth(resolved);
        }
      }

      // ── VOI ──
      if (sourceChain === "voi") {
        if (!voiContractId.trim()) { toast.error("Please enter a Voi Contract ID"); setStep("input"); return; }
        if (!isValidContractId(voiContractId.trim())) { toast.error("Invalid Contract ID. Must be a positive number."); setStep("input"); return; }

        toast.info("Scanning Voi Network for NFTs via Mimir API...");
        const rawNfts = await fetchNFTsByContractId(voiContractId.trim(), (count) => setScanProgress(count));

        if (rawNfts.length === 0) { toast.warning("No NFTs found for this contract"); setStep("input"); return; }
        setTotalScanned(rawNfts.length);

        const start = Math.max(0, parseInt(startIndex, 10) || 0);
        const end = endIndex.trim() !== "" ? Math.max(start, parseInt(endIndex, 10)) : rawNfts.length;
        const slicedNfts = rawNfts.slice(start, end);
        if (slicedNfts.length === 0) { toast.warning(`No NFTs found within range ${start} to ${end}`); setStep("input"); return; }

        toast.info(`Found ${rawNfts.length} NFTs. Resolving metadata for range ${start} to ${start + slicedNfts.length}...`);
        setStep("resolving");
        setResolveProgress({ done: 0, total: slicedNfts.length });

        const resolved = resolveVoiMetadata(slicedNfts, (done, total) => setResolveProgress({ done, total }));
        unified = unifyVoi(resolved);
      }

      // ── Sort by true mint order (serial / token ID), lowest to highest ──
      // Name sorting broke sequential minting (e.g. "Dork 10" sorted before "Dork 2"
      // on collections without zero-padded names, and metadata names don't always
      // match mint order). sortKey is the on-chain serial/tokenId.
      unified.sort((a, b) => {
        if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      // ── Set preview state ──
      setUnifiedNFTs(unified);
      setSelectedNFTs(new Set(unified.filter((n) => n.metadataResolved || n.imageResolved).map((n) => n.id)));
      setStep("preview");

      const successCount = unified.filter((n) => n.metadataResolved || n.imageResolved).length;
      toast.success(`Loaded ${successCount} NFTs ready for import`);
    } catch (err: any) {
      console.error(err);
      let errMsg = err.message || "Failed to scan source chain";
      if (errMsg.includes("Account not found")) {
        errMsg = "Account not found. Please verify the address and check if you are on the correct network.";
      }
      toast.error(errMsg);
      setStep("input");
    }
  }, [sourceChain, xrpAddress, taxonId, startIndex, endIndex, xrplNetwork, cardanoPolicyId, cardanoNetwork, ethContractAddress, ethOwnerAddress, ethNetwork, alchemyApiKey, voiContractId, ethScanMode, ethCollectionSlug]);

  const handleDownloadVoiTraitsCsv = useCallback(async () => {
    const input = voiTraitInput.trim();
    if (!input) {
      toast.error("Please enter a Voi Creator Address or Contract ID");
      return;
    }

    setIsGeneratingCsv(true);
    try {
      let contractIds: number[] = [];

      // Determine if the input is a Creator Wallet Address (typically a standard Algorand/Voi 58-char address) or Contract ID (numeric)
      const isAddress = /^[A-Z2-7]{58}$/.test(input.toUpperCase());
      const isNumeric = /^\d+$/.test(input);

      if (isAddress) {
        toast.info("Fetching collections for creator...");
        contractIds = await fetchCollectionsByCreator(input);
        if (contractIds.length === 0) {
          toast.warning("No collections found for this creator address.");
          setIsGeneratingCsv(false);
          return;
        }
      } else if (isNumeric) {
        contractIds = [parseInt(input, 10)];
      } else {
        toast.error("Invalid input. Enter a 58-character Voi Creator Wallet Address or a numeric Application ID.");
        setIsGeneratingCsv(false);
        return;
      }

      toast.info(`Scanning Voi collections...`);
      const allResolvedNFTs: ResolvedVoiNFT[] = [];

      for (const contractId of contractIds) {
        const rawTokens = await fetchNFTsByContractId(String(contractId));
        if (rawTokens.length > 0) {
          const resolved = resolveVoiMetadata(rawTokens);
          allResolvedNFTs.push(...resolved);
        }
      }

      if (allResolvedNFTs.length === 0) {
        toast.warning("No NFTs with metadata found.");
        setIsGeneratingCsv(false);
        return;
      }

      // Sort NFTs by true mint order (contract, then token ID) so CSV rows
      // and the sequential unit-name numbering match the on-chain order 1, 2, 3...
      allResolvedNFTs.sort((a, b) => {
        if (a.contractId !== b.contractId) return a.contractId - b.contractId;
        return a.tokenId - b.tokenId;
      });

      // Generate CSV
      // 1. Gather all unique property/trait keys
      const traitKeys = new Set<string>();
      allResolvedNFTs.forEach((nft) => {
        if (nft.properties) {
          Object.keys(nft.properties).forEach((k) => {
            traitKeys.add(k);
          });
        }
      });
      const sortedTraitKeys = Array.from(traitKeys).sort();

      // 2. Build CSV Headers
      const headers = [
        "name",
        "unit_name",
        "has_clawback",
        "has_freeze",
        "decimals",
        "total_supply",
        "url",
        "description",
        "external_url",
        "mime_type",
        ...sortedTraitKeys.map((k) => `property_${k}`),
      ];

      const rows = [headers.join(",")];

      // 3. Build CSV Rows
      allResolvedNFTs.forEach((nft, idx) => {
        const absoluteIndex = idx + 1;
        const indexStr = String(absoluteIndex);
        let finalUnitName = "";
        if (collectionName.trim() !== "") {
          const maxPrefixLen = Math.max(0, 8 - indexStr.length);
          const baseUnitPrefix = collectionName.replace(/\d+\s*$/, "").trim() || "VOI";
          finalUnitName = `${baseUnitPrefix.slice(0, maxPrefixLen)}${indexStr}`.toUpperCase();
        } else {
          finalUnitName = "VOI";
        }

        const rowValues = [
          `"${nft.name.replace(/"/g, '""')}"`,
          `"${finalUnitName}"`,
          "N",
          "N",
          "0",
          "1",
          `"${nft.image || ""}"`,
          `"${(nft.description || "").replace(/"/g, '""')}"`,
          `"${(nft.metadataURI || "").replace(/"/g, '""')}"`,
          "image/png",
          ...sortedTraitKeys.map((k) => {
            const val = nft.properties?.[k];
            return val !== undefined && val !== null ? `"${String(val).replace(/"/g, '""')}"` : "";
          }),
        ];
        rows.push(rowValues.join(","));
      });

      // 4. Download file
      const csvContent = rows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      const filename = isAddress ? `voi_creator_${input.slice(0, 8)}_arc69.csv` : `voi_contract_${input}_arc69.csv`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success(`Successfully downloaded CSV for ${allResolvedNFTs.length} NFTs!`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to generate CSV");
    } finally {
      setIsGeneratingCsv(false);
    }
  }, [voiTraitInput, collectionName]);

  const handleToggleNFT = useCallback((nftId: string) => {
    setSelectedNFTs((prev) => {
      const next = new Set(prev);
      if (next.has(nftId)) next.delete(nftId); else next.add(nftId);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const validIds = unifiedNFTs.filter((n) => n.metadataResolved || n.imageResolved).map((n) => n.id);
    setSelectedNFTs(new Set(validIds));
  }, [unifiedNFTs]);

  const handleDeselectAll = useCallback(() => { setSelectedNFTs(new Set()); }, []);

  const handleMint = useCallback(async () => {
    if (!activeAddress) { toast.error("Please connect your Algorand wallet"); return; }
    if (selectedNFTs.size === 0) { toast.error("No NFTs selected for import"); return; }

    const toMint = unifiedNFTs.filter((n) => selectedNFTs.has(n.id));
    setStep("minting");
    setMintProgress({ done: 0, total: toMint.length });
    setMintedAssets([]);
    abortRef.current = false;

    try {
      const suggestedParams = await algodClient.getTransactionParams().do();
      suggestedParams.flatFee = true;
      suggestedParams.fee = 2000;

      const start = Math.max(0, parseInt(startIndex, 10) || 0);
      const allTxns: algosdk.Transaction[] = [];
      const allTxGroups: algosdk.Transaction[][] = [];
      let totalPrepared = 0;

      for (let i = 0; i < toMint.length; i++) {
        if (abortRef.current) break;
        const nft = toMint[i];

        // If the NFT came from XRPL, use the existing formatters
        // For Cardano & Ethereum we use a generic approach since
        // the metadata is already resolved into a common shape.
        let mintData: any;

        if (nft._xrpl) {
          const xrplNft = nft._xrpl;
          let finalFormat = arcFormat;
          if (finalFormat !== "ARC69" && !xrplNft.metadataIpfsCid && !xrplNft.decodedUri.startsWith("ipfs://")) {
            toast.warn(`Non-IPFS metadata detected for ${xrplNft.name}. Enforcing ARC69 format.`, { autoClose: 3500 });
            finalFormat = "ARC69";
          }
          if (finalFormat === "ARC69") mintData = formatAsARC69(xrplNft, collectionName);
          else if (finalFormat === "ARC3") mintData = formatAsARC3(xrplNft, collectionName);
          else mintData = formatAsARC19(xrplNft, collectionName);
        } else {
          // Generic formatting for Cardano / Ethereum imports
          let finalFormat = arcFormat;

          // ── Robust IPFS detection ──
          // Check all possible locations for an IPFS CID: the resolved image,
          // the raw token/metadata URI, and the raw metadata image field.
          const imageCid = extractIpfsCid(nft.image || "");
          const uriCid = extractIpfsCid(nft.decodedUri || "");
          const rawImageCid = nft._eth
            ? extractIpfsCid(nft._eth.raw_metadata?.image || "")
            : nft._voi
              ? extractIpfsCid(nft._voi.raw_metadata?.image || nft._voi.raw_metadata?.image_url || nft._voi.raw_metadata?.animation_url || "")
              : null;
          const rawTokenUriCid = nft._eth
            ? extractIpfsCid(nft._eth.tokenUri || "")
            : nft._voi
              ? extractIpfsCid(nft._voi.metadataURI || "")
              : null;

          // Pick the best CID available — prefer metadata-level CIDs for ARC19/ARC3
          const bestMetadataCid = uriCid || rawTokenUriCid;
          const bestImageCid = imageCid || rawImageCid;
          const hasIpfs = !!(bestMetadataCid || bestImageCid);
          const hasIpfsForArc19 = !!bestMetadataCid;

          if (finalFormat === "ARC19" && !hasIpfsForArc19) {
            toast.warn(`Non-IPFS metadata JSON detected for ${nft.name}. ARC19 requires the metadata JSON to be on IPFS. Enforcing ARC69 format.`, { autoClose: 3500 });
            finalFormat = "ARC69";
          }

          // Warn if they are using ARC19/ARC3 but the original JSON hardcodes an HTTP image
          const rawImageStr = nft._eth?.raw_metadata?.image || nft._eth?.raw_metadata?.image_url || nft._voi?.raw_metadata?.image || nft._voi?.raw_metadata?.image_url || "";
          if (finalFormat !== "ARC69" && hasIpfs && typeof rawImageStr === "string" && rawImageStr.startsWith("http")) {
            try {
              const gatewayHost = new URL(rawImageStr).hostname;
              // Use a ref or simple global variable to avoid spamming the toast in a loop
              if (!(window as any)._warnedGateways?.has(gatewayHost)) {
                toast.warn(
                  `Warning: Original metadata uses a hardcoded HTTP gateway (${gatewayHost}). If the gateway is offline, the image won't load for ARC19/ARC3. Consider using ARC69 to fix this.`,
                  { autoClose: 10000 }
                );
                (window as any)._warnedGateways = (window as any)._warnedGateways || new Set();
                (window as any)._warnedGateways.add(gatewayHost);
              }
            } catch (err) {
              console.debug("Invalid URL format:", rawImageStr, err);
            }
          }

          const unitName = collectionName
            ? collectionName.slice(0, 8).toUpperCase()
            : (nft._cardano?.policy_id?.slice(0, 8) || nft._eth?.contractSymbol?.slice(0, 8) || nft._voi?.contractId.toString() || "IMPORT").toUpperCase();

          const sourceProps: Record<string, string> = {
            source_chain: sourceChain,
            original_standard: nft.metadataStandard || "unknown",
            ...(nft._cardano ? { cardano_fingerprint: nft._cardano.fingerprint } : {}),
            ...(nft._eth ? { eth_contract: nft._eth.contract_address, eth_token_id: nft._eth.token_id } : {}),
            ...(nft._voi ? { voi_contract_id: nft._voi.contractId.toString(), voi_token_id: nft._voi.tokenId.toString() } : {}),
          };

          // Merge actual traits from Voi, Cardano, or Ethereum
          if (nft._voi?.properties) {
            Object.entries(nft._voi.properties).forEach(([key, val]) => {
              if (val !== undefined && val !== null) {
                sourceProps[key] = String(val);
              }
            });
          }

          if (nft._eth?.raw_metadata) {
            const meta = nft._eth.raw_metadata;
            if (meta.properties && typeof meta.properties === "object") {
              Object.entries(meta.properties).forEach(([key, val]) => {
                if (val !== undefined && val !== null && typeof val !== "object") {
                  sourceProps[key] = String(val);
                }
              });
            } else if (Array.isArray(meta.attributes)) {
              for (const attr of meta.attributes) {
                if (attr && typeof attr === "object" && attr.trait_type) {
                  sourceProps[attr.trait_type] = String(attr.value);
                }
              }
            }
          }

          if (nft._cardano?.raw_metadata) {
            const meta = nft._cardano.raw_metadata;
            const policyBlock = meta[nft._cardano.policy_id];
            if (policyBlock) {
              const assetBlock = policyBlock[nft._cardano.asset_name_hex] || policyBlock[nft.name];
              if (assetBlock && typeof assetBlock === "object") {
                Object.entries(assetBlock).forEach(([key, val]) => {
                  if (["name", "image", "description", "mediaType", "files"].includes(key)) return;
                  if (val !== undefined && val !== null && typeof val !== "object" && !Array.isArray(val)) {
                    sourceProps[key] = String(val);
                  }
                });
              }
            }
            if (meta.fields && typeof meta.fields === "object") {
              Object.entries(meta.fields).forEach(([key, val]) => {
                if (["name", "image", "description"].includes(key)) return;
                if (val !== undefined && val !== null && typeof val !== "object" && !Array.isArray(val)) {
                  sourceProps[key] = String(val);
                }
              });
            }
          }

          if (finalFormat === "ARC19") {
            // ── ARC19: encode the IPFS CID into the reserve address ──
            let cidForReserve = bestMetadataCid || "";

            // For ARC19 template URLs, substitute {id} with the actual token ID.
            // This encodes the base folder CID into the reserve address and puts the exact file in the URL.
            if (cidForReserve && (nft._eth || nft._voi)) {
              const tId = nft._eth ? nft._eth.token_id.toString() : nft._voi!.tokenId.toString();
              cidForReserve = generalizeIpfsCid(cidForReserve, tId);
            }

            let assetURL = "";
            let reserveAddress = activeAddress || "";
            if (cidForReserve) {
              const ret = createReserveAddressFromIpfsCid(cidForReserve);
              assetURL = ret.assetURL;
              reserveAddress = ret.reserveAddress;
            }
            mintData = {
              asset_name: nft.name.slice(0, 32),
              unit_name: unitName,
              total_supply: 1,
              decimals: 0,
              asset_url: assetURL,
              reserve_address: reserveAddress,
              has_freeze: "N",
              has_clawback: "N",
              default_frozen: "N",
              asset_note: {
                standard: "arc19",
                description: nft.description.slice(0, 1024),
                properties: sourceProps,
              },
            };
          } else if (finalFormat === "ARC3") {
            // ── ARC3: asset_url = ipfs://CID#arc3 ──
            let cidForUrl = bestMetadataCid || bestImageCid || "";
            if (cidForUrl && (nft._eth || nft._voi)) {
              const tId = nft._eth ? nft._eth.token_id.toString() : nft._voi!.tokenId.toString();
              cidForUrl = generalizeIpfsCid(cidForUrl, tId);
            }
            const fallbackUrl = nft.decodedUri || nft.image || "";
            const arc3Url = cidForUrl ? `ipfs://${cidForUrl}#arc3` : (fallbackUrl.endsWith("#arc3") ? fallbackUrl : `${fallbackUrl}#arc3`);
            const compressedArc3Url = tryCompressUrl(arc3Url);
            mintData = {
              asset_name: nft.name.slice(0, 32),
              unit_name: unitName,
              total_supply: 1,
              decimals: 0,
              asset_url: compressedArc3Url.slice(0, 96),
              reserve_address: activeAddress,
              has_freeze: "N",
              has_clawback: "N",
              default_frozen: "N",
            };
          } else {
            // ── ARC69: media URL in asset_url, metadata in note ──
            const mimeType = nft.image?.endsWith(".gif")
              ? "image/gif"
              : nft.image?.endsWith(".webp")
                ? "image/webp"
                : nft.image?.endsWith(".jpg") || nft.image?.endsWith(".jpeg")
                  ? "image/jpeg"
                  : "image/png";

            let assetUrl = nft.image || nft.decodedUri || "";
            if (assetUrl.includes("{id}") && (nft._eth || nft._voi)) {
              const tId = nft._eth ? nft._eth.token_id.toString() : nft._voi!.tokenId.toString();
              assetUrl = assetUrl.replace("{id}", tId);
            }

                        // Append standard media fragment (#i for image)
            const mediaUrl = appendMediaFragment(assetUrl, mimeType);
            const compressedAssetUrl = tryCompressUrl(mediaUrl);
            const finalAssetUrl = truncateStringToBytes(compressedAssetUrl, 96);
            const finalImage = appendMediaFragment(nft.image, mimeType);

            mintData = {
              asset_name: truncateStringToBytes(nft.name, 32),
              unit_name: unitName,
              total_supply: 1,
              decimals: 0,
              asset_url: finalAssetUrl,
              reserve_address: activeAddress,
              has_freeze: "N",
              has_clawback: "N",
              default_frozen: "N",
              asset_note: {
                standard: "arc69",
                description: nft.description.slice(0, 300), // Sensible starting slice
                external_url: nft._eth?.opensea_url || nft.decodedUri || nft.image || "",
                media_url: finalImage,
                image: finalImage,
                mime_type: mimeType,
                properties: sourceProps,
              },
            };
          }
        }

        // Compute the dynamic sequential unit name for the collection
        const indexInUnified = unifiedNFTs.findIndex((n) => n.id === nft.id);
        const absoluteIndex = start + (indexInUnified >= 0 ? indexInUnified : i) + 1;
        const indexStr = String(absoluteIndex);
        const maxPrefixLen = Math.max(0, 8 - indexStr.length);

        // ── Asset name: ensure a space between the base name and its number ──
        // e.g. "DorkCity123" -> "DorkCity 123", "DorkCity#123" -> "DorkCity #123".
        // Names that already have the space ("Dork City 123") are left untouched.
        const rawAssetName = String(mintData.asset_name || nft.name || "");
        const paddedName = rawAssetName.replace(/([^\s#\d])(#?\d+)\s*$/, "$1 $2");
        mintData.asset_name = truncateStringToBytes(paddedName, 32);

        // ── Unit name: only append sequential number if Collection Unit Name Prefix is specified ──
        if (collectionName.trim() !== "") {
          const baseUnitPrefix = collectionName.replace(/\d+\s*$/, "").trim() || "NFT";
          const finalUnitName = `${baseUnitPrefix.slice(0, maxPrefixLen)}${indexStr}`.toUpperCase();
          mintData.unit_name = truncateStringToBytes(finalUnitName, 8);
        } else {
          // If no prefix is specified, use the original/default unit name sanitized to 8 chars
          const baseUnit = String(mintData.unit_name || "NFT").trim();
          mintData.unit_name = truncateStringToBytes(baseUnit, 8).toUpperCase();
        }

        const asset_create_tx = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          manager: activeAddress,
          assetName: mintData.asset_name,
          unitName: mintData.unit_name,
          total: BigInt(mintData.total_supply) * 10n ** BigInt(mintData.decimals),
          decimals: parseInt(mintData.decimals as any),
          reserve: mintData.reserve_address || activeAddress,
          freeze: mintData.has_freeze === "Y" ? activeAddress : undefined,
          assetURL: mintData.asset_url,
          suggestedParams: { ...suggestedParams, fee: 2000 },
          clawback: mintData.has_clawback === "Y" ? activeAddress : undefined,
          defaultFrozen: mintData.default_frozen === "Y" ? true : false,
          note: mintData.asset_note ? buildAndTruncateNote(mintData.asset_note) : undefined,
        });

        const fee_tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: MINT_FEE_WALLET,
          amount: 0,
          suggestedParams: { ...suggestedParams, fee: 1000 },
          note: new TextEncoder().encode("via wen.tools cross-chain importer | " + Math.random().toString(36).substring(2)),
        });

        const group = algosdk.assignGroupID([asset_create_tx, fee_tx]);
        allTxns.push(...group);
        allTxGroups.push(group);
        totalPrepared++;
        setMintProgress({ done: totalPrepared, total: toMint.length });
        toast.info(`Prepared ${totalPrepared}/${toMint.length}: ${nft.name}`, { autoClose: 500 });
      }

      if (abortRef.current) { setStep("preview"); return; }

      toast.info(`Signing all ${toMint.length} NFTs (in batches of 500)...`);
      const signedTxns: Uint8Array[] = [];
      const batches = sliceIntoChunks(allTxGroups, 500); // Batch size of 500 groups to prevent wallet size limit errors

      for (let b = 0; b < batches.length; b++) {
        if (abortRef.current) { setStep("preview"); return; }
        const batch = batches[b];
        const batchTxns = batch.flat();
        toast.info(`Signing batch ${b + 1} of ${batches.length}...`);
        const signed = await walletSign(batchTxns, transactionSigner);
        signedTxns.push(...signed);
      }

      const signedGroups = sliceIntoChunks(Array.from(signedTxns), 2);

      const allCreatedIds: number[] = [];

      if (preserveMintOrder) {
        toast.info(`Submitting ${signedGroups.length} NFTs sequentially (strict order)...`);
        setMintProgress({ done: 0, total: signedGroups.length });

        for (let idx = 0; idx < signedGroups.length; idx++) {
          if (abortRef.current) break;
          try {
            const { txId } = await algodClient.sendRawTransaction(signedGroups[idx]).do();
            const confirmed = await algosdk.waitForConfirmation(algodClient, txId, 4);
            if (confirmed["asset-index"]) {
              const assetId = Number(confirmed["asset-index"]);
              allCreatedIds.push(assetId);
              setMintedAssets([...allCreatedIds]);
            }
          } catch (e) {
            console.warn(`NFT ${idx + 1} submission/confirmation error:`, e);
          }
          setMintProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      } else {
        toast.info(`Submitting ${signedGroups.length} NFTs in parallel for maximum speed...`);
        setMintProgress({ done: 0, total: signedGroups.length });

        // Submit in parallel batches to avoid overloading the node/wallet
        const chunkSize = 16;
        for (let i = 0; i < signedGroups.length; i += chunkSize) {
          if (abortRef.current) break;
          const chunk = signedGroups.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map(async (group, groupOffset) => {
              const idx = i + groupOffset;
              try {
                const { txId } = await algodClient.sendRawTransaction(group).do();
                const confirmed = await algosdk.waitForConfirmation(algodClient, txId, 4);
                if (confirmed["asset-index"]) {
                  const assetId = Number(confirmed["asset-index"]);
                  allCreatedIds.push(assetId);
                  setMintedAssets((prev) => [...prev, assetId]);
                }
              } catch (e) {
                console.warn(`NFT ${idx + 1} submission error:`, e);
              }
              setMintProgress((prev) => ({ ...prev, done: prev.done + 1 }));
            })
          );
        }
      }

      setMintedAssets(allCreatedIds);
      setStep("done");
      toast.success(`Successfully imported ${allCreatedIds.length} NFTs to Algorand!`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Minting failed");
      setStep("preview");
    }
  }, [activeAddress, algodClient, transactionSigner, selectedNFTs, unifiedNFTs, arcFormat, collectionName, sourceChain, startIndex, preserveMintOrder]);

  // ─── Filtering ────────────────────────────────────────────────────────────

  const filteredNFTs = unifiedNFTs.filter((nft) => {
    if (!searchFilter) return true;
    const q = searchFilter.toLowerCase();
    return nft.name.toLowerCase().includes(q) || nft.id.toLowerCase().includes(q) || nft.description.toLowerCase().includes(q);
  });

  // ─── Chain label helpers ──────────────────────────────────────────────────

  const chainLabel = sourceChain === "xrpl" ? "XRPL" : sourceChain === "cardano" ? "Cardano" : sourceChain === "voi" ? "Voi" : "Ethereum";
  const chainEmoji = sourceChain === "xrpl" ? "💧" : sourceChain === "cardano" ? "🔷" : sourceChain === "voi" ? "⚡" : "⟠";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="pb-20 pt-2 text-white flex flex-col items-center min-h-screen w-full">
      <Meta title={TOOL_META.label} description={TOOL_META.description} />

      <div className="w-full max-w-6xl px-4">
        {/* Header */}
        <div className="text-center mb-8 mt-4">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent">
              NFT Import Tool
            </h1>
          </div>
          <p className="text-gray-400 max-w-xl mx-auto text-sm leading-relaxed">
            Import your NFTs from other blockchains (XRP Ledger, Cardano, Ethereum) and re-mint them on Algorand.
            Scans metadata &amp; IPFS images, then formats to your chosen ARC standard.
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          {[
            { key: "input", label: "Configure" },
            { key: "scanning", label: "Scan" },
            { key: "preview", label: "Preview" },
            { key: "minting", label: "Mint" },
          ].map((s, i) => {
            const isActive = step === s.key || (step === "resolving" && s.key === "scanning") || (step === "done" && s.key === "minting");
            const isPast =
              (step === "preview" && i < 2) ||
              (step === "minting" && i < 3) ||
              (step === "done" && i < 4) ||
              (step === "resolving" && i < 1);
            return (
              <div key={s.key} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${isActive ? "bg-orange-500 text-white shadow-lg shadow-orange-500/30"
                    : isPast ? "bg-orange-500/30 text-orange-300 border border-orange-500/40"
                      : "bg-white/5 text-gray-500 border border-white/10"
                  }`}>
                  {isPast ? "✓" : i + 1}
                </div>
                <span className={`text-xs font-medium ${isActive ? "text-orange-400" : isPast ? "text-orange-300/60" : "text-gray-500"}`}>
                  {s.label}
                </span>
                {i < 3 && <div className={`w-8 h-px ${isPast || isActive ? "bg-orange-500/40" : "bg-white/10"}`} />}
              </div>
            );
          })}
        </div>

        {/* ── Step: Input ── */}
        {step === "input" && (
          <div className="max-w-2xl mx-auto space-y-6 animate-fadeIn">

            {/* Source Chain Selector */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-3">Source Chain</label>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setSourceChain("xrpl")}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all ${sourceChain === "xrpl"
                      ? "bg-orange-500/20 border-2 border-orange-500 text-orange-400"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                    }`}
                >
                  <img src="https://cryptologos.cc/logos/xrp-xrp-logo.svg?v=035" alt="XRP" className="w-5 h-5" /> XRP Ledger
                </button>
                <button
                  onClick={() => setSourceChain("cardano")}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all ${sourceChain === "cardano"
                      ? "bg-blue-500/20 border-2 border-blue-500 text-blue-400"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                    }`}
                >
                  <img src="https://cryptologos.cc/logos/cardano-ada-logo.svg?v=035" alt="ADA" className="w-5 h-5" /> Cardano (ADA)
                </button>
                <button
                  onClick={() => setSourceChain("ethereum")}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all ${sourceChain === "ethereum"
                      ? "bg-purple-500/20 border-2 border-purple-500 text-purple-400"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                    }`}
                >
                  <img src="https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=035" alt="ETH" className="w-5 h-5" /> Ethereum (ETH)
                </button>
                <button
                  onClick={() => setSourceChain("voi")}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all ${sourceChain === "voi"
                      ? "bg-green-500/20 border-2 border-green-500 text-green-400"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                    }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4l7 15 7-15" /></svg> Voi (ARC-72)
                </button>
              </div>
            </div>

            {/* Source Network */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 animate-fadeIn">
              <label className="block text-sm font-semibold text-gray-300 mb-3">Source Network</label>
              <div className="flex flex-wrap gap-3">
                {sourceChain === "xrpl" && (
                  <>
                    <button onClick={() => setXrplNetwork("mainnet")} className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${xrplNetwork === "mainnet" ? "bg-orange-500/20 border-2 border-orange-500 text-orange-400" : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"}`}>Mainnet</button>
                    <button onClick={() => setXrplNetwork("testnet")} className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${xrplNetwork === "testnet" ? "bg-orange-500/20 border-2 border-orange-500 text-orange-400" : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"}`}>Testnet</button>
                  </>
                )}
                {sourceChain === "cardano" && (
                  <>
                    <button onClick={() => setCardanoNetwork("mainnet")} className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${cardanoNetwork === "mainnet" ? "bg-blue-500/20 border-2 border-blue-500 text-blue-400" : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"}`}>Mainnet</button>
                    <button onClick={() => setCardanoNetwork("preprod")} className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${cardanoNetwork === "preprod" ? "bg-blue-500/20 border-2 border-blue-500 text-blue-400" : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"}`}>Preprod</button>
                    <button onClick={() => setCardanoNetwork("preview")} className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${cardanoNetwork === "preview" ? "bg-blue-500/20 border-2 border-blue-500 text-blue-400" : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"}`}>Preview</button>
                  </>
                )}
                {sourceChain === "ethereum" && (
                  <>
                    <button onClick={() => setEthNetwork("mainnet")} className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${ethNetwork === "mainnet" ? "bg-purple-500/20 border-2 border-purple-500 text-purple-400" : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"}`}>Mainnet</button>
                    <button onClick={() => setEthNetwork("sepolia")} className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${ethNetwork === "sepolia" ? "bg-purple-500/20 border-2 border-purple-500 text-purple-400" : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"}`}>Sepolia</button>
                  </>
                )}
                {sourceChain === "voi" && (
                  <button className="px-5 py-3 rounded-xl text-sm font-semibold transition-all bg-green-500/20 border-2 border-green-500 text-green-400">Mainnet</button>
                )}
              </div>
            </div>

            {/* ── XRPL-specific inputs ── */}
            {sourceChain === "xrpl" && (
              <>
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                  <label className="block text-sm font-semibold text-gray-300 mb-2">XRP Creator / Owner Wallet Address</label>
                  <p className="text-xs text-gray-500 mb-3">Enter the XRPL address that issued or holds the NFTs you want to import.</p>
                  <input type="text" value={xrpAddress} onChange={(e) => setXrpAddress(e.target.value)} placeholder="rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 transition font-mono text-sm" />
                </div>
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Taxon ID <span className="text-gray-500 font-normal">(optional collection filter)</span></label>
                  <p className="text-xs text-gray-500 mb-3">XRPL uses Taxon IDs to group NFTs into collections under an issuer. Enter a taxon ID to only import that collection.</p>
                  <input type="text" value={taxonId} onChange={(e) => setTaxonId(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 0"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 transition text-sm" />
                </div>
              </>
            )}

            {/* ── Cardano-specific inputs ── */}
            {sourceChain === "cardano" && (
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                <label className="block text-sm font-semibold text-gray-300 mb-2">Policy ID</label>
                <p className="text-xs text-gray-500 mb-3">
                  Cardano groups NFTs by Policy ID (56 hex chars). All tokens minted under the same policy belong to one collection.
                  This is similar to XRPL's Taxon ID. Supports both <span className="text-blue-400 font-medium">CIP-25</span> (immutable) and <span className="text-blue-400 font-medium">CIP-68</span> (mutable) standards.
                </p>
                <input type="text" value={cardanoPolicyId} onChange={(e) => setCardanoPolicyId(e.target.value.replace(/[^0-9a-fA-F]/g, ""))} placeholder="e.g. 477cec772adb1466b301fb8161f505aa66ed1ee8d69d3e7984256a43"
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition font-mono text-sm" />
                <p className="text-xxs text-gray-600 mt-2">
                  Powered by <a href="https://koios.rest" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Koios API</a> — free tier, no API key required (5,000 req/day)
                </p>
              </div>
            )}

            {/* ── Ethereum-specific inputs ── */}
            {sourceChain === "ethereum" && (
              <>
                {/* Scan Mode Toggle */}
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 animate-fadeIn">
                  <label className="block text-sm font-semibold text-gray-300 mb-3">Scan Mode</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setEthScanMode("blockchain")}
                      className={`flex-1 px-4 py-3 rounded-xl text-xs font-bold transition-all ${
                        ethScanMode === "blockchain"
                          ? "bg-purple-500/20 border-2 border-purple-500 text-purple-400"
                          : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                      }`}
                    >
                      ⛓️ Blockchain Scan (Alchemy)
                    </button>
                    <button
                      onClick={() => setEthScanMode("opensea")}
                      className={`flex-1 px-4 py-3 rounded-xl text-xs font-bold transition-all ${
                        ethScanMode === "opensea"
                          ? "bg-purple-500/20 border-2 border-purple-500 text-purple-400"
                          : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                      }`}
                    >
                      ⛵ OpenSea Collection (Lazy Mints)
                    </button>
                  </div>
                </div>

                {ethScanMode === "opensea" ? (
                  <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 animate-fadeIn">
                    <label className="block text-sm font-semibold text-gray-300 mb-2">OpenSea Collection Slug</label>
                    <p className="text-xs text-gray-500 mb-3">
                      Enter the collection slug from the OpenSea URL (e.g. <code>d3ath5t4r-you-are-a-flower</code> from <code>https://opensea.io/collection/d3ath5t4r-you-are-a-flower</code>).
                      This fetches all 141 NFTs in the collection directly via OpenSea's API (including lazy-minted, off-chain items).
                    </p>
                    <input
                      type="text"
                      value={ethCollectionSlug}
                      onChange={(e) => setEthCollectionSlug(e.target.value)}
                      placeholder="e.g. d3ath5t4r-you-are-a-flower"
                      className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition font-mono text-sm"
                    />
                  </div>
                ) : (
                  <>
                    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 animate-fadeIn">
                      <label className="block text-sm font-semibold text-gray-300 mb-2">NFT Contract Address</label>
                      <p className="text-xs text-gray-500 mb-3">
                        Ethereum groups NFTs by contract address (the deployed ERC-721 or ERC-1155 smart contract).
                        Supports both <span className="text-purple-400 font-medium">ERC-721</span> (unique 1/1 tokens) and <span className="text-purple-400 font-medium">ERC-1155</span> (multi-token, can be NFT when supply=1).
                        ERC-721 metadata can be immutable (IPFS) or mutable (HTTP tokenURI).
                      </p>
                      <input type="text" value={ethContractAddress} onChange={(e) => setEthContractAddress(e.target.value)} placeholder="0x..."
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition font-mono text-sm" />
                    </div>

                    {/* Shared contract warning + Owner wallet filter */}
                    {(() => {
                      const sharedLabel = ethContractAddress.trim() ? isSharedContract(ethContractAddress.trim()) : null;
                      return (
                        <>
                          {sharedLabel && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 animate-fadeIn">
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                  </svg>
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-amber-400 mb-1">Shared / Universal Contract Detected</p>
                                  <p className="text-xs text-amber-300/70 leading-relaxed">
                                    This is the <span className="font-semibold text-amber-300">{sharedLabel}</span> — a universal contract used by millions of creators.
                                    Enter the <span className="font-semibold text-amber-300">creator's wallet address</span> below to find all NFTs they minted on this contract,
                                    even if they've been sold or transferred to other wallets.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 animate-fadeIn">
                            <label className="block text-sm font-semibold text-gray-300 mb-2">
                              {sharedLabel
                                ? <>Creator Wallet Address <span className="text-amber-400 font-normal">(required for shared contracts)</span></>
                                : <>ETH Wallet Address <span className="text-gray-500 font-normal">(optional — filter by owner)</span></>
                              }
                            </label>
                            <p className="text-xs text-gray-500 mb-3">
                              {sharedLabel
                                ? "Enter the wallet address that created/minted the NFTs. This scans by creator, so it finds NFTs even after they've been sold or transferred."
                                : "Optionally enter a wallet address to only import NFTs owned by that wallet. Useful for large collections."
                              }
                            </p>
                            <input type="text" value={ethOwnerAddress} onChange={(e) => setEthOwnerAddress(e.target.value)} placeholder={sharedLabel ? "0x... (creator wallet address)" : "0x... (owner wallet address)"}
                              className={`w-full bg-black/30 border rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none transition font-mono text-sm ${
                                sharedLabel ? "border-amber-500/30 focus:border-amber-500/50" : "border-white/10 focus:border-purple-500/50"
                              }`} />
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </>
            )}

            {/* ── Voi-specific inputs ── */}
            {sourceChain === "voi" && (
              <>
                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Contract ID (Application ID)</label>
                  <p className="text-xs text-gray-500 mb-3">
                    Voi uses <span className="text-green-400 font-medium">ARC-72</span> smart contract NFTs (similar to ERC-721).
                    Each collection is an application deployed on the Voi network. Enter the Application ID to scan all NFTs in that collection.
                    Metadata is stored on-chain via tokenURI, typically pointing to IPFS.
                  </p>
                  <input type="text" value={voiContractId} onChange={(e) => setVoiContractId(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 29105999"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition font-mono text-sm" />
                  <p className="text-xxs text-gray-600 mt-2">
                    Powered by <a href="https://voi-mainnet-mimirapi.nftnavigator.xyz" target="_blank" rel="noreferrer" className="text-green-400 hover:underline">Mimir API</a> — free, no API key required
                  </p>
                </div>

                <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                  <label className="block text-sm font-semibold text-gray-300 mb-2">Download ARC-69 Traits CSV</label>
                  <p className="text-xs text-gray-500 mb-3">
                    Enter a Creator Address or Contract ID to fetch metadata traits and download a CSV formatted for the <span className="text-orange-400 font-semibold">ARC-69 Collection Mint</span>.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input type="text" value={voiTraitInput} onChange={(e) => setVoiTraitInput(e.target.value)} placeholder="Creator Address or Application ID"
                      className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-green-500/50 transition text-sm font-mono" />
                    <button onClick={handleDownloadVoiTraitsCsv} disabled={isGeneratingCsv}
                      className="px-5 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-semibold rounded-xl text-sm transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2">
                      {isGeneratingCsv ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download CSV
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Range Index Filter (shared) */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-2">Import Range (Indices)</label>
              <p className="text-xs text-gray-500 mb-3">Specify a range of NFTs to load from the filtered list. Pera Wallet has a maximum signing limit of around 500 transactions.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xxs text-gray-500 uppercase font-bold mb-1">Start Index</label>
                  <input type="number" min="0" value={startIndex} onChange={(e) => setStartIndex(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 0"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500/50 transition text-sm font-mono" />
                </div>
                <div>
                  <label className="block text-xxs text-gray-500 uppercase font-bold mb-1">End Index (Exclusive)</label>
                  <input type="number" min="0" value={endIndex} onChange={(e) => setEndIndex(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 500"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500/50 transition text-sm font-mono" />
                </div>
              </div>
            </div>

            {/* ARC Format */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-2">Algorand ARC Standard</label>
              <p className="text-xs text-gray-500 mb-3">Choose how your NFTs will be formatted on Algorand.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(["ARC19", "ARC3", "ARC69"] as AlgorandARC[]).map((arc) => (
                  <button key={arc} onClick={() => setArcFormat(arc)}
                    className={`p-4 rounded-xl text-left transition-all ${arcFormat === arc
                        ? "bg-orange-500/15 border-2 border-orange-500 shadow-lg shadow-orange-500/10"
                        : "bg-white/5 border border-white/10 hover:border-white/20"
                      }`}>
                    <div className="font-bold text-sm mb-1">{arc}</div>
                    <div className="text-xxs text-gray-400 leading-relaxed">
                      {arc === "ARC3" && "Immutable. Metadata on IPFS. Best for permanent art."}
                      {arc === "ARC19" && "Mutable. Uses reserve address for IPFS pointer. Recommended."}
                      {arc === "ARC69" && "On-chain metadata in note field. Media URL in asset URL."}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Collection Unit Name */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-2">Collection Unit Name Prefix <span className="text-gray-500 font-normal">(optional)</span></label>
              <p className="text-xs text-gray-500 mb-3">Specify the base Unit Name. We will append the sequential number based on the range (e.g. DORK1, DORK2).</p>
              <input type="text" value={collectionName} onChange={(e) => setCollectionName(e.target.value)} placeholder="e.g. DORK" maxLength={8}
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 transition text-sm" />
              <p className="text-xxs text-gray-600 mt-1">Max 8 characters, alphanumeric</p>
            </div>

            {/* Scan Button */}
            <div className="flex justify-center pt-2">
              <button onClick={handleScan}
                className="px-8 py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 text-sm">
                🔍 Scan {chainLabel} for NFTs
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Scanning / Resolving ── */}
        {(step === "scanning" || step === "resolving") && (
          <div className="max-w-lg mx-auto text-center animate-fadeIn">
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-10">
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 border-4 border-orange-500/20 rounded-full" />
                <div className="absolute inset-0 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
                <div className="absolute inset-3 border-4 border-amber-400/30 border-b-transparent rounded-full animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
              </div>
              {step === "scanning" ? (
                <>
                  <h3 className="text-lg font-bold mb-2">Scanning {chainLabel}...</h3>
                  <p className="text-gray-400 text-sm">Found {scanProgress} NFTs so far</p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold mb-2">Resolving Metadata...</h3>
                  <p className="text-gray-400 text-sm mb-4">Fetching metadata for each NFT</p>
                  <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300 rounded-full"
                      style={{ width: resolveProgress.total ? `${(resolveProgress.done / resolveProgress.total) * 100}%` : "0%" }} />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">{resolveProgress.done} / {resolveProgress.total}</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Step: Preview ── */}
        {step === "preview" && (
          <div className="animate-fadeIn space-y-6">
            {/* Collection Summary Panel */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 text-left">
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Source</span>
                <p className="text-sm font-bold text-orange-400">{chainEmoji} {chainLabel}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">
                  {sourceChain === "xrpl" ? "Address / Taxon" : sourceChain === "cardano" ? "Policy ID" : sourceChain === "voi" ? "Contract ID" : "Contract"}
                </span>
                <p className="text-sm font-mono text-gray-300 truncate" title={sourceChain === "xrpl" ? xrpAddress : sourceChain === "cardano" ? cardanoPolicyId : sourceChain === "voi" ? voiContractId : ethContractAddress}>
                  {sourceChain === "xrpl" && (taxonId.trim() !== "" ? `Taxon: ${taxonId}` : xrpAddress.slice(0, 16) + "…")}
                  {sourceChain === "cardano" && (cardanoPolicyId.slice(0, 16) + "…")}
                  {sourceChain === "ethereum" && (ethContractAddress.slice(0, 16) + "…")}
                  {sourceChain === "voi" && `App ID: ${voiContractId}`}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Total Scanned</span>
                <p className="text-sm font-bold text-gray-300">{totalScanned} NFTs</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Loaded Range</span>
                <p className="text-sm font-bold text-blue-400 font-mono">Index {startIndex} to {parseInt(startIndex, 10) + unifiedNFTs.length}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Selected / Loaded</span>
                <p className="text-sm font-bold text-amber-300">{selectedNFTs.size} of {unifiedNFTs.filter(n => n.metadataResolved || n.imageResolved).length} Ok</p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">{selectedNFTs.size} selected</span>
                <button onClick={handleSelectAll} className="text-xs text-orange-400 hover:text-orange-300 underline">Select All</button>
                <button onClick={handleDeselectAll} className="text-xs text-gray-400 hover:text-gray-300 underline">Deselect All</button>
              </div>
              <div className="flex items-center gap-3">
                <input type="text" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="Filter by name..."
                  className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 w-48" />
                <button onClick={() => setStep("input")} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-400 hover:border-white/20 transition">← Back</button>
              </div>
            </div>

            {/* NFT Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-8">
              {filteredNFTs.map((nft) => {
                const isSelected = selectedNFTs.has(nft.id);
                const isValid = nft.metadataResolved || nft.imageResolved;
                return (
                  <div key={nft.id} onClick={() => isValid && handleToggleNFT(nft.id)}
                    className={`relative rounded-xl overflow-hidden transition-all cursor-pointer group ${!isValid ? "opacity-40 cursor-not-allowed bg-red-950/10 border border-red-900/20"
                        : isSelected ? "ring-2 ring-orange-500 shadow-lg shadow-orange-500/20"
                          : "ring-1 ring-white/10 hover:ring-white/20"
                      }`}>
                    {isValid && (
                      <div className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${isSelected ? "bg-orange-500 text-white" : "bg-black/50 border border-white/20 text-transparent group-hover:border-white/40"
                        }`}>✓</div>
                    )}
                    <div className="aspect-square bg-white/5 overflow-hidden">
                      {nft.imageResolved ? (
                        <img src={resolveDisplayUri(nft.image, nft._eth?.contract_address)} alt={nft.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23222' width='200' height='200'/%3E%3Ctext x='50%25' y='50%25' fill='%23666' text-anchor='middle' dy='.3em' font-size='14'%3ENo Image%3C/text%3E%3C/svg%3E"; }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">No Image</div>
                      )}
                    </div>
                    <div className="p-3 bg-black/40">
                      <div className="text-xs font-semibold truncate">{nft.name}</div>
                      <div className="text-xxs text-gray-500 mt-0.5 truncate flex items-center justify-between">
                        <span>{nft.serialOrId}</span>
                        <span className="bg-white/5 px-1 py-0.2 rounded">{nft.collectionTag}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredNFTs.length === 0 && <div className="text-center py-12 text-gray-500">No NFTs match your filter.</div>}

            {/* ARC format reminder & Mint button */}
            <div className="flex flex-col items-center gap-4 mt-6">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>Minting as</span>
                <span className="px-3 py-1 bg-orange-500/15 border border-orange-500/30 rounded-lg font-bold text-orange-400">{arcFormat}</span>
                <span>on Algorand</span>
              </div>
              <label className="flex flex-col sm:flex-row items-center gap-2 text-sm text-gray-300 cursor-pointer bg-white/5 border border-white/10 rounded-xl px-4 py-2 hover:border-white/20 transition-all select-none">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={preserveMintOrder}
                    onChange={(e) => setPreserveMintOrder(e.target.checked)}
                    className="rounded border-white/10 bg-black/30 text-orange-500 focus:ring-orange-500/50 cursor-pointer h-4 w-4"
                  />
                  <span className="font-semibold text-orange-400">Preserve Mint Order (Strict Confirmation)</span>
                </div>
                <span className="text-xxs text-gray-400">
                  ⚠️ Slow: Waits for each block confirmation (~3s per NFT) to guarantee ID order. Uncheck for fast parallel import.
                </span>
              </label>
              {!activeAddress ? (
                <ConnectButton />
              ) : (
                <button onClick={handleMint} disabled={selectedNFTs.size === 0}
                  className="px-10 py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 text-sm">
                  🚀 Import {selectedNFTs.size} NFT{selectedNFTs.size !== 1 ? "s" : ""} to Algorand
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Step: Minting ── */}
        {step === "minting" && (
          <div className="max-w-lg mx-auto text-center animate-fadeIn">
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-10">
              <div className="relative w-20 h-20 mx-auto mb-6">
                <div className="absolute inset-0 border-4 border-orange-500/20 rounded-full" />
                <div className="absolute inset-0 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
              </div>
              <h3 className="text-lg font-bold mb-2">Importing to Algorand...</h3>
              <p className="text-gray-400 text-sm mb-4">Preparing import transactions</p>
              <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-500 rounded-full"
                  style={{ width: mintProgress.total ? `${(mintProgress.done / mintProgress.total) * 100}%` : "0%" }} />
              </div>
              <p className="text-xs text-gray-500 mt-2">{mintProgress.done} / {mintProgress.total} prepared</p>
              <p className="text-xxs text-gray-600 mt-4">Please approve transactions in your wallet when prompted</p>
            </div>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === "done" && (
          <div className="max-w-lg mx-auto text-center animate-fadeIn">
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-10">
              <div className="w-16 h-16 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Import Complete!</h3>
              <p className="text-gray-400 text-sm mb-6">Successfully imported {mintedAssets.length} NFTs to Algorand!</p>
              {mintedAssets.length > 0 && (
                <div className="bg-black/30 border border-white/10 rounded-xl p-4 mb-6 text-left max-h-60 overflow-y-auto">
                  <span className="text-xs text-gray-500 block mb-2 font-semibold">Created Asset IDs:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                    {mintedAssets.map((assetId) => {
                      const isTestnet = activeNetwork === "testnet";
                      const explorerBase = isTestnet ? "https://testnet.explorer.perawallet.app/asset/" : "https://explorer.perawallet.app/asset/";
                      return (
                        <a key={assetId} href={`${explorerBase}${assetId}`} target="_blank" rel="noreferrer" className="text-orange-400 hover:text-orange-300 underline flex items-center gap-1">
                          <span>{assetId}</span>
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={() => {
                  setStep("input");
                  setUnifiedNFTs([]);
                  setSelectedNFTs(new Set());
                  setMintedAssets([]);
                  setTotalScanned(0);
                  const size = unifiedNFTs.length || 500;
                  const nextStart = parseInt(startIndex, 10) + size;
                  setStartIndex(String(nextStart));
                  setEndIndex(String(nextStart + size));
                }}
                  className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold rounded-xl transition text-sm shadow-md"
                  title="Move to the next range batch for this collection">
                  Next Batch Range
                </button>
                <button onClick={() => {
                  setStep("input");
                  setXrpAddress(""); setTaxonId(""); setCardanoPolicyId(""); setEthContractAddress(""); setEthOwnerAddress(""); setAlchemyApiKey((import.meta.env.VITE_ALCHEMY_API_KEY as string) || ""); setVoiContractId("");
                  setStartIndex("0"); setEndIndex("500");
                  setUnifiedNFTs([]); setSelectedNFTs(new Set()); setMintedAssets([]); setTotalScanned(0);
                }}
                  className="px-6 py-2.5 bg-white/5 border border-white/10 hover:border-white/20 text-gray-300 hover:text-white font-bold rounded-xl transition text-sm shadow-md">
                  Start New Import
                </button>
              </div>
            </div>
          </div>
        )}

        <FaqSectionComponent
          faqData={[
            {
              question: "How does the NFT Import Tool work?",
              answer:
                "The tool scans an issuer/policy/contract on the source chain, resolves metadata from IPFS or HTTP URLs, and allows you to re-mint them directly on Algorand following ARC-3, ARC-19, or ARC-69 standards.",
            },
            {
              question: "What chains and standards are supported?",
              answer:
                "XRPL: Uses Taxon IDs as the collection filter. Cardano (ADA): Uses Policy IDs as the collection identifier, supports both CIP-25 (immutable metadata in minting tx) and CIP-68 (mutable datum metadata with reference NFTs). Ethereum (ETH): Uses Contract Addresses, supports ERC-721 (unique tokens) and ERC-1155 (multi-tokens). Voi: Uses Contract IDs (Application IDs), supports ARC-72 smart contract NFTs (similar to ERC-721 but on AVM).",
            },
            {
              question: "What is a Taxon ID (XRPL)?",
              answer:
                "On the XRP Ledger, a Taxon is a 32-bit unsigned integer that issuers use to categorize different collections under a single account. Entering a Taxon ID lets you import a specific collection instead of all assets under that issuer address.",
            },
            {
              question: "What is a Policy ID (Cardano)?",
              answer:
                "On Cardano, a Policy ID is a 56-character hex string (blake2b-224 hash) of the minting policy script. All tokens minted under the same policy belong to the same collection. CIP-25 NFTs have immutable metadata stored in the minting transaction. CIP-68 NFTs can have mutable metadata stored in UTXO datums.",
            },
            {
              question: "What is a Contract Address (Ethereum)?",
              answer:
                "On Ethereum, NFT collections are deployed as smart contracts (ERC-721 or ERC-1155). The contract address uniquely identifies the collection. ERC-721 tokens are unique 1-of-1 assets. ERC-1155 allows both fungible and non-fungible tokens in the same contract. Metadata mutability depends on whether the tokenURI points to IPFS (immutable) or an HTTP server (mutable).",
            },
            {
              question: "What is a Contract ID (Voi)?",
              answer:
                "Voi is an AVM-based blockchain (Algorand fork) that uses ARC-72 for NFTs — a smart contract standard similar to Ethereum's ERC-721 but running on the AVM. Each collection is deployed as an application (smart contract), and the Application ID serves as the collection identifier. ARC-72 NFTs don't require opt-in to receive, and metadata is stored on-chain via tokenURI, typically pointing to IPFS. Note: ARC-200 is Voi's fungible token standard (like ERC-20), not for NFTs.",
            },
            {
              question: "Do I need API keys?",
              answer:
                "XRPL, Cardano, and Voi scanning require no API keys. Cardano uses the free Koios API (5,000 requests/day). Voi uses the free Mimir API with no documented rate limit. Ethereum requires a free Alchemy API key (sign up at dashboard.alchemy.com – 30M compute units/month). Your key stays in your browser and is never stored on our servers.",
            },
            {
              question: "What are ARC-3, ARC-19, and ARC-69?",
              answer:
                "These are Algorand's NFT standards. ARC-3 stores immutable metadata on IPFS. ARC-19 uses the reserve address field to point to IPFS metadata (mutable by updating the reserve). ARC-69 stores metadata on-chain in the transaction note field with the media URL in the asset URL.",
            },
          ]}
        />
      </div>
    </div>
  );
}
