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
  SignWithMnemonics,
} from "../utils";
import { IPFS_ENDPOINT, MINT_FEE_PER_ASA, TOOLS } from "../constants";

import Papa from "papaparse";
import InfinityModeComponent from "../components/InfinityModeComponent";
import FaqSectionComponent from "../components/FaqSectionComponent";

export function SimpleBatchMint() {
  const START_PROCESS = 0;
  const CREATE_TRANSACTIONS_PROCESS = 1;
  const SIGN_TRANSACTIONS_PROCESS = 2;
  const SENDING_TRANSACTIONS_PROCESS = 3;
  const COMPLETED = 4;

  const [formData, setFormData] = useState({
    collectionFormat: "ARC3",
    name: "",
    unitName: "",
    mediaIPFSCID: "",
    mediaExtension: "",
    startIndex: "",
    endIndex: "",
    freeze: false,
    clawback: false,
    defaultFrozen: false,
    externalUrl: "",
    description: "",
    creatorName: "",
    tokenId: "",
    royalty: "",
  });

  const [csvData, setCsvData] = useState(null);

  const [processStep, setProcessStep] = useState(START_PROCESS);
  const [token, setToken] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [hasMetadataFile, setHasMetadataFile] = useState(false);
  const [assetTransactions, setAssetTransactions] = useState([]);
  const [previewAsset, setPreviewAsset] = useState(null);

  const TraitMetadataInputField = (key) => {
    return (
      <div key={key} id={`metadata-${key}`} className="mb-2">
        <input
          disabled
          type="text"
          id={`key-${key}`}
          placeholder="Property"
          className="w-24 md:w-28 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 placeholder:text-xs px-3 py-2 border rounded border-gray-200"
          value={key.replace(/([A-Z])/g, " $1").replace(/^./, function (str) {
            return str.toUpperCase();
          })}
        />
        <input
          id={`value-${key}`}
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
  };

  async function createTransactions() {
    try {
      const wallet = localStorage.getItem("wallet");
      if (!wallet) {
        toast.error("Please connect your wallet");
        return;
      }
      if (formData.collectionFormat !== "ARC69" && !token) {
        toast.error("Please enter a token");
        return;
      }

      if (hasMetadataFile && !csvData) {
        toast.error("Please upload a metadata file");
        return;
      }

      // check index values
      if (!hasMetadataFile && (!formData.startIndex || !formData.endIndex)) {
        toast.error("Please enter start and end index values");
        return;
      }

      if (!hasMetadataFile && formData.startIndex >= formData.endIndex) {
        toast.error("End index must be greater than start index");
        return;
      }

      if (formData.mediaExtension === "") {
        toast.error("Please enter media extension");
        return;
      }

      if (formData.mediaIPFSCID === "") {
        toast.error("Please enter media IPFS CID");
        return;
      }

      if (formData.name === "") {
        toast.error("Please enter collection name");
        return;
      }

      if (formData.unitName === "") {
        toast.error("Please enter collection unit name");
        return;
      }

      if (!formData.mediaExtension.includes(".")) {
        toast.error("Media extension must include '.'");
        return;
      }

      let headers;
      let data = [];
      if (hasMetadataFile && csvData.length > 1) {
        for (let i = 0; i < csvData.length; i++) {
          if (csvData[i].length === 1) continue;
          if (i === 0) {
            headers = csvData[i];
          } else {
            let obj = {};
            for (let j = 0; j < headers.length; j++) {
              if (headers[j].startsWith("metadata_")) {
                obj[headers[j].replace("metadata_", "")] = csvData[i][j];
              } else {
                obj[headers[j]] = csvData[i][j];
              }
            }
            obj[
              "image_ipfs_cid"
            ] = `ipfs://${formData.mediaIPFSCID}/${obj["index"]}${formData.mediaExtension}`;
            data.push(obj);
          }
        }
      }

      if (!hasMetadataFile) {
        for (let i = formData.startIndex; i <= formData.endIndex; i++) {
          data.push({
            index: i,
            image_ipfs_cid: `ipfs://${formData.mediaIPFSCID}/${i}${formData.mediaExtension}`,
          });
        }
      }

      const nodeURL = getNodeURL();
      const resp = await fetch(
        `${nodeURL}/v2/accounts/${wallet}?exclude=all`
      ).then((res) => res.json());
      const min_balance = resp.amount - resp["min-balance"] / 10 ** 6;
      if (min_balance < (0.1 + MINT_FEE_PER_ASA + 0.002) * data.length) {
        toast.error("You don't have enough balance to mint these assets!");
        return;
      }

      let data_for_txns = [];
      data.forEach((item) => {
        const asset_name = `${formData.name} ${item.index}`;
        const unit_name = `${formData.unitName} ${item.index}`;
        const has_clawback = formData.clawback ? "Y" : "N";
        const has_freeze = formData.freeze ? "Y" : "N";
        const default_frozen = formData.defaultFrozen ? "Y" : "N";
        const decimals = 0;
        const total_supply = 1;

        let ipfs_cid = item.image_ipfs_cid;

        function getMimeType(extension) {
          switch (extension) {
            case ".png":
              return "image/png";
            case ".jpg":
              return "image/jpeg";
            case ".jpeg":
              return "image/jpeg";
            case ".mp4":
              return "video/mp4";
            default:
              return "";
          }
        }

        let ipfs_data = {
          name: asset_name,
          standard: formData.collectionFormat.toLowerCase(),
          image: ipfs_cid,
          image_mime_type: getMimeType(formData.mediaExtension),
          properties: {
            traits: {},
            filters: {},
          },
          extra: {},
        };

        if (formData.externalUrl) {
          ipfs_data.external_url = formData.externalUrl;
        }

        if (formData.description) {
          ipfs_data.description = formData.description;
        }

        if (formData.creatorName) {
          ipfs_data.extra.creator = formData.creatorName;
        }

        if (formData.tokenId) {
          ipfs_data.extra.token_id = formData.tokenId;
        }

        if (formData.royalty) {
          ipfs_data.extra.royalty = formData.royalty;
        }

        Object.keys(ipfs_data).forEach((key) => {
          if (ipfs_data[key] === "") {
            delete ipfs_data[key];
          }
        });

        Object.keys(item).forEach((key) => {
          if (key.startsWith("property_")) {
            ipfs_data.properties.traits[key.replace("property_", "")] =
              item[key];
          }
          if (key.startsWith("extra_")) {
            ipfs_data.extra[key.replace("extra_", "")] = item[key];
          }
          if (key.startsWith("filters_")) {
            ipfs_data.properties.filters[key.replace("filters_", "")] =
              item[key];
          }
        });
        if (asset_name.length > 32) {
          toast.error(
            `Asset name cannot be longer than 32 characters, too long for ${asset_name}`
          );
          return;
        }
        if (unit_name.length > 8) {
          toast.error(
            `Unit name cannot be longer than 8 characters, too long for ${asset_name}`
          );
          return;
        }
        if (decimals > 19) {
          toast.error(
            `Decimals cannot be more than 19, too many for ${asset_name}`
          );
          return;
        }

        if (formData.collectionFormat === "ARC69") {
          ipfs_data.properties = ipfs_data.properties.traits;
        }

        const transaction_data = {
          asset_name,
          unit_name,
          has_clawback,
          has_freeze,
          default_frozen,
          decimals,
          total_supply,
          ipfs_data,
        };
        data_for_txns.push(transaction_data);
      });

      setPreviewAsset(data_for_txns[0]);

      let unsignedAssetTransaction;
      if (formData.collectionFormat === "ARC3") {
        toast.info("Creating ARC3 transactions...");
        setProcessStep(CREATE_TRANSACTIONS_PROCESS);
        unsignedAssetTransaction = await createARC3AssetMintArray(
          data_for_txns,
          nodeURL,
          token
        );
      } else if (formData.collectionFormat === "ARC19") {
        toast.info("Creating ARC19 transactions...");
        setProcessStep(CREATE_TRANSACTIONS_PROCESS);
        unsignedAssetTransaction = await createARC19AssetMintArray(
          data_for_txns,
          nodeURL,
          token        
        );
      } else if (formData.collectionFormat === "ARC69") {
        toast.info("Creating ARC69 transactions...");
        setProcessStep(CREATE_TRANSACTIONS_PROCESS);
        data_for_txns = data_for_txns.map((item) => {
          return {
            ...item,
            asset_note: item.ipfs_data,
            asset_url: item.ipfs_data.image,
          };
        });
        unsignedAssetTransaction = await createAssetMintArray(
          data_for_txns,
          nodeURL,
          "",
          false
        );
      } else {
        toast.error("Invalid ARC format");
        return;
      }
      setAssetTransactions(unsignedAssetTransaction);
      setProcessStep(SIGN_TRANSACTIONS_PROCESS);
      toast.success("Transactions created successfully!");
    } catch (error) {
      console.log(error);
      toast.error("Something went wrong!");
      setProcessStep(START_PROCESS);
    }
  }

  async function sendTransaction() {
    try {
      const wallet = localStorage.getItem("wallet");
      if (wallet === null || wallet === undefined) {
        toast.error("Please connect your wallet first!");
        return;
      }
      if (assetTransactions.length === 0) {
        toast.error("Please create transactions first!");
        return;
      }
      if (assetTransactions.length > 7 && mnemonic === "") {
        toast.error("Please enter your mnemonic!");
        return;
      }
      setProcessStep(SENDING_TRANSACTIONS_PROCESS);
      const nodeURL = getNodeURL();
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });

      let signedAssetTransactions;
      if (mnemonic !== "") {
        if (mnemonic.split(" ").length !== 25)
          throw new Error("Invalid Mnemonic!");
        const { sk } = algosdk.mnemonicToSecretKey(mnemonic);
        signedAssetTransactions = SignWithMnemonics(
          assetTransactions.flat(),
          sk
        );
      } else {
        signedAssetTransactions = await signGroupTransactions(
          assetTransactions,
          wallet,
          true
        );
      }

      signedAssetTransactions = sliceIntoChunks(signedAssetTransactions, 2);

      for (let i = 0; i < signedAssetTransactions.length; i++) {
        try {
          await algodClient.sendRawTransaction(signedAssetTransactions[i]).do();
          if (i % 5 === 0) {
            toast.success(
              `Transaction ${i + 1} of ${
                signedAssetTransactions.length
              } confirmed!`,
              {
                autoClose: 1000,
              }
            );
          }
        } catch (error) {
          toast.error(
            `Transaction ${i + 1} of ${signedAssetTransactions.length} failed!`,
            {
              autoClose: 1000,
            }
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      setProcessStep(COMPLETED);
      toast.success("All transactions confirmed!");
      toast.info("You can support by donating :)");
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
      <button className="text-center text-lg text-primary-green mt-2 bg-primary-green px-4 py-2 rounded">
        <a
          className="hover:text-primary-green transition"
          href="https://loafpickle.medium.com/simple-batch-mint-guide-9f1bbe7882cd"
          target="_blank"
          rel="noopener noreferrer"
        >
          Check Guide Here
        </a>
      </button>
      <button className="text-center text-lg text-primary-green mt-2 bg-primary-green px-4 py-2 rounded">
        <a
          className="hover:text-primary-green transition"
          href="https://docs.google.com/spreadsheets/d/1_hxkAcW2DWgoZ3s0A6jBK3DS7liU5QnA89mbXRttLhw/edit?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
        >
          CSV Template
        </a>
      </button>
      {/* mnemonic */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      {/* end mnemonic */}
      <div className="mt-4 md:flex items-center text-start gap-x-4">
        <div className="flex flex-col md:mt-0 mt-2">
          <label className="mb-2 text-sm leading-none text-gray-200">
            Collection Format*
          </label>
          <div className="inline-flex items-center space-x-2">
            <select
              className="bg-gray-300 rounded border-gray-300 font-medium text-center text-black transition px-2 py-1 w-48"
              required
              value={formData.collectionFormat}
              disabled={processStep !== START_PROCESS}
              onChange={(e) => {
                setFormData({
                  ...formData,
                  collectionFormat: e.target.value,
                });
              }}
            >
              <option value="ARC3">ARC3 (Unchangeable)</option>
              <option value="ARC19">ARC19 (Mutable Images and Data)</option>
              <option value="ARC69">ARC69 (Mutable Data Only)</option>
            </select>
          </div>
        </div>
      </div>
      <div className="w-min px-10">
        <div className="mt-2 md:flex items-center text-start gap-x-4">
          <div className="flex flex-col">
            <label className="mb-2 text-sm leading-none text-gray-200">
              Collection Name*
            </label>
            <input
              type="text"
              placeholder="Ex: STUPIDHORSE"
              className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
              maxLength={32}
              required
              disabled={processStep !== START_PROCESS}
              value={formData.name}
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value });
              }}
            />
          </div>
          <div className="flex flex-col md:mt-0 mt-4">
            <label className="mb-2 text-sm leading-none text-gray-200">
              Collection Unit Name*
            </label>
            <input
              type="text"
              placeholder="Ex: HORSE"
              className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
              maxLength={8}
              required
              disabled={processStep !== START_PROCESS}
              value={formData.unitName}
              onChange={(e) => {
                setFormData({ ...formData, unitName: e.target.value });
              }}
            />
          </div>
        </div>
        <div className="mt-4 md:flex items-center text-start gap-x-4">
          <div className="flex flex-col md:mt-0 mt-4">
            <label className="mb-2 text-sm leading-none text-gray-200">
              Media IPFS CID*
            </label>
            <input
              className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
              id="select_image"
              placeholder="Enter IPFS CID of media folder"
              type="text"
              disabled={processStep !== START_PROCESS}
              value={formData.mediaIPFSCID}
              onChange={(e) => {
                setFormData({ ...formData, mediaIPFSCID: e.target.value });
              }}
            />
          </div>
          <div className="flex flex-col md:mt-0 mt-4">
            <label className="mb-2 text-sm leading-none text-gray-200">
              Media Extension*
            </label>
            <input
              type="text"
              placeholder="Ex: .png, .jpg, .jpeg, .mp4"
              className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
              maxLength={8}
              required
              disabled={processStep !== START_PROCESS}
              value={formData.mediaExtension}
              onChange={(e) => {
                setFormData({ ...formData, mediaExtension: e.target.value });
              }}
            />
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer mt-4">
          <input
            type="checkbox"
            className="sr-only peer"
            id="freeze"
            onChange={(e) => {
              setHasMetadataFile(e.target.checked);
            }}
            checked={hasMetadataFile}
          />
          <div className="w-11 h-6 bg-gray-400 peer-focus:outline-none peer-focus:ring-4  rounded-full peer  peer-checked:after:translate-x-full  after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-blue-600"></div>
          <span className="ml-3 text-sm font-medium text-gray-300">
            Has Metadata File?
          </span>
        </label>
        {hasMetadataFile ? (
          <div>
            <p className="mt-2">Upload Metadata CSV file</p>
            {csvData === null ? (
              <div className="mt-2 md:flex items-center text-start mx-auto">
                <label
                  htmlFor="dropzone-file"
                  className="flex flex-col mx-auto justify-center items-center w-[16rem] h-[8rem] px-4  rounded-lg border-2  border-dashed cursor-pointer hover:bg-bray-800 bg-gray-700  border-gray-600 hover:border-gray-500 hover:bg-gray-600"
                >
                  <div className="flex flex-col justify-center items-center pt-5 pb-6">
                    <p className="mb-1 text-sm text-gray-400 font-bold">
                      Click to upload metada file
                    </p>
                    <p className="text-xs text-gray-400">(CSV)</p>
                  </div>
                  <input
                    className="hidden"
                    id="dropzone-file"
                    type="file"
                    accept=".csv"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      Papa.parse(file, {
                        complete: function (results) {
                          const filteredData = results.data.filter(
                            (row) => row[0].length > 0
                          );
                          setCsvData(filteredData);
                        },
                      });
                    }}
                  />
                </label>
              </div>
            ) : (
              <p className="mb-1 text-sm text-slate-300 w-min mt-1 mx-auto font-bold rounded-lg border-2 py-6 px-4 border-dashed border-slate-400">
                File uploaded
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 md:flex items-center text-start gap-x-4">
            <div className="flex flex-col md:mt-0 mt-4">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Collection Start Index*
              </label>
              <input
                className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
                id="start_index"
                placeholder="Enter start index"
                type="number"
                value={formData.startIndex}
                onChange={(e) => {
                  setFormData({ ...formData, startIndex: e.target.value });
                }}
              />
            </div>
            <div className="flex flex-col md:mt-0 mt-4">
              <label className="mb-2 text-sm leading-none text-gray-200">
                Collection End Index*
              </label>
              <input
                className="w-64 bg-gray-300 text-sm font-medium text-center leading-none text-black placeholder:text-black/30 px-3 py-2 border rounded border-gray-200"
                id="end_index"
                placeholder="Enter end index"
                type="number"
                value={formData.endIndex}
                onChange={(e) => {
                  setFormData({ ...formData, endIndex: e.target.value });
                }}
              />
            </div>
          </div>
        )}
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
              disabled={processStep !== START_PROCESS}
              checked={formData.freeze}
            />
            <div className="w-11 h-6 bg-gray-400 peer-focus:outline-none peer-focus:ring-4  rounded-full peer  peer-checked:after:translate-x-full  after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-blue-600"></div>
            <span className="ml-3 text-sm font-medium text-gray-300">
              Freeze
            </span>
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
              disabled={processStep !== START_PROCESS}
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
            disabled={processStep !== START_PROCESS}
            checked={formData.defaultFrozen}
          />
          <div className="w-11 h-6 bg-gray-400 peer-focus:outline-none peer-focus:ring-4  rounded-full peer  peer-checked:after:translate-x-full  after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all border-gray-600 peer-checked:bg-blue-600"></div>
          <span className="ml-2 text-sm font-medium text-gray-300">
            Default Frozen
          </span>
        </label>
      </div>
      <div className="md:flex flex-col items-center text-start justify-center">
        {[
          "externalUrl",
          "description",
          "creatorName",
          "tokenId",
          "royalty",
        ].map((key) => {
          return TraitMetadataInputField(key);
        })}
      </div>
      {formData.collectionFormat !== "ARC69" && (
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
                  className="text-primary-green/70 hover:text-secondary-green/80 transition"
                  rel="noreferrer"
                >
                  here
                </a>
              </p>{" "}          
        </div>
      )}
      {previewAsset && (
        <div className="flex flex-col mt-2 justify-center items-center w-[16rem] bg-secondary-black p-4 rounded-lg">
          <p className="text-lg font-bold">Preview Asset</p>
          <div className="flex flex-col items-center mt-2">
            <img
              src={previewAsset.ipfs_data.image.replace("ipfs://", IPFS_ENDPOINT)}
              alt="preview"
              className="w-32 h-32 object-cover rounded-lg"
            />
            <p className="text-base text-gray-200 mt-2">
              {previewAsset.asset_name} | {previewAsset.unit_name}
            </p>
            {/* metadata like json intended */}
            <p className="text-sm text-gray-200 mt-1 w-48 overflow-x-auto">
              {JSON.stringify(previewAsset.ipfs_data, null, 2)}
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-col justify-center items-center w-[16rem]">
        {processStep === COMPLETED ? (
          <>
            <p className="pt-4 text-green-500 text-sm">
              Collection created successfully!
              <br />
            </p>
            <p className="pb-2 text-slate-400 text-xs">
              You can reload the page if you want to use again.
            </p>
          </>
        ) : processStep === SENDING_TRANSACTIONS_PROCESS ? (
          <>
            <p className="pt-4 text-green-500 animate-pulse text-sm">
              Sending transactions...
            </p>
          </>
        ) : processStep === SIGN_TRANSACTIONS_PROCESS ? (
          <>
            <p className="mt-1 text-green-200/60 text-sm animate-pulse">
              Transactions created!
            </p>
            <button
              id="create_transactions_id"
              className="rounded bg-secondary-green hover:bg-secondary-green/80 transition text-black/90 font-semibold px-4 py-1 mt-2"
              onClick={() => {
                sendTransaction();
              }}
            >
              Step 2: Sign
            </button>
          </>
        ) : processStep === CREATE_TRANSACTIONS_PROCESS ? (
          <div className="mx-auto flex flex-col">
            <div
              className="spinner-border animate-spin inline-block mx-auto w-8 h-8 border-4 rounded-full"
              role="status"
            ></div>
            Creating transaction...
          </div>
        ) : (
          <button
            className="rounded bg-secondary-green hover:bg-secondary-green/80 transition text-black/90 font-semibold px-4 py-1 mt-2"
            onClick={createTransactions}
          >
            Step 1: Create Transactions
          </button>
        )}
      </div>
      <p className="text-sm italic text-slate-200 px-4">
        **It is recommended that any Creator Host their own Files using their
        own token. Evil Tools will not be held responsible for anything that
        happens to publicly hosted images.
      </p>
      <p className="text-sm italic text-slate-200">Fee: {MINT_FEE_PER_ASA}A</p>
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
      <FaqSectionComponent
        faqData={[
          {
            question: "What is Simple Batch Mint?",
            answer:
              "Simple Batch Mint is a tool that allows you to mint NFT Collections on the Algorand blockchain in any of the major standards.",
          },
          {
            question: "How much does it cost to Mint?",
            answer:
              "There is a network fee of 0.1A and a Lab fee of 0.1A. In total you need to have at least 0.2A per Asset in your wallet before minting.",
          },
          {
            question: "How long can the name and Unit Name be?",
            answer:
              "Name can be up to 32 characters and Unit Name is up to 8 characters.",
          },
        ]}
      />
    </div>
  );
}
