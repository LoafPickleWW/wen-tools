import { useState } from "react";
import ConnectButton from "../components/ConnectButton";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import axios from "axios";
import {
  pinImageToNFTStorage,
  getNodeURL,
  updateARC19AssetMintArray,
  createAssetConfigArray,
  signGroupTransactions,
  sliceIntoChunks,
  Arc69,
  getARC19AssetMetadataData,
  getAlgoexplorerURL,
} from "../utils";
import { TOOLS, IPFS_ENDPOINT, NFT_STORAGE_KEY } from "../constants";

export function SimpleUpdate() {
  const [formData, setFormData] = useState({
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
    metadata: [],
  });
  const [token, setToken] = useState("");
  const [processStep, setProcessStep] = useState(0);
  const [transaction, setTransaction] = useState(null);
  const [assetID, setAssetID] = useState("");

  const TraitMetadatInputField = (id) => {
    return (
      <div key={id} id={`metadata-${id}`} className="mb-2">
        <input
          type="text"
          id={`category-${id}`}
          placeholder="Trait Category"
          className={`${
            formData.format === "ARC3" ? "w-32" : "w-24 md:w-28"
          } bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-xs px-3 py-2 border rounded border-gray-200`}
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
          readOnly={formData.format === "ARC3"}
        />
        <input
          id={`name-${id}`}
          type="text"
          placeholder="Trait"
          className={`${
            formData.format === "ARC3" ? "w-32" : "w-24 md:w-28"
          } bg-gray-300 text-sm ml-2 font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-sm px-3 py-2 border rounded border-gray-200`}
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
          readOnly={formData.format === "ARC3"}
        />
        {formData.format !== "ARC3" && (
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
        )}
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
          throw new Error("This asset doesn't have a URL field.");
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
      let metadata = [];
      if (assetMetadata.properties) {
        metadata = Object.keys(assetMetadata.properties).map((key, index) => {
          return {
            id: index,
            category: key,
            name: assetMetadata.properties[key],
          };
        });
      }
      if (assetMetadata.description) {
        metadata = [
          ...metadata,
          {
            id: metadata.length,
            category: "description",
            name: assetMetadata.description,
          },
        ];
      }
      if (assetMetadata.external_url) {
        metadata = [
          ...metadata,
          {
            id: metadata.length,
            category: "external_url",
            name: assetMetadata.external_url,
          },
        ];
      }
      setFormData({
        ...formData,
        name: assetData.params["name"],
        unitName: assetData.params["unit-name"],
        totalSupply: assetData.params["total"],
        decimals: assetData.params["decimals"],
        freeze: assetData.params["freeze"] === undefined ? false : true,
        clawback: assetData.params["clawback"] === undefined ? false : true,
        format: assetFormat,
        metadata: metadata,
        image_url: assetMetadata.image || assetData.params["url"],
        image_mime_type: assetMetadata.image_mime_type,
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
      formData.metadata.forEach((data) => {
        if (data.category !== "" && data.name !== "") {
          if (
            data.category === "description" ||
            data.category === "external_url"
          ) {
            metadata[data.category] = data.name;
          } else {
            metadata.properties[data.category] = data.name;
          }
        }
      });
      if (formData.image && formData.format === "ARC19") {
        toast.info("Uploading the image to IPFS...");
        const imageURL =
          "ipfs://" + (await pinImageToNFTStorage(token, formData.image));
        metadata.image = imageURL;
        metadata.image_mime_type = formData.image.type;
      } else if (formData.format === "ARC3") {
        throw new Error("ARC3 assets can't be updated");
      } else {
        if (formData.image_mime_type) {
          metadata.image_mime_type = formData.image_mime_type;
        }
        if (formData.image_url) {
          metadata.image = formData.image_url;
        }
      }
      const nodeURL = getNodeURL();
      if (formData.format === "ARC19") {
        const transaction_data = {
          asset_id: assetID,
          ipfs_data: metadata,
        };
        const unsignedAssetTransactions = await updateARC19AssetMintArray(
          [transaction_data],
          nodeURL,
          token,
          true
        );
        setTransaction(unsignedAssetTransactions);
      } else if (formData.format === "ARC69") {
        const transaction_data = {
          asset_id: assetID,
          note: metadata,
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

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      <SelectNetworkComponent />
      {assetID !== "" && formData.name ? (
        <>
          <p>Connect Creator Wallet</p>
          <ConnectButton />
          <div className="w-full px-10">
            <div className="flex flex-row justify-between">
              <button
                className="rounded bg-secondary-green hover:bg-secondary-green/80  text-white px-4 py-1 mt-2"
                onClick={() => {
                  setAssetID("");
                  setFormData({
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
                    metadata: [],
                  });
                }}
              >
                Back
              </button>
              <p className="focus:outline-nonetext-sm font-light leading-tight text-slate-200 mt-4">
                Asset:{" "}
                <a
                  className="font-medium text-slate-300 underline hover:text-slate-400 transition"
                  href={`${getAlgoexplorerURL()}/asset/${assetID}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {assetID}
                </a>
              </p>
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
                    accept="image/*"
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
              />
            )}
            <p className="focus:outline-nonetext-sm font-light leading-tight text-gray-200 mt-4">
              Property Metadata
            </p>
            <div className="mt-4 md:flex flex-col items-center text-start justify-center">
              {formData.metadata.map((metadata) => {
                return TraitMetadatInputField(metadata.id);
              })}
            </div>
            {formData.format !== "ARC3" && (
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
            )}
          </div>
          {formData.format === "ARC3" ? (
            <p className="text-lg text-red-400 font-roboto">
              ARC3 assets can't be updated
            </p>
          ) : (
            <>
              {formData.format === "ARC19" && (
                <div className="flex flex-col mt-4">
                  <div className="flex flex-row items-center justify-center gap-x-2 mb-2">
                    <input
                      type="checkbox"
                      id="ipfs"
                      className="peer"
                      value={token === NFT_STORAGE_KEY}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setToken(NFT_STORAGE_KEY);
                        } else {
                          setToken("");
                        }
                      }}
                    />
                    <label
                      htmlFor="ipfs"
                      className="text-sm font-light leading-tight text-gray-200 peer-checked:text-primary-green/80 peer-checked:font-medium cursor-pointer"
                    >
                      Use Public Token - Opt out from hosting your image*
                    </label>
                  </div>
                  {token !== NFT_STORAGE_KEY && (
                    <>
                      <p className="text-xs text-slate-400 font-roboto my-2">
                        or
                      </p>
                      <label className="mb-1 text-sm leading-none text-gray-200">
                        NFT Storage Token**
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
                        **You can get your own token{" "}
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
              )}
              <div className="flex flex-col justify-center items-center w-[16rem]">
                {processStep === 4 ? (
                  <>
                    <p className="pt-4 text-green-500 animate-pulse text-sm">
                      Asset updated successfully!
                      <br />
                    </p>
                    <p className="pb-2 text-slate-400 text-xs">
                      You can reload the page if you want to use again.
                    </p>
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
                      className="rounded bg-secondary-green hover:bg-secondary-green/80 transition text-white/90 font-semibold px-4 py-1 mt-2"
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
                    className="rounded bg-secondary-green hover:bg-secondary-green/80 transition text-white/90 font-semibold px-4 py-1 mt-2"
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
            className="rounded bg-secondary-green hover:bg-secondary-green/80 transition text-white/90 font-semibold px-4 py-1 mt-2"
            onClick={getAssetData}
          >
            Next
          </button>
        </div>
      )}
      <p className="text-sm italic text-slate-200">*It is recommended that Creators Host their own Files</p>
      <p className="text-sm italic text-slate-200">Fee: 0.05A</p>
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
    </div>
  );
}
