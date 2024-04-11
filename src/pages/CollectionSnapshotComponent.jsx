import { useState, useEffect } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import {
  getIndexerURL,
  getNfdDomain,
  isWalletHolder,
  getRandCreatorListings,
  getCreatedAssets,
} from "../utils";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import { TOOLS } from "../constants";

export function CollectionSnapshot() {
  const [creatorWallet, setCreatorWallet] = useState("");
  const [unitNamePrefix, setUnitNamePrefix] = useState("");
  const [collectionData, setCollectionData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(0);
  const [checkRandSupport, setCheckRandSupport] = useState(false);
  const [checkSeparated, setCheckSeparated] = useState(false);
  const [randCreatorListings, setRandCreatorListings] = useState([]);
  const [isHorseHolder, setIsHorseHolder] = useState(false);

  async function checkWalletIsOwner() {
    const wallet = localStorage.getItem("wallet");
    if (wallet) {
      const isHolder = await isWalletHolder(wallet);
      setIsHorseHolder(isHolder);
    } else {
      setIsHorseHolder(false);
    }
  }

  useEffect(() => {
    checkWalletIsOwner();
  }, []);

  async function getCollectionData() {
    if (creatorWallet) {
      let creatorWallets = creatorWallet
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "");
      for (let i = 0; i < creatorWallets.length; i++) {
        if (creatorWallets[i].length !== 58) {
          toast.error("You have entered an invalid wallet address!");
          return;
        }
      }
      creatorWallets = [...new Set(creatorWallets)];
      let createdAssets = [];
      for (let i = 0; i < creatorWallets.length; i++) {
        createdAssets = createdAssets.concat(
          await getCreatedAssets(creatorWallets[i])
        );
      }
      if (unitNamePrefix) {
        const unitNamePrefixList = unitNamePrefix
          .split(",")
          .map((item) => item.trim().toLowerCase());
        createdAssets = createdAssets.filter((asset) => {
          const unitName = asset.unit_name.toLowerCase();
          return unitNamePrefixList.some((prefix) =>
            unitName.startsWith(prefix)
          );
        });
      }
      createdAssets = createdAssets.map((asset) => asset.asset_id);
      if (checkRandSupport) {
        let randData = [];
        for (let i = 0; i < creatorWallets.length; i++) {
          let creatorListings = await getRandCreatorListings(creatorWallets[i]);
          creatorListings = creatorListings.filter((listing) =>
            createdAssets.includes(listing.assetId)
          );
          randData = randData.concat(creatorListings);
        }
        randData = randData.reduce((acc, listing) => {
          if (acc[listing.sellerAddress]) {
            acc[listing.sellerAddress].push(listing.assetId);
          } else {
            acc[listing.sellerAddress] = [listing.assetId];
          }
          return acc;
        }, {});
        setRandCreatorListings(randData);
      }
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
    } catch (err) {}
  }

  function convertToCSV(headers, objArray) {
    let array = typeof objArray != "object" ? JSON.parse(objArray) : objArray;
    let str = "";
    let row = "";

    for (let index in headers) {
      row += headers[index] + ",";
    }
    str += row + "\r";
    if (checkSeparated) {
      for (let i = 0; i < array.length; i++) {
        console.log(array[i]);
        let line = "";
        line += array[i].asset_id + ",";
        line += array[i].wallet + ",";
        line += array[i].nfd + ",";
        str += line + "\r\n";
      }
    } else {
      Object.entries(array).forEach(([key, value]) => {
        let line = "";
        line += key + ",";
        line += value.nfd + ",";
        if (checkRandSupport) {
          if (!value.listed_assets) {
            value.listed_assets = [];
          }
          line += value.assets.length + value.listed_assets.length + ",";
        }
        const asset_list = "[" + value.assets.map((asset) => asset).join(",");
        line += '"' + asset_list + ']",';
        line += value.assets.length + ",";
        if (checkRandSupport) {
          const listed_asset_list =
            "[" + value.listed_assets.map((asset) => asset).join(",");
          line += '"' + listed_asset_list + ']",';
          line += value.listed_assets.length + ",";
        }
        str += line + "\r\n";
      });
    }

    return str;
  }

  function exportCSVFile(headers, items, fileTitle) {
    try {
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
    } catch (err) {
      toast.error("Something went wrong!");
    }
  }

  async function downloadCollectionDataAsCSV() {
    if (collectionData.length > 0) {
      setLoading(true);
      let data = [];
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
      let headers = ["wallet", "nfdomain", "assets", "assets_count"];
      if (checkRandSupport) {
        headers = [
          "wallet",
          "nfdomain",
          "total_assets_count",
          "assets",
          "assets_count",
          "listed_assets",
          "listed_assets_count",
        ];
        Object.entries(randCreatorListings).forEach(([key, value]) => {
          if (data[key]) {
            data[key].listed_assets = value;
          }
        });
      }
      if (checkSeparated) {
        headers = ["asset_id", "wallet", "nfdomain"];
        let newData = [];
        Object.entries(data).forEach(([key, value]) => {
          value.assets.forEach((asset_id) => {
            newData.push({
              asset_id,
              wallet: key,
              nfd: value.nfd,
            });
          });
        });
        console.log(newData);
        data = newData;
      }
      exportCSVFile(headers, data, "collection-snapshot.csv");
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
      <div className="flex flex-col items-start text-sm py-2 bg-black/20 px-4 rounded-xl">
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            id="check_separated"
            className="mr-2"
            checked={checkSeparated}
            onChange={(e) => setCheckSeparated(e.target.checked)}
          />
          <label htmlFor="check_separated" className="text-slate-300">
            Non-aggregated Holder List
          </label>
        </div>
        {!isHorseHolder && (
          <span className="text-slate-400 text-xs text-center mx-auto my-2">
            If you hold any{" "}
            <a
              href="https://www.asalytic.app/collections?search=thurstober"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-300 transition"
            >
              ASA from Thurstober Digital Studios
            </a>
            <br />
            You can enjoy these Premium Filters:
          </span>
        )}
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            id="check_rand"
            className="mr-2"
            disabled={!isHorseHolder}
            checked={checkRandSupport}
            onChange={(e) => setCheckRandSupport(e.target.checked)}
          />
          <label htmlFor="check_rand" className="text-slate-300">
            RandGallery listing support
          </label>
        </div>
      </div>
      <p className="text-center text-xs my-2 text-slate-300">
        Separate multiple wallet addresses and prefixes with commas.
        <br />
        Just works with 1/1 ASAs.
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
