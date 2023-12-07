import { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import algosdk from "algosdk";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import {
  TOOLS,
  MAINNET_ALGONODE_INDEXER,
  TESTNET_ALGONODE_INDEXER,
} from "../constants";
import { CID } from "multiformats/cid";
import * as mfsha2 from "multiformats/hashes/sha2";
import * as digest from "multiformats/hashes/digest";

export function Download19CollectionData() {
  const [creatorWallet, setCreatorWallet] = useState("");
  const [collectionData, setCollectionData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(0);

  async function getCollectionData() {
    if (creatorWallet) {
      if (creatorWallet.length !== 58) {
        toast.error("Invalid wallet address!");
        return;
      }
      try {
        const host =
          localStorage.getItem("networkType") === "mainnet"
            ? MAINNET_ALGONODE_INDEXER
            : TESTNET_ALGONODE_INDEXER;
        const url = `${host}/v2/accounts/${creatorWallet}?exclude=assets,apps-local-state,created-apps,none`;
        const response = await axios.get(url);
        const createdAssets = response.data.account["created-assets"].filter(
          (asset) =>
            asset.params.url
              ? asset.params.url.includes("template-ipfs:")
              : false
        );
        setCollectionData(createdAssets);
      } catch (error) {
        toast.error("Error getting collection data! Please try again.");
      }
    } else {
      toast.info("Please enter a wallet address");
    }
  }

  function convertToCSV(objArray) {
    let array = typeof objArray != "object" ? JSON.parse(objArray) : objArray;
    let str = "";
    for (let i = 0; i < array.length; i++) {
      let line = "";
      for (let index in array[i]) {
        if (line !== "") line += ",";
        line += '"' + array[i][index] + '"';
      }
      // don't put '\r\n' at the end of the last line
      if (i !== array.length - 1) {
        str += line + "\r\n";
      } else {
        str += line;
      }
    }
    return str;
  }

  function exportCSVFile(headers, items, fileTitle) {
    if (headers) {
      items.unshift(headers);
    }
    let jsonObject = JSON.stringify(items);

    let csv = convertToCSV(jsonObject);
    let blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    if (navigator.msSaveBlob) {
      navigator.msSaveBlob(blob, fileTitle);
    } else {
      let link = document.createElement("a");
      if (link.download !== undefined) {
        let url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", fileTitle);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  }

  async function getARC19AssetMetadataData(url, reserve) {
    try {
      let chunks = url.split("://");
      if (chunks[0] === "template-ipfs" && chunks[1].startsWith("{ipfscid:")) {
        const cidComponents = chunks[1].split(":");
        const cidVersion = cidComponents[1];
        const cidCodec = cidComponents[2];
        let cidCodecCode;
        if (cidCodec === "raw") {
          cidCodecCode = 0x55;
        } else if (cidCodec === "dag-pb") {
          cidCodecCode = 0x70;
        }
        const addr = algosdk.decodeAddress(reserve);
        const mhdigest = digest.create(mfsha2.sha256.code, addr.publicKey);
        const cid = CID.create(parseInt(cidVersion), cidCodecCode, mhdigest);
        const response = await axios.get(
          `https://ipfs.algonode.xyz/ipfs/${cid}`
        );
        return response.data;
      }
      return {};
    } catch (error) {
      return {};
    }
  }

  async function downloadCollectionDataAsCSV() {
    if (collectionData.length > 0) {
      setLoading(true);
      let data = [];
      let count = 0;
      for (const asset of collectionData) {
        const asset_metadata = await getARC19AssetMetadataData(
          asset.params.url,
          asset.params.reserve
        );
        let asset_data = {
          index: asset.index,
          name: asset.params.name,
          "unit-name": asset.params["unit-name"],
          reserve: asset.params.reserve,
        };
      for (const topLevelKey in asset_metadata) {
        if (topLevelKey === "properties") {
          for (const secondLevelKey in asset_metadata[topLevelKey]) {
            if (secondLevelKey == "traits" || secondLevelKey == "filter") {
                for (const k in asset_metadata[topLevelKey][secondLevelKey]) {
                    asset_data[`${secondLevelKey}_${k}`] = asset_metadata[topLevelKey][secondLevelKey][k];
                  }
              }
          }
        } else if (topLevelKey === "extra") {
          for (const key in asset_metadata[key]) {
            asset_data[`${key}_${k}`] = asset_metadata[key][k];
          }
        } else {
            asset_data[topLevelKey] = asset_metadata[topLevelKey];
        }
      }
        count++;
        setCounter(count);
        data.push(asset_data);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const headers = Object.keys(
        data.reduce((a, b) =>
          Object.keys(b).length > Object.keys(a).length ? b : a
        )
      );
      exportCSVFile(
        headers ? headers : ["asset_id", "name", "unit-name", "metadata"],
        data,
        `${creatorWallet}-arc19-collection-data.csv`
      );
      setLoading(false);
      setCounter(0);
      toast.success("Collection data downloaded successfully!");
      toast.info("You can support by donating :)");
    } else {
      toast.info("Please get collection data first!");
    }
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      <SelectNetworkComponent />
      <input
        type="text"
        id="creatorWallet"
        placeholder="Enter Creator Wallet Address"
        maxLength={58}
        className="text-center bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 my-2 w-64 mx-auto placeholder:text-center placeholder:text-sm"
        value={creatorWallet}
        onChange={(e) => setCreatorWallet(e.target.value)}
      />
      <button
        className="mb-2 bg-secondary-green/80 hover:bg-secondary-green text-white text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
        onClick={getCollectionData}
      >
        Get Collection Data
      </button>
      {collectionData && collectionData.length > 0 && (
        <>
          {creatorWallet.length === 58 && collectionData && (
            <div className="flex flex-col justify-center items-center">
              <p className="text-center text-sm text-slate-300">
                {creatorWallet.substring(0, 4)}...
                {creatorWallet.substring(
                  creatorWallet.length - 4,
                  creatorWallet.length
                )}{" "}
                has{" "}
                <span className="text-slate-100 font-semibold text-base animate-pulse">
                  {collectionData.length}
                </span>{" "}
                created ARC-19 assets
              </p>
            </div>
          )}
          {loading ? (
            <div className="mx-auto flex flex-col">
              <div
                className="spinner-border animate-spin inline-block mx-auto mt-4 w-8 h-8 border-4 rounded-full"
                role="status"
              ></div>
              Fetching data from blockchain...
              <p className="text-center text-sm text-slate-300">
                {counter}/{collectionData.length}
              </p>
            </div>
          ) : (
            <button
              onClick={downloadCollectionDataAsCSV}
              className="mb-2 bg-green-500 hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
            >
              Download Collection Data
            </button>
          )}
        </>
      )}
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
    </div>
  );
}
