import { useState } from "react";
import algosdk from "algosdk";
import Papa from "papaparse";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";

import {
  createAssetMintArray,
  sliceIntoChunks,
  SignWithSk,
  createARC3AssetMintArrayV2Batch,
  createARC19AssetMintArrayV2Batch,
  createARC3AssetMintArray,
  createARC19AssetMintArray,
  walletSign,
} from "../utils";
import IpfsProviderSelect from "../components/IpfsProviderSelect";
import { IpfsProvider } from "../types";
import { IPFS_ENDPOINT, MINT_FEE_PER_ASA } from "../constants";
import InfinityModeComponent from "../components/InfinityModeComponent";
import FaqSectionComponent from "../components/FaqSectionComponent";
import { isCrustAuth } from "../crust-auth";
import { PreviewAssetComponent } from "../components/PreviewAssetComponent";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

export function BatchMint() {
  const START_PROCESS = 0;
  const CREATE_TRANSACTIONS_PROCESS = 1;
  const SIGN_TRANSACTIONS_PROCESS = 2;
  const SENDING_TRANSACTIONS_PROCESS = 3;
  const COMPLETED = 4;

  const [formData, setFormData] = useState({
    collectionFormat: "ARC3", // ARC3, ARC19, ARC69
    pinningProvider: "crust", // crust, pinata, none
    sourceMode: "folder", // folder, csv

    // Folder Mode inputs
    name: "",
    unitName: "",
    mediaIPFSCID: "",
    mediaExtension: "",
    startIndex: "",
    endIndex: "",

    // Optional metadata defaults (for Folder Mode or fallback)
    externalUrl: "",
    description: "",
    creatorName: "",
    tokenId: "",
    royalty: "",

    // Token parameters
    freeze: false,
    clawback: false,
    defaultFrozen: false,

    // Pinning Creds
    pinataToken: "",
    filebaseToken: "",
  } as any);

  const [csvData, setCsvData] = useState(null as null | any);
  const [processStep, setProcessStep] = useState(START_PROCESS);
  const [mnemonic, setMnemonic] = useState("");
  const [assetTransactions, setAssetTransactions] = useState([] as algosdk.Transaction[][]);
  const [previewAsset, setPreviewAsset] = useState(null as any);

  const { activeAddress, algodClient, transactionSigner, activeWallet, activeNetwork } = useWallet();
  const isTestnet = activeNetwork === "testnet";
  const effectiveProvider = isTestnet
    ? (formData.pinningProvider === "crust" ? "pinata" : formData.pinningProvider)
    : formData.pinningProvider;

  const handleCsvUpload = (file: File) => {
    Papa.parse(file, {
      complete: function (results) {
        const filteredData = results.data.filter((row: any) => row[0] && row[0].length > 0);
        setCsvData(filteredData);
        toast.success(`CSV file parsed: ${filteredData.length - 1} rows found.`);
      },
      error: function (err) {
        console.error(err);
        toast.error("Failed to parse CSV file");
      }
    });
  };

  const getPinFeeText = () => {
    if (effectiveProvider === "none") {
      return "Free (No pinning service selected)";
    }
    if (effectiveProvider === "pinata") {
      return "Free (Uses your custom Pinata JWT)";
    }
    if (effectiveProvider === "filebase") {
      return "Free (Requires your custom Filebase API token)";
    }
    // Crust Network fees
    if (formData.collectionFormat === "ARC69") {
      return "1.4 ALGO per Asset (Crust Pinning)";
    }
    return "2.8 ALGO per Asset (Crust Pinning: Image + JSON)";
  };

  async function createTransactions() {
    try {
      if (!activeAddress) {
        toast.error("Please connect your wallet");
        return;
      }

      if (effectiveProvider === "crust" && !isCrustAuth()) {
        toast.error("Crust authentication is not complete. Please sign in via the wallet connect button.");
        return;
      }

      if (effectiveProvider === "pinata" && !formData.pinataToken) {
        toast.error("Please enter your Pinata JWT Token.");
        return;
      }

      if (effectiveProvider === "filebase" && !formData.filebaseToken) {
        toast.error("Please enter your Filebase API Token.");
        return;
      }

      if (formData.sourceMode === "csv" && !csvData) {
        toast.error("Please upload your metadata CSV file.");
        return;
      }

      if (formData.sourceMode === "folder") {
        if (!formData.startIndex || !formData.endIndex) {
          toast.error("Please enter start and end index values.");
          return;
        }
        if (parseInt(formData.startIndex) > parseInt(formData.endIndex)) {
          toast.error("End index must be greater than or equal to start index.");
          return;
        }
        if (!formData.mediaIPFSCID) {
          toast.error("Please enter the media folder IPFS CID.");
          return;
        }
        if (!formData.mediaExtension || !formData.mediaExtension.includes(".")) {
          toast.error("Please enter a valid media extension (e.g. .png, .jpg).");
          return;
        }
        if (!formData.name || !formData.unitName) {
          toast.error("Please enter collection Name and Unit Name.");
          return;
        }
      }

      const data: any[] = [];

      if (formData.sourceMode === "csv") {
        let headers: string[] = [];
        for (let i = 0; i < csvData.length; i++) {
          if (csvData[i].length <= 1) continue;
          if (i === 0) {
            headers = csvData[i].map((h: string) => h.trim());
          } else {
            const obj: any = {};
            for (let j = 0; j < headers.length; j++) {
              const header = headers[j];
              if (header.startsWith("metadata_")) {
                obj[header.replace("metadata_", "")] = csvData[i][j];
              } else {
                obj[header] = csvData[i][j];
              }
            }
            data.push(obj);
          }
        }
      } else {
        const start = parseInt(formData.startIndex);
        const end = parseInt(formData.endIndex);
        for (let i = start; i <= end; i++) {
          data.push({
            index: i,
            name: `${formData.name} ${i}`,
            unit_name: `${formData.unitName} ${i}`,
            image_ipfs_cid: `ipfs://${formData.mediaIPFSCID}/${i}${formData.mediaExtension}`,
            // Optional defaults
            description: formData.description,
            external_url: formData.externalUrl,
            creator: formData.creatorName,
            token_id: formData.tokenId,
            royalty: formData.royalty,
          });
        }
      }

      if (data.length === 0) {
        toast.error("No assets found to mint!");
        return;
      }

      // Check balance
      const accountInfo = await algodClient.accountInformation(activeAddress).exclude("all").do();
      const minBalance = accountInfo.amount - accountInfo["min-balance"] / 10 ** 6;
      
      let estimatedCostPerAsset = 0.1 + MINT_FEE_PER_ASA + 0.002; // network fee + site fee + tx fees
      if (effectiveProvider === "crust") {
        estimatedCostPerAsset += formData.collectionFormat === "ARC69" ? 1.4 : 2.8;
      }

      if (minBalance < estimatedCostPerAsset * data.length) {
        toast.error(`Insufficient balance. Estimated ALGO needed: ${(estimatedCostPerAsset * data.length).toFixed(2)} ALGO`);
        return;
      }

      setProcessStep(CREATE_TRANSACTIONS_PROCESS);

      const data_for_txns: any[] = [];
      data.forEach((item, index) => {
        const asset_name = item.name || `${formData.name} ${item.index || index}`;
        const unit_name = item.unit_name || `${formData.unitName} ${item.index || index}`;
        const has_clawback = (item.has_clawback === "Y" || formData.clawback) ? "Y" : "N";
        const has_freeze = (item.has_freeze === "Y" || formData.freeze) ? "Y" : "N";
        const default_frozen = (item.default_frozen === "Y" || formData.defaultFrozen) ? "Y" : "N";
        
        const decimals = item.decimals !== undefined ? parseInt(item.decimals) : 0;
        const total_supply = item.total_supply !== undefined ? parseInt(item.total_supply) : 1;

        // Determine image URL
        let image_url = "";
        if (item.image_ipfs_cid) {
          image_url = item.image_ipfs_cid.startsWith("ipfs://") ? item.image_ipfs_cid : "ipfs://" + item.image_ipfs_cid;
        } else if (item.url) {
          image_url = item.url;
        } else if (formData.mediaIPFSCID && item.index !== undefined) {
          image_url = `ipfs://${formData.mediaIPFSCID}/${item.index}${formData.mediaExtension || ".png"}`;
        }

        const ipfs_data: any = {
          name: asset_name,
          standard: formData.collectionFormat.toLowerCase(),
          image: image_url,
          properties: {
            traits: {},
            filters: {},
          },
          extra: {},
        };

        // Determine description and external url
        const desc = item.description || formData.description;
        if (desc) ipfs_data.description = desc;

        const extUrl = item.external_url || formData.externalUrl;
        if (extUrl) ipfs_data.external_url = extUrl;

        // Mime Type
        const ext = formData.mediaExtension || (image_url ? "." + image_url.split(".").pop() : "");
        const mime = getMimeType(ext);
        if (mime) ipfs_data.image_mime_type = mime;

        // Custom traits / extra details
        Object.keys(item).forEach((key) => {
          if (key.startsWith("property_")) {
            ipfs_data.properties.traits[key.replace("property_", "")] = item[key];
          } else if (key.startsWith("extra_")) {
            ipfs_data.extra[key.replace("extra_", "")] = item[key];
          } else if (key.startsWith("filters_")) {
            ipfs_data.properties.filters[key.replace("filters_", "")] = item[key];
          }
        });

        // Clean up empty fields
        if (Object.keys(ipfs_data.properties.traits).length === 0) delete ipfs_data.properties.traits;
        if (Object.keys(ipfs_data.properties.filters).length === 0) delete ipfs_data.properties.filters;
        if (Object.keys(ipfs_data.properties).length === 0) delete ipfs_data.properties;
        if (Object.keys(ipfs_data.extra).length === 0) delete ipfs_data.extra;

        if (formData.collectionFormat === "ARC69") {
          // ARC69 notes traits directly on properties
          if (ipfs_data.properties) {
            ipfs_data.properties = ipfs_data.properties.traits || ipfs_data.properties;
          }
        }

        const txn_item: any = {
          asset_name,
          unit_name,
          has_clawback,
          has_freeze,
          default_frozen,
          decimals,
          total_supply,
          ipfs_data,
        };

        if (formData.collectionFormat === "ARC69") {
          txn_item.asset_note = ipfs_data;
          txn_item.asset_url = image_url;
        }

        data_for_txns.push(txn_item);
      });

      setPreviewAsset(data_for_txns[0]);

      let unsignedAssetTransaction: algosdk.Transaction[][] = [];

      if (formData.collectionFormat === "ARC3") {
        if (effectiveProvider === "crust") {
          toast.info("Generating Crust-based ARC3 Transactions...");
          const { txnsArray } = await createARC3AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "crust",
            undefined,
            mnemonic
          );
          unsignedAssetTransaction = txnsArray;
        } else if (effectiveProvider === "filebase") {
          toast.info("Generating Filebase-based ARC3 Transactions...");
          const { txnsArray } = await createARC3AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "filebase",
            formData.filebaseToken,
            mnemonic
          );
          unsignedAssetTransaction = txnsArray;
        } else if (effectiveProvider === "pinata") {
          toast.info("Generating Pinata-based ARC3 Transactions...");
          const { txnsArray } = await createARC3AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "pinata",
            formData.pinataToken,
            mnemonic
          );
          unsignedAssetTransaction = txnsArray;
        } else {
          // None (no pinning, use direct URL/CID)
          toast.info("Generating ARC3 Transactions without IPFS pinning...");
          unsignedAssetTransaction = await createARC3AssetMintArray(
            data_for_txns,
            activeAddress,
            algodClient,
            "mock-token",
            transactionSigner,
            mnemonic,
            "none"
          );
        }
      } else if (formData.collectionFormat === "ARC19") {
        if (effectiveProvider === "crust") {
          toast.info("Generating Crust-based ARC19 Transactions...");
          const { txnsArray } = await createARC19AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "crust",
            undefined,
            mnemonic
          );
          unsignedAssetTransaction = txnsArray;
        } else if (effectiveProvider === "filebase") {
          toast.info("Generating Filebase-based ARC19 Transactions...");
          const { txnsArray } = await createARC19AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "filebase",
            formData.filebaseToken,
            mnemonic
          );
          unsignedAssetTransaction = txnsArray;
        } else if (effectiveProvider === "pinata") {
          toast.info("Generating Pinata-based ARC19 Transactions...");
          const { txnsArray } = await createARC19AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "pinata",
            formData.pinataToken,
            mnemonic
          );
          unsignedAssetTransaction = txnsArray;
        } else {
          toast.info("Generating ARC19 Transactions...");
          unsignedAssetTransaction = await createARC19AssetMintArray(
            data_for_txns,
            activeAddress,
            algodClient,
            "mock-token",
            undefined,
            "none"
          );
        }
      } else {
        // ARC69 format
        toast.info("Generating ARC69 Transactions...");
        unsignedAssetTransaction = await createAssetMintArray(
          data_for_txns,
          activeAddress,
          algodClient
        );
      }

      setAssetTransactions(unsignedAssetTransaction);
      setProcessStep(SIGN_TRANSACTIONS_PROCESS);
      toast.success("Transactions compiled successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to compile transactions.");
      setProcessStep(START_PROCESS);
    }
  }

  async function sendTransactions() {
    try {
      if (!activeAddress) {
        toast.error("Please connect your wallet!");
        return;
      }
      if (assetTransactions.length === 0) {
        toast.error("No transactions to sign!");
        return;
      }
      if (assetTransactions.length > 200 && !mnemonic) {
        toast.error("For batches larger than 200, please input your mnemonic to use Infinity Mode.");
        return;
      }

      setProcessStep(SENDING_TRANSACTIONS_PROCESS);

      let signedTransactions;
      if (mnemonic) {
        if (mnemonic.split(" ").length !== 25) throw Error("Invalid mnemonic phrase!");
        const { sk } = algosdk.mnemonicToSecretKey(mnemonic);
        signedTransactions = SignWithSk(assetTransactions.flat(), sk);
      } else {
        signedTransactions = await walletSign(
          assetTransactions,
          transactionSigner,
          activeWallet?.id === ("ledger" as any)
        );
      }

      // Crust groups are 4 txs, Pinata / None / ARC69 are 2 txs
      const chunkSize = (effectiveProvider === "crust" && formData.collectionFormat !== "ARC69") ? 4 : 2;
      const groups = sliceIntoChunks(signedTransactions, chunkSize);

      for (let i = 0; i < groups.length; i++) {
        try {
          await algodClient.sendRawTransaction(groups[i]).do();
          if (i % 5 === 0) {
            toast.success(`Sent batch ${i + 1} of ${groups.length}`, {
              autoClose: 1000,
            });
          }
        } catch (err) {
          console.error(err);
          toast.error(`Transaction group ${i + 1} failed.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      setProcessStep(COMPLETED);
      toast.success("All assets minted successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Sending failed.");
      setProcessStep(SIGN_TRANSACTIONS_PROCESS);
    }
  }

  function getMimeType(extension: string) {
    if (!extension) return "";
    const ext = extension.toLowerCase().trim();
    switch (ext) {
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".gif":
        return "image/gif";
      case ".webp":
        return "image/webp";
      case ".mp4":
        return "video/mp4";
      default:
        return "";
    }
  }

  const handleReset = () => {
    setCsvData(null);
    setProcessStep(START_PROCESS);
    setAssetTransactions([]);
    setPreviewAsset(null);
  };

  return (
    <div className="mx-auto text-white mb-8 text-center flex flex-col items-center max-w-4xl gap-y-4 min-h-screen px-4">
      <Meta
        title="Batch Collection Mint"
        description="Unified Algorand Batch/Collection Asset Minter. Support for ARC-3, ARC-19, and ARC-69, using Crust, Pinata or custom setups."
      />

      <div className="w-full max-w-2xl bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 md:p-8 mt-6 shadow-2xl">
        <h1 className="text-3xl font-extrabold bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent mb-2">
          Batch Collection Mint
        </h1>
        <p className="text-gray-300 text-sm mb-6">
          Mint large collections with custom traits and metadata configurations using standard Algorand specs.
        </p>

        <ConnectButton inmain={true} />



        {/* step 1 settings */}
        {processStep === START_PROCESS && (
          <div className="space-y-6 mt-6 text-left">
            {/* Standard and Provider Selectors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block mb-2 text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  Asset Standard
                </label>
                <select
                  className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                  value={formData.collectionFormat}
                  onChange={(e) => setFormData({ ...formData, collectionFormat: e.target.value })}
                >
                  <option value="ARC3" className="bg-slate-900 text-white">ARC3 (Immutable Metadata)</option>
                  <option value="ARC19" className="bg-slate-900 text-white">ARC19 (Mutable Metadata via IPFS)</option>
                  <option value="ARC69" className="bg-slate-900 text-white">ARC69 (Mutable Metadata via Tx Note)</option>
                </select>
              </div>

              <div>
                <IpfsProviderSelect
                  provider={formData.pinningProvider as IpfsProvider}
                  setProvider={(p) => setFormData({ ...formData, pinningProvider: p })}
                  isTestnet={isTestnet}
                  showNone={true}
                  pinataToken={formData.pinataToken}
                  setPinataToken={(t) => setFormData({ ...formData, pinataToken: t })}
                  filebaseToken={formData.filebaseToken}
                  setFilebaseToken={(t) => setFormData({ ...formData, filebaseToken: t })}
                />
              </div>
            </div>

            {/* Source Mode Selectors */}
            <div>
              <label className="block mb-2 text-xs font-semibold text-gray-300 uppercase tracking-wider">
                Metadata Source
              </label>
              <div className="flex gap-4">
                <button
                  type="button"
                  className={`flex-1 py-3 px-4 rounded-xl border transition text-sm font-medium ${
                    formData.sourceMode === "folder"
                      ? "bg-gradient-to-r from-orange-500/20 to-amber-500/20 border-orange-500/50 text-orange-400 font-bold"
                      : "bg-slate-900/40 border-slate-800 text-gray-400 hover:bg-slate-900/60"
                  }`}
                  onClick={() => setFormData({ ...formData, sourceMode: "folder" })}
                >
                  📁 Folder CID + Index Range
                </button>
                <button
                  type="button"
                  className={`flex-1 py-3 px-4 rounded-xl border transition text-sm font-medium ${
                    formData.sourceMode === "csv"
                      ? "bg-gradient-to-r from-orange-500/20 to-amber-500/20 border-orange-500/50 text-orange-400 font-bold"
                      : "bg-slate-900/40 border-slate-800 text-gray-400 hover:bg-slate-900/60"
                  }`}
                  onClick={() => setFormData({ ...formData, sourceMode: "csv" })}
                >
                  📄 Upload Metadata CSV
                </button>
              </div>
            </div>

            {/* Folder CID Mode Fields */}
            {formData.sourceMode === "folder" ? (
              <div className="space-y-4 bg-slate-900/40 p-4 rounded-xl border border-slate-850 animate-fadeIn">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1.5 text-xs text-gray-400 uppercase tracking-wider font-bold">Collection Name</label>
                    <input
                      type="text"
                      placeholder="Ex: USAlgo"
                      maxLength={32}
                      className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1.5 text-xs text-gray-400 uppercase tracking-wider font-bold">Collection Unit Name</label>
                    <input
                      type="text"
                      placeholder="Ex: USA"
                      maxLength={8}
                      className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                      value={formData.unitName}
                      onChange={(e) => setFormData({ ...formData, unitName: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1.5 text-xs text-gray-400 uppercase tracking-wider font-bold">Media IPFS CID (Folder CID)</label>
                    <input
                      type="text"
                      placeholder="Qm..."
                      className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                      value={formData.mediaIPFSCID}
                      onChange={(e) => setFormData({ ...formData, mediaIPFSCID: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1.5 text-xs text-gray-400 uppercase tracking-wider font-bold">Media Extension</label>
                    <input
                      type="text"
                      placeholder="Ex: .png, .jpg"
                      className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                      value={formData.mediaExtension}
                      onChange={(e) => setFormData({ ...formData, mediaExtension: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1.5 text-xs text-gray-400 uppercase tracking-wider font-bold">Start Index</label>
                    <input
                      type="number"
                      placeholder="1"
                      className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                      value={formData.startIndex}
                      onChange={(e) => setFormData({ ...formData, startIndex: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block mb-1.5 text-xs text-gray-400 uppercase tracking-wider font-bold">End Index</label>
                    <input
                      type="number"
                      placeholder="100"
                      className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                      value={formData.endIndex}
                      onChange={(e) => setFormData({ ...formData, endIndex: e.target.value })}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 mt-2">
                  <span className="block mb-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Optional Metadata Fallbacks
                  </span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {["description", "externalUrl", "creatorName", "tokenId", "royalty"].map((field) => (
                      <div key={field} className="flex items-center gap-2">
                        <span className="w-24 text-gray-450 uppercase tracking-wider text-[10px] font-bold">
                          {field.replace(/([A-Z])/g, " $1")}
                        </span>
                        <input
                          type="text"
                          placeholder="(optional)"
                          className="flex-1 bg-slate-900/60 border border-slate-700 text-xs font-medium text-white placeholder:text-slate-500 px-3 py-2 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                          value={formData[field]}
                          onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Templates and Guides */}
                <div className="flex flex-wrap gap-3">
                  <a
                    href="https://docs.google.com/spreadsheets/d/1_hxkAcW2DWgoZ3s0A6jBK3DS7liU5QnA89mbXRttLhw/edit?usp=sharing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-lg py-1.5 px-3 transition"
                  >
                    📊 General CSV Template
                  </a>
                  <a
                    href="https://docs.google.com/spreadsheets/d/19gVmGo-2mq5Adpf8NmD4bQbMxM7-r9INUGu0L4qQO1c/edit?usp=sharing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-lg py-1.5 px-3 transition"
                  >
                    📊 ARC69 CSV Template
                  </a>
                </div>

                {/* CSV Drag and Drop */}
                {csvData === null ? (
                  <div className="flex justify-center items-center w-full">
                    <label
                      htmlFor="csv-upload"
                      className="flex flex-col justify-center items-center w-full h-32 px-4 bg-slate-800/30 rounded-xl border-2 border-slate-700 border-dashed cursor-pointer hover:bg-slate-800/50 hover:border-slate-500 transition"
                    >
                      <div className="flex flex-col justify-center items-center pt-5 pb-6 text-center">
                        <p className="mb-1 text-sm text-gray-300 font-bold">
                          Click to select or drop CSV file
                        </p>
                        <p className="text-xs text-gray-400">Standard CSV metadata file</p>
                      </div>
                      <input
                        className="hidden"
                        id="csv-upload"
                        type="file"
                        accept=".csv"
                        onChange={(e: any) => {
                          const file = e.target.files[0];
                          if (file) handleCsvUpload(file);
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700 flex justify-between items-center">
                    <div className="text-left">
                      <span className="text-green-400 font-semibold text-sm block">CSV File Loaded Successfully</span>
                      <span className="text-xs text-gray-400">{csvData.length - 1} assets detected in file.</span>
                    </div>
                    <button
                      className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 py-1.5 px-3 rounded-lg transition"
                      onClick={() => setCsvData(null)}
                    >
                      Remove File
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Custom parameters (Freeze / Clawback) */}
            <div className="bg-slate-800/10 p-4 rounded-xl border border-slate-700/40 space-y-3">
              <span className="block mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Advanced Token Configuration
              </span>
              <div className="flex flex-wrap gap-6 text-sm">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    onChange={(e) => setFormData({ ...formData, freeze: e.target.checked })}
                    checked={formData.freeze}
                  />
                  <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
                  <span className="ml-3 text-xs text-gray-300 font-medium">Enable Freeze Address</span>
                </label>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    onChange={(e) => setFormData({ ...formData, clawback: e.target.checked })}
                    checked={formData.clawback}
                  />
                  <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
                  <span className="ml-3 text-xs text-gray-300 font-medium">Enable Clawback Address</span>
                </label>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    onChange={(e) => setFormData({ ...formData, defaultFrozen: e.target.checked })}
                    checked={formData.defaultFrozen}
                  />
                  <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
                  <span className="ml-3 text-xs text-gray-300 font-medium">Default Frozen</span>
                </label>
              </div>
            </div>

            {/* Cost Summary Box */}
            <div className="bg-orange-500/5 p-4 rounded-xl border border-orange-500/20 text-sm">
              <h4 className="text-orange-400 font-semibold mb-1">Fee & Pinning Breakdown</h4>
              <ul className="space-y-1 text-xs text-gray-300">
                <li>• Pinning Fee: <span className="font-semibold text-white">{getPinFeeText()}</span></li>
                <li>• Network Fee: <span className="font-semibold text-white">0.1 ALGO per asset</span></li>
                <li>• Platform Minter Fee: <span className="font-semibold text-white">Free (wen.tools site fee is 0 ALGO)</span></li>
              </ul>
            </div>
          </div>
        )}

        {/* Steps Display */}
        {processStep > START_PROCESS && (
          <div className="my-6 space-y-4">
            {previewAsset && (
              <div className="p-4 bg-slate-800/40 rounded-xl border border-slate-700/60 max-w-sm mx-auto">
                <span className="text-xs text-gray-400 uppercase tracking-wider block mb-2 font-bold">First Asset Preview</span>
                <PreviewAssetComponent
                  imageUrl={
                    previewAsset.ipfs_data.image
                      ? previewAsset.ipfs_data.image.replace("ipfs://", IPFS_ENDPOINT)
                      : ""
                  }
                  previewAsset={previewAsset}
                />
              </div>
            )}

            {processStep === COMPLETED ? (
              <div className="p-6 bg-green-500/10 rounded-xl border border-green-500/30">
                <span className="text-green-400 font-bold block text-lg mb-1">🎉 Collection Mint Completed!</span>
                <p className="text-gray-300 text-sm mb-4">All assets have been created on the Algorand blockchain.</p>
                <button
                  className="bg-orange-500 hover:bg-orange-600 text-black font-semibold text-sm py-2 px-6 rounded-lg transition"
                  onClick={handleReset}
                >
                  Mint Another Collection
                </button>
              </div>
            ) : processStep === SENDING_TRANSACTIONS_PROCESS ? (
              <div className="p-6 bg-orange-500/10 rounded-xl border border-orange-500/30 flex flex-col items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mb-3"></div>
                <span className="text-orange-400 font-bold block mb-1">Minting in Progress...</span>
                <p className="text-gray-300 text-sm">Please approve transactions in your wallet. Keeping browser tab open.</p>
              </div>
            ) : processStep === SIGN_TRANSACTIONS_PROCESS ? (
              <div className="p-6 bg-slate-800/60 rounded-xl border border-slate-700 flex flex-col items-center">
                <span className="text-orange-400 font-bold block mb-2">Step 2: Sign Transactions</span>
                <p className="text-gray-300 text-sm mb-4">Compiled transactions are ready for signing.</p>
                <button
                  className="bg-orange-500 hover:bg-orange-600 text-black font-bold text-sm py-2.5 px-8 rounded-lg transition"
                  onClick={sendTransactions}
                >
                  Sign & Broadcast Collection
                </button>
              </div>
            ) : (
              <div className="p-6 bg-slate-800/60 rounded-xl border border-slate-700 flex flex-col items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mb-3"></div>
                <span className="text-gray-300 text-sm">Compiling asset specifications & uploading metadata JSON...</span>
              </div>
            )}

            {processStep < COMPLETED && (
              <button
                className="text-xs text-gray-400 hover:text-white underline mt-2 block mx-auto"
                onClick={handleReset}
              >
                Cancel and reset
              </button>
            )}
          </div>
        )}

        {/* Footer actions */}
        {processStep === START_PROCESS && (
          <div className="mt-8">
            <button
              className="w-full md:w-auto bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-black font-bold text-sm py-3 px-8 rounded-xl transition duration-300 transform hover:scale-[1.02] shadow-lg shadow-orange-500/20"
              onClick={createTransactions}
            >
              Step 1: Compile Transactions
            </button>
          </div>
        )}
      </div>

      {/* Mnemonic / Infinity Mode */}
      <div className="mt-4 w-full max-w-2xl">
        <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      </div>

      {/* Guide link */}
      <div className="mt-4 text-sm text-gray-400">
        Need assistance? View the{" "}
        <a
          href="https://loafpickle.medium.com/simple-batch-mint-guide-9f1bbe7882cd"
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-400 hover:underline"
        >
          Simple Batch Mint Guide
        </a>{" "}
        or the{" "}
        <a
          href="https://loafpickle.medium.com/evil-tools-mass-mint-tool-d06b8fc054b1"
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-400 hover:underline"
        >
          Mass Mint Tool Guide
        </a>.
      </div>

      <FaqSectionComponent
        faqData={[
          {
            question: "What is Batch Collection Mint?",
            answer:
              "Batch Collection Mint combines standard ARC-3, ARC-19, and ARC-69 NFT creation workflows on Algorand. It supports bulk uploading and indexing so you can launch large NFT collections in minutes.",
          },
          {
            question: "How do pinning providers differ?",
            answer:
              "Crust Network utilizes decentralized Web3 storage with inline storage payment transactions. Pinata connects to your own API endpoint securely using a custom JWT. Select None if your metadata files are already hosted on IPFS or a custom URL server.",
          },
          {
            question: "What are the requirements for CSV files?",
            answer:
              "Use columns like name, unit_name, image_ipfs_cid, and description. You can add category-based filters or traits using prefix column headers like 'property_color' or 'filters_background'.",
          },
        ]}
      />

      <section className="mt-12 pt-8 border-t border-slate-800 w-full max-w-2xl text-left px-4 text-xs text-gray-500">
        <p className="mb-2">
          ⚠️ <strong>Warnings and Best Practices:</strong> Batches containing more than 200 items should use Mnemonic/Infinity Mode. Ensure you have tested a single asset mint first to verify the layout and formatting on explorer platforms.
        </p>
      </section>
    </div>
  );
}
