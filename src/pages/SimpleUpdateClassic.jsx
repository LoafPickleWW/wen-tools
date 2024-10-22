import { useState } from "react";
import { useNavigate } from "react-router-dom";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import axios from "axios";
import { useAtom } from 'jotai';
import { atomWithStorage, RESET } from 'jotai/utils';
import { Button } from "@mui/material";
import {
  pinImageToPinata,
  getNodeURL,
  updateARC19AssetMintArray,
  createAssetConfigArray,
  signGroupTransactions,
  sliceIntoChunks,
  Arc69,
  getARC19AssetMetadataData,
  getAssetPreviewURL,
} from "../utils";
import { TOOLS, IPFS_ENDPOINT } from "../constants";

const simpleUpdateAtom = atomWithStorage('simpleUpdate', {
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
  extras: []
});
const suAssetIdAtom = atomWithStorage('suAssetId', "");
const suTokenAtom = atomWithStorage('suToken', "");

export function SimpleUpdate() {
  const [formData, setFormData] = useAtom(simpleUpdateAtom);
  const [token, setToken] = useAtom(suTokenAtom);
  const [processStep, setProcessStep] = useState(0);
  const [transaction, setTransaction] = useState(null);
  const [assetID, setAssetID] = useAtom(suAssetIdAtom);
  const navigate = useNavigate();

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
          readOnly={formData.format === "ARC3"}
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
          readOnly={formData.format === "ARC3"}
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

  async function getAssetData() {
    try {
      const nodeURL = getNodeURL();
      const assetID = document.getElementById("asset_id").value;
      if (assetID === "") {
        toast.error("Please enter an asset ID");
        return;
      }
      setAssetID(assetID);
      const response = await axios.get(`${nodeURL}/v2/assets/${assetID}`);
      const assetData = response.data;
      function findFormat(url) {
        if (!url) {
          //throw new Error("This asset doesn't have a URL field.");
          return "ARC69";
        }
        if (url.includes("template-ipfs")) {
          return "ARC19";
        } else if (url.includes("#arc3")) {
          return "ARC3";
        } else if (url.includes("ipfs://") || url.includes("ipfs/")) {
          return "ARC69";
        } else {
          throw new Error("Invalid asset or ARC format!");
        }
      }
      const assetFormat = findFormat(assetData.params["url"]);
      let assetMetadata;
      if (assetFormat === "ARC19") {
        assetMetadata = await getARC19AssetMetadataData(
          assetData.params["url"],
          assetData.params["reserve"]
        );
      } else if (assetFormat === "ARC69") {
        const arc69 = new Arc69();
        const selectNetwork = localStorage.getItem("networkType");
        assetMetadata = await arc69.fetch(assetID, selectNetwork);
        if (assetMetadata.attributes && !assetMetadata.properties) {
          assetMetadata.properties = assetMetadata.attributes;
          delete assetMetadata.attributes;
          assetMetadata.properties = assetMetadata.properties.reduce(
            (obj, item) => {
              obj[item.trait_type] = item.value;
              return obj;
            }
          );
        }
      } else {
        if (assetData.params["url"].startsWith("ipfs://")) {
          assetMetadata = await axios
            .get(IPFS_ENDPOINT + assetData.params["url"].replace("ipfs://", ""))
            .then((res) => res.data);
        } else {
          assetMetadata = await axios
            .get(assetData.params["url"])
            .then((res) => res.data);
        }
      }
      let metadata = {
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
        traits: Object.keys(metadata.traits).map((key, index) => ({
          id: index,
          category: key,
          name: metadata.traits[key],
        })),
        filters: Object.keys(metadata).includes("filters")
          ? Object.keys(metadata.filters).map((key, index) => ({
              id: index,
              category: key,
              name: metadata.filters[key],
            }))
          : [],
        extras: Object.keys(metadata).includes("extras")
          ? Object.keys(metadata.extras).map((key, index) => ({
              id: index,
              category: key,
              name: metadata.extras[key],
            }))
          : [],
        image_url: assetMetadata.image || assetData.params["url"],
        image_mime_type: assetMetadata.image_mime_type,
        animation_url: assetMetadata.animation_url || assetData.params["url"],
        animation_mime_type: assetMetadata.animation_mime_type
      });
    } catch (error) {
      if (error.response) {
        toast.error(error.response.data.message);
      } else {
        toast.error(error.message);
      }
      setAssetID("");
    }
  }

  async function update() {
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
        (token === "" && formData.format === "ARC19")
      ) {
        toast.error("Please fill all the required fields");
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

      if (formData.image && formData.format === "ARC19") {
        toast.info("Uploading the image to IPFS...");
        const imageURL =
          "ipfs://" + (await pinImageToPinata(token, formData.image));
        if (formData.image && formData.image.type.includes("video")) {
          metadata.animation_url = imageURL;
          metadata.animation_mime_type = formData.image
            ? formData.image.type
            : "";
        } else {
          metadata.image = imageURL;
          metadata.image_mime_type = formData.image ? formData.image.type : "";
        }
      } else if (formData.format === "ARC3") {
        throw new Error("ARC3 assets can't be updated");
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
      const nodeURL = getNodeURL();
      if (formData.format === "ARC19") {
        const transaction_data = {
          asset_id: assetID,
          ipfs_data: metadata,
          freeze: formData.freeze,
          clawback: formData.clawback,
        };
        const unsignedAssetTransactions = await updateARC19AssetMintArray(
          [transaction_data],
          nodeURL,
          token
        );
        if (unsignedAssetTransactions.length === 0) {
          toast.error("Something went wrong while creating transactions");
          return;
        }
        setTransaction(unsignedAssetTransactions);
      } else if (formData.format === "ARC69") {
        metadata.properties = metadata.properties.traits;
        const transaction_data = {
          asset_id: assetID,
          note: metadata,
          freeze: formData.freeze,
          clawback: formData.clawback,
        };
        const signedTransactions = await createAssetConfigArray(
          [transaction_data],
          nodeURL,
          "",
          false
        );
        setTransaction(signedTransactions);
      } else {
        throw new Error("ARC3 assets can't be updated");
      }
      toast.info("Please sign the transaction");
      setProcessStep(2);
    } catch (error) {
      console.log(error);
      setProcessStep(0);
      toast.error("Something went wrong!");
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
      await algodClient.sendRawTransaction(groups[0]).do();
      toast.success("Asset updated successfully!");
      setProcessStep(4);
    } catch (error) {
      toast.error("Something went wrong!");
      setProcessStep(2);
    }
  }

  /** Remove the locally stored data */
  function removeStoredData() {
    setFormData(RESET);
    setAssetID(RESET);
    setToken(RESET);
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 min-h-screen">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      {assetID !== "" && formData.name ? (
        <>
          <div className="flex flex-col md:flex-row justify-between">
            <button
              className="rounded bg-secondary-orange hover:bg-secondary-orange/80  text-black px-4 py-1 mt-2"
              onClick={() => {
                removeStoredData();
                window.location.reload();
              }}
            >
              Back
            </button>
            <div className="focus:outline-nonetext-sm font-light leading-tight text-slate-200 mt-4 md:ml-2">
              Asset:{" "}
              <a
                className="font-medium text-slate-300 underline hover:text-slate-400 transition"
                href={getAssetPreviewURL(assetID)}
                target="_blank"
                rel="noreferrer"
              >
                {assetID}
              </a>
            </div>
          </div>
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            <div className="flex flex-col">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Name
              </label>
              <input
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                value={formData.name}
                disabled
              />
            </div>
            <div className="flex flex-col md:mt-0 mt-4">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Unit name
              </label>
              <input
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                value={formData.unitName}
                disabled
              />
            </div>
          </div>
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            <div className="flex flex-col">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Total supply
              </label>
              <input
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                value={formData.totalSupply}
                disabled
              />
            </div>
            <div className="flex flex-col md:mt-0 mt-4">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Decimals
              </label>
              <input
                className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                value={formData.decimals}
                disabled
              />
            </div>
          </div>
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            {formData.format === "ARC19" && (
              <div className="flex flex-col md:mt-0 mt-4">
                <label className="mb-2 text-sm leading-none text-gray-200">
                  New Image <span className="text-xs italic">(optional)</span>
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
            )}
            <div className="flex flex-col md:mt-0 mt-4 mx-auto">
              <label className="mb-2 text-sm leading-none text-gray-200">
                ARC format
              </label>
              <div className="inline-flex items-center space-x-2">
                <input
                  className="w-64 bg-gray-400 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-400 disabled:cursor-not-allowed"
                  value={formData.format}
                  disabled
                />
              </div>
            </div>
          </div>
          {formData.image_url && (
            <img
              src={
                formData.image_url.startsWith("ipfs://")
                  ? `${IPFS_ENDPOINT}${formData.image_url.replace(
                      "ipfs://",
                      ""
                    )}`
                  : formData.image_url
              }
              className="w-60 mx-auto mt-4 object-contain rounded-md"
              alt="asset"
              id="asset_image"
              onError={(e) => {
                e.target.onerror = null;
                window.document.getElementById("asset_image").remove();
              }}
            />
          )}
          {formData.animation_url && (
            <video
              src={
                formData.animation_url.startsWith("ipfs://")
                  ? `${IPFS_ENDPOINT}${formData.animation_url.replace(
                      "ipfs://",
                      ""
                    )}`
                  : formData.animation_url
              }
              className="w-60 mx-auto mt-4 object-contain rounded-md"
              alt="asset_video"
              id="asset_video"
              onError={(e) => {
                e.target.onerror = null;
                window.document.getElementById("asset_video").remove();
              }}
              controls
              autoPlay
            />
          )}
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
                  readOnly={formData.format === "ARC3"}
                />
              </div>
            );
          })}
          <p className="focus:outline-nonetext-sm font-light leading-tight text-gray-200 mt-2">
            Traits
          </p>
          <div className="md:flex flex-col items-center text-start justify-center">
            {formData.traits.map((metadata) => {
              return TraitMetadataInputField(metadata.id, "traits");
            })}
          </div>
          {formData.format !== "ARC3" && (
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
          )}
          <p className="focus:outline-nonetext-sm font-semibold text-xl leading-tight text-gray-200 mt-2">
            Non-Rarity Filters
          </p>
          <p className="focus:outline-nonetext-sm font-light leading-tight text-gray-200 mt-2">
            Filters
          </p>
          <div className="md:flex flex-col items-center text-start justify-center">
            {formData.filters.map((metadata) => {
              return TraitMetadataInputField(metadata.id, "filters");
            })}
          </div>
          {formData.format !== "ARC3" && (
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
          )}
          <div className="border-b-2 border-gray-400 w-1/2 my-4"></div>
          <p className="focus:outline-nonetext-sm font-light leading-tight text-gray-200">
            Extras
          </p>
          <div className="md:flex flex-col items-center text-start justify-center">
            {formData.extras.map((metadata) => {
              return TraitMetadataInputField(metadata.id, "extras");
            })}
          </div>
          {formData.format !== "ARC3" && (
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
          )}
          {formData.format === "ARC3" ? (
            <p className="text-lg text-red-400 font-roboto">
              ARC3 assets can't be updated
            </p>
          ) : (
            <>
              {formData.format === "ARC19" && (
                <div className="flex flex-col mt-4">
                  <label className="mb-1 text-sm leading-none text-gray-200">
                    Pinata JWT***
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
                      href="https://knowledge.pinata.cloud/en/articles/6191471-how-to-create-an-pinata-api-key"
                      target="_blank"
                      className="text-primary-orange/70 hover:text-secondary-orange/80 transition"
                      rel="noreferrer"
                    >
                      here
                    </a>
                  </p>{" "}
                </div>
              )}
              <div className="flex flex-col justify-center items-center w-[16rem]">
                {processStep === 4 ? (
                  <>
                    <p className="pt-4 text-green-500 text-sm">
                      Asset updated successfully!
                      <br />
                    </p>
                    {assetID && (
                      <a
                        href={getAssetPreviewURL(assetID)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-yellow hover:text-primary-yellow/80 transition text-lg py-2 animate-pulse"
                      >
                        View the Updated Asset
                      </a>
                    )}
                    <div className="mt-4">
                    <button
                        className="rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black/90 font-semibold px-4 py-1 mb-3 w-full"
                        onClick={() => {
                          removeStoredData();
                          window.location.reload();
                        }}
                      >
                        Do another update
                      </button>
                      <Button
                        variant="outlined"
                        color="inherit"
                        fullWidth={true}
                        onClick={() => {
                          removeStoredData();
                          navigate("/");
                        }}
                      >
                        Go to home
                      </Button>
                    </div>

                  </>
                ) : processStep === 3 ? (
                  <>
                    <p className="pt-4 text-green-500 animate-pulse text-sm">
                      Sending transactions...
                    </p>
                  </>
                ) : processStep === 2 ? (
                  <>
                    <p className="mt-1 text-green-200/60 text-sm animate-pulse">
                      Transaction created!
                    </p>
                    <button
                      id="create_transactions_id"
                      className="rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black font-semibold px-4 py-1 mt-2"
                      onClick={() => {
                        sendTransaction();
                      }}
                    >
                      Sign
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
                    className="rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black font-semibold px-4 py-1 mt-2"
                    onClick={update}
                  >
                    Update
                  </button>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="flex flex-col justify-center items-center w-[16rem]">
          <input
            type="number"
            id="asset_id"
            placeholder="asset ID"
            className="w-48 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/50 px-3 py-2 border rounded border-gray-200"
          ></input>
          <button
            className="rounded bg-secondary-orange hover:bg-secondary-orange/80 transition text-black/90 font-semibold px-4 py-1 mt-2"
            onClick={getAssetData}
          >
            Next
          </button>
        </div>
      )}
      <p className="text-sm italic text-slate-200 py-4">
        **It is recommended that any Creator Host their own Files using their
        own token. Evil Tools will not be held responsible for anything that
        happens to publicly hosted images.
      </p>
      <p className="text-sm italic text-slate-200">Fee: Free</p>
    </div>
  );
}