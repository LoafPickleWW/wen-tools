import { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { Arc69 } from "../utils";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import { TOOLS, MAINNET_ALGONODE_INDEXER, TESTNET_ALGONODE_INDEXER } from "../constants";

export function DownloadCollectionData() {
  const [creatorWallet, setCreatorWallet] = useState("");
  const [collectionData, setCollectionData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(0);

  const arc69 = new Arc69();

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
        setCollectionData(response.data.account["created-assets"]);
      } catch (error) {
        toast.error("Error getting collection data! Please try again.");
      }
    } else {
      toast.info("Please enter a wallet address");
    }
  }

  async function getAssetData(asset) {
    try {
      const metadata = await arc69.fetch(
        asset.index,
        localStorage.getItem("networkType")
      );
      const asset_data_csv = {
        index: asset.index,
        name: asset.params.name,
        "unit-name": asset.params["unit-name"],
        url: asset.params.url,
        metadata_description: metadata.description || "",
        metadata_external_url: metadata.external_url || "",
        metadata_mime_type: metadata.mime_type || "",
      };
      if (metadata.properties) {
        Object.entries(metadata.properties).map(([trait_type, value]) => {
          return asset_data_csv[`metadata_${trait_type}`] = value;
        });
      }
      if (metadata.attributes) {
        metadata.attributes.map(({ trait_type, value }) => {
          return asset_data_csv[`metadata_${trait_type}`] = value;
        });
      }
      return asset_data_csv;
    } catch (err) {
      //console.log(err);
    }
  }

  function convertToCSV(objArray) {
    let array = typeof objArray != "object" ? JSON.parse(objArray) : objArray;
    let str = "";
    for (let i = 0; i < array.length; i++) {
      let line = "";
      for (let index in array[i]) {
        if (line != "") line += ",";
        line += '"' + array[i][index] + '"';
      }
      // don't put '\r\n' at the end of the last line
      if (i != array.length - 1) {
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

  async function downloadCollectionDataAsCSV() {
    if (collectionData.length > 0) {
      setLoading(true);
      const data = [];
      let count = 0;
      for (const asset of collectionData) {
        const asset_data = await getAssetData(asset);
        count++;
        setCounter(count);
        data.push(asset_data);
      }
      const headers = Object.keys(
        data.reduce((a, b) =>
          Object.keys(b).length > Object.keys(a).length ? b : a
        )
      );
      exportCSVFile(
        headers ? headers : ["index", "name", "unit-name", "url", "metadata"],
        data,
        `${creatorWallet}-collection-data.csv`
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
      {collectionData.length > 0 && (
        <>
          {creatorWallet.length == 58 && collectionData && (
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
                created assets
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
