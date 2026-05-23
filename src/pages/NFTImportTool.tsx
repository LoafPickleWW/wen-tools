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
  resolveUri,
  XRPL_MAINNET_ENDPOINT,
  XRPL_TESTNET_ENDPOINT,
  type ResolvedNFTMetadata,
  type AlgorandARC,
} from "../utils/xrplImport";
import {
  createARC3AssetMintArrayV2,
  createARC19AssetMintArrayV2,
  createAssetMintArrayV2,
  sliceIntoChunks,
  walletSign,
  pinImageToPinata,
  pinJSONToPinata,
} from "../utils";
import { pinImageToCrust, pinJSONToCrust } from "../crust";
import { TOOLS } from "../constants";
import FaqSectionComponent from "../components/FaqSectionComponent";

type ImportStep = "input" | "scanning" | "resolving" | "preview" | "minting" | "done";

const TOOL_META = TOOLS.find((t) => t.id === "nft_import") || {
  label: "NFT Import Tool",
  description: "Import NFTs from other chains (XRP Ledger) and mint them on Algorand.",
};

export function NFTImportTool() {
  const { activeAddress, algodClient, transactionSigner, activeNetwork } = useWallet();

  // ── Step state ──
  const [step, setStep] = useState<ImportStep>("input");

  // ── Input state ──
  const [sourceChain] = useState<"xrpl">("xrpl"); // extensible later
  const [xrpAddress, setXrpAddress] = useState("");
  const [taxonId, setTaxonId] = useState(""); // optional Taxon ID filter
  const [startIndex, setStartIndex] = useState("0");
  const [endIndex, setEndIndex] = useState("500");
  const [arcFormat, setArcFormat] = useState<AlgorandARC>("ARC19");
  const [collectionName, setCollectionName] = useState("");
  const [pinningProvider, setPinningProvider] = useState<"crust" | "pinata">("crust");
  const [pinataToken, setPinataToken] = useState("");
  const [xrplNetwork, setXrplNetwork] = useState<"mainnet" | "testnet">("mainnet");

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
  const [totalScanned, setTotalScanned] = useState(0); // overall found on issuer before taxon filtering
  const [resolveProgress, setResolveProgress] = useState({ done: 0, total: 0 });

  // ── Preview state ──
  const [resolvedNFTs, setResolvedNFTs] = useState<ResolvedNFTMetadata[]>([]);
  const [selectedNFTs, setSelectedNFTs] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState("");

  // ── Mint state ──
  const [mintProgress, setMintProgress] = useState({ done: 0, total: 0 });
  const [mintedAssets, setMintedAssets] = useState<number[]>([]);

  const abortRef = useRef(false);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleScan = useCallback(async () => {
    if (!xrpAddress.trim()) {
      toast.error("Please enter an XRP wallet address");
      return;
    }
    if (!isValidXRPAddress(xrpAddress.trim())) {
      toast.error("Invalid XRP address format. Addresses start with 'r'.");
      return;
    }

    abortRef.current = false;
    setStep("scanning");
    setScanProgress(0);
    setResolvedNFTs([]);
    setSelectedNFTs(new Set());
    setTotalScanned(0);

    try {
      toast.info("Scanning XRPL for NFTs...");
      const endpoint = xrplNetwork === "testnet" ? XRPL_TESTNET_ENDPOINT : XRPL_MAINNET_ENDPOINT;

      const nfts = await fetchNFTsByIssuer(xrpAddress.trim(), (count) => {
        setScanProgress(count);
      }, endpoint);

      if (nfts.length === 0) {
        toast.warning("No NFTs found for this address");
        setStep("input");
        return;
      }

      setTotalScanned(nfts.length);

      // Filter by Taxon ID if provided
      let filteredNfts = nfts;
      if (taxonId.trim() !== "") {
        const taxonNum = parseInt(taxonId.trim(), 10);
        if (!isNaN(taxonNum)) {
          filteredNfts = nfts.filter((nft) => nft.nft_taxon === taxonNum);
        }
      }

      if (filteredNfts.length === 0) {
        toast.warning(`No NFTs found matching Taxon ID ${taxonId}`);
        setStep("input");
        return;
      }

      // Apply Index Slicing (Start/End Range)
      const start = Math.max(0, parseInt(startIndex, 10) || 0);
      const end = endIndex.trim() !== "" ? Math.max(start, parseInt(endIndex, 10)) : filteredNfts.length;
      const slicedNfts = filteredNfts.slice(start, end);

      if (slicedNfts.length === 0) {
        toast.warning(`No NFTs found within range ${start} to ${end}`);
        setStep("input");
        return;
      }

      toast.info(`Found ${filteredNfts.length} matching NFTs. Resolving metadata for range ${start} to ${start + slicedNfts.length}...`);
      setStep("resolving");
      setResolveProgress({ done: 0, total: slicedNfts.length });

      const resolved = await resolveAllMetadata(slicedNfts, 5, (done, total) => {
        setResolveProgress({ done, total });
      });

      setResolvedNFTs(resolved);
      setSelectedNFTs(new Set(resolved.filter((n) => n.metadataResolved || n.imageResolved).map((n) => n.nft_id)));
      setStep("preview");

      const successCount = resolved.filter((n) => n.metadataResolved || n.imageResolved).length;
      toast.success(`Loaded ${successCount} NFTs (range ${start} to ${start + slicedNfts.length})`);
    } catch (err: any) {
      console.error(err);
      let errMsg = err.message || "Failed to scan XRPL";
      if (errMsg.includes("Account not found")) {
        errMsg = "Account not found. Please verify the address and check if you are on the correct network (Mainnet vs Testnet).";
      }
      toast.error(errMsg);
      setStep("input");
    }
  }, [xrpAddress, taxonId, startIndex, endIndex, xrplNetwork]);

  const handleToggleNFT = useCallback((nftId: string) => {
    setSelectedNFTs((prev) => {
      const next = new Set(prev);
      if (next.has(nftId)) next.delete(nftId);
      else next.add(nftId);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const validIds = resolvedNFTs
      .filter((n) => n.metadataResolved || n.imageResolved)
      .map((n) => n.nft_id);
    setSelectedNFTs(new Set(validIds));
  }, [resolvedNFTs]);

  const handleDeselectAll = useCallback(() => {
    setSelectedNFTs(new Set());
  }, []);

  const handleMint = useCallback(async () => {
    if (!activeAddress) {
      toast.error("Please connect your Algorand wallet");
      return;
    }
    if (selectedNFTs.size === 0) {
      toast.error("No NFTs selected for import");
      return;
    }
    if (pinningProvider === "pinata" && !pinataToken.trim()) {
      toast.error("Please enter your Pinata API token");
      return;
    }

    const toMint = resolvedNFTs.filter((n) => selectedNFTs.has(n.nft_id));
    setStep("minting");
    setMintProgress({ done: 0, total: toMint.length });
    setMintedAssets([]);
    abortRef.current = false;

    try {
      // Build mint data based on selected ARC format
      const mintDataArray: any[] = [];

      for (let i = 0; i < toMint.length; i++) {
        if (abortRef.current) break;
        const nft = toMint[i];

        // First, re-pin the image to IPFS (so it's on Algorand-accessible pinning)
        let imageCid = nft.imageIpfsCid;

        if (nft.image && !imageCid) {
          // Need to fetch and re-pin the image
          try {
            toast.info(`Fetching image for ${nft.name}...`, { autoClose: 1000 });
            const imageResp = await fetch(resolveUri(nft.image));
            const imageBlob = await imageResp.blob();
            const imageFile = new File([imageBlob], `${nft.nft_serial}.png`, {
              type: imageBlob.type || "image/png",
            });

            if (pinningProvider === "pinata") {
              imageCid = await pinImageToPinata(pinataToken, imageFile);
            } else {
              let authBasic = localStorage.getItem("authBasic");
              if (!authBasic) {
                authBasic = "YWxnby1CQ0FQV0pBTFdBM04zRUlaUkZDTzU1UFEzWUJZQ1NHUFpYTkRIT09BNlI3Q0dIVElTVjJHQ1NZQzZZOkZyYjl6RWhudVVKZ0ZaY0d1cmRTUE45dW1SL1hHMnRlalc0VFpkb3huN3ZXMTVKOFd6TGMva3R2LytnMklWRVFRMVN4Vnk3N0plZ3laZkVKMkRxaEFRPT0=";
                localStorage.setItem("authBasic", authBasic);
              }
              // For crust, we use the existing crust pinning
              imageCid = await pinImageToCrust(authBasic, imageFile);
            }
          } catch (err) {
            console.warn(`Failed to re-pin image for ${nft.name}`, err);
            // Use original image URL as fallback
          }
        }

        const imageUrl = imageCid ? `ipfs://${imageCid}` : nft.image;

        // Update the NFT image reference
        const updatedNft = { ...nft, image: imageUrl, imageIpfsCid: imageCid || "" };

        if (arcFormat === "ARC69") {
          const data = formatAsARC69(updatedNft, collectionName);
          mintDataArray.push(data);
        } else if (arcFormat === "ARC3") {
          const { mintData, metadataJson } = formatAsARC3(updatedNft, collectionName);
          // Pin metadata JSON to IPFS
          let metadataCid: string;
          if (pinningProvider === "pinata") {
            metadataCid = await pinJSONToPinata(pinataToken, JSON.stringify(metadataJson));
          } else {
            let authBasic = localStorage.getItem("authBasic");
            if (!authBasic) {
              authBasic = "YWxnby1CQ0FQV0pBTFdBM04zRUlaUkZDTzU1UFEzWUJZQ1NHUFpYTkRIT09BNlI3Q0dIVElTVjJHQ1NZQzZZOkZyYjl6RWhudVVKZ0ZaY0d1cmRTUE45dW1SL1hHMnRlalc0VFpkb3huN3ZXMTVKOFd6TGMva3R2LytnMklWRVFRMVN4Vnk3N0plZ3laZkVKMkRxaEFRPT0=";
              localStorage.setItem("authBasic", authBasic);
            }
            metadataCid = await pinJSONToCrust(authBasic, JSON.stringify(metadataJson));
          }
          mintData.asset_url = `ipfs://${metadataCid}#arc3`;
          mintDataArray.push(mintData);
        } else {
          // ARC19
          const { mintData, metadataJson } = formatAsARC19(updatedNft, collectionName);
          mintData.ipfs_data = metadataJson;
          mintDataArray.push(mintData);
        }

        setMintProgress({ done: i + 1, total: toMint.length });
        toast.info(`Prepared ${i + 1}/${toMint.length}: ${nft.name}`, {
          autoClose: 500,
        });
      }

      if (abortRef.current) {
        setStep("preview");
        return;
      }

      // Batch mint in groups of 16 (Algorand atomic txn limit)
      const chunks = sliceIntoChunks(mintDataArray, 16);
      const allCreatedIds: number[] = [];

      for (let c = 0; c < chunks.length; c++) {
        toast.info(`Signing batch ${c + 1} of ${chunks.length}...`);

        let result: any;
        if (arcFormat === "ARC69") {
          result = await createAssetMintArrayV2(
            chunks[c],
            activeAddress,
            algodClient,
            transactionSigner
          );
        } else if (arcFormat === "ARC3") {
          result = await createARC3AssetMintArrayV2(
            chunks[c],
            activeAddress,
            algodClient,
            transactionSigner
          );
        } else {
          result = await createARC19AssetMintArrayV2(
            chunks[c],
            activeAddress,
            algodClient,
            transactionSigner
          );
        }

        // Sign and submit
        const signedTxns = await walletSign(
          result.atc.buildGroup().map((t: any) => t.txn),
          transactionSigner
        );

        // Submit in groups
        const txnChunks = sliceIntoChunks(Array.from(signedTxns), 4);
        for (const txnChunk of txnChunks) {
          try {
            const { txid } = await algodClient.sendRawTransaction(txnChunk).do();
            const confirmed = await algosdk.waitForConfirmation(algodClient, txid, 4);
            if (confirmed["asset-index"]) {
              allCreatedIds.push(confirmed["asset-index"]);
            }
          } catch (err) {
            console.warn("Txn submission error (may be partial success):", err);
          }
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
  }, [
    activeAddress,
    algodClient,
    transactionSigner,
    selectedNFTs,
    resolvedNFTs,
    arcFormat,
    collectionName,
    pinningProvider,
    pinataToken,
  ]);

  // ─── Filtering ─────────────────────────────────────────────────────────────

  const filteredNFTs = resolvedNFTs.filter((nft) => {
    if (!searchFilter) return true;
    const q = searchFilter.toLowerCase();
    return (
      nft.name.toLowerCase().includes(q) ||
      nft.nft_id.toLowerCase().includes(q) ||
      nft.description.toLowerCase().includes(q)
    );
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="pb-20 pt-2 text-white flex flex-col items-center min-h-screen w-full">
      <Meta
        title={TOOL_META.label}
        description={TOOL_META.description}
      />

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
            Import your NFTs from other blockchains (XRP Ledger) and re-mint them on Algorand.
            Scans metadata & IPFS images, then formats to your chosen ARC standard.
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
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                    isActive
                      ? "bg-orange-500 text-white shadow-lg shadow-orange-500/30"
                      : isPast
                        ? "bg-orange-500/30 text-orange-300 border border-orange-500/40"
                        : "bg-white/5 text-gray-500 border border-white/10"
                  }`}
                >
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
            {/* Source Chain */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-3">Source Chain</label>
              <div className="flex flex-wrap gap-3">
                <button
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all ${
                    sourceChain === "xrpl"
                      ? "bg-orange-500/20 border-2 border-orange-500 text-orange-400"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                  }`}
                >
                  <span className="text-lg">💧</span> XRP Ledger
                </button>
                <button
                  disabled
                  className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold bg-white/5 border border-white/10 text-gray-600 cursor-not-allowed opacity-50"
                  title="Coming soon"
                >
                  <span className="text-lg">⟠</span> Ethereum
                  <span className="text-xxs bg-white/10 px-2 py-0.5 rounded-full">Soon</span>
                </button>
              </div>
            </div>

            {/* Source Network */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 animate-fadeIn">
              <label className="block text-sm font-semibold text-gray-300 mb-3">Source Network</label>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setXrplNetwork("mainnet")}
                  className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${
                    xrplNetwork === "mainnet"
                      ? "bg-orange-500/20 border-2 border-orange-500 text-orange-400"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                  }`}
                >
                  Mainnet
                </button>
                <button
                  onClick={() => setXrplNetwork("testnet")}
                  className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${
                    xrplNetwork === "testnet"
                      ? "bg-orange-500/20 border-2 border-orange-500 text-orange-400"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                  }`}
                >
                  Testnet
                </button>
              </div>
            </div>

            {/* XRP Address */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                XRP Creator / Owner Wallet Address
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Enter the XRPL address that issued or holds the NFTs you want to import.
              </p>
              <input
                type="text"
                value={xrpAddress}
                onChange={(e) => setXrpAddress(e.target.value)}
                placeholder="rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 transition font-mono text-sm"
              />
            </div>

            {/* Taxon ID Filter */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                Taxon ID <span className="text-gray-500 font-normal">(optional collection filter)</span>
              </label>
              <p className="text-xs text-gray-500 mb-3">
                XRPL uses Taxon IDs to group NFTs into collections under an issuer. Enter a taxon ID to only import that collection.
              </p>
              <input
                type="text"
                value={taxonId}
                onChange={(e) => setTaxonId(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="e.g. 0"
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 transition text-sm"
              />
            </div>

            {/* Range Index Filter */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                Import Range (Indices)
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Specify a range of NFTs to load from the filtered list. Pera Wallet has a maximum signing limit of around 500 transactions.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xxs text-gray-500 uppercase font-bold mb-1">Start Index</label>
                  <input
                    type="number"
                    min="0"
                    value={startIndex}
                    onChange={(e) => setStartIndex(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="e.g. 0"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500/50 transition text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xxs text-gray-500 uppercase font-bold mb-1">End Index (Exclusive)</label>
                  <input
                    type="number"
                    min="0"
                    value={endIndex}
                    onChange={(e) => setEndIndex(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="e.g. 500"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500/50 transition text-sm font-mono"
                  />
                </div>
              </div>
            </div>

            {/* ARC Format */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                Algorand ARC Standard
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Choose how your NFTs will be formatted on Algorand.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(["ARC19", "ARC3", "ARC69"] as AlgorandARC[]).map((arc) => (
                  <button
                    key={arc}
                    onClick={() => setArcFormat(arc)}
                    className={`p-4 rounded-xl text-left transition-all ${
                      arcFormat === arc
                        ? "bg-orange-500/15 border-2 border-orange-500 shadow-lg shadow-orange-500/10"
                        : "bg-white/5 border border-white/10 hover:border-white/20"
                    }`}
                  >
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

            {/* Collection Name */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                Collection Name <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Used as the unit name prefix for all imported NFTs.
              </p>
              <input
                type="text"
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                placeholder="e.g. MYXRPNFT"
                maxLength={8}
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 transition text-sm"
              />
              <p className="text-xxs text-gray-600 mt-1">Max 8 characters, alphanumeric</p>
            </div>

            {/* IPFS Provider */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
              <label className="block text-sm font-semibold text-gray-300 mb-2">
                IPFS Pinning Provider
              </label>
              <div className="flex flex-wrap gap-3 mb-3">
                <button
                  onClick={() => setPinningProvider("crust")}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                    pinningProvider === "crust"
                      ? "bg-orange-500/20 border border-orange-500 text-orange-400"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                  }`}
                >
                  Crust Network
                </button>
                <button
                  onClick={() => setPinningProvider("pinata")}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                    pinningProvider === "pinata"
                      ? "bg-orange-500/20 border border-orange-500 text-orange-400"
                      : "bg-white/5 border border-white/10 text-gray-400 hover:border-white/20"
                  }`}
                >
                  Pinata
                </button>
              </div>
              {pinningProvider === "pinata" && (
                <input
                  type="password"
                  value={pinataToken}
                  onChange={(e) => setPinataToken(e.target.value)}
                  placeholder="Pinata JWT Token"
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 transition text-sm"
                />
              )}
            </div>

            {/* Scan Button */}
            <div className="flex justify-center pt-2">
              <button
                onClick={handleScan}
                className="px-8 py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 text-sm"
              >
                🔍 Scan XRPL for NFTs
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
                  <h3 className="text-lg font-bold mb-2">Scanning XRPL...</h3>
                  <p className="text-gray-400 text-sm">Found {scanProgress} NFTs so far</p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold mb-2">Resolving Metadata...</h3>
                  <p className="text-gray-400 text-sm mb-4">
                    Fetching IPFS metadata for each NFT
                  </p>
                  <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300 rounded-full"
                      style={{
                        width: resolveProgress.total
                          ? `${(resolveProgress.done / resolveProgress.total) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {resolveProgress.done} / {resolveProgress.total}
                  </p>
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
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">XRP Address</span>
                <p className="text-sm font-mono text-gray-300 truncate" title={xrpAddress}>{xrpAddress}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Collection / Taxon Filter</span>
                <p className="text-sm font-bold text-orange-400 truncate">
                  {taxonId.trim() !== "" ? `Taxon: ${taxonId} (${xrplNetwork})` : `Show All (${xrplNetwork})`}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Total Scanned</span>
                <p className="text-sm font-bold text-gray-300">
                  {totalScanned} NFTs
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Loaded Range</span>
                <p className="text-sm font-bold text-blue-400 font-mono">
                  Index {startIndex} to {parseInt(startIndex, 10) + resolvedNFTs.length}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Selected / Loaded</span>
                <p className="text-sm font-bold text-amber-300">
                  {selectedNFTs.size} of {resolvedNFTs.filter(n => n.metadataResolved || n.imageResolved).length} Ok
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">
                  {selectedNFTs.size} selected
                </span>
                <button onClick={handleSelectAll} className="text-xs text-orange-400 hover:text-orange-300 underline">
                  Select All
                </button>
                <button onClick={handleDeselectAll} className="text-xs text-gray-400 hover:text-gray-300 underline">
                  Deselect All
                </button>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter by name..."
                  className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500/50 w-48"
                />
                <button
                  onClick={() => setStep("input")}
                  className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-400 hover:border-white/20 transition"
                >
                  ← Back
                </button>
              </div>
            </div>

            {/* NFT Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-8">
              {filteredNFTs.map((nft) => {
                const isSelected = selectedNFTs.has(nft.nft_id);
                const isValid = nft.metadataResolved || nft.imageResolved;
                return (
                  <div
                    key={nft.nft_id}
                    onClick={() => isValid && handleToggleNFT(nft.nft_id)}
                    className={`relative rounded-xl overflow-hidden transition-all cursor-pointer group ${
                      !isValid
                        ? "opacity-40 cursor-not-allowed bg-red-950/10 border border-red-900/20"
                        : isSelected
                          ? "ring-2 ring-orange-500 shadow-lg shadow-orange-500/20"
                          : "ring-1 ring-white/10 hover:ring-white/20"
                    }`}
                  >
                    {/* Selection indicator */}
                    {isValid && (
                      <div
                        className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                          isSelected
                            ? "bg-orange-500 text-white"
                            : "bg-black/50 border border-white/20 text-transparent group-hover:border-white/40"
                        }`}
                      >
                        ✓
                      </div>
                    )}

                    {/* Image */}
                    <div className="aspect-square bg-white/5 overflow-hidden">
                      {nft.imageResolved ? (
                        <img
                          src={nft.image}
                          alt={nft.name}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23222' width='200' height='200'/%3E%3Ctext x='50%25' y='50%25' fill='%23666' text-anchor='middle' dy='.3em' font-size='14'%3ENo Image%3C/text%3E%3C/svg%3E";
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                          No Image
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-3 bg-black/40">
                      <div className="text-xs font-semibold truncate">{nft.name}</div>
                      <div className="text-xxs text-gray-500 mt-0.5 truncate flex items-center justify-between">
                        <span>#{nft.nft_serial}</span>
                        <span className="bg-white/5 px-1 py-0.2 rounded">T: {nft.nft_taxon}</span>
                      </div>
                      {nft.error && (
                        <div className="text-xxs text-red-400 mt-1 truncate" title={nft.error}>
                          ⚠ {nft.error}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredNFTs.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No NFTs match your filter.
              </div>
            )}

            {/* ARC format reminder & Mint button */}
            <div className="flex flex-col items-center gap-4 mt-6">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>Minting as</span>
                <span className="px-3 py-1 bg-orange-500/15 border border-orange-500/30 rounded-lg font-bold text-orange-400">
                  {arcFormat}
                </span>
                <span>on Algorand</span>
              </div>

              {!activeAddress ? (
                <ConnectButton />
              ) : (
                <button
                  onClick={handleMint}
                  disabled={selectedNFTs.size === 0}
                  className="px-10 py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 text-sm"
                >
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
              <p className="text-gray-400 text-sm mb-4">
                Pinning assets and building transactions
              </p>
              <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-500 rounded-full"
                  style={{
                    width: mintProgress.total
                      ? `${(mintProgress.done / mintProgress.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {mintProgress.done} / {mintProgress.total} prepared
              </p>
              <p className="text-xxs text-gray-600 mt-4">
                Please approve transactions in your wallet when prompted
              </p>
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
              <p className="text-gray-400 text-sm mb-6">
                Successfully imported {mintedAssets.length} NFTs to Algorand!
              </p>

              {mintedAssets.length > 0 && (
                <div className="bg-black/30 border border-white/10 rounded-xl p-4 mb-6 text-left max-h-60 overflow-y-auto">
                  <span className="text-xs text-gray-500 block mb-2 font-semibold">Created Asset IDs:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                    {mintedAssets.map((assetId) => {
                      const isTestnet = activeNetwork === "testnet";
                      const explorerBase = isTestnet
                        ? "https://testnet.explorer.perawallet.app/asset/"
                        : "https://explorer.perawallet.app/asset/";
                      return (
                        <a
                          key={assetId}
                          href={`${explorerBase}${assetId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-orange-400 hover:text-orange-300 underline flex items-center gap-1"
                        >
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
                <button
                  onClick={() => {
                    setStep("input");
                    setResolvedNFTs([]);
                    setSelectedNFTs(new Set());
                    setMintedAssets([]);
                    setTotalScanned(0);
                    // Automatically shift range indices forward by the loaded batch size
                    const size = resolvedNFTs.length || 500;
                    const nextStart = parseInt(startIndex, 10) + size;
                    setStartIndex(String(nextStart));
                    setEndIndex(String(nextStart + size));
                  }}
                  className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold rounded-xl transition text-sm shadow-md"
                  title="Move to the next range batch for this collection"
                >
                  Next Batch Range
                </button>
                <button
                  onClick={() => {
                    setStep("input");
                    setXrpAddress("");
                    setTaxonId("");
                    setStartIndex("0");
                    setEndIndex("500");
                    setResolvedNFTs([]);
                    setSelectedNFTs(new Set());
                    setMintedAssets([]);
                    setTotalScanned(0);
                  }}
                  className="px-6 py-2.5 bg-white/5 border border-white/10 hover:border-white/20 text-gray-300 hover:text-white font-bold rounded-xl transition text-sm shadow-md"
                >
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
                "The tool scans an issuer address on the XRP Ledger, resolves metadata from IPFS or HTTP URLs, and allows you to re-mint them directly on Algorand following ARC-3, ARC-19, or ARC-69 standards.",
            },
            {
              question: "What is a Taxon ID?",
              answer:
                "On the XRP Ledger, a Taxon is a 32-bit unsigned integer that issuers use to categorize different collections under a single account. Entering a Taxon ID lets you import a specific collection instead of all assets under that issuer address.",
            },
            {
              question: "Why do I need to re-pin images?",
              answer:
                "To ensure that your newly minted Algorand assets are self-contained and stable, the tool downloads the original media files and re-pins them to your chosen IPFS provider (Crust or Pinata) so they don't depend on the original XRPL host.",
            },
          ]}
        />
      </div>
    </div>
  );
}
