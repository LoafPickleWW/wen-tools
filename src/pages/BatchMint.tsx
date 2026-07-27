import { useState, useEffect } from "react";
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
import {
  completeAlgoFileUpload,
  getAlgoFileBatchPaymentRequirements,
  completeAlgoFileBatchUpload,
  uploadFilesToS3,
  confirmAlgoFileBatch
} from "../utils/algofile";
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
    pinningProvider: "algofile", // algofile, crust, pinata, none
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
  const [isCsvAccordionOpen, setIsCsvAccordionOpen] = useState(false);
  const [processStep, setProcessStep] = useState(START_PROCESS);
  const [mnemonic, setMnemonic] = useState("");
  const [assetTransactions, setAssetTransactions] = useState([] as algosdk.Transaction[][]);
  const [algofileUploads, setAlgofileUploads] = useState<any[]>([]);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [previewAsset, setPreviewAsset] = useState(null as any);

  const { activeAddress, algodClient, transactionSigner, activeWallet, activeNetwork } = useWallet();
  const isTestnet = activeNetwork === "testnet";
  const effectiveProvider = isTestnet
    ? (formData.pinningProvider === "crust" ? "pinata" : formData.pinningProvider)
    : formData.pinningProvider;

  // Automatically switch away from "none" if standard is changed to ARC3 or ARC19
  useEffect(() => {
    if (formData.collectionFormat !== "ARC69" && formData.pinningProvider === "none") {
      setFormData((prev: any) => ({
        ...prev,
        pinningProvider: "algofile"
      }));
    }
  }, [formData.collectionFormat, isTestnet, formData.pinningProvider]);

  const handleCsvUpload = (file: File) => {
    Papa.parse(file, {
      complete: function (results) {
        const filteredData = results.data.filter((row: any) => row[0] && row[0].length > 0);
        setCsvData(filteredData);
        setFormData((prev: any) => ({ ...prev, sourceMode: "csv" }));
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
    if (effectiveProvider === "algofile") {
      return "Variable USDC (AlgoFile x402 Pinning: paid directly on-chain. Valid for 1 year)";
    }
    // Crust Network fees
    if (formData.collectionFormat === "ARC69") {
      return "1.4 ALGO per pin (Crust Pinning: 1 pin for image)";
    }
    return "1.4 ALGO per pin (Crust Pinning: 2 pins: Image + JSON = 2.8 ALGO)";
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
        if (effectiveProvider === "algofile") {
          if (mediaFiles.length === 0) {
            toast.error("Please upload the collection images.");
            return;
          }
        } else {
          if (!formData.mediaIPFSCID) {
            toast.error("Please enter the media folder IPFS CID.");
            return;
          }
          if (!formData.mediaExtension || !formData.mediaExtension.includes(".")) {
            toast.error("Please enter a valid media extension (e.g. .png, .jpg).");
            return;
          }
        }
        if (!formData.name || !formData.unitName) {
          toast.error("Please enter collection Name and Unit Name.");
          return;
        }
      }

      const data: any[] = [];

      if (formData.sourceMode === "csv") {
        let headers: string[] = [];
        const startIndex = formData.startIndex ? parseInt(formData.startIndex) : null;
        const endIndex = formData.endIndex ? parseInt(formData.endIndex) : null;

        for (let i = 0; i < csvData.length; i++) {
          if (csvData[i].length <= 1) continue;
          if (i === 0) {
            headers = csvData[i].map((h: string) => h.trim());
          } else {
            const obj: any = {};
            for (let j = 0; j < headers.length; j++) {
              const header = headers[j];
              let key = header;
              const lowerKey = key.toLowerCase().replace(/[\s_-]+/g, "_");
              if (lowerKey === "index") key = "index";
              else if (lowerKey === "name") key = "name";
              else if (lowerKey === "unit_name" || lowerKey === "unitname") key = "unit_name";
              else if (lowerKey === "image_ipfs_cid" || lowerKey === "imageipfscid") key = "image_ipfs_cid";
              else if (lowerKey === "url") key = "url";
              else if (lowerKey === "description") key = "description";
              else if (lowerKey === "external_url" || lowerKey === "externalurl") key = "external_url";
              else if (lowerKey === "creator") key = "creator";
              else if (lowerKey === "token_id" || lowerKey === "tokenid") key = "token_id";
              else if (lowerKey === "royalty") key = "royalty";
              else if (lowerKey === "decimals") key = "decimals";
              else if (lowerKey === "total_supply" || lowerKey === "totalsupply") key = "total_supply";
              else if (lowerKey === "has_clawback" || lowerKey === "hasclawback") key = "has_clawback";
              else if (lowerKey === "has_freeze" || lowerKey === "hasfreeze") key = "has_freeze";
              else if (lowerKey === "default_frozen" || lowerKey === "defaultfrozen") key = "default_frozen";

              if (header.startsWith("metadata_")) {
                obj[header.replace("metadata_", "")] = csvData[i][j];
              } else {
                obj[key] = csvData[i][j];
              }
            }

            // Filter by range if specified
            if (obj.index !== undefined) {
              const itemIndex = parseInt(obj.index);
              if (!isNaN(itemIndex)) {
                if (startIndex !== null && itemIndex < startIndex) continue;
                if (endIndex !== null && itemIndex > endIndex) continue;
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
            image_ipfs_cid: effectiveProvider === "algofile" ? "" : `ipfs://${formData.mediaIPFSCID}/${i}${formData.mediaExtension}`,
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

      // 1. Upload Images to AlgoFile (if using algofile provider)
      const imageCidsMap = new Map<string, string>();
      if (effectiveProvider === "algofile") {
        toast.info("Preparing AlgoFile image assets...");
        
        // Match each data item with its corresponding file in mediaFiles
        const matchedFiles: { file: File; idx: number }[] = [];
        data.forEach((item, idx) => {
          let matchedFile = null;
          // Match by index (e.g. "1.png" matches index 1)
          if (item.index !== undefined) {
            const targetName = String(item.index).padStart(2, '0');
            matchedFile = mediaFiles.find(f => {
              const baseName = f.name.substring(0, f.name.lastIndexOf('.'));
              return baseName === String(item.index) || baseName === targetName;
            }) || null;
          }
          // Match by name
          if (!matchedFile && item.name) {
            matchedFile = mediaFiles.find(f => {
              const baseName = f.name.substring(0, f.name.lastIndexOf('.'));
              return baseName.toLowerCase() === item.name.toLowerCase();
            }) || null;
          }
          // Fallback to array index match
          if (!matchedFile && idx < mediaFiles.length) {
            matchedFile = mediaFiles[idx];
          }

          if (matchedFile) {
            matchedFiles.push({ file: matchedFile, idx });
            data[idx].original_image_name = matchedFile.name;
          }
        });

        if (matchedFiles.length === 0) {
          toast.error("Could not find matching image files for the assets!");
          return;
        }

        // Get storage quote for images
        const imgItems = matchedFiles.map(mf => ({
          fileName: mf.file.name,
          sizeBytes: mf.file.size,
          contentType: mf.file.type
        }));

        toast.info("Requesting image storage quote from AlgoFile...");
        const imgRequirements = await getAlgoFileBatchPaymentRequirements(imgItems);
        const params = await algodClient.getTransactionParams().do();
        const imgAssetId = Number(imgRequirements.asset || 0);
        const imgAmountMicro = BigInt(imgRequirements.amount);
        
        let imgPaymentTxn;
        if (imgAssetId === 0) {
          imgPaymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: activeAddress,
            to: imgRequirements.payTo,
            amount: imgAmountMicro,
            suggestedParams: params,
          });
        } else {
          imgPaymentTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            from: activeAddress,
            to: imgRequirements.payTo,
            amount: imgAmountMicro,
            assetIndex: imgAssetId,
            suggestedParams: params,
          });
        }

        toast.info("Please sign the image storage payment in your wallet...");
        const imgSigned = await walletSign([imgPaymentTxn], transactionSigner);
        if (!imgSigned || imgSigned.length === 0) throw new Error("Image storage payment rejected.");

        let imgBinary = "";
        for (let k = 0; k < imgSigned[0].byteLength; k++) {
          imgBinary += String.fromCharCode(imgSigned[0][k]);
        }
        const imgSignedB64 = window.btoa(imgBinary);

        toast.info("Uploading images directly to S3...");
        const imgBatchRes = await completeAlgoFileBatchUpload(imgItems, [imgSignedB64], 0, imgRequirements);

        const imgUploadItems = imgBatchRes.items.map((item, idx) => ({
          file: matchedFiles[idx].file,
          uploadUrl: item.uploadUrl,
          contentType: matchedFiles[idx].file.type
        }));
        await uploadFilesToS3(imgUploadItems);

        toast.info("Confirming image uploads & pinning...");
        const imgConfirmRes = await confirmAlgoFileBatch(imgBatchRes.bucketName, imgBatchRes.items.map((it, idx) => ({
          key: it.key,
          originalName: it.fileName,
          sizeBytes: matchedFiles[idx].file.size
        })));

        imgConfirmRes.items.forEach(it => {
          imageCidsMap.set(it.fileName, it.cid);
        });

        // Update the data array items with the computed CIDs
        matchedFiles.forEach(mf => {
          const cid = imageCidsMap.get(mf.file.name);
          if (cid) {
            data[mf.idx].image_ipfs_cid = `ipfs://${cid}`;
          }
        });

        toast.success("AlgoFile image upload completed!");
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
          const urlStr = String(item.url).trim();
          if (urlStr.startsWith("ipfs://") || urlStr.startsWith("http")) {
            image_url = urlStr;
          } else if (formData.mediaIPFSCID && !urlStr.startsWith("Qm") && !urlStr.startsWith("bafy")) {
            image_url = `ipfs://${formData.mediaIPFSCID}/${urlStr.startsWith("/") ? urlStr.substring(1) : urlStr}`;
          } else {
            image_url = "ipfs://" + urlStr;
          }
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
          original_image_name: item.original_image_name,
        };

        if (formData.collectionFormat === "ARC69") {
          txn_item.asset_note = ipfs_data;
          txn_item.asset_url = image_url.slice(0, 96);
        }

        data_for_txns.push(txn_item);
      });

      setPreviewAsset(data_for_txns[0]);

      if (effectiveProvider === "algofile") {
        toast.info("Preparing AlgoFile batch storage requirements...");
        
        const getMetaFileName = (imageUrl: string, idx: number) => {
          const origName = data_for_txns[idx]?.original_image_name;
          if (origName && origName.includes('.')) {
            const nameWithoutExtension = origName.substring(0, origName.lastIndexOf('.'));
            if (nameWithoutExtension) {
              return `${nameWithoutExtension}.json`;
            }
          }
          if (imageUrl) {
            const parts = imageUrl.split('/');
            const lastPart = parts[parts.length - 1];
            if (lastPart && lastPart.includes('.')) {
              const nameWithoutExtension = lastPart.substring(0, lastPart.lastIndexOf('.'));
              if (nameWithoutExtension) {
                return `${nameWithoutExtension}.json`;
              }
            }
          }
          return `metadata_${idx}.json`;
        };

        const items = data_for_txns.map((item: any, idx: number) => {
          const jsonStr = JSON.stringify(item.ipfs_data);
          const sizeBytes = new TextEncoder().encode(jsonStr).length;
          return {
            fileName: getMetaFileName(item.ipfs_data.image, idx),
            sizeBytes,
            contentType: "application/json"
          };
        });

        const requirements = await getAlgoFileBatchPaymentRequirements(items);
        const params = await algodClient.getTransactionParams().do();
        const assetId = Number(requirements.asset || 0);
        const amountMicro = BigInt(requirements.amount);
        let paymentTxn;
        if (assetId === 0) {
          paymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: activeAddress,
            to: requirements.payTo,
            amount: amountMicro,
            suggestedParams: params,
          });
        } else {
          paymentTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            from: activeAddress,
            to: requirements.payTo,
            amount: amountMicro,
            assetIndex: assetId,
            suggestedParams: params,
          });
        }

        toast.info("Please sign the AlgoFile batch storage payment...");
        const signedTxns = await walletSign([paymentTxn], transactionSigner);
        if (!signedTxns || signedTxns.length === 0) {
          throw new Error("Payment transaction signature was rejected by user.");
        }
        let binary = "";
        const len = signedTxns[0].byteLength;
        for (let k = 0; k < len; k++) {
          binary += String.fromCharCode(signedTxns[0][k]);
        }
        const signedTxnB64 = window.btoa(binary);

        toast.info("Acquiring pre-signed upload URLs...");
        const batchRes = await completeAlgoFileBatchUpload(items, [signedTxnB64], 0, requirements);

        toast.info("Uploading metadata files directly to S3...");
        const uploadItems = batchRes.items.map((item: any, idx: number) => {
          const fileContent = JSON.stringify(data_for_txns[idx].ipfs_data);
          const blob = new Blob([fileContent], { type: "application/json" });
          return {
            file: blob,
            uploadUrl: item.uploadUrl,
            contentType: "application/json"
          };
        });
        await uploadFilesToS3(uploadItems);

        toast.info("Confirming uploads and pinning to IPFS...");
        const confirmItems = batchRes.items.map((item: any, idx: number) => ({
          key: item.key,
          originalName: item.fileName,
          sizeBytes: new TextEncoder().encode(JSON.stringify(data_for_txns[idx].ipfs_data)).length
        }));
        const confirmRes = await confirmAlgoFileBatch(batchRes.bucketName, confirmItems);

        const cidMap = new Map<string, string>();
        confirmRes.items.forEach((item: any) => {
          cidMap.set(item.fileName, item.cid);
        });

        data_for_txns.forEach((item: any, idx: number) => {
          const fileName = getMetaFileName(item.ipfs_data.image, idx);
          item.cid = cidMap.get(fileName) || "";
        });

        toast.success("AlgoFile batch upload & pinning completed!");
      }

      let unsignedAssetTransaction: algosdk.Transaction[][] = [];

      if (formData.collectionFormat === "ARC3") {
        if (effectiveProvider === "algofile") {
          toast.info("Generating AlgoFile-based ARC3 Transactions...");
          const result = await createARC3AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "none",
            undefined,
            mnemonic
          );
          unsignedAssetTransaction = result.txnsArray;
          setAlgofileUploads([]);
        } else if (effectiveProvider === "crust") {
          toast.info("Generating Crust-based ARC3 Transactions...");
          const result = await createARC3AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "crust",
            undefined,
            mnemonic
          );
          unsignedAssetTransaction = result.txnsArray;
        } else if (effectiveProvider === "filebase") {
          toast.info("Generating Filebase-based ARC3 Transactions...");
          const result = await createARC3AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "filebase",
            formData.filebaseToken,
            mnemonic
          );
          unsignedAssetTransaction = result.txnsArray;
        } else if (effectiveProvider === "pinata") {
          toast.info("Generating Pinata-based ARC3 Transactions...");
          const result = await createARC3AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "pinata",
            formData.pinataToken,
            mnemonic
          );
          unsignedAssetTransaction = result.txnsArray;
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
        if (effectiveProvider === "algofile") {
          toast.info("Generating AlgoFile-based ARC19 Transactions...");
          const result = await createARC19AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "none",
            undefined,
            mnemonic
          );
          unsignedAssetTransaction = result.txnsArray;
          setAlgofileUploads([]);
        } else if (effectiveProvider === "crust") {
          toast.info("Generating Crust-based ARC19 Transactions...");
          const result = await createARC19AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "crust",
            undefined,
            mnemonic
          );
          unsignedAssetTransaction = result.txnsArray;
        } else if (effectiveProvider === "filebase") {
          toast.info("Generating Filebase-based ARC19 Transactions...");
          const result = await createARC19AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "filebase",
            formData.filebaseToken,
            mnemonic
          );
          unsignedAssetTransaction = result.txnsArray;
        } else if (effectiveProvider === "pinata") {
          toast.info("Generating Pinata-based ARC19 Transactions...");
          const result = await createARC19AssetMintArrayV2Batch(
            data_for_txns,
            activeAddress,
            algodClient,
            transactionSigner,
            "pinata",
            formData.pinataToken,
            mnemonic
          );
          unsignedAssetTransaction = result.txnsArray;
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
      if (err.response && err.response.data) {
        console.error("Error response details:", err.response.data);
      }
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

      // Crust groups are 4 txs, AlgoFile are 3 txs, Pinata / None / ARC69 are 2 txs
      const chunkSize = (effectiveProvider === "crust" && formData.collectionFormat !== "ARC69") ? 4 : (effectiveProvider === "algofile" && formData.collectionFormat !== "ARC69") ? 3 : 2;
      const groups = sliceIntoChunks(signedTransactions, chunkSize);

      for (let i = 0; i < groups.length; i++) {
        try {
          await algodClient.sendRawTransaction(groups[i]).do();

          // Upload metadata to AlgoFile using the signed transactions group
          if (effectiveProvider === "algofile" && algofileUploads && algofileUploads.length > 0) {
            const upload = algofileUploads.find((u) => u.groupIndex === i);
            if (upload) {
              try {
                const signedGroupB64 = groups[i].map((txnBytes: Uint8Array) => {
                  let binary = "";
                  const len = txnBytes.byteLength;
                  for (let k = 0; k < len; k++) {
                    binary += String.fromCharCode(txnBytes[k]);
                  }
                  return window.btoa(binary);
                });

                await completeAlgoFileUpload(
                  upload.file,
                  upload.fileName,
                  signedGroupB64,
                  upload.paymentIndex,
                  upload.requirements
                );
              } catch (uploadErr) {
                console.error("AlgoFile upload failed for index:", i, uploadErr);
              }
            }
          }

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
                  showNone={formData.collectionFormat === "ARC69"}
                />
              </div>
            </div>

            {/* Token inputs - full width below the grid */}
            {effectiveProvider === "pinata" && (
              <div className="flex flex-col animate-fadeIn bg-slate-900/40 p-4 rounded-xl border border-slate-800">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Pinata JWT Token*
                </label>
                <input
                  type="password"
                  placeholder="Paste Pinata JWT Token"
                  className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                  required
                  value={formData.pinataToken}
                  onChange={(e) => setFormData({ ...formData, pinataToken: e.target.value })}
                />
                <span className="text-[11px] text-slate-500 mt-2 block">
                  Need a token? Create one in your{" "}
                  <a
                    href="https://knowledge.pinata.cloud/en/articles/6191471-how-to-create-an-pinata-api-key"
                    target="_blank"
                    rel="noreferrer"
                    className="text-orange-400 hover:underline"
                  >
                    Pinata account
                  </a>.
                </span>
              </div>
            )}

            {effectiveProvider === "filebase" && (
              <div className="flex flex-col animate-fadeIn bg-slate-900/40 p-4 rounded-xl border border-slate-800">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Filebase API Token*
                </label>
                <input
                  type="password"
                  placeholder="Paste Filebase API Token"
                  className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                  required
                  value={formData.filebaseToken}
                  onChange={(e) => setFormData({ ...formData, filebaseToken: e.target.value })}
                />
                <span className="text-[11px] text-slate-500 mt-2 block">
                  Need a token? Create or find one in your{" "}
                  <a
                    href="https://console.filebase.com/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-orange-400 hover:underline"
                  >
                    Filebase console
                  </a>.
                </span>
              </div>
            )}

            {effectiveProvider === "algofile" && (
              <div className="w-full text-xs bg-slate-900/60 p-4 border border-slate-800 rounded-xl text-slate-400 font-medium leading-relaxed animate-fadeIn text-left mt-3">
                <span className="text-orange-500 font-extrabold mr-1.5 uppercase tracking-wide">Beta Feature:</span> 
                Direct browser-to-S3 media upload and automatic CID replacement in JSON metadata files is in active development. Please verify transaction previews carefully before executing on Mainnet.
              </div>
            )}

             {/* Folder CID Mode Fields (Core Configuration) */}
             <div className="space-y-4 bg-slate-900/40 p-4 rounded-xl border border-slate-850 animate-fadeIn text-left">
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

               {effectiveProvider === "algofile" ? (
                 <div>
                   <label className="block mb-1.5 text-xs text-gray-400 uppercase tracking-wider font-bold">Upload Collection Images (Multiple)*</label>
                   <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-orange-500/50 bg-slate-900/40 hover:bg-slate-900/60 p-6 rounded-xl cursor-pointer transition-all relative">
                     <svg className="w-8 h-8 text-slate-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                     </svg>
                     <span className="text-sm font-semibold text-slate-200">
                       Click to upload or drag files here
                     </span>
                     <span className="text-xs text-slate-500 mt-1">
                       {mediaFiles.length > 0 ? `${mediaFiles.length} file(s) selected.` : "PNG, JPG, JPEG, GIF, MP4, etc."}
                     </span>
                     <input
                       type="file"
                       multiple
                       onChange={(e) => {
                         if (e.target.files) {
                           setMediaFiles(Array.from(e.target.files));
                         }
                       }}
                       className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                       required
                     />
                   </div>
                 </div>
               ) : (
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
               )}

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

             {/* CSV Accordion Section */}
             <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/20 text-left">
               <button
                 type="button"
                 className="w-full flex justify-between items-center p-4 text-sm font-semibold text-gray-300 hover:bg-slate-800/30 transition-colors"
                 onClick={() => setIsCsvAccordionOpen(!isCsvAccordionOpen)}
               >
                 <span className="flex items-center gap-2">
                   📄 CSV Metadata Upload {csvData ? " (Active)" : " (Optional)"}
                 </span>
                 <span className="text-xs text-gray-500 font-mono">{isCsvAccordionOpen ? "▲" : "▼"}</span>
               </button>
               {isCsvAccordionOpen && (
                 <div className="p-4 border-t border-slate-800 space-y-4 animate-fadeIn">
                   {/* Templates and Guides */}
                   <div className="flex flex-wrap gap-3">
                     <a
                       href="https://docs.google.com/spreadsheets/d/1_hxkAcW2DWgoZ3s0A6jBK3DS7liU5QnA89mbXRttLhw/edit?usp=sharing"
                       target="_blank"
                       rel="noopener noreferrer"
                       className="inline-flex items-center text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-lg py-1.5 px-3 transition font-medium"
                     >
                       📊 General CSV Template
                     </a>
                     <a
                       href="https://docs.google.com/spreadsheets/d/19gVmGo-2mq5Adpf8NmD4bQbMxM7-r9INUGu0L4qQO1c/edit?usp=sharing"
                       target="_blank"
                       rel="noopener noreferrer"
                       className="inline-flex items-center text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-lg py-1.5 px-3 transition font-medium"
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
                         onClick={() => {
                           setCsvData(null);
                           setFormData((prev: any) => ({ ...prev, sourceMode: "folder" }));
                         }}
                       >
                         Remove File
                       </button>
                     </div>
                   )}
                 </div>
               )}
             </div>

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
                {effectiveProvider === "algofile" ? (
                  <>
                    <li>• Pinning Fee (AlgoFile): <span className="font-semibold text-white">Variable USDC (paid directly on-chain. Valid for 1 year)</span></li>
                    <li className="opacity-70">• Secondary Option (Crust Pinning): <span className="font-semibold text-white/85">1.4 ALGO per pin ({formData.collectionFormat === "ARC69" ? "1 pin: image" : "2 pins: image + JSON"} = {formData.collectionFormat === "ARC69" ? "1.4 ALGO" : "2.8 ALGO"})</span></li>
                  </>
                ) : effectiveProvider === "crust" ? (
                  <>
                    <li>• Pinning Fee (Crust): <span className="font-semibold text-white">1.4 ALGO per pin ({formData.collectionFormat === "ARC69" ? "1 pin: image" : "2 pins: image + JSON"} = {formData.collectionFormat === "ARC69" ? "1.4 ALGO" : "2.8 ALGO"})</span></li>
                    <li className="opacity-70">• Primary Option (AlgoFile Pinning): <span className="font-semibold text-white/85">Variable USDC (paid directly on-chain. Valid for 1 year)</span></li>
                  </>
                ) : (
                  <li>• Pinning Fee: <span className="font-semibold text-white">{getPinFeeText()}</span></li>
                )}
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
