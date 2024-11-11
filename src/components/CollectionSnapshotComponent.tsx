import { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { getIndexerURL, getNfdDomain } from "../utils";
import { useWallet } from "@txnlab/use-wallet-react";

export function CollectionSnapshot(props) {
  const [creatorWallet, setCreatorWallet] = useState("");
  const [collectionData, setCollectionData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(0);
  const { activeNetwork } = useWallet();

  async function getCollectionData() {
    if (creatorWallet) {
      if (creatorWallet.length != 58) {
        toast.error("Invalid wallet address!");
        return;
      }
      try {
        const host = getIndexerURL(activeNetwork);
        const url = `${host}/v2/accounts/${creatorWallet}?exclude=assets,apps-local-state,created-apps,none`;
        const response = await axios.get(url);
        setCollectionData(
          response.data.account["created-assets"]
            .map((asset) => asset.index)
            .flat()
        );
      } catch (error) {
        toast.error("Error getting collection data! Please try again.");
      }
    } else {
      toast.info("Please enter a wallet address");
    }
  }

  async function getAssetOwner(asset_id) {
    try {
      const host = getIndexerURL(activeNetwork);
      const url = `${host}/v2/assets/${asset_id}/balances?include-all=false&currency-greater-than=0`;
      const response = await axios.get(url);
      return response.data.balances[0].address;
    } catch (err) {
      //console.log(err);
    }
  }

  function convertToCSV(headers, objArray) {
    var array = typeof objArray != "object" ? JSON.parse(objArray) : objArray;
    var str = "";
    var row = "";

    for (var index in headers) {
      row += headers[index] + ",";
    }
    str += row + "\r";

    Object.entries(array).forEach(([key, value]) => {
      var line = "";
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
    var csv = convertToCSV(headers, items);
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    if (navigator.msSaveBlob) {
      navigator.msSaveBlob(blob, fileTitle);
    } else {
      var link = document.createElement("a");
      if (link.download !== undefined) {
        var url = URL.createObjectURL(blob);
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
        `${creatorWallet}-collection-snapshot.csv`
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
    <div className="flex flex-col justify-center mb-4">
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
        className="mb-2 bg-rose-500 hover:bg-rose-700 text-white text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
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
              Download Holders Data
            </button>
          )}
        </>
      )}
    </div>
  );
}
