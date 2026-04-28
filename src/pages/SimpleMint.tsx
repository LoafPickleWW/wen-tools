import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

import algosdk from "algosdk";
import { toast } from "react-toastify";
import { useAtom } from "jotai";
import { atomWithStorage, RESET } from "jotai/utils";
import { Button } from "@mui/material";
import {
  createARC3AssetMintArrayV2,
  createARC19AssetMintArrayV2,
  createAssetMintArrayV2,
} from "../utils";
import { ASSET_PREVIEW, TOOLS } from "../constants";
import FaqSectionComponent from "../components/FaqSectionComponent";
import { pinImageToCrust, makeCrustPinTx } from "../crust";
import { useWallet } from "@txnlab/use-wallet-react";
import "react-json-view-lite/dist/index.css";
import { PreviewAssetComponent } from "../components/PreviewAssetComponent";
import ConnectButton from "../components/ConnectButton";

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

export function SimpleMint() {
  const [formData, setFormData] = useAtom(simpleMintAtom);
  const [processStep, setProcessStep] = useState(0);

  const [createdAssetID, setCreatedAssetID] = useState(null);

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
    return (
      <div key={id} id={`metadata-${id}`} className="mb-2">
        <input
          type="text"
          id={`category-${id}`}
          placeholder={type.slice(0, -1)}
          className="w-24 md:w-28 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-xs px-3 py-2 border rounded border-gray-200"
          value={
            formData[type].find((metadata: any) => metadata.id === id).category
          }
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
          placeholder="value"
          className="w-24 md:w-28 bg-gray-300 text-sm ml-2 font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-sm px-3 py-2 border rounded border-gray-200"
          value={
            formData[type].find((metadata: any) => metadata.id === id).name
          }
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
          className="rounded bg-primary-red text-lg hover:bg-red-600 transition text-white ml-2 px-4"
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
          -
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
        formData.format !== "Token" &&
        (formData.image === null || !(formData.image instanceof File))
      ) {
        toast.error("Please select an image");
        return;
      }
      setProcessStep(1);
      const metadata: any = {
        name: formData.name,
        standard: formData.format.toLocaleLowerCase(),
        properties: {},
      };
      if (formData.external_url !== "") {
        metadata.external_url = formData.external_url;
      }
      if (formData.description !== "") {
        metadata.description = formData.description;
      }
      if (formData.traits.length > 0) {
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
      if (formData.filters.length > 0) {
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
      if (formData.extras.length > 0) {
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
      let imageURL;
      let imageCID = null;
      if (formData.format === "Token") {
        imageURL = formData.urlField;
      } else {
        if (formData.image === null || !(formData.image instanceof File)) {
          toast.error("Please select an image");
          return;
        }
        toast.info("Uploading the image to IPFS...");
        let authBasic = localStorage.getItem("authBasic");
        if (!authBasic) {
          // Hardcoded emergency auth
          authBasic = "YWxnby1CQ0FQV0pBTFdBM04zRUlaUkZDTzU1UFEzWUJZQ1NHUFpYTkRIT09BNlI3Q0dIVElTVjJHQ1NZQzZZOkZyYjl6RWhudVVKZ0ZaY0d1cmRTUE45dW1SL1hHMnRlalc0VFpkb3huN3ZXMTVKOFd6TGMva3R2LytnMklWRVFRMVN4Vnk3N0plZ3laZkVKMkRxaEFRPT0=";
          localStorage.setItem("authBasic", authBasic);
        }
        imageCID = await pinImageToCrust(authBasic, formData.image);
        imageURL = "ipfs://" + imageCID;
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
        imageURLForPreview = URL.createObjectURL(formData.image);
      }catch(e){
        imageURLForPreview = "";
        console.error(e);
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
      if (formData.format === "ARC3") {
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

        // Bundle IPFS pins into the same atomic group (max 16 txns)
        for (const cid of cids) {
          atc.addMethodCall(
            await makeCrustPinTx(
              cid,
              transactionSigner,
              activeAddress,
              algodClient
            )
          );
        }

        setBatchATC(atc);
      } else if (formData.format === "ARC19") {
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

        for (const cid of cids) {
          atc.addMethodCall(
            await makeCrustPinTx(
              cid,
              transactionSigner,
              activeAddress,
              algodClient
            )
          );
        }
        setBatchATC(atc);
      } else if (formData.format === "ARC69" || formData.format === "Token") {
        metadata.properties = metadata.properties.traits;
        metadataForIPFS = {
          ...metadataForIPFS,
          asset_note: metadata,
          asset_url: imageURL,
        };

        if (formData.format === "ARC69") {
          const { atc, pinCids: cids } = await createAssetMintArrayV2(
            [metadataForIPFS],
            activeAddress,
            algodClient,
            transactionSigner,
            [imageCID],
            extraFee || undefined,
            extraFeeAddress || undefined
          );

          for (const cid of cids) {
            atc.addMethodCall(
              await makeCrustPinTx(
                cid,
                transactionSigner,
                activeAddress,
                algodClient
              )
            );
          }
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

          for (const cid of cids) {
            atc.addMethodCall(
              await makeCrustPinTx(
                cid,
                transactionSigner,
                activeAddress,
                algodClient
              )
            );
          }
          setBatchATC(atc);
        }
      } else {
        toast.error("Invalid ARC format");
        return;
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

      // Use atc.execute for robust signing and submission of the entire group
      const { txIDs } = await batchATC.execute(algodClient, 4);
      const txId = txIDs[0];
      const result = await algosdk.waitForConfirmation(
        algodClient,
        txId,
        4
      );

      setCreatedAssetID(result["asset-index"]);
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
            placeholder="Ex: USAlgo 001"
            className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
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
        <div className="flex flex-col md:mt-0 mt-4">
          <label className="mb-2 text-sm leading-none text-gray-200">
            Unit name*
          </label>
          <input
            type="text"
            placeholder="Ex: USA001"
            className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
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
      </div>
      <div className="mt-4 md:flex items-center text-start gap-x-4">
        <div className="flex flex-col">
          <label className="mb-2 text-sm leading-none text-gray-200">
            Total supply*
          </label>
          <input
            className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-sm px-3 py-2 border rounded border-gray-200"
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
        <div className="flex flex-col md:mt-0 mt-4">
          <label className="mb-2 text-sm leading-none text-gray-200">
            Decimals*
          </label>
          <input
            type="number"
            className="w-64 bg-gray-300 text-sm font-medium text-center leading-none placeholder:text-sm text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
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
      <div className="mt-4 md:flex items-center text-start gap-x-4">
        {formData.format !== "Token" ? (
          <div className="flex flex-col md:mt-0 mt-4">
            <label className="mb-2 text-sm leading-none text-gray-200">
              Select Image*
            </label>
            <input
              className="block w-64 text-sm border border-gray-200 rounded cursor-pointer bg-gray-300  focus:outline-none  text-black font-medium"
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
          <div className="flex flex-col md:mt-0 mt-4">
            <label className="mb-2 text-sm leading-none text-gray-200">
              URL Field
            </label>
            <input
              className="w-64 bg-gray-300 text-sm font-medium text-center leading-none placeholder:text-sm text-black placeholder:text-black/30 px-3 py-1 border rounded border-gray-200"
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
        <div className="flex flex-col md:mt-0 mt-4">
          <label className="mb-2 text-sm leading-none text-gray-200">
            Asset format*
          </label>
          <div className="inline-flex items-center space-x-2">
            <select
              className="bg-gray-300 rounded border-gray-300 font-medium text-center text-black transition px-2 py-1 w-64"
              required
              onChange={(e) => {
                setFormData({
                  ...formData,
                  format: e.target.value,
                });
              }}
              value={formData.format}
            >
              <option value="ARC3">ARC3 - Unchangeable</option>
              <option value="ARC19">ARC19 - Changeable Images and Data</option>
              <option value="ARC69">ARC69- Changeable Data</option>
              <option value="Token">Token</option>
            </select>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-row items-center text-start justify-center gap-x-4">
        <label className="relative inline-flex items-center cursor-pointer">
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
          <div className="w-11 h-6 bg-gray-400 peer-focus:outline-none peer-focus:ring-4  rounded-full peer  peer-checked:after:translate-x-full  after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-blue-600"></div>
          <span className="ml-3 text-sm font-medium text-gray-300">Freeze</span>
        </label>
        <label className="relative inline-flex items-center cursor-pointer">
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
          <div className="w-11 h-6 bg-gray-400 peer-focus:outline-none peer-focus:ring-4  rounded-full peer  peer-checked:after:translate-x-full  after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-blue-600"></div>
          <span className="ml-3 text-sm font-medium text-gray-300">
            Clawback
          </span>
        </label>
      </div>
      <label className="relative inline-flex items-center cursor-pointer mt-1">
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
        <div className="w-11 h-6 bg-gray-400 peer-focus:outline-none peer-focus:ring-4  rounded-full peer  peer-checked:after:translate-x-full  after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-blue-600"></div>
        <span className="ml-2 text-sm font-medium text-gray-300">
          Default Frozen
        </span>
      </label>
      <p className="focus:outline-none text-sm font-semibold text-lg leading-tight text-gray-200 mt-2">
        Property Metadata
      </p>
      {["external_url", "description"].map((key) => {
        return (
          <div className="mb-2" key={key}>
            <input
              type="text"
              disabled
              id={`${key}-label`}
              className="w-24 md:w-28 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-xs px-3 py-2 border rounded border-gray-200"
              value={key}
            />
            <input
              id={key}
              type="text"
              placeholder="(optional)"
              className="w-24 md:w-28 bg-gray-300 text-sm ml-2 font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-sm px-3 py-2 border rounded border-gray-200"
              value={formData[key]}
              onChange={(e) => {
                setFormData({ ...formData, [key]: e.target.value });
              }}
            />
          </div>
        );
      })}
      <p className="focus:outline-none text-sm font-semibold text-xl leading-tight text-gray-200 mt-2">
        Rarity Traits
      </p>
      <div className="md:flex flex-col items-center text-start justify-center">
        {formData.traits.map((metadata: any) => {
          return TraitMetadataInputField(metadata.id, "traits");
        })}
      </div>
      <button
        className="rounded-md bg-primary-orange hover:bg-green-600 transition text-black px-4 py-1"
        onClick={() => {
          let lastId;
          try {
            lastId = formData.traits[formData.traits.length - 1].id;
          } catch (err) {
            console.error(err);
            lastId = 0;
          }
          setFormData({
            ...formData,
            traits: [
              ...formData.traits,
              {
                id: lastId + 1,
                category: "",
                name: "",
              },
            ],
          });
        }}
      >
        +
      </button>
      <p className="focus:outline-none text-sm font-semibold text-xl leading-tight text-gray-200 mt-2">
        Non-Rarity Traits
      </p>
      <p className="focus:outline-none text-sm font-light leading-tight text-gray-200 mt-2">
        Filters
      </p>
      <div className="md:flex flex-col items-center text-start justify-center">
        {formData.filters.map((metadata: any) => {
          return TraitMetadataInputField(metadata.id, "filters");
        })}
      </div>
      <button
        className="rounded-md bg-primary-orange hover:bg-green-600 transition text-black px-4 py-1"
        onClick={() => {
          let lastId;
          try {
            lastId = formData.filters[formData.filters.length - 1].id;
          } catch (err) {
            console.error(err);
            lastId = 0;
          }
          setFormData({
            ...formData,
            filters: [
              ...formData.filters,
              {
                id: lastId + 1,
                category: "",
                name: "",
              },
            ],
          });
        }}
      >
        +
      </button>
      <div className="border-b-2 border-gray-400 w-1/2 my-4"></div>
      <p className="focus:outline-none text-sm font-light leading-tight text-gray-200">
        Extras
      </p>
      <div className="md:flex flex-col items-center text-start justify-center">
        {formData.extras.map((metadata: any) => {
          return TraitMetadataInputField(metadata.id, "extras");
        })}
      </div>
      <button
        className="rounded-md bg-primary-orange hover:bg-green-600 transition text-black px-4 py-1"
        onClick={() => {
          let lastId;
          try {
            lastId = formData.extras[formData.extras.length - 1].id;
          } catch (err) {
            console.error(err);
            lastId = 0;
          }
          setFormData({
            ...formData,
            extras: [
              ...formData.extras,
              {
                id: lastId + 1,
                category: "",
                name: "",
              },
            ],
          });
        }}
      >
        +
      </button>
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
              onClick={() => {
                sendTransaction();
              }}
            >
              Step 2: Sign
            </button>
          </>
        ) : processStep === 1 ? (
          <div className="mx-auto flex flex-col">
            <div
              className="spinner-border animate-spin inline-block mx-auto w-8 h-8 border-4 rounded-full"
              role="status"
            ></div>
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
        Pin Fee: Arc69 - 1.4A, Arc3/19 - 2.8A, Token - Free
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
    </div>
  );
}
