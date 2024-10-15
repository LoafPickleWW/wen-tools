import { useState } from "react";

import algosdk from "algosdk";
import { toast } from "react-toastify";
import { useAtom } from 'jotai';
import { atomWithStorage, RESET } from 'jotai/utils';
import { Button } from "@mui/material";
import {
  getNodeURL,
  getAssetPreviewURL,
  getTokenPreviewURL,
  createARC3AssetMintArrayV2,
  createARC19AssetMintArrayV2,
  createAssetMintArrayV2,
} from "../utils";
import { TOOLS } from "../constants";
import FaqSectionComponent from "../components/FaqSectionComponent";
import { pinImageToCrust } from "../crust";

const simpleMintAtom = atomWithStorage('simpleMint', {
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
});

export function SimpleMint() {
  const [formData, setFormData] = useAtom(simpleMintAtom);
  const [processStep, setProcessStep] = useState(0);

  const [createdAssetID, setCreatedAssetID] = useState(null);

  // batchATC is a AtomicTransactionComposer to batch and send all transactions
  const [batchATC, setBatchATC] = useState(null);

  const TraitMetadataInputField = (id, type) => {
    return (
      <div key={id} id={`metadata-${id}`} className="mb-2">
        <input
          type="text"
          id={`category-${id}`}
          placeholder={type.slice(0, -1)}
          className="w-24 md:w-28 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-xs px-3 py-2 border rounded border-gray-200"
          value={formData[type].find((metadata) => metadata.id === id).category}
          onChange={(e) => {
            const newMetadata = formData[type].map((trait) => {
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
          value={formData[type].find((metadata) => metadata.id === id).name}
          onChange={(e) => {
            const newMetadata = formData[type].map((trait) => {
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
              (metadata) => metadata.id !== id
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
      const wallet = localStorage.getItem("wallet");
      if (!wallet) {
        toast.error("Please connect your wallet");
        return;
      }
      if (
        formData.name === "" ||
        formData.unitName === "" ||
        formData.totalSupply === "" ||
        formData.decimals === ""
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
      if (formData.external_url !== "") {
        metadata.external_url = formData.external_url;
      }
      if (formData.description !== "") {
        metadata.description = formData.description;
      }
      if (formData.traits.length > 0) {
        metadata.properties.traits = formData.traits.reduce((acc, trait) => {
          if (trait.category !== "" && trait.name !== "") {
            acc[trait.category] = trait.name;
          }
          return acc;
        }, {});
      }
      if (formData.filters.length > 0) {
        metadata.properties.filters = formData.filters.reduce((acc, filter) => {
          if (filter.category !== "" && filter.name !== "") {
            acc[filter.category] = filter.name;
          }
          return acc;
        }, {});
      }
      if (formData.extras.length > 0) {
        metadata.properties.extras = formData.extras.reduce((acc, extra) => {
          if (extra.category !== "" && extra.name !== "") {
            acc[extra.category] = extra.name;
          }
          return acc;
        }, {});
      }
      let imageURL;
      let imageCID = null;
      if (formData.format === "Token") {
        imageURL = formData.urlField;
      } else {
        if (formData.image === null) {
          toast.error("Please select an image");
          return;
        }
        toast.info("Uploading the image to IPFS...");
        const authBasic = localStorage.getItem("authBasic");
        imageCID = await pinImageToCrust(authBasic, formData.image)
        imageURL = "ipfs://" + imageCID;
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
      if (formData.format === "ARC3") {
        // V1
        // unsignedAssetTransaction = await createARC3AssetMintArray(
        //   [metadataForIPFS],
        //   nodeURL,
        //   token
        // );

        // V2 here, AtomicTransactionComposer will be used
        const batchATC = await createARC3AssetMintArrayV2([metadataForIPFS], nodeURL, [imageCID]);
        setBatchATC(batchATC);
      } else if (formData.format === "ARC19") {
        // V1
        // unsignedAssetTransaction = await createARC19AssetMintArray(
        //   [metadataForIPFS],
        //   nodeURL,
        //   token
        // );

        // V2 here, AtomicTransactionComposer will be used
        const batchATC = await createARC19AssetMintArrayV2([metadataForIPFS], nodeURL, [imageCID]);
        setBatchATC(batchATC);
      } else if (formData.format === "ARC69" || formData.format === "Token") {
        metadata.properties = metadata.properties.traits;
        metadataForIPFS = {
          ...metadataForIPFS,
          asset_note: metadata,
          asset_url: imageURL,
        };
        // V1 
        // unsignedAssetTransaction = await createAssetMintArray(
        //   [metadataForIPFS],
        //   nodeURL,
        //   "",
        //   false
        // );
        
        // V2
        const batchATC = await createAssetMintArrayV2([metadataForIPFS], nodeURL, [imageCID]);
        setBatchATC(batchATC);
      } else {
        toast.error("Invalid ARC format");
        return;
      }
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
      if (!batchATC) {
        toast.error("Please create the transaction first");
        return;
      }
      setProcessStep(3);
      const nodeURL = getNodeURL();
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });

      const txres = await batchATC.execute(algodClient, 4);

      if (!txres || !txres.txIDs || txres.txIDs.length === 0) {
        // err tx
        console.error("transaction submit error, batchATC.execute return : ", txres);
        toast.error("transaction submit error");
        return
      }

      const assetCreateTxID = txres.txIDs[0];

      const result = await algosdk.waitForConfirmation(algodClient, assetCreateTxID, 3);

      setCreatedAssetID(result["asset-index"]);

      removeStoredData(); // Remove stored data now that mint is complete
      toast.success("Asset created successfully!");
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
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 min-h-screen">
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
      <p className="focus:outline-nonetext-sm font-semibold text-lg leading-tight text-gray-200 mt-2">
        Property Metadata
      </p>
      {["external_url", "description"].map((key) => {
        return (
          <div className="mb-2">
            <input
              type="text"
              disabled
              id={key}
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
      <p className="focus:outline-nonetext-sm font-semibold text-xl leading-tight text-gray-200 mt-2">
        Rarity Traits
      </p>
      <div className="md:flex flex-col items-center text-start justify-center">
        {formData.traits.map((metadata) => {
          return TraitMetadataInputField(metadata.id, "traits");
        })}
      </div>
      <button
        className="rounded-md bg-primary-orange hover:bg-green-600 transition text-black px-4 py-1"
        onClick={() => {
          let lastId;
          try {
            lastId = formData.traits[formData.traits.length - 1].id;
          } catch (error) {
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
      <p className="focus:outline-nonetext-sm font-semibold text-xl leading-tight text-gray-200 mt-2">
        Non-Rarity Traits
      </p>
      <p className="focus:outline-nonetext-sm font-light leading-tight text-gray-200 mt-2">
        Filters
      </p>
      <div className="md:flex flex-col items-center text-start justify-center">
        {formData.filters.map((metadata) => {
          return TraitMetadataInputField(metadata.id, "filters");
        })}
      </div>
      <button
        className="rounded-md bg-primary-orange hover:bg-green-600 transition text-black px-4 py-1"
        onClick={() => {
          let lastId;
          try {
            lastId = formData.filters[formData.filters.length - 1].id;
          } catch (error) {
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
      <p className="focus:outline-nonetext-sm font-light leading-tight text-gray-200">
        Extras
      </p>
      <div className="md:flex flex-col items-center text-start justify-center">
        {formData.extras.map((metadata) => {
          return TraitMetadataInputField(metadata.id, "extras");
        })}
      </div>
      <button
        className="rounded-md bg-primary-orange hover:bg-green-600 transition text-black px-4 py-1"
        onClick={() => {
          let lastId;
          try {
            lastId = formData.extras[formData.extras.length - 1].id;
          } catch (error) {
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
            className="rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black/90 font-semibold px-4 py-1 mt-2"
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
      <p className="text-sm italic text-slate-200 mb-6">Fee: Free</p>
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
