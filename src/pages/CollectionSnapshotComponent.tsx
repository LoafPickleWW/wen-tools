import { showDonationToast } from "../utils";
import { useState, useMemo } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import {
  getIndexerURL,
  getNfdDomain,
  getRandCreatorListings,
  getCreatedAssets,
  getDownbadListingsMap,
  getAkitaListingsMap,
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
  const [checkDownbadSupport, setCheckDownbadSupport] = useState(false);
  const [checkAkitaSupport, setCheckAkitaSupport] = useState(false);
  const [checkSeparated, setCheckSeparated] = useState(false);
  const { activeNetwork } = useWallet();

  // Dashboard states
  const [snapshotResult, setSnapshotResult] = useState<Record<string, {
    nfd: string;
    assets: number[];
    listed_assets_rand?: number[];
    listed_assets_downbad?: number[];
    listed_assets_akita?: number[];
  }> | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"total" | "held" | "rand" | "downbad" | "akita">("total");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

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
        if (checkRandSupport || checkDownbadSupport || checkAkitaSupport) {
          const assetsLen = value.assets ? value.assets.length : 0;
          const randLen = value.listed_assets_rand ? value.listed_assets_rand.length : 0;
          const downbadLen = value.listed_assets_downbad ? value.listed_assets_downbad.length : 0;
          const akitaLen = value.listed_assets_akita ? value.listed_assets_akita.length : 0;
          line += (assetsLen + randLen + downbadLen + akitaLen) + ",";
        }
        const asset_list =
          "[" + (value.assets || []).map((asset: any) => asset).join(",");
        line += '"' + asset_list + ']",';
        line += (value.assets || []).length + ",";
        if (checkRandSupport) {
          const listed_rand = value.listed_assets_rand || [];
          const listed_rand_list =
            "[" + listed_rand.map((asset: any) => asset).join(",");
          line += '"' + listed_rand_list + ']",';
          line += listed_rand.length + ",";
        }
        if (checkDownbadSupport) {
          const listed_downbad = value.listed_assets_downbad || [];
          const listed_downbad_list =
            "[" + listed_downbad.map((asset: any) => asset).join(",");
          line += '"' + listed_downbad_list + ']",';
          line += listed_downbad.length + ",";
        }
        if (checkAkitaSupport) {
          const listed_akita = value.listed_assets_akita || [];
          const listed_akita_list =
            "[" + listed_akita.map((asset: any) => asset).join(",");
          line += '"' + listed_akita_list + ']",';
          line += listed_akita.length + ",";
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

  async function runSnapshotAudit() {
    if (!creatorWallet) {
      toast.info("Please enter at least one creator wallet address!");
      return;
    }
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
    
    setLoading(true);
    setCounter(0);
    setSnapshotResult(null);
    setCurrentPage(1);

    try {
      // 1. Fetch created assets
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
      const assetIds = createdAssets.map((asset) => asset.asset_id);
      setCollectionData(assetIds);

      if (assetIds.length === 0) {
        toast.info("No assets found for the creator wallet(s).");
        setLoading(false);
        return;
      }

      // 2. Fetch Rand listings
      let randListingsMap: Record<number, string> = {};
      let randCreatorListingsGrouped: Record<string, number[]> = {};
      if (checkRandSupport) {
        for (let i = 0; i < creatorWallets.length; i++) {
          let creatorListings = await getRandCreatorListings(creatorWallets[i]);
          creatorListings = creatorListings.filter((listing: any) =>
            assetIds.includes(listing.assetId)
          );
          creatorListings.forEach((listing: any) => {
            randListingsMap[listing.assetId] = listing.sellerAddress;
            if (randCreatorListingsGrouped[listing.sellerAddress]) {
              randCreatorListingsGrouped[listing.sellerAddress].push(listing.assetId);
            } else {
              randCreatorListingsGrouped[listing.sellerAddress] = [listing.assetId];
            }
          });
        }
      }

      // 3. Fetch Downbad listings
      let downbadListingsMap: Record<number, { sellerAddress: string }> = {};
      let downbadCreatorListings: Record<string, number[]> = {};
      if (checkDownbadSupport) {
        const allDownbadListings = await getDownbadListingsMap(activeNetwork);
        Object.entries(allDownbadListings).forEach(([assetIdStr, listing]) => {
          const assetId = parseInt(assetIdStr);
          if (assetIds.includes(assetId)) {
            downbadListingsMap[assetId] = listing;
            if (downbadCreatorListings[listing.sellerAddress]) {
              downbadCreatorListings[listing.sellerAddress].push(assetId);
            } else {
              downbadCreatorListings[listing.sellerAddress] = [assetId];
            }
          }
        });
      }

      // 3b. Fetch Akita listings
      let akitaListingsMap: Record<number, { sellerAddress: string }> = {};
      let akitaCreatorListings: Record<string, number[]> = {};
      if (checkAkitaSupport) {
        const allAkitaListings = await getAkitaListingsMap(activeNetwork);
        Object.entries(allAkitaListings).forEach(([assetIdStr, listing]) => {
          const assetId = parseInt(assetIdStr);
          if (assetIds.includes(assetId)) {
            akitaListingsMap[assetId] = listing;
            if (akitaCreatorListings[listing.sellerAddress]) {
              akitaCreatorListings[listing.sellerAddress].push(assetId);
            } else {
              akitaCreatorListings[listing.sellerAddress] = [assetId];
            }
          }
        });
      }

      // 4. Audit asset owners
      let data: Record<string, { nfd: string, assets: number[], listed_assets_rand?: number[], listed_assets_downbad?: number[], listed_assets_akita?: number[] }> = {};
      let count = 0;
      for (const asset_id of assetIds) {
        let asset_owner = await getAssetOwner(asset_id);
        let isListed = false;

        if (checkRandSupport && randListingsMap[asset_id]) {
          asset_owner = randListingsMap[asset_id];
          isListed = true;
        }

        if (checkDownbadSupport && downbadListingsMap[asset_id]) {
          asset_owner = downbadListingsMap[asset_id].sellerAddress;
          isListed = true;
        }

        if (checkAkitaSupport && akitaListingsMap[asset_id]) {
          asset_owner = akitaListingsMap[asset_id].sellerAddress;
          isListed = true;
        }

        count++;
        setCounter(count);

        if (!data[asset_owner]) {
          data[asset_owner] = {
            nfd: await getNfdDomain(asset_owner),
            assets: [],
          };
        }

        if (!isListed) {
          data[asset_owner].assets.push(asset_id);
        }
      }

      // 5. Populate listings lists
      if (checkRandSupport) {
        for (const [key, value] of Object.entries(randCreatorListingsGrouped)) {
          if (!data[key]) {
            data[key] = {
              nfd: await getNfdDomain(key),
              assets: [],
            };
          }
          data[key].listed_assets_rand = value;
        }
      }

      if (checkDownbadSupport) {
        for (const [key, value] of Object.entries(downbadCreatorListings)) {
          if (!data[key]) {
            data[key] = {
              nfd: await getNfdDomain(key),
              assets: [],
            };
          }
          data[key].listed_assets_downbad = value;
        }
      }

      if (checkAkitaSupport) {
        for (const [key, value] of Object.entries(akitaCreatorListings)) {
          if (!data[key]) {
            data[key] = {
              nfd: await getNfdDomain(key),
              assets: [],
            };
          }
          data[key].listed_assets_akita = value;
        }
      }

      setSnapshotResult(data);
      toast.success("Snapshot created successfully!");
      showDonationToast();
    } catch (err: any) {
      console.error(err);
      toast.error("An error occurred during auditing.");
    } finally {
      setLoading(false);
      setCounter(0);
    }
  }

  function downloadCollectionDataAsCSV() {
    if (!snapshotResult) {
      toast.info("Please run the snapshot first!");
      return;
    }
    
    let headers = ["wallet", "nfdomain", "assets", "assets_count"];
    if (checkRandSupport || checkDownbadSupport || checkAkitaSupport) {
      headers = [
        "wallet",
        "nfdomain",
        "total_assets_count",
        "assets",
        "assets_count"
      ];
      if (checkRandSupport) {
        headers.push("listed_assets_rand", "listed_assets_rand_count");
      }
      if (checkDownbadSupport) {
        headers.push("listed_assets_downbad", "listed_assets_downbad_count");
      }
      if (checkAkitaSupport) {
        headers.push("listed_assets_akita", "listed_assets_akita_count");
      }
    }

    let csvData: any = snapshotResult;
    if (checkSeparated) {
      headers = ["asset_id", "wallet", "nfdomain"];
      const newData: any[] = [];
      Object.entries(snapshotResult).forEach(([key, value]) => {
        const allAssets = [
          ...(value.assets || []),
          ...(value.listed_assets_rand || []),
          ...(value.listed_assets_downbad || []),
          ...(value.listed_assets_akita || []),
        ];
        allAssets.forEach((asset_id: number) => {
          newData.push({
            asset_id,
            wallet: key,
            nfd: value.nfd,
          });
        });
      });
      csvData = newData;
    }

    exportCSVFile(headers, csvData, "collection-snapshot.csv");
  }

  // Analytics helper calculations
  const analytics = useMemo(() => {
    if (!snapshotResult) return null;

    const totalHolders = Object.keys(snapshotResult).length;
    const totalUnlisted = Object.values(snapshotResult).reduce((sum, item) => sum + item.assets.length, 0);
    const totalRand = Object.values(snapshotResult).reduce((sum, item) => sum + (item.listed_assets_rand?.length || 0), 0);
    const totalDownbad = Object.values(snapshotResult).reduce((sum, item) => sum + (item.listed_assets_downbad?.length || 0), 0);
    const totalAkita = Object.values(snapshotResult).reduce((sum, item) => sum + (item.listed_assets_akita?.length || 0), 0);
    const totalAssets = totalUnlisted + totalRand + totalDownbad + totalAkita;
    const uniqueRatio = totalAssets > 0 ? ((totalHolders / totalAssets) * 100).toFixed(1) : "0";

    return {
      totalHolders,
      totalUnlisted,
      totalRand,
      totalDownbad,
      totalAkita,
      totalAssets,
      uniqueRatio,
    };
  }, [snapshotResult]);

  // Sorting & Filtering helpers
  const processedHolders = useMemo(() => {
    if (!snapshotResult) return [];

    let list = Object.entries(snapshotResult).map(([wallet, data]) => {
      const unlistedCount = data.assets.length;
      const randCount = data.listed_assets_rand?.length || 0;
      const downbadCount = data.listed_assets_downbad?.length || 0;
      const akitaCount = data.listed_assets_akita?.length || 0;
      const totalCount = unlistedCount + randCount + downbadCount + akitaCount;

      return {
        wallet,
        nfd: data.nfd || "",
        unlistedCount,
        randCount,
        downbadCount,
        akitaCount,
        totalCount,
      };
    });

    // Search filter
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(item => 
        item.wallet.toLowerCase().includes(q) || 
        item.nfd.toLowerCase().includes(q)
      );
    }

    // Sort logic
    list.sort((a, b) => {
      let valA = 0;
      let valB = 0;

      if (sortBy === "total") {
        valA = a.totalCount;
        valB = b.totalCount;
      } else if (sortBy === "held") {
        valA = a.unlistedCount;
        valB = b.unlistedCount;
      } else if (sortBy === "rand") {
        valA = a.randCount;
        valB = b.randCount;
      } else if (sortBy === "downbad") {
        valA = a.downbadCount;
        valB = b.downbadCount;
      } else if (sortBy === "akita") {
        valA = a.akitaCount;
        valB = b.akitaCount;
      }

      if (valA === valB) {
        // Tiebreaker by wallet alphabetical order
        return a.wallet.localeCompare(b.wallet);
      }

      return sortOrder === "desc" ? valB - valA : valA - valB;
    });

    return list;
  }, [snapshotResult, searchTerm, sortBy, sortOrder]);

  // Paginated list
  const paginatedHolders = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return processedHolders.slice(start, start + itemsPerPage);
  }, [processedHolders, currentPage]);

  const totalPages = Math.ceil(processedHolders.length / itemsPerPage);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  const copyAllWallets = () => {
    if (!snapshotResult) return;
    copyToClipboard(Object.keys(snapshotResult).join(", "));
  };

  const copyUnlistedWallets = () => {
    if (!snapshotResult) return;
    const wallets = Object.entries(snapshotResult)
      .filter(([_, val]) => val.assets.length > 0)
      .map(([key]) => key);
    copyToClipboard(wallets.join(", "));
  };

  const handleSort = (field: "total" | "held" | "rand" | "downbad" | "akita") => {
    if (sortBy === field) {
      setSortOrder(prev => prev === "desc" ? "asc" : "desc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setCurrentPage(1);
  };

  return (
    <div className="mx-auto text-white mb-12 text-center flex flex-col items-center min-h-screen px-4 w-full max-w-7xl">
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

      {/* Snapshot Inputs & Options Panel */}
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
          <div className="flex items-center">
            <input
              type="checkbox"
              id="check_downbad"
              className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950"
              checked={checkDownbadSupport}
              onChange={(e) => setCheckDownbadSupport(e.target.checked)}
            />
            <label htmlFor="check_downbad" className="text-slate-300 text-sm cursor-pointer select-none">
              Include Downbad.farm Listings (reconcile escrows to sellers)
            </label>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="check_akita"
              className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950"
              checked={checkAkitaSupport}
              onChange={(e) => setCheckAkitaSupport(e.target.checked)}
            />
            <label htmlFor="check_akita" className="text-slate-300 text-sm cursor-pointer select-none">
              Include Akita Marketplace Listings (reconcile escrows to sellers)
            </label>
          </div>
        </div>

        <p className="text-xs text-slate-400 text-left w-full">
          * Works with 1/1 ASAs (NFTs). Separate multiple addresses and prefixes with commas.
        </p>

        {!loading ? (
          <button
            className="mt-2 w-full px-8 py-3 bg-gradient-to-r from-primary-yellow to-secondary-orange hover:from-primary-yellow/90 hover:to-secondary-orange/90 text-black font-bold rounded-xl transition shadow-lg hover:scale-95 duration-200 cursor-pointer"
            onClick={runSnapshotAudit}
          >
            Get Snapshot
          </button>
        ) : (
          <div className="w-full flex flex-col items-center gap-2 mt-2">
            <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
            <span className="text-sm text-slate-300">Auditing asset balances from blockchain...</span>
            <span className="text-xs text-slate-400 font-mono">
              {counter} / {collectionData.length || "?"} assets audited
            </span>
          </div>
        )}
      </div>

      {/* Snapshot Results & Dashboard */}
      {snapshotResult && analytics && (
        <div className="w-full mt-10 space-y-8 animate-fadeIn text-left">
          
          {/* Analytics Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Assets</p>
                <h3 className="text-2xl font-extrabold mt-1 text-white font-mono">{analytics.totalAssets}</h3>
              </div>
              <div className="bg-indigo-500/10 p-3 rounded-xl border border-indigo-500/20 text-indigo-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
              </div>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Unique Holders</p>
                <h3 className="text-2xl font-extrabold mt-1 text-white font-mono">{analytics.totalHolders}</h3>
              </div>
              <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
              </div>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Unique Ratio</p>
                <h3 className="text-2xl font-extrabold mt-1 text-white font-mono">{analytics.uniqueRatio}%</h3>
              </div>
              <div className="bg-orange-500/10 p-3 rounded-xl border border-orange-500/20 text-orange-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
              </div>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
              <div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Listed Ratio</p>
                <h3 className="text-2xl font-extrabold mt-1 text-white font-mono">
                  {analytics.totalAssets > 0 
                    ? (((analytics.totalRand + analytics.totalDownbad + analytics.totalAkita) / analytics.totalAssets) * 100).toFixed(1)
                    : 0
                  }%
                </h3>
              </div>
              <div className="bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 text-rose-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
              </div>
            </div>
          </div>

          {/* Premium Distribution Bar Panel */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">Asset Distribution Breakdown</h3>
            
            <div className="w-full h-6 rounded-full overflow-hidden bg-slate-950 flex border border-slate-800">
              <div 
                style={{ width: `${(analytics.totalUnlisted / analytics.totalAssets) * 100}%` }}
                className="bg-gradient-to-r from-emerald-500 to-green-400 h-full transition-all duration-500 relative group cursor-pointer"
                title={`Held/Unlisted: ${analytics.totalUnlisted}`}
              />
              {checkRandSupport && analytics.totalRand > 0 && (
                <div 
                  style={{ width: `${(analytics.totalRand / analytics.totalAssets) * 100}%` }}
                  className="bg-gradient-to-r from-orange-500 to-amber-400 h-full transition-all duration-500 border-l border-slate-950 relative group cursor-pointer"
                  title={`Rand Gallery: ${analytics.totalRand}`}
                />
              )}
              {checkDownbadSupport && analytics.totalDownbad > 0 && (
                <div 
                  style={{ width: `${(analytics.totalDownbad / analytics.totalAssets) * 100}%` }}
                  className="bg-gradient-to-r from-pink-500 to-rose-400 h-full transition-all duration-500 border-l border-slate-950 relative group cursor-pointer"
                  title={`Downbad.farm: ${analytics.totalDownbad}`}
                />
              )}
              {checkAkitaSupport && analytics.totalAkita > 0 && (
                <div 
                  style={{ width: `${(analytics.totalAkita / analytics.totalAssets) * 100}%` }}
                  className="bg-gradient-to-r from-blue-500 to-indigo-400 h-full transition-all duration-500 border-l border-slate-950 relative group cursor-pointer"
                  title={`Akita: ${analytics.totalAkita}`}
                />
              )}
            </div>

            {/* Distribution Legend */}
            <div className="flex flex-wrap items-center gap-6 mt-4 text-xs font-semibold text-slate-400">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-gradient-to-r from-emerald-500 to-green-400" />
                <span>Held (Unlisted): {analytics.totalUnlisted} ({((analytics.totalUnlisted / analytics.totalAssets) * 100).toFixed(1)}%)</span>
              </div>
              {checkRandSupport && (
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded bg-gradient-to-r from-orange-500 to-amber-400" />
                  <span>Rand Gallery Listings: {analytics.totalRand} ({((analytics.totalRand / analytics.totalAssets) * 100).toFixed(1)}%)</span>
                </div>
              )}
              {checkDownbadSupport && (
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded bg-gradient-to-r from-pink-500 to-rose-400" />
                  <span>Downbad Listings: {analytics.totalDownbad} ({((analytics.totalDownbad / analytics.totalAssets) * 100).toFixed(1)}%)</span>
                </div>
              )}
              {checkAkitaSupport && (
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded bg-gradient-to-r from-blue-500 to-indigo-400" />
                  <span>Akita Listings: {analytics.totalAkita} ({((analytics.totalAkita / analytics.totalAssets) * 100).toFixed(1)}%)</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions & Search Panel */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={downloadCollectionDataAsCSV}
                className="px-5 py-2.5 bg-green-500 hover:bg-green-600 text-black font-bold rounded-xl text-sm transition flex items-center gap-2 cursor-pointer shadow-md"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                Download CSV
              </button>
              <button
                onClick={copyAllWallets}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-sm transition flex items-center gap-2 cursor-pointer border border-slate-700"
              >
                Copy All Wallets
              </button>
              <button
                onClick={copyUnlistedWallets}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-sm transition flex items-center gap-2 cursor-pointer border border-slate-700"
              >
                Copy Unlisted Wallets
              </button>
            </div>

            <div className="relative w-full md:max-w-xs">
              <input
                type="text"
                placeholder="Search Wallet or NFD..."
                className="bg-slate-950/80 text-white placeholder-slate-500 border border-slate-850 rounded-xl px-4 py-2.5 pl-10 w-full focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none text-sm"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              />
              <div className="absolute left-3.5 top-3 text-slate-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
              </div>
            </div>
          </div>

          {/* Interactive Holders Table */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 text-xs uppercase font-bold">
                    <th className="p-4 pl-6">Wallet / NFD Domain</th>
                    <th 
                      onClick={() => handleSort("total")}
                      className="p-4 cursor-pointer hover:bg-slate-950/65 transition select-none text-center"
                    >
                      <div className="flex items-center justify-center gap-1">
                        Total Count
                        {sortBy === "total" && (sortOrder === "desc" ? "↓" : "↑")}
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort("held")}
                      className="p-4 cursor-pointer hover:bg-slate-950/65 transition select-none text-center"
                    >
                      <div className="flex items-center justify-center gap-1">
                        Held (Unlisted)
                        {sortBy === "held" && (sortOrder === "desc" ? "↓" : "↑")}
                      </div>
                    </th>
                    {checkRandSupport && (
                      <th 
                        onClick={() => handleSort("rand")}
                        className="p-4 cursor-pointer hover:bg-slate-950/65 transition select-none text-center"
                      >
                        <div className="flex items-center justify-center gap-1">
                          Rand Listed
                          {sortBy === "rand" && (sortOrder === "desc" ? "↓" : "↑")}
                        </div>
                      </th>
                    )}
                    {checkDownbadSupport && (
                      <th 
                        onClick={() => handleSort("downbad")}
                        className="p-4 cursor-pointer hover:bg-slate-950/65 transition select-none text-center"
                      >
                        <div className="flex items-center justify-center gap-1">
                          Downbad Listed
                          {sortBy === "downbad" && (sortOrder === "desc" ? "↓" : "↑")}
                        </div>
                      </th>
                    )}
                    {checkAkitaSupport && (
                      <th 
                        onClick={() => handleSort("akita")}
                        className="p-4 cursor-pointer hover:bg-slate-950/65 transition select-none text-center"
                      >
                        <div className="flex items-center justify-center gap-1">
                          Akita Listed
                          {sortBy === "akita" && (sortOrder === "desc" ? "↓" : "↑")}
                        </div>
                      </th>
                    )}
                    <th className="p-4 pr-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 text-sm font-medium">
                  {paginatedHolders.map((holder) => (
                    <tr key={holder.wallet} className="hover:bg-slate-900/30 transition-colors">
                      <td className="p-4 pl-6 max-w-xs sm:max-w-md">
                        <div className="flex flex-col gap-0.5">
                          {holder.nfd && (
                            <span className="text-primary-orange font-bold font-sans">{holder.nfd}</span>
                          )}
                          <span className="text-slate-400 font-mono text-xs truncate" title={holder.wallet}>
                            {holder.wallet}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-center font-mono text-white text-base font-bold">{holder.totalCount}</td>
                      <td className="p-4 text-center font-mono text-emerald-400">{holder.unlistedCount}</td>
                      {checkRandSupport && (
                        <td className="p-4 text-center font-mono text-orange-400">{holder.randCount}</td>
                      )}
                      {checkDownbadSupport && (
                        <td className="p-4 text-center font-mono text-pink-400">{holder.downbadCount}</td>
                      )}
                      {checkAkitaSupport && (
                        <td className="p-4 text-center font-mono text-blue-400">{holder.akitaCount}</td>
                      )}
                      <td className="p-4 pr-6 text-right">
                        <button
                          onClick={() => copyToClipboard(holder.wallet)}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition border border-slate-700 cursor-pointer shadow"
                        >
                          Copy Address
                        </button>
                      </td>
                    </tr>
                  ))}
                  {processedHolders.length === 0 && (
                    <tr>
                      <td 
                        colSpan={6} 
                        className="p-8 text-center text-slate-500 font-semibold italic"
                      >
                        No holder matching search criteria found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-4 bg-slate-950/40 border-t border-slate-800 flex items-center justify-between text-xs font-bold text-slate-400">
                <span>
                  Showing {Math.min(processedHolders.length, (currentPage - 1) * itemsPerPage + 1)} - {Math.min(processedHolders.length, currentPage * itemsPerPage)} of {processedHolders.length} wallets
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => p - 1)}
                    className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 text-white disabled:opacity-50 transition cursor-pointer"
                  >
                    Previous
                  </button>
                  <span className="font-mono">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => p + 1)}
                    className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 text-white disabled:opacity-50 transition cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Practitioner Section: Snapshot Accuracy */}
      <section className="mt-20 pt-12 border-t border-slate-800 w-full max-w-4xl text-left">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Snapshot Accuracy</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Capturing a precise snapshot is the foundation of decentralized community management. This tool iterates through creator wallets to identify all associated assets and their current holders. For airdrops or gated access, ensuring that your data includes RandGallery and Downbad listings and aggregated balances is crucial for maintaining fairness and trust within your ecosystem.
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
