import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

import algosdk from "algosdk";
import { toast } from "react-toastify";
import { useAtom } from "jotai";
import { atomWithStorage, RESET } from "jotai/utils";
import { Button } from "@mui/material";
import { createAssetMintArrayV2 } from "../utils";
import { ASSET_PREVIEW, TOOLS } from "../constants";
import FaqSectionComponent from "../components/FaqSectionComponent";
import { pinImageToCrust } from "../crust";
import { useWallet } from "@txnlab/use-wallet-react";
import "react-json-view-lite/dist/index.css";
import { PreviewAssetComponent } from "../components/PreviewAssetComponent";
import ConnectButton from "../components/ConnectButton";

const reallySimpleMintAtom = atomWithStorage("reallySimpleMint", {
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
  traits: [{ id: 1, category: "", name: "" }],
  filters: [{ id: 1, category: "", name: "" }],
  extras: [{ id: 1, category: "", name: "" }],
} as any);

export function ReallySimpleMint() {
  const [formData, setFormData] = useAtom(reallySimpleMintAtom);
  const [processStep, setProcessStep] = useState(0);

  const [createdAssetID, setCreatedAssetID] = useState(null);

  // batchATC is a AtomicTransactionComposer to batch and send all transactions
  const [batchATC, setBatchATC] = useState(null as any);
  const { activeAddress, algodClient, transactionSigner } = useWallet();
  const [previewAsset, setPreviewAsset] = useState(null as any);
  const [showIntegratorPortal, setShowIntegratorPortal] = useState(false);
  const [searchParams] = useSearchParams();
  const [extraFee, setExtraFee] = useState<number | null>(null);
  const [extraFeeAddress, setExtraFeeAddress] = useState<string | null>(null);

  useEffect(() => {
    // Handle query parameters
    const name = searchParams.get("name");
    const unitName = searchParams.get("unitName");
    const description = searchParams.get("description");
    const external_url = searchParams.get("external_url");
    const totalSupply = searchParams.get("totalSupply");
    const decimals = searchParams.get("decimals");
    const format = searchParams.get("format");
    const imageUrl = searchParams.get("image_url");
    const exFee = searchParams.get("extraFee");
    const exFeeAddr = searchParams.get("extraFeeAddress");
    const autoMint = searchParams.get("autoMint");

    const newFormData = { ...formData };
    if (name) newFormData.name = name;
    if (unitName) newFormData.unitName = unitName;
    if (description) newFormData.description = description;
    if (external_url) newFormData.external_url = external_url;
    if (totalSupply) newFormData.totalSupply = parseInt(totalSupply);
    if (decimals) newFormData.decimals = parseInt(decimals);
    if (format) newFormData.format = format;

    if (exFee) setExtraFee(parseInt(exFee));
    if (exFeeAddr) setExtraFeeAddress(exFeeAddr);

    setFormData(newFormData);

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
        const msgFormData = { ...formData };
        if (data.name) msgFormData.name = data.name;
        if (data.unitName) msgFormData.unitName = data.unitName;
        if (data.description) msgFormData.description = data.description;
        if (data.external_url) msgFormData.external_url = data.external_url;
        if (data.totalSupply) msgFormData.totalSupply = data.totalSupply;
        if (data.decimals) msgFormData.decimals = data.decimals;
        if (data.format) msgFormData.format = data.format;
        else msgFormData.format = "ARC69";
        if (data.image) msgFormData.image = data.image; // Should be a File or Blob

        if (data.extraFee) setExtraFee(data.extraFee);
        if (data.extraFeeAddress) setExtraFeeAddress(data.extraFeeAddress);

        setFormData(msgFormData);
        
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
  }, []);

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
                     href="/really-simple-mint?name=MyIntegratorNFT&image_url=https://ipfs.io/ipfs/QmQ6y8nS6p3gH8T9K8Vv...&extraFee=1000000&extraFeeAddress=MYWALLET..."
                     className="text-xs text-blue-400 hover:underline break-all"
                   >
                     Example: wen.tools/really-simple-mint?name=NFT&image_url=...
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
  src="https://wen.tools/really-simple-mint"
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

  async function mint() {
    if (!activeAddress) {
      toast.error("Please connect your wallet");
      return;
    }

    if (formData.name === "") {
      toast.error("Please enter a name");
      return;
    }

    if (formData.image === null || !(formData.image instanceof File)) {
      toast.error("Please select an image");
      return;
    }

    setProcessStep(1);
    toast.info("Uploading the image to IPFS...");

    let imageCID = "";
    let authBasic = localStorage.getItem("authBasic");
    if (!authBasic) {
      // Hardcoded emergency auth
      authBasic = "YWxnby1CQ0FQV0pBTFdBM04zRUlaUkZDTzU1UFEzWUJZQ1NHUFpYTkRIT09BNlI3Q0dIVElTVjJHQ1NZQzZZOkZyYjl6RWhudVVKZ0ZaY0d1cmRTUE45dW1SL1hHMnRlalc0VFpkb3huN3ZXMTVKOFd6TGMva3R2LytnMklWRVFRMVN4Vnk3N0plZ3laZkVKMkRxaEFRPT0=";
      localStorage.setItem("authBasic", authBasic);
    }

    try {
      imageCID = await pinImageToCrust(authBasic, formData.image);
    } catch (error) {
      console.error(error);
      toast.error("Failed to upload image");
      setProcessStep(0);
      return;
    }

    const imageURL = "ipfs://" + imageCID;
    const metadata: any = {
      name: formData.name,
      standard: formData.format.toLocaleLowerCase(),
      properties: {},
    };

    if (formData.image.type && formData.image.type.includes("video")) {
      metadata.animation_url = imageURL;
      metadata.animation_url_mime_type = formData.image ? formData.image.type : "";
    } else {
      metadata.image = imageURL;
      metadata.image_mime_type = formData.image ? formData.image.type : "";
    }

    let imageURLForPreview;

    try{
      imageURLForPreview = URL.createObjectURL(formData.image);
    }catch(e){
      imageURLForPreview = "";
      console.error(e);
      setProcessStep(0);
      return;
    }

    let metadataForIPFS: any = {
      asset_name: formData.name,
      unit_name: formData.unitName,
      has_clawback: formData.clawback ? "Y" : "N",
      has_freeze: formData.freeze ? "Y" : "N",
      default_frozen: formData.defaultFrozen ? "Y" : "N",
      decimals: formData.decimals,
      total_supply: formData.totalSupply,
      ipfs_data: metadata,
      image: imageURLForPreview,
    };

    metadata.properties = metadata.properties.traits;
    metadataForIPFS = {
      ...metadataForIPFS,
      asset_note: metadata,
      asset_url: imageURL,
    };

    const batchATC = await createAssetMintArrayV2(
      [metadataForIPFS],
      activeAddress,
      algodClient,
      transactionSigner,
      [imageCID],
      extraFee || undefined,
      extraFeeAddress || undefined
    );
    setBatchATC(batchATC);
    setPreviewAsset(metadataForIPFS);

    toast.info("Please sign the transaction");
    setProcessStep(2);
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

      const txres = await batchATC.execute(algodClient, 4);

      if (!txres || !txres.txIDs || txres.txIDs.length === 0) {
        // err tx
        console.error(
          "transaction submit error, batchATC.execute return : ",
          txres
        );
        toast.error("transaction submit error");
        return;
      }

      const assetCreateTxID = txres.txIDs[0];
      const result = await algosdk.waitForConfirmation(algodClient, assetCreateTxID, 3);
      const newAssetID = result["asset-index"];

      setCreatedAssetID(newAssetID);
      removeStoredData(); // Remove stored data now that mint is complete
      toast.success("Asset created successfully!");
      if (window.parent) {
        window.parent.postMessage({
          type: "WEN_TOOLS_MINT_SUCCESS",
          assetID: newAssetID
        }, "*");
      }
      setProcessStep(4);
    } catch (error) {
      console.error("Something went wrong: ", error);
      toast.error("Something went wrong!");
      setProcessStep(2);
    }
  }

  /** Remove the locally stored data */
  function removeStoredData() {
    setFormData(RESET);
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-full gap-y-2 min-h-screen">
      <h1 className="text-2xl font-bold mt-6">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </h1>
      <ConnectButton inmain={true} />
      <div className="mt-4 md:flex items-center text-start gap-x-4">
        <div className="flex flex-col md:mt-0 mt-2">
          <label className="mb-2 text-sm leading-none text-gray-200">
            Name*
          </label>
          <input
            type="text"
            placeholder="Ex: My First NFT"
            className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
            maxLength={32}
            required
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
          />
        </div>
      </div>
      <div className="mt-4 md:flex items-center text-start gap-x-4">
        <div className="flex flex-col md:mt-0 mt-4">
          <label className="mb-2 text-sm leading-none text-gray-200">
            Select Image*
          </label>
          <input
            className="block w-64 text-sm border border-gray-200 rounded cursor-pointer bg-gray-300  focus:outline-none  text-black font-medium"
            id="select_image"
            type="file"
            accept="image/*,video/*"
            multiple={false}
            required
            onChange={(e: any) => setFormData({...formData, image: e.target.files[0]})}
          />
        </div>
      </div>

      {previewAsset && (
        <PreviewAssetComponent
          imageUrl={previewAsset.image}
          previewAsset={previewAsset}
        />
      )}
      <div className="flex flex-col justify-center items-center w-[16rem]">
        {processStep === 4 ? (
          <>
            <p className="pt-4 text-green-500 text-sm">
              Asset created successfully!
              <br />
            </p>
            {createdAssetID && (
              <a
                href={ASSET_PREVIEW + createdAssetID}
                target="_blank"
                rel="noreferrer"
                className="text-primary-yellow hover:text-primary-yellow/80 transition text-lg py-2 animate-pulse"
              >
                View the Created Asset (May take up to 30s to Load)
              </a>
            )}
            <p className="pb-2 text-slate-400 text-xs">
              You can reload the page if you want to use again.
            </p>
          </>
        ) : processStep === 3 ? (
          <>
            <p className="pt-4 text-green-500 animate-pulse text-sm">
              Sending transaction...
            </p>
          </>
        ) : processStep === 2 ? (
          <>
            <p className="mt-1 text-green-200/60 text-sm animate-pulse">
              Transaction created!
            </p>
            <button
              id="create_transactions_id"
              className="rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black/90 font-semibold px-4 py-1 mt-2"
              onClick={() => sendTransaction()}
            >
              Step 2: Sign
            </button>
          </>
        ) : processStep === 1 ? (
          <div className="mx-auto flex flex-col">
            <div className="spinner-border animate-spin inline-block mx-auto w-8 h-8 border-4 rounded-full" role="status"></div>
            Creating transaction...
          </div>
        ) : (
          <button
            id="step1-mint-btn"
            className="rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black/90 font-semibold px-4 py-1 mt-2"
            onClick={mint}
          >
            Step 1: Mint
          </button>
        )}
      </div>
      <p className="text-sm italic text-slate-200 mb-6">
        Pin Fee: 1.4A
      </p>
      <Button
        variant="outlined"
        color="error"
        onClick={() => {
          removeStoredData();
          window.location.reload();
        }}
      >
        Clear &amp; start over
      </Button>
      <IntegratorPortal />
      <FaqSectionComponent
        faqData={[
          {
            question: "What is Really Simple Mint?",
            answer: "Really Simple Mint is a tool that allows you to mint NFTs on the Algorand blockchain in the ARC-69 standard.",
          },
          {
            question: "How much does it cost to Mint?",
            answer:
              "There is a network fee of 0.1A and a pinning fee of 1.4A. In total you need to have at least 1.6A in your wallet available before minting.",
          },
          {
            question: "I am coming in from Algorand and am having some issues",
            answer:
              "You need to sign the arbitrary data message when logging into the website. If you don't it will say upload failed. In addition, you need to use your phone's browser or a computer to use the website, uploading an image from Pera's in-app browser does not work. Finally this tool only works with Pera Wallet.",
          },
          {
            question: "Can I mint a token or memecoin?",
            answer: "No, you can only mint an ARC-69 NFT.",
          },
        ]}
      />
    </div>
  );
}



