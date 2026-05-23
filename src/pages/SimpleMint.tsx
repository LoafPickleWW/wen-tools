import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

import algosdk from "algosdk";
import { toast } from "react-toastify";
import { useAtom } from "jotai";
import { atomWithStorage, RESET } from "jotai/utils";
import {
  createARC3AssetMintArrayV2,
  createARC19AssetMintArrayV2,
  createAssetMintArrayV2,
  walletSign,
  pinImageToPinata,
  pinJSONToPinata,
} from "../utils";
import { ASSET_PREVIEW, TOOLS } from "../constants";
import FaqSectionComponent from "../components/FaqSectionComponent";
import { pinImageToCrust, makeCrustPinTx, buildAssetMintAtomicTransactionComposer } from "../crust";
import { useWallet } from "@txnlab/use-wallet-react";
import "react-json-view-lite/dist/index.css";
import { PreviewAssetComponent } from "../components/PreviewAssetComponent";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

const simpleMintAtom = atomWithStorage("simpleMint", {
  name: "",
  unitName: "",
  totalSupply: 1,
  decimals: 0,
  image: null,
  format: "ARC69",
  freeze: false,
  clawback: false,
  defaultFrozen: false,
  urlField: "",
  description: "",
  external_url: "",
  traits: [
    {
      id: 1,
      category: "",
      name: "",
    },
  ],
  filters: [
    {
      id: 1,
      category: "",
      name: "",
    },
  ],
  extras: [
    {
      id: 1,
      category: "",
      name: "",
    },
  ],
} as any);

const smTokenAtom = atomWithStorage("smToken", "");
const simpleMintProviderAtom = atomWithStorage("simpleMintProvider", "crust");

