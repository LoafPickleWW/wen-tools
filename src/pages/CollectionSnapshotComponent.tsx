import { useState } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import {
  getIndexerURL,
  getNfdDomain,
  getRandCreatorListings,
  getCreatedAssets,
} from "../utils";
import { useWallet } from "@txnlab/use-wallet-react";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

export function CollectionSnapshot() {
  const [creatorWallet, setCreatorWallet] = useState("");
  const [unitNamePrefix, setUnitNamePrefix] = useState("");
  const [collectionData, setCollectionData] = useState([] as any[]);
  const [loading, setLoading] = useState(false);
  const [counter, setCounter] = useState(0);
  const [checkRandSupport, setCheckRandSupport] = useState(false);
  const [checkSeparated, setCheckSeparated] = useState(false);
  const [randCreatorListings, setRandCreatorListings] = useState([] as any[]);
  const { activeNetwork } = useWallet();

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
      let createdAssets: any[] = [];
      for (let i = 0; i < creatorWallets.length; i++) {
        createdAssets = createdAssets.concat(
          await getCreatedAssets(creatorWallets[i], activeNetwork)
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
        let randData: any[] = [];
        for (let i = 0; i < creatorWallets.length; i++) {
          let creatorListings = await getRandCreatorListings(creatorWallets[i]);
          creatorListings = creatorListings.filter((listing: any) =>
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

  async function getAssetOwner(asset_id: number) {
    try {
      const indexerURL = getIndexerURL(activeNetwork);
      const url = `${indexerURL}/v2/assets/${asset_id}/balances?include-all=false&currency-greater-than=0`;
      const response = await axios.get(url);
      return response.data.balances[0].address;
    } catch (err: any) {
      console.error(err);
    }
  }

  function convertToCSV(headers: string[], objArray: any[]) {
    const array = typeof objArray != "object" ? JSON.parse(objArray) : objArray;
    let str = "";
    let row = "";

    for (const index in headers) {
      row += headers[index] + ",";
    }
    str += row + "\r";
    if (checkSeparated) {
      for (let i = 0; i < array.length; i++) {
        let line = "";
        line += array[i].asset_id + ",";
        line += array[i].wallet + ",";
        line += array[i].nfd + ",";
        str += line + "\r\n";
      }
    } else {
      Object.entries(array).forEach(([key, value]: [string, any]) => {
        let line = "";
        line += key + ",";
        line += value.nfd + ",";
        if (checkRandSupport) {
          if (!value.listed_assets) {
            value.listed_assets = [];
          }
          line += value.assets.length + value.listed_assets.length + ",";
        }
        const asset_list =
          "[" + value.assets.map((asset: any) => asset).join(",");
        line += '"' + asset_list + ']",';
        line += value.assets.length + ",";
        if (checkRandSupport) {
          const listed_asset_list =
            "[" + value.listed_assets.map((asset: any) => asset).join(",");
          line += '"' + listed_asset_list + ']",';
          line += value.listed_assets.length + ",";
        }
        str += line + "\r\n";
      });
    }

    return str;
  }

  function exportCSVFile(headers: string[], items: any[], fileTitle: string) {
    try {
      const csv = convertToCSV(headers, items);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", fileTitle);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong!");
    }
  }

  async function downloadCollectionDataAsCSV() {
    if (collectionData.length > 0) {
      setLoading(true);
      let data: any = [];
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
        Object.entries(randCreatorListings).forEach(
          ([key, value]: [string, any]) => {
            if (data[key]) {
              data[key].listed_assets = value;
            }
          }
        );
      }
      if (checkSeparated) {
        headers = ["asset_id", "wallet", "nfdomain"];
        const newData: any[] = [];
        Object.entries(data).forEach(([key, value]: [string, any]) => {
          value.assets.forEach((asset_id: number) => {
            newData.push({
              asset_id,
              wallet: key,
              nfd: value.nfd,
            });
          });
        });
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
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center min-h-screen px-4 max-w-5xl">
      <Meta 
        title="Collection Snapshot Tool" 
        description="Capture real-time holder data for any Algorand NFT collection. Generate accurate snapshots for airdrops, governance, and community analytics."
      />
      <h1 className="text-3xl font-extrabold mt-8 bg-gradient-to-r from-primary-yellow to-secondary-orange bg-clip-text text-transparent">
        Collection Snapshot Tool
      </h1>
      <p className="text-slate-400 mt-2 text-sm max-w-xl">
        Capture real-time holder data for any Algorand NFT collection. Generate accurate snapshots for airdrops, governance, and community analytics.
      </p>

      <div className="w-full max-w-2xl mt-8 bg-slate-900/60 border border-slate-700/50 backdrop-blur-md rounded-2xl p-6 md:p-8 shadow-2xl flex flex-col items-center gap-4">
        <ConnectButton inmain={true} />
        
        <div className="w-full flex flex-col items-start gap-1 text-left">
          <label className="text-slate-300 text-sm font-semibold">Creator Wallet Addresses</label>
          <textarea
            rows={creatorWallet.split(",").length > 1 ? 3 : 1}
            id="creatorWallet"
            placeholder="Enter Creator Wallet Address List (comma, space, or newline separated)"
            className="bg-slate-950/80 text-white placeholder-slate-500 border border-slate-800 rounded-xl p-4 w-full h-24 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-sm leading-relaxed"
            value={creatorWallet}
            onChange={(e) => setCreatorWallet(e.target.value)}
          />
        </div>

        <div className="w-full flex flex-col items-start gap-1 text-left">
          <label className="text-slate-300 text-sm font-semibold">Unit Name Prefixes (Optional)</label>
          <input
            type="text"
            id="unitNamePrefix"
            placeholder="e.g. CARD, HERO (comma separated)"
            className="bg-slate-950/80 text-white placeholder-slate-500 border border-slate-800 rounded-xl p-3 w-full focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-sm"
            value={unitNamePrefix}
            onChange={(e) => setUnitNamePrefix(e.target.value)}
          />
        </div>

        <div className="w-full flex flex-col gap-2.5 p-4 bg-slate-950/40 border border-slate-800/80 rounded-xl text-left">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="check_separated"
              className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950"
              checked={checkSeparated}
              onChange={(e) => setCheckSeparated(e.target.checked)}
            />
            <label htmlFor="check_separated" className="text-slate-300 text-sm cursor-pointer select-none">
              Non-aggregated Holder List (separate row per asset holding)
            </label>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="check_rand"
              className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950"
              checked={checkRandSupport}
              onChange={(e) => setCheckRandSupport(e.target.checked)}
            />
            <label htmlFor="check_rand" className="text-slate-300 text-sm cursor-pointer select-none">
              Include RandGallery Listings (reconcile escrows to sellers)
            </label>
          </div>
        </div>

        <p className="text-xs text-slate-400 text-left w-full">
          * Works with 1/1 ASAs (NFTs). Separate multiple addresses and prefixes with commas.
        </p>

        <button
          className="mt-2 w-full px-8 py-3 bg-gradient-to-r from-primary-yellow to-secondary-orange hover:from-primary-yellow/90 hover:to-secondary-orange/90 text-black font-bold rounded-xl transition shadow-lg hover:scale-95 duration-200 cursor-pointer"
          onClick={getCollectionData}
        >
          Get Holders Data
        </button>
      </div>

      {collectionData.length > 0 && (
        <div className="w-full max-w-2xl mt-6 bg-slate-900/40 border border-slate-800 rounded-xl p-6 flex flex-col items-center gap-4">
          <p className="text-sm text-slate-300">
            Found <span className="text-primary-orange font-bold">{collectionData.length}</span> created assets.
          </p>

          {loading ? (
            <div className="flex flex-col items-center gap-2 mt-2">
              <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
              <span className="text-sm text-slate-300">Fetching holder balances from blockchain...</span>
              <span className="text-xs text-slate-400 font-mono">
                {counter} / {collectionData.length} assets audited
              </span>
            </div>
          ) : (
            <button
              onClick={downloadCollectionDataAsCSV}
              className="px-8 py-3 bg-green-500 hover:bg-green-600 text-black font-bold rounded-xl transition shadow-lg hover:scale-95 duration-200 cursor-pointer"
            >
              Download Holders CSV
            </button>
          )}
        </div>
      )}

      <p className="text-center text-xs text-slate-500 mt-6 max-w-md leading-relaxed">
        ⚠️ If you reload or close this page, you will lose your progress. You can reload the page if you need to stop/restart the process.
      </p>

      {/* Practitioner Section: Snapshot Accuracy */}
      <section className="mt-20 pt-12 border-t border-slate-800 w-full max-w-4xl text-left">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Snapshot Accuracy</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Capturing a precise snapshot is the foundation of decentralized community management. This tool iterates through creator wallets to identify all associated assets and their current holders. For airdrops or gated access, ensuring that your data includes RandGallery listings and aggregated balances is crucial for maintaining fairness and trust within your ecosystem.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">The Holder Distribution Model</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Analyzing your holder distribution reveals the health and decentralization of your project. Use "Non-aggregated" views for granular asset tracking, or aggregated lists to see your top supporters. Understanding these patterns allows practitioners to design better incentive structures and governance models, leveraging the transparency of the Algorand ledger for professional-grade community scaling.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
