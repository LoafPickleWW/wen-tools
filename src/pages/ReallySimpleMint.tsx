import { useState } from "react";

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
    const authBasic = localStorage.getItem("authBasic");

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
      [imageCID]
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

      setCreatedAssetID(result["asset-index"]);
      removeStoredData(); // Remove stored data now that mint is complete
      toast.success("Asset created successfully!");
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
            placeholder="Ex: USAlgo 001"
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
      <FaqSectionComponent
        faqData={[
          {
            question: "What is Really Simple Mint?",
            answer: "Really Simple Mint is a tool that allows you to mint NFTs on the Algorand blockchain in the ARC-69 standard.",
          },
          {
            question: "How much does it cost to Mint?",
            answer:
              "There is a network fee of 0.1A. In total you need to have at least 0.2A in your wallet before minting.",
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