export function SimpleMint() {
  const [formData, setFormData] = useAtom(simpleMintAtom);
  const [pinningProvider, setPinningProvider] = useAtom(simpleMintProviderAtom);
  const { activeAddress, algodClient, transactionSigner, activeNetwork } = useWallet();
  const isTestnet = activeNetwork === "testnet";
  const effectiveProvider = isTestnet ? "pinata" : pinningProvider;
  const [token, setToken] = useAtom(smTokenAtom);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [processStep, setProcessStep] = useState(0);

  const [createdAssetID, setCreatedAssetID] = useState(null);

  const [batchATC, setBatchATC] = useState(null as any);
  const [pinCids, setPinCids] = useState<string[]>([]);
  const [previewAsset, setPreviewAsset] = useState(null as any);
  const [showIntegratorPortal, setShowIntegratorPortal] = useState(false);
  const [searchParams] = useSearchParams();
  const [extraFee, setExtraFee] = useState<number | null>(null);
  const [extraFeeAddress, setExtraFeeAddress] = useState<string | null>(null);
  const [isLedger, setIsLedger] = useState(false);

  const finalFormat = isCustomMode ? formData.format : "ARC69";
  const finalSupply = isCustomMode ? formData.totalSupply : 1;
  const finalDecimals = isCustomMode ? formData.decimals : 0;
  const finalFreeze = isCustomMode ? formData.freeze : false;
  const finalClawback = isCustomMode ? formData.clawback : false;
  const finalDefaultFrozen = isCustomMode ? formData.defaultFrozen : false;
  const finalUnitName = isCustomMode
    ? formData.unitName
    : (formData.unitName || (formData.name ? formData.name.substring(0, 8).toUpperCase().replace(/\s/g, "") : ""));

  useEffect(() => {
    // Handle query parameters
    const name = searchParams.get("name");
    const unitName = searchParams.get("unitName");
    const description = searchParams.get("description");
    const external_url = searchParams.get("external_url");
    const totalSupply = searchParams.get("totalSupply");
    const decimals = searchParams.get("decimals");
    const format = searchParams.get("format");
    const imageUrl = searchParams.get("imageUrl") || searchParams.get("image_url");
    const exFee = searchParams.get("extraFee");
    const exFeeAddr = searchParams.get("extraFeeAddress");
    const autoMint = searchParams.get("autoMint");

    if (name || unitName || description || external_url || totalSupply || decimals || format) {
      setFormData((prev: any) => ({
        ...prev,
        name: name || prev.name,
        unitName: unitName || prev.unitName,
        description: description || prev.description,
        external_url: external_url || prev.external_url,
        totalSupply: totalSupply ? parseInt(totalSupply) : prev.totalSupply,
        decimals: decimals ? parseInt(decimals) : prev.decimals,
        format: format || prev.format,
      }));

      // Enable custom mode if standard deviates from ARC69, or advanced parameters are present
      if (
        (format && format !== "ARC69") ||
        (totalSupply && parseInt(totalSupply) !== 1) ||
        (decimals && parseInt(decimals) !== 0) ||
        external_url
      ) {
        setIsCustomMode(true);
      }
    }

    if (exFee) setExtraFee(parseInt(exFee));
    if (exFeeAddr) setExtraFeeAddress(exFeeAddr);

    if (imageUrl) {
      fetch(imageUrl)
        .then((res) => res.blob())
        .then((blob) => {
          const file = new File([blob], "image.png", { type: blob.type });
          setFormData((prev: any) => ({ ...prev, image: file }));
        })
        .catch((err) => console.error("Error fetching image from URL:", err));
    }

    // Handle postMessage
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === "WEN_TOOLS_MINT_REQUEST") {
        const { data } = event.data;
        setFormData((prev: any) => {
          const msgFormData = { ...prev };
          if (data.name) msgFormData.name = data.name;
          if (data.unitName) msgFormData.unitName = data.unitName;
          if (data.description) msgFormData.description = data.description;
          if (data.external_url) msgFormData.external_url = data.external_url;
          if (data.totalSupply) msgFormData.totalSupply = data.totalSupply;
          if (data.decimals) msgFormData.decimals = data.decimals;
          if (data.format) msgFormData.format = data.format;
          else if (!msgFormData.format) msgFormData.format = "ARC69";
          if (data.image) msgFormData.image = data.image; // Should be a File or Blob

          // Automatically enable custom mode if fields warrant it
          if (
            (data.format && data.format !== "ARC69") ||
            (data.totalSupply && parseInt(data.totalSupply) !== 1) ||
            (data.decimals && parseInt(data.decimals) !== 0) ||
            data.external_url ||
            (data.traits && data.traits.length > 0)
          ) {
            setIsCustomMode(true);
          }
          return msgFormData;
        });

        if (data.extraFee) setExtraFee(data.extraFee);
        if (data.extraFeeAddress) setExtraFeeAddress(data.extraFeeAddress);
        
        if (data.autoMint) {
           // Small delay to ensure state update
           setTimeout(() => {
             const mintBtn = document.getElementById("step1-mint-btn");
             if (mintBtn) mintBtn.click();
           }, 500);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    
    // Auto mint from URL params
    if (autoMint === "true") {
        setTimeout(() => {
            const mintBtn = document.getElementById("step1-mint-btn");
             if (mintBtn) mintBtn.click();
        }, 1000);
    }

    return () => window.removeEventListener("message", handleMessage);
  }, [searchParams, setFormData]);

  const IntegratorPortal = () => {
    return (
      <div className="mt-20 w-full max-w-4xl mx-auto px-4">
        <button 
          onClick={() => setShowIntegratorPortal(!showIntegratorPortal)}
          className="w-full py-4 px-6 bg-primary-black/60 border border-slate-700/50 rounded-xl flex justify-between items-center hover:bg-primary-black/80 transition shadow-lg group"
        >
          <span className="text-xl font-bold bg-gradient-to-r from-primary-yellow to-secondary-orange bg-clip-text text-transparent">
            Integrate Wen-Tools into your own site
          </span>
          <span className={`text-2xl transition-transform duration-300 ${showIntegratorPortal ? 'rotate-180' : ''} text-slate-400 group-hover:text-primary-yellow`}>
            ▼
          </span>
        </button>

        {showIntegratorPortal && (
          <div className="mt-4 p-8 bg-primary-black/40 border border-slate-700/50 rounded-xl text-left shadow-2xl backdrop-blur-sm animate-fadeIn">
            <p className="text-slate-300 mb-6">
              Use Wen-Tools as your backend "minting engine". Perfect for marketplaces, launchpads, or any site that wants to offer decentralized IPFS minting without building the infra.
            </p>

            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">1. URL Parameter Redirect</h3>
                <p className="text-sm text-slate-400 mb-3">
                  Fastest way to integrate. Link users directly to Wen-Tools with pre-filled data.
                </p>
                <ul className="text-xs space-y-2 text-slate-300 bg-black/30 p-3 rounded-lg border border-slate-800">
                  <li><span className="text-primary-yellow font-mono">format</span>: ARC Format (Default: <span className="text-primary-yellow">ARC69</span>)</li>
                  <li><span className="text-primary-yellow font-mono">name</span>: (Required) Asset Name</li>
                  <li><span className="text-primary-yellow font-mono">image_url</span>: Link to your media file</li>
                  <li><span className="text-primary-yellow font-mono">description</span>: Metadata description</li>
                  <li><span className="text-primary-yellow font-mono">extraFee</span>: Amount in microAlgos</li>
                  <li><span className="text-primary-yellow font-mono">extraFeeAddress</span>: Your wallet address</li>
                  <li><span className="text-primary-yellow font-mono">autoMint=true</span>: Jump straight to the sign step!</li>
                </ul>
                <div className="mt-4">
                   <a 
                     href="/simple-mint?name=MyIntegratorNFT&image_url=https://ipfs.io/ipfs/QmQ6y8nS6p3gH8T9K8Vv...&extraFee=1000000&extraFeeAddress=MYWALLET..."
                     className="text-xs text-blue-400 hover:underline break-all"
                   >
                     Example: wen.tools/simple-mint?name=NFT&image_url=...
                   </a>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-white mb-3">2. Iframe Embedding</h3>
                <p className="text-sm text-slate-400 mb-2">
                  Embed Wen-Tools and use <span className="font-mono text-secondary-orange">postMessage</span> for a seamless minting experience.
                </p>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">HTML</p>
                    <pre className="text-[10px] text-blue-300 bg-black/50 p-2 rounded border border-slate-800">
{`<iframe 
  id="wen-tools"
  src="https://wen.tools/simple-mint"
  width="100%" 
  height="600px"
/>`}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">JavaScript (Send Request)</p>
                    <pre className="text-[10px] text-green-400 bg-black/50 p-2 rounded border border-slate-800 overflow-x-auto">
{`const wen = document.getElementById('wen-tools');
wen.contentWindow.postMessage({
  type: 'WEN_TOOLS_MINT_REQUEST',
  data: {
    name: 'Awesome NFT',
    image: myFileBlob,
    format: 'ARC69',
    autoMint: true
  }
}, 'https://wen.tools');`}
                    </pre>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Listen for Success</p>
                    <pre className="text-[10px] text-purple-400 bg-black/50 p-2 rounded border border-slate-800">
{`window.addEventListener('message', (event) => {
  if (event.data.type === 'WEN_TOOLS_MINT_SUCCESS') {
    console.log('Minted Asset ID:', event.data.assetID);
    alert('NFT Minted Successfully!');
  }
});`}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const TraitMetadataInputField = (id: string, type: string) => {
    const item = formData[type]?.find((m: any) => m.id === id);
    if (!item) return null;

    return (
      <div key={id} id={`metadata-${id}`} className="flex items-center gap-2 mb-2 w-full animate-fadeIn">
        <input
          type="text"
          id={`category-${id}`}
          placeholder={type === "traits" ? "Trait type" : type === "filters" ? "Filter type" : "Extra key"}
          className="w-1/2 bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
          value={item.category}
          onChange={(e) => {
            const newMetadata = formData[type].map((trait: any) => {
              if (trait.id === id) {
                return {
                  ...trait,
                  category: e.target.value,
                };
              }
              return trait;
            });
            setFormData({
              ...formData,
              [type]: newMetadata,
            });
          }}
        />
        <input
          id={`name-${id}`}
          type="text"
          placeholder="Value"
          className="w-1/2 bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
          value={item.name}
          onChange={(e) => {
            const newMetadata = formData[type].map((trait: any) => {
              if (trait.id === id) {
                return {
                  ...trait,
                  name: e.target.value,
                };
              }
              return trait;
            });
            setFormData({
              ...formData,
              [type]: newMetadata,
            });
          }}
        />
        <button
          type="button"
          className="rounded-xl bg-red-650/20 text-primary-red border border-primary-red/30 text-base hover:bg-primary-red hover:text-white transition-all w-10 h-10 flex items-center justify-center font-bold"
          onClick={() => {
            const newMetadata = formData[type].filter(
              (metadata: any) => metadata.id !== id
            );
            setFormData({
              ...formData,
              [type]: newMetadata,
            });
          }}
        >
          ✕
        </button>
      </div>
    );
  };

  async function mint() {
    try {
      if (!activeAddress) {
        toast.error("Please connect your wallet");
        return;
      }
      if (formData.name === "") {
        toast.error("Please fill the name field");
        return;
      }
      if (
        finalFormat !== "Token" &&
        (formData.image === null || !(formData.image instanceof File))
      ) {
        toast.error("Please select an image");
        return;
      }
      setProcessStep(1);
      const metadata: any = {
        name: formData.name,
        standard: finalFormat.toLowerCase(),
        properties: {},
      };
      if (formData.description !== "") {
        metadata.description = formData.description;
      }
      if (isCustomMode) {
        if (formData.external_url !== "") {
          metadata.external_url = formData.external_url;
        }
        if (formData.traits && formData.traits.length > 0) {
          metadata.properties.traits = formData.traits.reduce(
            (acc: any, trait: any) => {
              if (trait.category !== "" && trait.name !== "") {
                acc[trait.category] = trait.name;
              }
              return acc;
            },
            {}
          );
        }
        if (formData.filters && formData.filters.length > 0) {
          metadata.properties.filters = formData.filters.reduce(
            (acc: any, filter: any) => {
              if (filter.category !== "" && filter.name !== "") {
                acc[filter.category] = filter.name;
              }
              return acc;
            },
            {}
          );
        }
        if (formData.extras && formData.extras.length > 0) {
          metadata.properties.extras = formData.extras.reduce(
            (acc: any, extra: any) => {
              if (extra.category !== "" && extra.name !== "") {
                acc[extra.category] = extra.name;
              }
              return acc;
            },
            {}
          );
        }
      }
      let imageURL;
      let imageCID = null;
      if (finalFormat === "Token") {
        imageURL = formData.urlField;
      } else {
        if (formData.image === null || !(formData.image instanceof File)) {
          toast.error("Please select an image");
          return;
        }
        if (effectiveProvider === "crust") {
          toast.info("Uploading the image to IPFS via Crust...");
          let authBasic = localStorage.getItem("authBasic");
          if (!authBasic) {
            // Hardcoded emergency auth
            authBasic = "YWxnby1CQ0FQV0pBTFdBM04zRUlaUkZDTzU1UFEzWUJZQ1NHUFpYTkRIT09BNlI3Q0dIVElTVjJHQ1NZQzZZOkZyYjl6RWhudVVKZ0ZaY0d1cmRTUE45dW1SL1hHMnRlalc0VFpkb3huN3ZXMTVKOFd6TGMva3R2LytnMklWRVFRMVN4Vnk3N0plZ3laZkVKMkRxaEFRPT0=";
            localStorage.setItem("authBasic", authBasic);
          }
          imageCID = await pinImageToCrust(authBasic, formData.image);
          imageURL = "ipfs://" + imageCID;
        } else {
          if (!token) {
            toast.error("Please enter a Pinata JWT token");
            return;
          }
          toast.info("Uploading the image to IPFS via Pinata...");
          imageCID = await pinImageToPinata(token, formData.image);
          imageURL = "ipfs://" + imageCID;
        }
      }

      if (formData.image && formData.image instanceof File) {
        if (formData.image.type && formData.image.type.includes("video")) {
          metadata.animation_url = imageURL;
          metadata.animation_url_mime_type = formData.image
            ? formData.image.type
            : "";
        } else if (formData.image.type && formData.image.type.includes("audio")) {
          metadata.properties.file_url = imageURL;
          metadata.properties.file_url_mimetype = formData.image
            ? formData.image.type
            : "";
        } else {
          metadata.image = imageURL;
          metadata.image_mime_type = formData.image ? formData.image.type : "";
        }
      }

      let imageURLForPreview ;

      try{
        if (formData.image) {
          imageURLForPreview = URL.createObjectURL(formData.image);
        } else {
          imageURLForPreview = "";
        }
      }catch(e){
        imageURLForPreview = "";
        console.error(e);
      }

      let metadataForIPFS: any = {
        asset_name: formData.name,
        unit_name: finalUnitName,
        has_clawback: finalClawback ? "Y" : "N",
        has_freeze: finalFreeze ? "Y" : "N",
        default_frozen: finalDefaultFrozen ? "Y" : "N",
        decimals: finalDecimals,
        total_supply: finalSupply,
        ipfs_data: metadata,
        image: imageURLForPreview,
      };

      if (effectiveProvider === "crust") {
        if (finalFormat === "ARC3") {
          const { atc, pinCids: cids } = await createARC3AssetMintArrayV2(
            [metadataForIPFS],
            activeAddress,
            algodClient,
            transactionSigner,
            [imageCID],
            undefined,
            extraFee || undefined,
            extraFeeAddress || undefined
          );

          setPinCids(cids);
          setBatchATC(atc);
        } else if (finalFormat === "ARC19") {
          const { atc, pinCids: cids } = await createARC19AssetMintArrayV2(
            [metadataForIPFS],
            activeAddress,
            algodClient,
            transactionSigner,
            [imageCID],
            undefined,
            extraFee || undefined,
            extraFeeAddress || undefined
          );

          setPinCids(cids);
          setBatchATC(atc);
        } else if (finalFormat === "ARC69" || finalFormat === "Token") {
          metadata.properties = isCustomMode ? (metadata.properties.traits || {}) : {};
          metadataForIPFS = {
            ...metadataForIPFS,
            asset_note: metadata,
            asset_url: imageURL,
          };

          if (finalFormat === "ARC69") {
            const { atc, pinCids: cids } = await createAssetMintArrayV2(
              [metadataForIPFS],
              activeAddress,
              algodClient,
              transactionSigner,
              [imageCID],
              extraFee || undefined,
              extraFeeAddress || undefined
            );

            setPinCids(cids);
            setBatchATC(atc);
          } else {
            const { atc, pinCids: cids } = await createAssetMintArrayV2(
              [metadataForIPFS],
              activeAddress,
              algodClient,
              transactionSigner,
              undefined,
              extraFee || undefined,
              extraFeeAddress || undefined
            );

            setPinCids(cids);
            setBatchATC(atc);
          }
        } else {
          toast.error("Invalid ARC format");
          return;
        }
      } else {
        // Pinata path
        if (finalFormat === "ARC3" || finalFormat === "ARC19") {
          const jsonString = JSON.stringify(metadata);
          toast.info("Uploading metadata to IPFS via Pinata...");
          const metadataCID = await pinJSONToPinata(token, jsonString);

          const atc = new algosdk.AtomicTransactionComposer();
          const suggestedParams = await algodClient.getTransactionParams().do();
          suggestedParams.flatFee = true;
          suggestedParams.fee = 2000 * 4; // set fee

          metadataForIPFS.asset_url_section = "ipfs://" + metadataCID;

          await buildAssetMintAtomicTransactionComposer(
            atc,
            activeAddress,
            finalFormat,
            transactionSigner,
            metadataForIPFS,
            suggestedParams,
            metadataCID
          );

          if (extraFee && extraFeeAddress) {
            const extra_fee_tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              from: activeAddress,
              to: extraFeeAddress,
              amount: BigInt(extraFee),
              suggestedParams: suggestedParams,
              note: new TextEncoder().encode("Extra fee via wen.tools integration"),
            });
            atc.addTransaction({ txn: extra_fee_tx, signer: transactionSigner });
          }

          setPinCids([]);
          setBatchATC(atc);
        } else if (finalFormat === "ARC69" || finalFormat === "Token") {
          metadata.properties = isCustomMode ? (metadata.properties.traits || {}) : {};
          metadataForIPFS = {
            ...metadataForIPFS,
            asset_note: metadata,
            asset_url: imageURL,
          };

          const { atc } = await createAssetMintArrayV2(
            [metadataForIPFS],
            activeAddress,
            algodClient,
            transactionSigner,
            undefined, // No Crust pinning CID needed
            extraFee || undefined,
            extraFeeAddress || undefined
          );

          setPinCids([]);
          setBatchATC(atc);
        } else {
          toast.error("Invalid ARC format");
          return;
        }
      }
      setPreviewAsset(metadataForIPFS);
      toast.info("Please sign the transaction");
      setProcessStep(2);
    } catch (error) {
      console.log(error);
      toast.error("Something went wrong!");
      setProcessStep(0);
    }
  }

  async function sendTransaction() {
    try {
      if (!activeAddress) {
        toast.error("Please connect your wallet");
        return;
      }
      if (!batchATC) {
        toast.error("Please create the transaction first");
        return;
      }
      setProcessStep(3);

      // Gather all transactions to sign in one batch for better UX
      const mintTxns = batchATC.buildGroup().map((t: any) => t.txn);
      const pinTxns: algosdk.Transaction[] = [];
      
      for (const cid of pinCids) {
        const pinAtc = new algosdk.AtomicTransactionComposer();
        pinAtc.addMethodCall(
          await makeCrustPinTx(
            cid,
            transactionSigner,
            activeAddress,
            algodClient
          )
        );
        const group = pinAtc.buildGroup();
        pinTxns.push(...group.map((t: any) => t.txn));
      }

      const allTxns = [...mintTxns, ...pinTxns];
      
      // Sign everything in one go (or one-by-one if Ledger Mode is on)
      const signedTxns = await walletSign(allTxns, transactionSigner, isLedger);
      
      if (!signedTxns || signedTxns.length === 0) {
        setProcessStep(2);
        return;
      }

      // 1. Send Mint Group
      const mintSigned = signedTxns.slice(0, mintTxns.length);
      const { txId } = await algodClient.sendRawTransaction(mintSigned).do();
      const result = await algosdk.waitForConfirmation(algodClient, txId, 4);
      setCreatedAssetID(result["asset-index"]);

      // 2. Send Pin Transactions
      const pinSigned = signedTxns.slice(mintTxns.length);
      if (pinSigned.length > 0) {
         toast.info("Sending IPFS Pin transactions...");
         for (const signed of pinSigned) {
           try {
             await algodClient.sendRawTransaction(signed).do();
           } catch (pinErr) {
             console.error("Pinning failed:", pinErr);
           }
         }
      }

      toast.success("Asset created successfully!");

      if (window.parent) {
        window.parent.postMessage({
          type: "WEN_TOOLS_MINT_SUCCESS",
          assetID: result["asset-index"],
        }, "*");
      }

      removeStoredData();
      setProcessStep(4);
    } catch (error) {
      console.log("Something went wrong: ", error);
      toast.error("Something went wrong!");
      setProcessStep(2);
    }
  }

  /** Remove the locally stored data */
  function removeStoredData() {
    setFormData(RESET);
    // setToken(RESET);
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-full gap-y-2 min-h-screen">
      <Meta 
        title="Simple Mint" 
        description="The easiest way to mint single or multiple assets on Algorand. A streamlined, practitioner-led minting utility for NFTs and tokens."
      />
      <h1 className="text-3xl font-extrabold bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent tracking-tight mt-6">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label || "Simple Mint"}
      </h1>
      <ConnectButton inmain={true} />

      <div className="w-full max-w-xl bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 md:p-8 mt-6 shadow-2xl space-y-6 text-left">
        {/* Custom Settings Toggle */}
        <div className="flex items-center justify-between p-4 bg-slate-900/60 border border-slate-800 rounded-xl">
          <div>
            <h3 className="text-sm font-bold text-white">Custom Settings</h3>
            <p className="text-xs text-slate-400">Enable advanced parameters & standards</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={isCustomMode}
              onChange={(e) => setIsCustomMode(e.target.checked)}
            />
            <div className="relative w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-orange"></div>
          </label>
        </div>

        {/* Inputs */}
        <div className={`grid grid-cols-1 ${isCustomMode ? 'md:grid-cols-2' : ''} gap-4`}>
          <div className="flex flex-col">
            <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              Name*
            </label>
            <input
              type="text"
              placeholder="Ex: USAlgo 001"
              className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
              maxLength={32}
              required
              value={formData.name}
              onChange={(e) => {
                setFormData({
                  ...formData,
                  name: e.target.value,
                });
              }}
            />
          </div>
          {isCustomMode && (
            <div className="flex flex-col animate-fadeIn">
              <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Unit name*
              </label>
              <input
                type="text"
                placeholder="Ex: USA001"
                className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                maxLength={8}
                required
                value={formData.unitName}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    unitName: e.target.value,
                  });
                }}
              />
            </div>
          )}
        </div>

        {/* Description in Simple Mode */}
        {!isCustomMode && (
          <div className="flex flex-col">
            <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              Description (optional)
            </label>
            <textarea
              placeholder="Describe your NFT..."
              className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium leading-normal text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all min-h-[90px]"
              maxLength={1000}
              value={formData.description}
              onChange={(e) => {
                setFormData({
                  ...formData,
                  description: e.target.value,
                });
              }}
            />
          </div>
        )}

        {/* Custom Supply and Decimals */}
        {isCustomMode && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
            <div className="flex flex-col">
              <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Total supply*
              </label>
              <input
                className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                type="number"
                max="18446744073709551615"
                min={1}
                required
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    totalSupply: e.target.value,
                  });
                }}
                placeholder="Recommended: 1 for NFTs"
                value={formData.totalSupply}
              />
            </div>
            <div className="flex flex-col">
              <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Decimals*
              </label>
              <input
                type="number"
                className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                max={19}
                min={0}
                required
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    decimals: e.target.value,
                  });
                }}
                value={formData.decimals}
                placeholder="Recommended: 0 for NFTs"
              />
            </div>
          </div>
        )}

        <div className={`grid grid-cols-1 ${isCustomMode ? 'md:grid-cols-2' : ''} gap-4`}>
          {finalFormat !== "Token" ? (
            <div className="flex flex-col">
              <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Select Image / Media*
              </label>
              <input
                className="block w-full text-sm border border-slate-700 rounded-xl cursor-pointer bg-slate-900/60 text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange file:mr-4 file:py-2.5 file:px-4 file:rounded-l-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-white hover:file:bg-slate-700 transition-all"
                id="select_image"
                type="file"
                accept="image/*,video/*,audio/*"
                multiple={false}
                required
                onChange={(e: any) => {
                  setFormData({
                    ...formData,
                    image: e.target.files[0],
                  });
                }}
              />
            </div>
          ) : (
            <div className="flex flex-col">
              <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                URL Field
              </label>
              <input
                className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                id="select_image"
                type="text"
                value={formData.urlField}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    urlField: e.target.value,
                  });
                }}
              />
            </div>
          )}

          {/* Format selector: only in Custom Mode */}
          {isCustomMode && (
            <div className="flex flex-col animate-fadeIn">
              <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Asset format*
              </label>
              <select
                className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                required
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    format: e.target.value,
                  });
                }}
                value={formData.format}
              >
                <option value="ARC3" className="bg-slate-900 text-white">ARC3 - Unchangeable</option>
                <option value="ARC19" className="bg-slate-900 text-white">ARC19 - Changeable Images and Data</option>
                <option value="ARC69" className="bg-slate-900 text-white">ARC69 - Changeable Data</option>
                <option value="Token" className="bg-slate-900 text-white">Token</option>
              </select>
            </div>
          )}
        </div>

        {finalFormat !== "Token" && (
          <div className="space-y-4">
            <div className="flex flex-col">
              <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                IPFS Pinning Provider*
              </label>
              {isTestnet ? (
                <div className="bg-slate-900/60 p-4 border border-slate-800 rounded-xl text-xs text-amber-500 font-medium">
                  Crust is disabled on Testnet. Pinata is used as the only IPFS pinning provider.
                </div>
              ) : (
                <div className="flex bg-slate-900/80 p-1.5 rounded-xl border border-slate-700 w-full">
                  <button
                    type="button"
                    className={`flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-300 ${
                      effectiveProvider === "crust"
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-md font-extrabold"
                        : "text-slate-400 hover:text-white"
                    }`}
                    onClick={() => setPinningProvider("crust")}
                  >
                    Crust Network
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-300 ${
                      effectiveProvider === "pinata"
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-md font-extrabold"
                        : "text-slate-400 hover:text-white"
                    }`}
                    onClick={() => setPinningProvider("pinata")}
                  >
                    Pinata (JWT)
                  </button>
                </div>
              )}
            </div>
            {effectiveProvider === "pinata" && (
              <div className="flex flex-col animate-fadeIn">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Pinata JWT Token*
                </label>
                <input
                  type="password"
                  placeholder="Paste Pinata JWT Token"
                  className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {/* Advanced configuration options only in Custom Mode */}
        {isCustomMode && (
          <div className="space-y-6 pt-4 border-t border-slate-800">
            {/* Advanced Flag Toggles */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Asset Management Flags</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-800 rounded-lg cursor-pointer hover:bg-slate-900/80 transition-all">
                  <span className="text-sm font-medium text-gray-200">Freeze</span>
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    id="freeze"
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        freeze: e.target.checked,
                      });
                    }}
                    checked={formData.freeze}
                  />
                  <div className="relative w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-orange"></div>
                </label>

                <label className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-800 rounded-lg cursor-pointer hover:bg-slate-900/80 transition-all">
                  <span className="text-sm font-medium text-gray-200">Clawback</span>
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    id="clawback"
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        clawback: e.target.checked,
                      });
                    }}
                    checked={formData.clawback}
                  />
                  <div className="relative w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-orange"></div>
                </label>

                <label className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-800 rounded-lg cursor-pointer hover:bg-slate-900/80 transition-all">
                  <span className="text-sm font-medium text-gray-200">Default Frozen</span>
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    id="defaultFrozen"
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        defaultFrozen: e.target.checked,
                      });
                    }}
                    checked={formData.defaultFrozen}
                  />
                  <div className="relative w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-orange"></div>
                </label>
              </div>
            </div>

            {/* Property Metadata */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Property Metadata</h4>
              {["external_url", "description"].map((key) => (
                <div className="flex gap-2" key={key}>
                  <div className="w-28 bg-slate-850 border border-slate-700 text-xs font-bold uppercase tracking-wider flex items-center justify-center text-slate-300 rounded-xl px-3 py-2 select-none">
                    {key === "external_url" ? "External URL" : "Description"}
                  </div>
                  <input
                    id={key}
                    type="text"
                    placeholder="(optional)"
                    className="flex-1 bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
                    value={formData[key]}
                    onChange={(e) => {
                      setFormData({ ...formData, [key]: e.target.value });
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Rarity Traits */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Rarity Traits</h4>
                  <p className="text-[10px] text-slate-500">Character attributes (e.g., Background, Eyes)</p>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 hover:border-orange-500/40 text-xs font-bold transition px-3 py-1.5"
                  onClick={() => {
                    let lastId = 0;
                    if (formData.traits.length > 0) {
                      lastId = formData.traits[formData.traits.length - 1].id;
                    }
                    setFormData({
                      ...formData,
                      traits: [
                        ...formData.traits,
                        { id: lastId + 1, category: "", name: "" },
                      ],
                    });
                  }}
                >
                  + Add Trait
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {formData.traits.map((metadata: any) => TraitMetadataInputField(metadata.id, "traits"))}
              </div>
            </div>

            <div className="border-t border-slate-800/60 my-4"></div>

            {/* Filters */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Filters</h4>
                  <p className="text-[10px] text-slate-500">Non-rarity search parameters</p>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 hover:border-orange-500/40 text-xs font-bold transition px-3 py-1.5"
                  onClick={() => {
                    let lastId = 0;
                    if (formData.filters.length > 0) {
                      lastId = formData.filters[formData.filters.length - 1].id;
                    }
                    setFormData({
                      ...formData,
                      filters: [
                        ...formData.filters,
                        { id: lastId + 1, category: "", name: "" },
                      ],
                    });
                  }}
                >
                  + Add Filter
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {formData.filters.map((metadata: any) => TraitMetadataInputField(metadata.id, "filters"))}
              </div>
            </div>

            <div className="border-t border-slate-800/60 my-4"></div>

            {/* Extras */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Extras</h4>
                  <p className="text-[10px] text-slate-500">Additional metadata properties</p>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 hover:border-orange-500/40 text-xs font-bold transition px-3 py-1.5"
                  onClick={() => {
                    let lastId = 0;
                    if (formData.extras.length > 0) {
                      lastId = formData.extras[formData.extras.length - 1].id;
                    }
                    setFormData({
                      ...formData,
                      extras: [
                        ...formData.extras,
                        { id: lastId + 1, category: "", name: "" },
                      ],
                    });
                  }}
                >
                  + Add Extra
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {formData.extras.map((metadata: any) => TraitMetadataInputField(metadata.id, "extras"))}
              </div>
            </div>
          </div>
        )}

        {previewAsset && (
          <div className="pt-4 border-t border-slate-800 animate-fadeIn">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Asset Preview</h4>
            <PreviewAssetComponent
              imageUrl={previewAsset.image}
              previewAsset={previewAsset}
            />
          </div>
        )}

        {/* Action Button Section */}
        <div className="flex flex-col justify-center items-center w-full pt-4 border-t border-slate-800 space-y-4">
          {processStep === 4 ? (
            <div className="w-full text-center space-y-3 bg-green-500/10 border border-green-500/20 p-4 rounded-xl">
              <p className="text-green-400 text-sm font-bold">
                🎉 Asset created successfully!
              </p>
              {createdAssetID && (
                <a
                  href={ASSET_PREVIEW + createdAssetID}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-primary-yellow hover:text-primary-yellow/80 transition font-bold text-base py-1 animate-pulse border-b border-primary-yellow/50"
                >
                  View Created Asset (Explorer)
                </a>
              )}
              <p className="text-slate-400 text-xs">
                You can reload the page if you want to use it again.
              </p>
            </div>
          ) : processStep === 3 ? (
            <div className="w-full py-4 text-center">
              <div className="spinner-border animate-spin inline-block w-8 h-8 border-4 border-t-orange-500 border-r-transparent rounded-full mb-2"></div>
              <p className="text-orange-400 animate-pulse text-sm font-bold">
                Processing transactions...
              </p>
            </div>
          ) : processStep === 2 ? (
            <div className="w-full space-y-4 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <p className="text-green-400 text-sm font-bold animate-pulse">
                ✓ Transaction created!
              </p>
              <div className="flex items-center justify-center gap-2">
                <input 
                  type="checkbox" 
                  id="ledger-mode" 
                  checked={isLedger} 
                  onChange={(e) => setIsLedger(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-primary-orange focus:ring-primary-orange"
                />
                <label htmlFor="ledger-mode" className="text-xs text-slate-300 cursor-pointer select-none">
                  Ledger Mode (Sign one-by-one)
                </label>
              </div>
              <button
                id="create_transactions_id"
                className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-black font-extrabold rounded-xl transition shadow-lg flex items-center justify-center gap-2"
                onClick={() => {
                  sendTransaction();
                }}
              >
                🚀 Step 2: Sign &amp; Submit
              </button>
            </div>
          ) : processStep === 1 ? (
            <div className="w-full py-4 text-center space-y-2">
              <div className="spinner-border animate-spin inline-block w-8 h-8 border-4 border-t-orange-500 border-r-transparent rounded-full"></div>
              <p className="text-slate-400 text-sm font-medium">Creating transactions...</p>
            </div>
          ) : (
            <button
              id="step1-mint-btn"
              className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-black font-extrabold rounded-xl transition shadow-lg text-base flex items-center justify-center gap-2 animate-fadeIn"
              onClick={mint}
            >
              🪙 Step 1: Mint Asset
            </button>
          )}
        </div>

        <p className="text-xs font-semibold text-slate-400 text-center mt-2">
          {effectiveProvider === "crust" ? (
            <span>Pin Fee (Crust): {finalFormat === "ARC69" ? "1.4 ALGO" : finalFormat === "Token" ? "Free" : "2.8 ALGO"}</span>
          ) : (
            <span>Pin Fee (Pinata): Free (requires custom Pinata JWT)</span>
          )}
        </p>

        <div className="pt-2 text-center flex justify-center">
          <button
            onClick={() => {
              removeStoredData();
              window.location.reload();
            }}
            className="text-xs font-bold text-red-400 hover:text-red-300 transition-colors uppercase tracking-wider bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 px-4 py-2 rounded-xl"
          >
            Clear &amp; Start Over
          </button>
        </div>
      </div>

      <IntegratorPortal />
      <FaqSectionComponent
        faqData={[
          {
            question: "What is Simple Mint?",
            answer:
              "Simple Mint is a tool that allows you to mint NFTs and tokens on the Algorand blockchain in any of the major standards.",
          },
          {
            question: "How much does it cost to Mint?",
            answer:
              "There is a network fee of 0.1A. In total you need to have at least 0.2A in your wallet before minting.",
          },
          {
            question: "Can I mint a token or memecoin?",
            answer:
              "Yes! You can mint a token by selecting the token option on the dropdown.",
          },
        ]}
      />
      {/* Practitioner Section: Minting Ethics & Best Practices */}
      <section className="mt-20 pt-12 border-t border-slate-800 w-full max-w-4xl text-left px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Asset Scarcity & Utility</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              When minting on Algorand, consider the long-term utility of your asset. NFTs (Total Supply: 1, Decimals: 0) are perfect for art, while fungible tokens are better suited for community rewards or governance. Choosing the right ARC standard (ARC-3 vs ARC-19) is a critical design decision for your project's roadmap.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">IPFS Resilience</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Decentralized storage is only as strong as its pinning strategy. Simple Mint automates pinning to the Crust Network, but for high-value collections, we recommend redundant pinning across multiple providers to ensure your media remains available through all network conditions.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
