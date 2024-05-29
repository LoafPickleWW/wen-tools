import { useState } from "react";

import algosdk from "algosdk";
import { toast } from "react-toastify";
import {
  getNodeURL,
  createARC3AssetMintArray,
  createARC19AssetMintArray,
  createAssetMintArray,
  signGroupTransactions,
  sliceIntoChunks,
  pinImageToNFTStorage,
  getAssetPreviewURL,
  getTokenPreviewURL,
} from "../utils";
import { TOOLS } from "../constants";
import FaqSectionComponent from "../components/FaqSectionComponent";

export function SimpleMint() {
  const [formData, setFormData] = useState({
    name: "",
    unitName: "",
    totalSupply: 1,
    decimals: 0,
    image: null,
    format: "ARC19",
    freeze: false,
    clawback: false,
    defaultFrozen: false,
    urlField: "",
    metadata: [
      {
        id: 1,
        category: "description",
        name: "",
      },
      {
        id: 2,
        category: "external_url",
        name: "",
      },
    ],
  });
  const [token, setToken] = useState("");
  const [processStep, setProcessStep] = useState(0);
  const [transaction, setTransaction] = useState(null);
  const [createdAssetID, setCreatedAssetID] = useState(null);

  const TraitMetadataInputField = (id) => {
    return (
      <div key={id} id={`metadata-${id}`} className="mb-2">
        <input
          type="text"
          id={`category-${id}`}
          placeholder="Property"
          className="w-24 md:w-28 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-xs px-3 py-2 border rounded border-gray-200"
          value={
            formData.metadata.find((metadata) => metadata.id === id).category
          }
          onChange={(e) => {
            const newMetadata = formData.metadata.map((metadata) => {
              if (metadata.id === id) {
                return {
                  ...metadata,
                  category: e.target.value,
                };
              }
              return metadata;
            });
            setFormData({
              ...formData,
              metadata: newMetadata,
            });
          }}
        />
        <input
          id={`name-${id}`}
          type="text"
          placeholder="Trait"
          className="w-24 md:w-28 bg-gray-300 text-sm ml-2 font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-sm px-3 py-2 border rounded border-gray-200"
          value={formData.metadata.find((metadata) => metadata.id === id).name}
          onChange={(e) => {
            const newMetadata = formData.metadata.map((metadata) => {
              if (metadata.id === id) {
                return {
                  ...metadata,
                  name: e.target.value,
                };
              }
              return metadata;
            });
            setFormData({
              ...formData,
              metadata: newMetadata,
            });
          }}
        />
        <button
          className="rounded bg-primary-red text-lg hover:bg-red-600 transition text-white ml-2 px-4"
          onClick={() => {
            const newMetadata = formData.metadata.filter(
              (metadata) => metadata.id !== id
            );
            setFormData({
              ...formData,
              metadata: newMetadata,
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
      const wallet = localStorage.getItem("wallet");
      if (!wallet) {
        toast.error("Please connect your wallet");
        return;
      }
      if (
        formData.name === "" ||
        formData.unitName === "" ||
        formData.totalSupply === "" ||
        formData.decimals === "" ||
        token === ""
      ) {
        toast.error("Please fill all the required fields");
        return;
      }
      if (formData.format !== "Token" && formData.image === null) {
        toast.error("Please select an image");
        return;
      }
      setProcessStep(1);
      let metadata = {
        name: formData.name,
        standard: formData.format.toLocaleLowerCase(),
        properties: {},
      };
      formData.metadata.forEach((data) => {
        if (data.category !== "" && data.name !== "") {
          if (
            data.category === "description" ||
            data.category === "external_url"
          ) {
            metadata[data.category] = data.name;
          } else {
            if (
              data.category.includes("traits_") ||
              data.category.includes("filters_")
            ) {
              const [category, subCategory] = data.category.split("_");
              if (!metadata.properties[category]) {
                metadata.properties[category] = {};
              }
              metadata.properties[category][subCategory] = data.name;
            } else {
              metadata.properties[data.category] = data.name;
            }
          }
        }
      });
      let imageURL;
      if (formData.format === "Token") {
        imageURL = formData.urlField;
      } else {
        if (formData.image === null) {
          toast.error("Please select an image");
          return;
        }
        toast.info("Uploading the image to IPFS...");
        imageURL =
          "ipfs://" + (await pinImageToNFTStorage(token, formData.image));
      }
      const nodeURL = getNodeURL();

      if (formData.image) {
        if (formData.image.type.includes("video")) {
          metadata.animation_url = imageURL;
          metadata.animation_url_mime_type = formData.image
            ? formData.image.type
            : "";
        } else {
          metadata.image = imageURL;
          metadata.image_mime_type = formData.image ? formData.image.type : "";
        }
      }

      let metadataForIPFS = {
        asset_name: formData.name,
        unit_name: formData.unitName,
        has_clawback: formData.clawback ? "Y" : "N",
        has_freeze: formData.freeze ? "Y" : "N",
        default_frozen: formData.defaultFrozen ? "Y" : "N",
        decimals: formData.decimals,
        total_supply: formData.totalSupply,
        ipfs_data: metadata,
      };
      let unsignedAssetTransaction;
      if (formData.format === "ARC3") {
        unsignedAssetTransaction = await createARC3AssetMintArray(
          [metadataForIPFS],
          nodeURL,
          token
        );
      } else if (formData.format === "ARC19") {
        unsignedAssetTransaction = await createARC19AssetMintArray(
          [metadataForIPFS],
          nodeURL,
          token,
          true
        );
      } else if (formData.format === "ARC69" || formData.format === "Token") {
        metadataForIPFS = {
          ...metadataForIPFS,
          asset_note: metadata,
          asset_url: imageURL,
        };
        unsignedAssetTransaction = await createAssetMintArray(
          [metadataForIPFS],
          nodeURL,
          "",
          false
        );
      } else {
        toast.error("Invalid ARC format");
        return;
      }
      setTransaction(unsignedAssetTransaction);
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
      const wallet = localStorage.getItem("wallet");
      if (!wallet) {
        toast.error("Please connect your wallet");
        return;
      }
      if (!transaction) {
        toast.error("Please create the transaction first");
        return;
      }
      setProcessStep(3);
      const nodeURL = getNodeURL();
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });
      const signedAssetTransaction = await signGroupTransactions(
        transaction,
        wallet,
        true
      );
      if (!signedAssetTransaction) {
        setProcessStep(2);
        toast.error("Transaction not signed!");
        return;
      }
      const groups = sliceIntoChunks(signedAssetTransaction, 2);
      const { txId } = await algodClient.sendRawTransaction(groups[0]).do();
      const result = await algosdk.waitForConfirmation(algodClient, txId, 3);
      setCreatedAssetID(result["asset-index"]);
      toast.success("Asset created successfully!");
      setProcessStep(4);
    } catch (error) {
      toast.error("Something went wrong!");
      setProcessStep(2);
    }
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      <div className="mt-4 md:flex items-center text-start gap-x-4">
        <div className="flex flex-col md:mt-0 mt-2">
          <label className="mb-2 text-sm leading-none text-gray-200">
            Name*
          </label>
          <input
            type="text"
            placeholder="Ex: STUPIDHORSE 001"
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
            placeholder="Ex: HORSE001"
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
            max={18446744073709551615n}
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
              accept="image/*,video/*"
              multiple={false}
              required
              onChange={(e) => {
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
      <p className="focus:outline-nonetext-sm font-light leading-tight text-gray-200 mt-2">
        Property Metadata
        <br />
        (optional)
      </p>
      <div className="mt-4 md:flex flex-col items-center text-start justify-center">
        {formData.metadata.map((metadata) => {
          return TraitMetadataInputField(metadata.id);
        })}
      </div>
      <button
        className="rounded-md bg-primary-green hover:bg-green-600 transition text-black px-4 py-1"
        onClick={() => {
          let lastId;
          try {
            lastId = formData.metadata[formData.metadata.length - 1].id;
          } catch (error) {
            lastId = 0;
          }
          setFormData({
            ...formData,
            metadata: [
              ...formData.metadata,
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

      <div className="flex flex-col mt-4">
        <div className="flex flex-row items-center justify-center gap-x-2">
          <input
            type="checkbox"
            id="ipfs"
            className="peer"
            value={token === process.env.REACT_APP_NFT_STORAGE_KEY}
            onChange={(e) => {
              if (e.target.checked) {
                setToken(process.env.REACT_APP_NFT_STORAGE_KEY);
              } else {
                setToken("");
              }
            }}
          />
          <label
            htmlFor="ipfs"
            className="text-sm font-light leading-tight text-gray-200 peer-checked:text-primary-green/80 peer-checked:font-medium cursor-pointer"
          >
            Use Public Token - Opt out from hosting your image**
          </label>
        </div>
        {token !== process.env.REACT_APP_NFT_STORAGE_KEY && (
          <>
            <p className="text-xs text-slate-400 font-roboto my-2">or</p>
            <label className="mb-1 text-sm leading-none text-gray-200">
              NFT Storage Token***
            </label>
            <input
              type="text"
              id="ipfs-token"
              placeholder="token"
              className="w-48 mx-auto bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="text-xs text-slate-400 font-roboto mt-1">
              ***You can get your own token{" "}
              <a
                href="https://nft.storage/docs/#get-an-api-token"
                target="_blank"
                className="text-primary-green/70 hover:text-secondary-green/80 transition"
                rel="noreferrer"
              >
                here
              </a>
            </p>{" "}
          </>
        )}
      </div>
      <div className="flex flex-col justify-center items-center w-[16rem]">
        {processStep === 4 ? (
          <>
            <p className="pt-4 text-green-500 text-sm">
              Asset created successfully!
              <br />
            </p>
            {createdAssetID && (
              <a
                href={
                  formData.format === "Token"
                    ? getTokenPreviewURL(createdAssetID)
                    : getAssetPreviewURL(createdAssetID)
                }
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
              className="rounded bg-secondary-green hover:bg-secondary-green/80 transition text-white/90 font-semibold px-4 py-1 mt-2"
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
            className="rounded bg-secondary-green hover:bg-secondary-green/80 transition text-white/90 font-semibold px-4 py-1 mt-2"
            onClick={mint}
          >
            Step 1: Mint
          </button>
        )}
      </div>
      <p className="text-sm italic text-slate-200 px-4">
        **It is recommended that any Creator Host their own Files using their
        own token. Evil Tools will not be held responsible for anything that
        happens to publicly hosted images.
      </p>
      <p className="text-sm italic text-slate-200">Fee: 0.1A</p>
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
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
              "There is a network fee of 0.1A and a Lab fee of 0.1A. In total you need to have at least 0.2A in your wallet before minting.",
          },
        ]}
      />
    </div>
  );
}
