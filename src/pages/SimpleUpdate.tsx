import { useState } from "react";
import algosdk from "algosdk";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import axios from "axios";
import { useAtom } from "jotai";
import { atomWithStorage, RESET } from "jotai/utils";
import {
  createAssetConfigArray,
  sliceIntoChunks,
  Arc69,
  getARC19AssetMetadataData,
  updateARC19AssetMintArray,
  updateARC19AssetMintArrayV2,
  walletSign,
  pinImageToPinata,
} from "../utils";
import { TOOLS, IPFS_ENDPOINT, ASSET_PREVIEW } from "../constants";
import { isCrustAuth } from "../crust-auth";
import { pinImageToCrust, makeCrustPinTx } from "../crust";
import { useWallet } from "@txnlab/use-wallet-react";
import "react-json-view-lite/dist/index.css";
import { PreviewAssetComponent } from "../components/PreviewAssetComponent";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

const simpleUpdateAtom = atomWithStorage("simpleUpdate", {
  name: "",
  unitName: "",
  totalSupply: 1,
  decimals: 0,
  image: null,
  format: "",
  freeze: false,
  clawback: false,
  image_url: "",
  image_mime_type: "",
  description: "",
  external_url: "",
  traits: [],
  filters: [],
  extras: [],
} as any);
const suAssetIdAtom = atomWithStorage("suAssetId", "");
const suTokenAtom = atomWithStorage("suToken", "");
const simpleUpdateProviderAtom = atomWithStorage("simpleUpdateProvider", "crust");

