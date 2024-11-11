import { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { getIndexerURL } from "../utils";
import { TOOLS } from "../constants";
import { useWallet } from "@txnlab/use-wallet-react";

export function WalletHoldings() {
  const [userWallet, setUserWallet] = useState("");
  const [walletData, setWalletData] = useState([]);
  const [isIncludedCreatedAssets, setIsIncludedCreatedAssets] = useState(false);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(0);
  const { activeNetwork, algodClient } = useWallet();

  async function getWalletData() {
    if (userWallet) {
      if (userWallet.length !== 58) {
        toast.error("Invalid wallet address!");
        return;
      }
      try {
        const indexerURL = getIndexerURL(activeNetwork);
        const url =
          `${indexerURL}/v2/accounts/${userWallet}?exclude=apps-local-state,created-apps,none` +
          (!isIncludedCreatedAssets ? "" : ",created-assets");
        const response = await axios.get(url);
        if (isIncludedCreatedAssets) {
          setWalletData(
            response.data.account["assets"].map((asset) => {
              return {
                asset_id: asset["asset-id"],
                amount: asset.amount,
              };
            })
          );
        } else {
          if (response.data.account["created-assets"]) {
            const created_assets = response.data.account["created-assets"].map(
              (asset) => {
                return asset["index"];
              }
            );
            setWalletData(
              response.data.account["assets"]
                .filter((asset) => {
                  return !created_assets.includes(asset["asset-id"]);
                })
                .map((asset) => {
                  return {
                    asset_id: asset["asset-id"],
                    amount: asset.amount,
                  };
                })
            );
          } else {
            setWalletData(
              response.data.account["assets"].map((asset) => {
                return {
                  asset_id: asset["asset-id"],
                  amount: asset.amount,
                };
              })
            );
          }
        }
      } catch (error) {
        toast.error("Error getting wallet data! Please try again.");
      }
    } else {
      toast.info("Please enter a wallet address!");
    }
  }

  async function getAssetData(asset) {
    try {
      // asset_id	unit_name	asset_name	amount
      const assetData = await algodClient.getAssetByID(asset.asset_id).do();
      return {
        asset_id: asset.asset_id,
        unit_name: assetData.params["unit-name"] || "-",
        asset_name: assetData.params.name || "-",
        amount: (asset.amount / 10 ** assetData.params.decimals).toFixed(
          assetData.params.decimals
        ),
      };
    } catch {
      return "";
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

  async function downloadWalletDataAsCSV() {
    if (walletData.length > 0) {
      setLoading(true);
      const data = [];
      let count = 0;
      for (const asset of walletData) {
        const asset_data = await getAssetData(asset);
        count++;
        setCounter(count);
        if (asset_data !== "") {
          data.push(asset_data);
        }
      }
      exportCSVFile(
        Object.keys(data[0]),
        data,
        `${userWallet}-holding-${activeNetwork}.csv`
      );
      setLoading(false);
      setCounter(0);
      toast.success("Wallet data downloaded successfully!");
      toast.info("You can support by donating :)");
    } else {
      toast.info("Please get wallet data first!");
    }
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center min-h-screen">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      <input
        type="text"
        id="userWallet"
        placeholder="Enter a Wallet"
        maxLength={58}
        className="text-center bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 my-2 w-64 mx-auto placeholder:text-center placeholder:text-sm"
        value={userWallet}
        onChange={(e) => setUserWallet(e.target.value)}
      />
      <div className="flex flex-row items-center justify-center mb-2">
        <input
          type="checkbox"
          id="includedCreatedAssets"
          className="form-checkbox h-4 w-4 text-rose-600"
          checked={isIncludedCreatedAssets}
          onChange={(e) => setIsIncludedCreatedAssets(e.target.checked)}
        />
        <label
          htmlFor="includedCreatedAssets"
          className="text-sm text-slate-300 ml-1"
        >
          Include Created Assets
        </label>
      </div>
      <button
        className="mb-2 bg-secondary-orange/80 hover:bg-secondary-orange text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
        onClick={getWalletData}
      >
        Get Wallet Assets
      </button>
      {walletData.length > 0 && (
        <>
          {userWallet.length === 58 && walletData && (
            <div className="flex flex-col justify-center items-center">
              <p className="text-center text-sm text-slate-300">
                {userWallet.substring(0, 4)}...
                {userWallet.substring(
                  userWallet.length - 4,
                  userWallet.length
                )}{" "}
                has{" "}
                <span className="text-slate-100 font-semibold text-base animate-pulse">
                  {walletData.length}
                </span>{" "}
                assets
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
                {counter}/{walletData.length}
              </p>
            </div>
          ) : (
            <button
              onClick={downloadWalletDataAsCSV}
              className="mb-2 bg-green-500 hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
            >
              Download Wallet Data
            </button>
          )}
        </>
      )}
    </div>
  );
}
