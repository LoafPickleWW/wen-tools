import { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { getIndexerURL, getNfdDomain } from "../utils";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import {
  TOOLS,
  MAINNET_ALGONODE_INDEXER,
  TESTNET_ALGONODE_INDEXER,
} from "../constants";

export function CollectionSnapshot() {
  const [creatorWallet, setCreatorWallet] = useState("");
  const [unitNamePrefix, setUnitNamePrefix] = useState("");
  const [collectionData, setCollectionData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(0);

  async function getCollectionData() {
    if (creatorWallet) {
      let creatorWallets = creatorWallet.split(",").map((item) => item.trim()).filter((item) => item !== "");
      for (let i = 0; i < creatorWallets.length; i++) {
        if (creatorWallets[i].length !== 58) {
          toast.error("You have entered an invalid wallet address!");
          return;
        }
      }
      creatorWallets = [...new Set(creatorWallets)];
      const host =
        localStorage.getItem("networkType") === "mainnet"
          ? MAINNET_ALGONODE_INDEXER
          : TESTNET_ALGONODE_INDEXER;
      let createdAssets = [];
      for (let i = 0; i < creatorWallets.length; i++) {
        try {
          const url = `${host}/v2/accounts/${creatorWallets[i]}?exclude=assets,apps-local-state,created-apps,none`;
          const response = await axios.get(url);
          createdAssets = [
            ...createdAssets,
            ...response.data.account["created-assets"],
          ];
        } catch (err) {
        }
      }
      if (unitNamePrefix) {
        const unitNamePrefixList = unitNamePrefix
          .split(",")
          .map((item) => item.trim().toLowerCase());
        createdAssets = createdAssets.filter((asset) => {
          for (let i = 0; i < unitNamePrefixList.length; i++) {
            if (
              asset.params["unit-name"]
                .toLowerCase()
                .startsWith(unitNamePrefixList[i]) && asset.params["total"] === 1
            ) {
              return true;
            }
          }
          return false;
        });
      }
      // just need assetid
      createdAssets = createdAssets.map((asset) => asset.index);
      setCollectionData(createdAssets);
    } else {
      toast.info("Please enter at least one wallet address!");
    }
  }

  async function getAssetOwner(asset_id) {
    try {
      const indexerURL = getIndexerURL();
      const url = `${indexerURL}/v2/assets/${asset_id}/balances?include-all=false&currency-greater-than=0`;
      const response = await axios.get(url);
      return response.data.balances[0].address;
    } catch (err) {
    }
  }

  function convertToCSV(headers, objArray) {
    let array = typeof objArray != "object" ? JSON.parse(objArray) : objArray;
    let str = "";
    let row = "";

    for (let index in headers) {
      row += headers[index] + ",";
    }
    str += row + "\r";

    Object.entries(array).forEach(([key, value]) => {
      let line = "";
      line += key + ",";
      line += value.nfd + ",";
      const asset_list = "[" + value.assets.map((asset) => asset).join(",");
      line += '"' + asset_list + "]" + '",';
      line += value.assets.length + ",";
      str += line + "\r\n";
    });

    return str;
  }

  function exportCSVFile(headers, items, fileTitle) {
    let csv = convertToCSV(headers, items);
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
      for (const asset_id of collectionData) {
        const asset_owner = await getAssetOwner(asset_id);
        count++;
        setCounter(count);
        if (data[asset_owner]) {
          data[asset_owner].assets.push(asset_id);
        } else {
          data[asset_owner] = {
            nfd: await getNfdDomain(asset_owner),
            assets: [asset_id],
          };
        }
      }
      exportCSVFile(
        ["wallet", "nfdomain", "assets", "assets_count"],
        data,
        "collection-snapshot.csv"
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
      <textarea
        type="text"
        rows={creatorWallet.split(",").length > 1 ? 3 : 1}
        id="creatorWallet"
        placeholder="Enter Creator Wallet Address List"
        className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 my-2 w-64 text-sm mx-auto placeholder:text-center placeholder:text-sm"
        value={creatorWallet}
        onChange={(e) => setCreatorWallet(e.target.value)}
      />
      <input
        type="text"
        id="unitNamePrefix"
        placeholder="(Opt.) Unit Name Prefixes"
        className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 mb-2 w-48 text-sm mx-auto placeholder:text-center placeholder:text-sm"
        value={unitNamePrefix}
        onChange={(e) => setUnitNamePrefix(e.target.value)}
      />
      <p className="text-center text-xs mb-2 text-slate-300">
        Separate multiple wallet addresses and prefixes with commas.<br/>Just works with 1/1 ASAs.
      </p>
      <button
        className="mb-2 bg-secondary-green/80 hover:bg-secondary-green text-white text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
        onClick={getCollectionData}
      >
        Get Holders Data
      </button>
      {collectionData.length > 0 && (
        <>
          {collectionData && (
            <div className="flex flex-col justify-center items-center">
              <p className="text-center text-sm text-slate-300">
                Wallets has{" "}
                <span className="text-slate-100 font-semibold text-base animate-pulse">
                  {collectionData.length}
                </span>{" "}
                created assets.
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
              Download Holders Data
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