export function SimpleUpdate() {
  const [formData, setFormData] = useAtom(simpleUpdateAtom);
  const [pinningProvider, setPinningProvider] = useAtom(simpleUpdateProviderAtom);
  const [token, setToken] = useAtom(suTokenAtom);

  const [processStep, setProcessStep] = useState(0);
  const [transaction, setTransaction] = useState(null as any);
  const [previewAsset, setPreviewAsset] = useState(null as any);
  const [assetID, setAssetID] = useAtom(suAssetIdAtom);
  const [removeFreeze, setRemoveFreeze] = useState(false);
  const [removeClawback, setRemoveClawback] = useState(false);
  const navigate = useNavigate();

  // batchATC is a AtomicTransactionComposer to batch and send all transactions
  const [batchATC, setBatchATC] = useState(null as any);
  const { activeAddress, activeNetwork, algodClient, transactionSigner } =
    useWallet();
  const isTestnet = activeNetwork === "testnet";
  const effectiveProvider = isTestnet ? "pinata" : pinningProvider;

  const TraitMetadataInputField = (id: any, type: string) => {
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
          readOnly={formData.format === "ARC3"}
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
          readOnly={formData.format === "ARC3"}
        />
        {formData.format !== "ARC3" && (
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
        )}
      </div>
    );
  };

  async function getAssetData() {
    try {
      const assetID = (document.getElementById("asset_id") as HTMLInputElement)
        ?.value;
      if (assetID === "") {
        toast.error("Please enter an asset ID");
        return;
      }
      setAssetID(assetID);
      const assetData = await algodClient.getAssetByID(Number(assetID)).do();

      function findFormat(url: string) {
        if (!url) {
          return "Token";
        }
        if (url.includes("template-ipfs")) {
          return "ARC19";
        } else if (url.includes("#arc3")) {
          return "ARC3";
        } else if (url.includes("ipfs://") || url.includes("ipfs/")) {
          return "ARC69";
        } else {
          return "Token";
        }
      }
      const assetFormat = findFormat(assetData.params["url"]);
      let assetMetadata: any = {};
      if (assetFormat === "ARC19") {
        assetMetadata = await getARC19AssetMetadataData(
          assetData.params["url"],
          assetData.params["reserve"]
        );
      } else if (assetFormat === "ARC69") {
        const arc69 = new Arc69();
        assetMetadata = await arc69.fetch(Number(assetID), activeNetwork);
        if (assetMetadata.attributes && !assetMetadata.properties) {
          assetMetadata.properties = assetMetadata.attributes;
          delete assetMetadata.attributes;
          assetMetadata.properties = assetMetadata.properties.reduce(
            (obj: any, item: any) => {
              obj[item.trait_type] = item.value;
              return obj;
            }
          );
        }
      } else if (assetFormat === "ARC3") {
        if (assetData.params["url"].startsWith("ipfs://")) {
          assetMetadata = await axios
            .get(IPFS_ENDPOINT + assetData.params["url"].replace("ipfs://", ""))
            .then((res) => res.data);
        } else {
          assetMetadata = await axios
            .get(assetData.params["url"])
            .then((res) => res.data);
        }
      } else {
        // Token format - no complex metadata parsing
        assetMetadata = {};
      }
      const metadata: any = {
        filters: [],
        traits: [],
        extras: [],
      };

      if (assetMetadata.properties) {
        for (const key in assetMetadata.properties) {
          if (typeof assetMetadata.properties[key] === "object") {
            for (const subKey in assetMetadata.properties[key]) {
              metadata[key][subKey] = assetMetadata.properties[key][subKey];
            }
          } else {
            if (!key.includes("image_static")) {
              metadata.traits[key] = assetMetadata.properties[key];
            }
          }
        }
      }

      setFormData({
        ...formData,
        name: assetData.params["name"],
        unitName: assetData.params["unit-name"],
        totalSupply: assetData.params["total"],
        decimals: assetData.params["decimals"],
        freeze: assetData.params["freeze"],
        clawback: assetData.params["clawback"],
        format: assetFormat,
        description: assetMetadata.description || "",
        external_url: assetMetadata.external_url || "",
        traits: Object.keys(metadata.traits || {}).map((key, index) => ({
          id: index,
          category: key,
          name: metadata.traits[key],
        })),
        filters: Object.keys(metadata).includes("filters")
          ? Object.keys(metadata.filters || {}).map((key, index) => ({
            id: index,
            category: key,
            name: metadata.filters[key],
          }))
          : [],
        extras: Object.keys(metadata).includes("extras")
          ? Object.keys(metadata.extras || {}).map((key, index) => ({
            id: index,
            category: key,
            name: metadata.extras[key],
          }))
          : [],
        image_url: assetMetadata.image || assetData.params["url"] || "",
        image_mime_type: assetMetadata.image_mime_type,
        animation_url: assetMetadata.animation_url || assetData.params["url"],
        animation_mime_type: assetMetadata.animation_mime_type,
      });

      setRemoveFreeze(false);
      setRemoveClawback(false);
    } catch (err: any) {
      console.error(err);
      if (err.response) {
        toast.error(err.response.data.message);
      } else {
        toast.error(err.message);
      }
      setAssetID("");
    }
  }

  async function update() {
    let imageCid = null;
    try {
      if (!activeAddress) {
        toast.error("Please connect your wallet");
        return;
      }
      if (
        formData.name === "" ||
        formData.unitName === "" ||
        formData.totalSupply === "" ||
        formData.decimals === "" ||
        (!isCrustAuth() && formData.format === "ARC19" && effectiveProvider === "crust")
      ) {
        toast.error("Please fill all the required fields");
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

      if (
        formData.image &&
        formData.image instanceof File &&
        formData.format === "ARC19"
      ) {
        toast.info("Uploading the image to IPFS...");

        if (effectiveProvider === "crust") {
          const atoken = localStorage.getItem("authBasic");
          imageCid = await pinImageToCrust(atoken, formData.image);
          const imageURL = "ipfs://" + imageCid;
          if (
            formData.image &&
            formData.image instanceof File &&
            formData.image.type.includes("video")
          ) {
            metadata.animation_url = imageURL;
            metadata.animation_mime_type = formData.image
              ? formData.image.type
              : "";
          } else {
            metadata.image = imageURL;
            metadata.image_mime_type = formData.image ? formData.image.type : "";
          }
        } else {
          if (!token) {
            toast.error("Please enter a Pinata JWT token");
            return;
          }
          const cid = await pinImageToPinata(token, formData.image);
          const imageURL = "ipfs://" + cid;
          if (
            formData.image &&
            formData.image instanceof File &&
            formData.image.type.includes("video")
          ) {
            metadata.animation_url = imageURL;
            metadata.animation_mime_type = formData.image
              ? formData.image.type
              : "";
          } else {
            metadata.image = imageURL;
            metadata.image_mime_type = formData.image ? formData.image.type : "";
          }
        }
      } else if (formData.format === "ARC3") {
        throw Error("ARC3 assets can't be updated");
      } else if (formData.format === "Token") {
        if (formData.image_url) {
          metadata.image = formData.image_url;
        }
      } else {
        if (formData.image_mime_type) {
          metadata.image_mime_type = formData.image_mime_type;
        }
        if (formData.image_url) {
          metadata.image = formData.image_url;
        }
        if (formData.animation_url) {
          metadata.animation_url = formData.animation_url;
        }
        if (formData.animation_mime_type) {
          metadata.animation_mime_type = formData.animation_mime_type;
        }
      }

      let ipfs_data;
      if (formData.format === "ARC19") {
        const transaction_data = {
          asset_id: assetID,
          ipfs_data: metadata,
          freeze: removeFreeze ? "" : formData.freeze,
          clawback: removeClawback ? "" : formData.clawback,
        };

        ipfs_data = metadata;

        if (effectiveProvider === "crust") {
          const { atc, pinCids: cids } = await updateARC19AssetMintArrayV2(
            [transaction_data],
            activeAddress,
            algodClient,
            transactionSigner,
            imageCid ? [imageCid] : []
          );

          // Bundle pins into the same group
          for (const cid of cids) {
            atc.addMethodCall(
              await makeCrustPinTx(cid, transactionSigner, activeAddress, algodClient)
            );
          }
          setBatchATC(atc);
          setTransaction(null);
        } else {
          if (!token) {
            toast.error("Please enter a Pinata JWT token");
            return;
          }
          const unsignedAssetTransactions = await updateARC19AssetMintArray(
            [transaction_data],
            activeAddress,
            algodClient,
            token
          );
          if (unsignedAssetTransactions.length === 0) {
            toast.error("Something went wrong while creating transactions");
            return;
          }
          setTransaction(unsignedAssetTransactions);
          setBatchATC(null);
        }
      } else if (formData.format === "ARC69") {
        metadata.properties = metadata.properties.traits;
        const transaction_data = {
          asset_id: assetID,
          note: metadata,
          freeze: removeFreeze ? "" : formData.freeze,
          clawback: removeClawback ? "" : formData.clawback,
        };
        ipfs_data = metadata;
        const signedTransactions = await createAssetConfigArray(
          [transaction_data],
          activeAddress,
          algodClient
        );
        setTransaction(signedTransactions);
        setBatchATC(null);
      } else if (formData.format === "Token") {
        const transaction_data = {
          asset_id: assetID,
          note: "", // Tokens don't need ARC metadata notes
          freeze: removeFreeze ? "" : formData.freeze,
          clawback: removeClawback ? "" : formData.clawback,
        };
        ipfs_data = {}; // Empty since it's just a Token
        const signedTransactions = await createAssetConfigArray(
          [transaction_data],
          activeAddress,
          algodClient
        );
        setTransaction(signedTransactions);
        setBatchATC(null);
      } else {
        throw Error("ARC3 assets can't be updated");
      }
      toast.info("Please sign the transaction");
      setPreviewAsset({
        ipfs_data,
        asset_name: formData.name,
        unit_name: formData.unitName,
        image: formData.image instanceof File ? formData.image : null,
      });
      setProcessStep(2);
    } catch (error) {
      console.log(error);
      setProcessStep(0);
      toast.error("Something went wrong!");
    }
  }

  async function sendTransaction() {
    try {
      if (!activeAddress) {
        toast.error("Please connect your wallet");
        return;
      }
      if (formData.format === "ARC19" && !batchATC && !transaction) {
        toast.error("Please create the transaction first");
        return;
      }
      setProcessStep(3);

      // use ATC batch, test asset ID: 2315438437
      if (formData.format === "ARC19") {
        // Use atc.execute for robust signing and submission of the entire group
        const { txIDs } = await batchATC.execute(algodClient, 4);
        const txId = txIDs[0];
        await algosdk.waitForConfirmation(algodClient, txId, 4);
      } else {
        // other formats
        const signedAssetTransaction = await walletSign(
          transaction,
          transactionSigner
        );
        if (!signedAssetTransaction) {
          setProcessStep(2);
          toast.error("Transaction not signed!");
          return;
        }
        const groups = sliceIntoChunks(signedAssetTransaction, 2);

        await algodClient.sendRawTransaction(groups[0]).do();
      }

      toast.success("Asset updated successfully!");
      if (window.parent) {
        window.parent.postMessage({
          type: "WEN_TOOLS_MINT_SUCCESS",
          assetID: assetID,
        }, "*");
      }
      setProcessStep(4);
    } catch (error) {
      console.log("----> sign: ", error);
      toast.error("Something went wrong!");
      setProcessStep(2);
    }
  }

  /** Remove the locally stored data */
  function removeStoredData() {
    setFormData(RESET);
    setAssetID(RESET);
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-full gap-y-2 min-h-screen">
      <Meta 
        title="Simple Update" 
        description="Modify metadata and configuration for existing Algorand assets. Supporting ARC-19, ARC-69, and standard token updates."
      />
      <h1 className="text-3xl font-extrabold bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent tracking-tight mt-6">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label || "Simple Update"}
      </h1>
      <ConnectButton inmain={true} />

      <div className="w-full max-w-xl bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 md:p-8 mt-6 shadow-2xl space-y-6 text-left">
        {assetID === "" || !formData.name ? (
          <div className="space-y-4">
            <div className="flex flex-col">
              <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Asset ID*
              </label>
              <input
                type="number"
                id="asset_id"
                placeholder="Ex: 2315438437"
                className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
              />
            </div>
            <button
              className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-black font-extrabold rounded-xl transition shadow-lg text-base flex items-center justify-center gap-2"
              onClick={getAssetData}
            >
              🔍 Next
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between p-4 bg-slate-900/60 border border-slate-800 rounded-xl">
              <button
                className="text-xs font-bold text-slate-400 hover:text-white transition-colors uppercase tracking-wider bg-slate-800/40 hover:bg-slate-805/80 border border-slate-700/50 px-3 py-1.5 rounded-lg"
                onClick={() => {
                  removeStoredData();
                  window.location.reload();
                }}
              >
                ← Back
              </button>
              <div className="text-xs font-medium text-slate-300">
                Asset ID:{" "}
                <a
                  className="font-bold text-primary-yellow underline hover:text-primary-yellow/80 transition"
                  href={ASSET_PREVIEW + assetID}
                  target="_blank"
                  rel="noreferrer"
                >
                  {assetID}
                </a>
              </div>
            </div>

            {/* Read-Only Asset Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Name
                </label>
                <input
                  className="w-full bg-slate-950/40 border border-slate-800 text-sm font-medium text-slate-400 px-4 py-3 rounded-xl cursor-not-allowed select-none"
                  value={formData.name}
                  disabled
                />
              </div>
              <div className="flex flex-col">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Unit name
                </label>
                <input
                  className="w-full bg-slate-950/40 border border-slate-800 text-sm font-medium text-slate-400 px-4 py-3 rounded-xl cursor-not-allowed select-none"
                  value={formData.unitName}
                  disabled
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Total supply
                </label>
                <input
                  className="w-full bg-slate-950/40 border border-slate-800 text-sm font-medium text-slate-400 px-4 py-3 rounded-xl cursor-not-allowed select-none"
                  value={formData.totalSupply}
                  disabled
                />
              </div>
              <div className="flex flex-col">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Decimals
                </label>
                <input
                  className="w-full bg-slate-950/40 border border-slate-800 text-sm font-medium text-slate-400 px-4 py-3 rounded-xl cursor-not-allowed select-none"
                  value={formData.decimals}
                  disabled
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  ARC format
                </label>
                <input
                  className="w-full bg-slate-950/40 border border-slate-800 text-sm font-medium text-slate-400 px-4 py-3 rounded-xl cursor-not-allowed select-none"
                  value={formData.format}
                  disabled
                />
              </div>
              
              {/* If ARC19, show New Image uploader */}
              {formData.format === "ARC19" && (
                <div className="flex flex-col">
                  <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                    New Image / Media <span className="text-[10px] italic lowercase">(optional)</span>
                  </label>
                  <input
                    className="block w-full text-sm border border-slate-700 rounded-xl cursor-pointer bg-slate-900/60 text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange file:mr-4 file:py-2.5 file:px-4 file:rounded-l-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-white hover:file:bg-slate-700 transition-all"
                    id="select_image"
                    type="file"
                    accept="image/*,video/*"
                    multiple={false}
                    onChange={(e: any) => {
                      setFormData({
                        ...formData,
                        image: e.target.files[0],
                      });
                    }}
                  />
                </div>
              )}
            </div>

            {/* If ARC19, show Pinning Provider settings */}
            {formData.format === "ARC19" && (
              <div className="space-y-4 pt-2">
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

            {/* Current Asset Previews */}
            {formData.image_url && formData.format !== "Token" && (
              <div className="flex flex-col items-start pt-2">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Current Image</label>
                <img
                  src={
                    formData.image_url.startsWith("ipfs://")
                      ? `${IPFS_ENDPOINT}${formData.image_url.replace(
                        "ipfs://",
                        ""
                      )}`
                      : formData.image_url
                  }
                  className="w-60 mx-auto object-contain rounded-xl border border-white/10 shadow-lg"
                  alt="asset"
                  id="asset_image"
                  onError={(e: any) => {
                    e.target.onerror = null;
                    window.document.getElementById("asset_image")?.remove();
                  }}
                />
              </div>
            )}
            
            {formData.animation_url && (
              <div className="flex flex-col items-start pt-2">
                <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Current Animation</label>
                <video
                  src={
                    formData.animation_url.startsWith("ipfs://")
                      ? `${IPFS_ENDPOINT}${formData.animation_url.replace(
                        "ipfs://",
                        ""
                      )}`
                      : formData.animation_url
                  }
                  className="w-60 mx-auto object-contain rounded-xl border border-white/10 shadow-lg"
                  id="asset_video"
                  onError={(e: any) => {
                    e.target.onerror = null;
                    window.document.getElementById("asset_video")?.remove();
                  }}
                  controls
                  autoPlay
                />
              </div>
            )}

            {/* Property Metadata Section */}
            {formData.format !== "Token" && (
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Property Metadata</h4>
                {["external_url", "description"].map((key) => {
                  return (
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
                        readOnly={formData.format === "ARC3"}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Traits */}
            {formData.format !== "Token" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Traits</h4>
                    <p className="text-[10px] text-slate-500">Character attributes (e.g., Background, Eyes)</p>
                  </div>
                  {formData.format !== "ARC3" && (
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
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {formData.traits.map((metadata: any) => TraitMetadataInputField(metadata.id, "traits"))}
                </div>
              </div>
            )}

            {/* Filters */}
            {formData.format !== "Token" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Filters</h4>
                    <p className="text-[10px] text-slate-500">Non-rarity search parameters</p>
                  </div>
                  {formData.format !== "ARC3" && (
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
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {formData.filters.map((metadata: any) => TraitMetadataInputField(metadata.id, "filters"))}
                </div>
              </div>
            )}

            {/* Extras */}
            {formData.format !== "Token" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Extras</h4>
                    <p className="text-[10px] text-slate-500">Additional metadata properties</p>
                  </div>
                  {formData.format !== "ARC3" && (
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
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {formData.extras.map((metadata: any) => TraitMetadataInputField(metadata.id, "extras"))}
                </div>
              </div>
            )}

            {/* Asset Capabilities Section */}
            {(formData.freeze || formData.clawback) && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-4 pt-4 border-t border-slate-800">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Asset Capabilities</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {formData.freeze && (
                    <label className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-800 rounded-lg cursor-pointer hover:bg-slate-900/80 transition-all">
                      <span className="text-sm font-medium text-gray-250">Remove Freeze</span>
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        onChange={(e) => setRemoveFreeze(e.target.checked)}
                        checked={removeFreeze}
                      />
                      <div className="relative w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-650"></div>
                    </label>
                  )}
                  {formData.clawback && (
                    <label className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-800 rounded-lg cursor-pointer hover:bg-slate-900/80 transition-all">
                      <span className="text-sm font-medium text-gray-250">Remove Clawback</span>
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        onChange={(e) => setRemoveClawback(e.target.checked)}
                        checked={removeClawback}
                      />
                      <div className="relative w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-650"></div>
                    </label>
                  )}
                </div>
                <p className="text-[10px] text-red-400 mt-1">
                  Warning: Removing these capabilities is permanent and cannot be undone.
                </p>
              </div>
            )}

            {formData.format === "ARC3" ? (
              <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl text-center">
                <p className="text-sm font-bold text-red-400">
                  ⚠️ ARC3 assets can't be updated
                </p>
              </div>
            ) : (
              <>
                {previewAsset && (
                  <div className="pt-4 border-t border-slate-800 animate-fadeIn">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Update Preview</h4>
                    <PreviewAssetComponent
                      imageUrl={
                        previewAsset.image
                          ? URL.createObjectURL(previewAsset.image)
                          : previewAsset.ipfs_data.image
                            ? previewAsset.ipfs_data.image.replace(
                              "ipfs://",
                              IPFS_ENDPOINT
                            )
                            : ""
                      }
                      previewAsset={previewAsset}
                    />
                  </div>
                )}

                {/* Steps and Action Button */}
                <div className="flex flex-col justify-center items-center w-full pt-4 border-t border-slate-800 space-y-4">
                  {processStep === 4 ? (
                    <div className="w-full text-center space-y-3 bg-green-500/10 border border-green-500/20 p-4 rounded-xl">
                      <p className="text-green-400 text-sm font-bold animate-pulse">
                        🎉 Asset updated successfully!
                      </p>
                      {assetID && (
                        <a
                          href={ASSET_PREVIEW + assetID}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block text-primary-yellow hover:text-primary-yellow/80 transition font-bold text-base py-1 animate-pulse border-b border-primary-yellow/50"
                        >
                          View Updated Asset (Explorer)
                        </a>
                      )}
                      <div className="flex flex-col md:flex-row gap-3 mt-4 w-full justify-center">
                        <button
                          className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-black font-bold rounded-xl transition shadow-md"
                          onClick={() => {
                            removeStoredData();
                            window.location.reload();
                          }}
                        >
                          Do Another Update
                        </button>
                        <button
                          className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl border border-slate-700 transition"
                          onClick={() => {
                            removeStoredData();
                            navigate("/");
                          }}
                        >
                          Go to Home
                        </button>
                      </div>
                    </div>
                  ) : processStep === 3 ? (
                    <div className="w-full py-4 text-center">
                      <div className="spinner-border animate-spin inline-block w-8 h-8 border-4 border-t-orange-500 border-r-transparent rounded-full mb-2"></div>
                      <p className="text-orange-400 animate-pulse text-sm font-bold">
                        Sending transactions...
                      </p>
                    </div>
                  ) : processStep === 2 ? (
                    <div className="w-full space-y-3 bg-slate-900/60 border border-slate-800 p-4 rounded-xl text-center">
                      <p className="text-green-400 text-sm font-bold animate-pulse mb-2">
                        ✓ Transaction created!
                      </p>
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
                      <p className="text-slate-400 text-sm font-medium">Creating transaction...</p>
                    </div>
                  ) : (
                    <button
                      className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-black font-extrabold rounded-xl transition shadow-lg text-base flex items-center justify-center gap-2"
                      onClick={update}
                    >
                      🪙 Step 1: Update Asset
                    </button>
                  )}
                </div>
              </>
            )}

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
          </>
        )}
      </div>

      <p className="text-xs font-semibold text-slate-400 text-center mt-2 max-w-xl">
        {formData.format === "ARC19" ? (
          effectiveProvider === "crust" ? (
            <span>Pin Fee (Crust): ARC19 with new image - 2.8 ALGO, without new image - 1.4 ALGO</span>
          ) : (
            <span>Pin Fee (Pinata): Free (requires custom Pinata JWT)</span>
          )
        ) : (
          <span>Pin Fee: Free (ARC69 / Token updates do not require IPFS pinning)</span>
        )}
      </p>

      {/* Practitioner Section: Asset Management */}
      <section className="mt-20 pt-12 border-t border-slate-800 w-full max-w-4xl text-left px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Asset Management</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Updating an asset on Algorand requires the specific authorization of the Manager address. This tool streamlines the configuration process, allowing you to modify metadata (for supported ARC standards) or update asset parameters like freeze and clawback addresses. Always verify your current management permissions before initiating an update.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">The ARC Standard Hierarchy</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Different ARC standards offer varying levels of mutability. ARC-19 allows for full metadata and image evolution, while ARC-69 focuses on mutable transaction notes. ARC-3 is largely immutable once the URL is set. Choosing the right standard during the initial mint defines the long-term flexibility of your asset's lifecycle.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
