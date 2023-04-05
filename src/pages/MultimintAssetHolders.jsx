import { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import {
  TOOLS,
  MAINNET_ALGONODE_INDEXER,
  TESTNET_ALGONODE_INDEXER,
} from "../constants";

export function MultimintAssetHolders() {
  const [assetId, setAssetId] = useState("");
  const [assetHolders, setAssetHolders] = useState([]);
  const [assetOwnersLoading, setAssetOwnersLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(0);

  async function getAssetOwners(asset_id) {
    const indexerURL =
      localStorage.getItem("networkType") === "mainnet"
        ? MAINNET_ALGONODE_INDEXER
        : TESTNET_ALGONODE_INDEXER;
    let threshold = 1000;
    let assetData = {
      asset_id: asset_id,
    };
    try {
      const assetDataResponse = await axios.get(
        `${indexerURL}/v2/assets/${asset_id}`
      );
      assetData.asset_name = assetDataResponse.data.asset.params.name;
      assetData.decimals = assetDataResponse.data.asset.params.decimals;
    } catch (error) {
      toast.error(`${asset_id} is not a valid asset id!`);
      throw Error(`${asset_id} is not a valid asset id!`);
    }

    try {
      let response = await axios.get(
        `${indexerURL}/v2/assets/${asset_id}/balances?currency-greater-than=0`
      );
      while (
        response.data["next-token"] &&
        response.data.balances.length === threshold
      ) {
        const nextResponse = await axios.get(
          `${indexerURL}/v2/assets/${asset_id}/balances?currency-greater-than=0&next=${response.data["next-token"]}`
        );
        response.data.balances = response.data.balances.concat(
          nextResponse.data.balances
        );
        response.data["next-token"] = nextResponse.data["next-token"];
        threshold += 1000;
      }
      assetData.holders = response.data.balances.map((holder) => {
        return {
          address: holder.address,
          amount: (holder.amount / Math.pow(10, assetData.decimals)).toFixed(
            assetData.decimals
          ),
        };
      });
      return assetData;
    } catch (err) {
      toast.error("Something went wrong!");
    }
  }

  async function getAssetHolders() {
    setAssetHolders([]);
    let assetIDs = assetId
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    assetIDs = [...new Set(assetIDs)];
    if (assetId) {
      let assetBalances = [];
      setAssetOwnersLoading(true);
      for (const asset_id of assetIDs) {
        try {
          const asset_owners = await getAssetOwners(asset_id);
          assetBalances.push(asset_owners);
        } catch (e) {}
      }
      setAssetHolders(assetBalances);
      setAssetOwnersLoading(false);
    } else {
      toast.info("Please enter at least one asset id!");
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
    for (let i = 0; i < array.length; i++) {
      let line = "";
      for (let index in headers) {
        if (line !== "") line += ",";
        line += array[i][headers[index]];
      }
      str += line + "\r";
    }

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

  async function getNftDomainsInBulk(wallets, bulkSize = 20) {
    const uniqueWallets = [...new Set(wallets)];
    let nfdDomains = {};
    let counter = 0;
    for (let i = 0; i < uniqueWallets.length; i += bulkSize) {
      const chunk = uniqueWallets
        .slice(i, i + bulkSize)
        .map((wallet) => `address=${wallet}`)
        .join("&");
      try {
        const response = await axios.get(
          `https://api.nf.domains/nfd/address?${chunk}`
        );
        for (const domain of response.data) {
          nfdDomains[domain.owner] = domain.name;
        }
      } catch {
        continue;
      }
      counter += bulkSize;
      if (counter > uniqueWallets.length) {
        counter = uniqueWallets.length;
      }
      setCounter(counter);
    }
    return nfdDomains;
  }

  async function downloadAssetHoldersDataAsCSV() {
    if (assetHolders.length > 0) {
      setLoading(true);
      let data = [];
      for (let i = 0; i < assetHolders.length; i++) {
        const asset = assetHolders[i];
        const assetHolderWallets = asset.holders.map(
          (holder) => holder.address
        );
        const nfdDomains = await getNftDomainsInBulk(assetHolderWallets, 20);
        for (let j = 0; j < asset.holders.length; j++) {
          const holder = asset.holders[j];
          data.push({
            wallet: holder.address,
            nfdomain: nfdDomains[holder.address] || "",
            asset_id: asset.asset_id,
            amount: holder.amount,
          });
        }
      }
      exportCSVFile(
        ["wallet", "nfdomain", "asset_id", "amount"],
        data,
        "asset_holders.csv"
      );
      setLoading(false);
      setCounter(0);
      toast.success("Downloaded successfully!");
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
        id="asset_id_list"
        placeholder="Enter asset ids"
        className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 my-2 w-64 text-sm mx-auto placeholder:text-center placeholder:text-sm"
        value={assetId}
        onChange={(e) => setAssetId(e.target.value)}
      />
      <p className="text-center text-xs mb-2 text-slate-300">
        Separate multiple asset ids with commas.
      </p>
      <button
        className="mb-2 bg-red-1000 hover:bg-red-700 text-white text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
        onClick={getAssetHolders}
      >
        Get Asset Holders
      </button>
      {assetOwnersLoading && (
        <div className="mx-auto flex flex-col">
          <div
            className="spinner-border animate-spin inline-block mx-auto mt-4 mb-2 w-8 h-8 border-4 rounded-full"
            role="status"
          ></div>
          Fetching asset holders from blockchain...
        </div>
      )}
      {assetHolders.length > 0 && (
        <>
          {assetHolders.map((assetHolder, index) => (
            <div key={index} className="w-full">
              <p className="text-center text-sm text-slate-300">
                <span className="font-semibold">
                  {assetHolder.asset_name} ({assetHolder.asset_id})
                </span>{" "}
                asset has{" "}
                <span className="animate-pulse font-semibold">
                  {assetHolder.holders.length}
                </span>{" "}
                holders.
              </p>
            </div>
          ))}
          {loading ? (
            <div className="mx-auto flex flex-col">
              <div
                className="spinner-border animate-spin inline-block mx-auto mt-4 w-8 h-8 border-4 rounded-full"
                role="status"
              ></div>
              Fetching NFDomains...
              <p className="text-center text-sm text-slate-300">
                {counter}/
                {assetHolders
                  .map((asset) => asset.holders.length)
                  .reduce((a, b) => a + b, 0)}
              </p>
            </div>
          ) : (
            <button
              onClick={downloadAssetHoldersDataAsCSV}
              className="mb-2 bg-green-500 hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-2 hover:scale-95 duration-700"
            >
              Download Asset Holders
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
