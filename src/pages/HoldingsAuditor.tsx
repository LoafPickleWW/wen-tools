import { showDonationToast, BONFIRE_APP_IDS } from "../utils";
import { useState, useEffect, useMemo } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import algosdk from "algosdk";
import {
  getIndexerURL,
  getNfDomainsInBulk,
  getRandListingAsset,
  getParticipationStatusOfWallet,
} from "../utils";
import { useWallet } from "@txnlab/use-wallet-react";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";
import {
  IoWallet,
  IoBriefcase,
  IoSearch,
  IoCloudDownload,
  IoInformationCircle,
} from "react-icons/io5";

type TabMode = "wallet" | "asset";

interface HoldingsAuditorProps {
  defaultTab?: TabMode;
}

export function HoldingsAuditor({ defaultTab = "wallet" }: HoldingsAuditorProps) {
  const [activeTab, setActiveTab] = useState<TabMode>(defaultTab);
  const [searchParams] = useSearchParams();
  const { activeNetwork, algodClient } = useWallet();

  // Tab change handler
  const handleTabChange = (tab: TabMode) => {
    setActiveTab(tab);
    // Reset states
    setWalletData([]);
    setAssetHolders([]);
    setWalletLoading(false);
    setAssetLoading(false);
  };

  useEffect(() => {
    if (searchParams.has("tab")) {
      const tab = searchParams.get("tab") as TabMode;
      if (tab === "wallet" || tab === "asset") {
        setActiveTab(tab);
      }
    } else if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [searchParams, defaultTab]);

  // ==========================================
  // TAB 1: WALLET HOLDINGS STATE & LOGIC
  // ==========================================
  const [userWallet, setUserWallet] = useState("");
  const [walletData, setWalletData] = useState<any[]>([]);
  const [isIncludedCreatedAssets, setIsIncludedCreatedAssets] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletCounter, setWalletCounter] = useState(0);

  async function getWalletData() {
    if (!userWallet) {
      toast.info("Please enter a wallet address!");
      return;
    }
    if (userWallet.length !== 58) {
      toast.error("Invalid wallet address!");
      return;
    }
    
    setWalletLoading(true);
    setWalletData([]);
    
    try {
      const indexerURL = getIndexerURL(activeNetwork);
      const url =
        `${indexerURL}/v2/accounts/${userWallet}?exclude=apps-local-state,created-apps,none` +
        (!isIncludedCreatedAssets ? "" : ",created-assets");
      const response = await axios.get(url);
      
      const accountData = response.data.account;
      if (!accountData || !accountData["assets"]) {
        setWalletData([]);
        toast.info("No assets held by this wallet.");
        setWalletLoading(false);
        return;
      }

      if (isIncludedCreatedAssets) {
        setWalletData(
          accountData["assets"].map((asset: any) => ({
            asset_id: asset["asset-id"],
            amount: asset.amount,
          }))
        );
      } else {
        if (accountData["created-assets"]) {
          const created_assets = accountData["created-assets"].map(
            (asset: any) => asset["index"]
          );
          setWalletData(
            accountData["assets"]
              .filter((asset: any) => !created_assets.includes(asset["asset-id"]))
              .map((asset: any) => ({
                asset_id: asset["asset-id"],
                amount: asset.amount,
              }))
          );
        } else {
          setWalletData(
            accountData["assets"].map((asset: any) => ({
              asset_id: asset["asset-id"],
              amount: asset.amount,
            }))
          );
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Error getting wallet data! Please try again.");
    } finally {
      setWalletLoading(false);
    }
  }

  async function getAssetData(asset: any) {
    try {
      const assetData = await algodClient.getAssetByID(asset.asset_id).do();
      const decimals = assetData.params.decimals || 0;
      return {
        asset_id: asset.asset_id,
        unit_name: assetData.params["unit-name"] || "-",
        asset_name: assetData.params.name || "-",
        amount: (asset.amount / 10 ** decimals).toFixed(decimals),
      };
    } catch {
      return "";
    }
  }

  function convertWalletDataToCSV(objArray: any[]) {
    let str = "";
    for (let i = 0; i < objArray.length; i++) {
      let line = "";
      for (const index in objArray[i]) {
        if (line !== "") line += ",";
        line += '"' + objArray[i][index] + '"';
      }
      if (i !== objArray.length - 1) {
        str += line + "\r\n";
      } else {
        str += line;
      }
    }
    return str;
  }

  function exportWalletCSVFile(headers: string[], items: any[], fileTitle: string) {
    const formattedItems = [...items];
    if (headers) {
      formattedItems.unshift(headers);
    }
    const csv = convertWalletDataToCSV(formattedItems);
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
  }

  const [walletExportLoading, setWalletExportLoading] = useState(false);

  async function downloadWalletDataAsCSV() {
    if (walletData.length === 0) {
      toast.info("Please query wallet data first!");
      return;
    }
    
    setWalletExportLoading(true);
    const data = [];
    let count = 0;
    setWalletCounter(0);
    
    for (const asset of walletData) {
      const asset_data = await getAssetData(asset);
      count++;
      setWalletCounter(count);
      if (asset_data !== "") {
        data.push(asset_data);
      }
    }
    
    if (data.length > 0) {
      exportWalletCSVFile(
        Object.keys(data[0]),
        data,
        `${userWallet}-holding-${activeNetwork}.csv`
      );
      toast.success("Wallet data downloaded successfully!");
      showDonationToast();
    } else {
      toast.error("Failed to fetch asset details.");
    }
    setWalletExportLoading(false);
    setWalletCounter(0);
  }

  // ==========================================
  // TAB 2: ASSET HOLDERS STATE & LOGIC
  // ==========================================
  const [assetId, setAssetId] = useState("");
  const [assetHolders, setAssetHolders] = useState<any[]>([]);
  const [assetOwnersLoading, setAssetOwnersLoading] = useState(false);
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetLoadingMessage, setAssetLoadingMessage] = useState("");
  const [checkOptin, setCheckOptin] = useState(false);
  const [checkNfdOnly, setCheckNfdOnly] = useState(false);
  const [checkVerifiedOnly, setCheckVerifiedOnly] = useState(false);
  const [checkRunningNode, setCheckRunningNode] = useState(false);
  const [checkRandSupport, setCheckRandSupport] = useState(false);
  const [assetHeaders, setAssetHeaders] = useState<string[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("all");
  const [assetSearchTerm, setAssetSearchTerm] = useState("");
  const [assetSortBy, setAssetSortBy] = useState<"total" | "wallet">("total");
  const [assetSortOrder, setAssetSortOrder] = useState<"asc" | "desc">("desc");
  const [assetCurrentPage, setAssetCurrentPage] = useState(1);
  const assetItemsPerPage = 10;

  async function getAssetOwners(asset_id: number) {
    const isOptin = checkOptin;
    const indexerURL = getIndexerURL(activeNetwork);
    let threshold = 1000;
    const assetData: any = {
      asset_id: asset_id,
    };
    try {
      const assetDataResponse = await axios.get(
        `${indexerURL}/v2/assets/${asset_id}`
      );
      assetData.asset_name = assetDataResponse.data.asset.params.name;
      assetData.decimals = assetDataResponse.data.asset.params.decimals;
      assetData.creator = assetDataResponse.data.asset.params.creator || "";
      assetData.reserve = assetDataResponse.data.asset.params.reserve || "";
      assetData.total = assetDataResponse.data.asset.params.total || 0;
    } catch (err) {
      console.error(err);
      toast.error(`${asset_id} is not a valid asset id!`);
      throw Error(`${asset_id} is not a valid asset id!`);
    }
    try {
      const response = await axios.get(
        `${indexerURL}/v2/assets/${asset_id}/balances` +
          (!isOptin ? "?currency-greater-than=0" : "")
      );
      while (
        response.data["next-token"] &&
        response.data.balances.length === threshold
      ) {
        const nextResponse = await axios.get(
          `${indexerURL}/v2/assets/${asset_id}/balances` +
            (!isOptin
              ? `?currency-greater-than=0&next=${response.data["next-token"]}`
              : `?next=${response.data["next-token"]}`)
        );
        response.data.balances = response.data.balances.concat(
          nextResponse.data.balances
        );
        response.data["next-token"] = nextResponse.data["next-token"];
        threshold += 1000;
      }
      assetData.holders = response.data.balances.map((holder: any) => ({
        address: holder.address,
        amount: (holder.amount / Math.pow(10, assetData.decimals)).toFixed(
          assetData.decimals
        ),
      }));
      return assetData;
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong!");
    }
  }

  async function getAssetHolders() {
    if (!assetId) {
      toast.info("Please enter at least one asset id!");
      return;
    }
    
    setAssetHolders([]);
    let assetIDs = assetId
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    assetIDs = [...new Set(assetIDs)];
    
    try {
      const assetBalances = [];
      setAssetOwnersLoading(true);
      for (const asset_id of assetIDs) {
        try {
          const asset_owners = await getAssetOwners(Number(asset_id));
          if (asset_owners) {
            assetBalances.push(asset_owners);
          }
        } catch (err: any) {
          console.error(err);
        }
      }

      setAssetHolders(assetBalances);
      setAssetOwnersLoading(false);

      if (assetBalances.length === 0) {
        toast.warning("No holders found for the specified asset IDs.");
        return;
      }

      setAssetLoading(true);
      setAssetLoadingMessage("Fetching NFDomains...");
      
      let data: any[] = [];
      for (let i = 0; i < assetBalances.length; i++) {
        const asset = assetBalances[i];
        const assetHolderWallets = asset.holders.map(
          (holder: any) => holder.address
        );
        const nfdDomains = await getNfDomainsInBulk(assetHolderWallets, 20);
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
      
      let headers = ["wallet", "nfdomain", "asset_id", "amount"];
      if (checkNfdOnly) {
        data = data.filter((item) => item.nfdomain !== "");
      }
      
      if (checkVerifiedOnly) {
        setAssetLoadingMessage("Fetching NFDs' socials...");
        data = data.filter((item) => item.nfdomain !== "");
        const nfdDomains = data.map((item) => item.nfdomain);
        const nfdSocials = await getNFDsSocials(nfdDomains);
        data = data.map((item) => ({
          ...item,
          twitter: nfdSocials[item.nfdomain]?.twitter || "",
          discord: nfdSocials[item.nfdomain]?.discord || "",
        }));
        data = data.filter(
          (item) => item.twitter !== "" || item.discord !== ""
        );
        headers = [...headers, "twitter", "discord"];
      }
      
      if (checkRandSupport) {
        setAssetLoadingMessage("Fetching RandGallery listings...");
        let assetIdsList = assetBalances.map((item) => item.asset_id);
        assetIdsList = [...new Set(assetIdsList)];
        for (let i = 0; i < assetIdsList.length; i++) {
          const assetIdVal = assetIdsList[i];
          const randListing = await getRandListingAsset(assetIdVal);
          if (randListing && randListing.length > 0) {
            for (let j = 0; j < randListing.length; j++) {
              const sellerAddress = randListing[j].sellerAddress;
              const escrowAddress = randListing[j].escrowAddress;
              const index = data.findIndex(
                (item) =>
                  item.wallet === escrowAddress && item.asset_id === assetIdVal
              );
              if (index !== -1) {
                data[index].listed_on_rand = "YES";
                data[index].wallet = sellerAddress;
              }
            }
          }
        }
        headers = [...headers, "listed_on_rand"];
      }
      
      if (checkRunningNode) {
        setAssetLoadingMessage("Checking participation status of wallets...");
        const uniqueWallets = Array.from(new Set(data.map((a) => a.wallet)));
        const participatedWallets: any[] = [];
        for (let i = 0; i < uniqueWallets.length; i++) {
          const participationStatus = await getParticipationStatusOfWallet(
            uniqueWallets[i],
            algodClient
          );
          if (participationStatus) {
            participatedWallets.push(uniqueWallets[i]);
          }
          if (i % 50 === 0 && i !== 0) {
            toast.info(`Checked ${i}/${uniqueWallets.length} wallets.`);
          }
        }
        data = data.filter((item) =>
          participatedWallets.includes(item.wallet)
        );
      }

      const assetBalancesWithFiltered = assetBalances.map((asset) => {
        const assetFilteredHolders = data.filter(
          (item) => item.asset_id === asset.asset_id
        );
        return { ...asset, assetFilteredHolders };
      });
      
      setAssetHolders(assetBalancesWithFiltered);
      setAssetHeaders(headers);
    } catch (err: any) {
      console.error(err);
      toast.error("An error occurred during scanning holdings.");
    } finally {
      setAssetLoading(false);
      setAssetLoadingMessage("");
    }
  }

  async function getNFDsSocials(nfdomains: any[]) {
    const nfdSocials: any = {};
    const uniqueNfds = [...new Set(nfdomains)];
    for (let i = 0; i < uniqueNfds.length; i++) {
      const nfdomain = uniqueNfds[i].toLowerCase();
      const url = `https://api.nf.domains/nfd/${nfdomain}?view=full&poll=false&nocache=false`;
      try {
        const response = await axios.get(url);
        const twitter = response.data.properties.verified.twitter || "";
        const discord = response.data.properties.verified.discord || "";
        nfdSocials[nfdomain] = { twitter, discord };
      } catch (err) {
        console.error(err);
        nfdSocials[nfdomain] = { twitter: "", discord: "" };
      }
      if (i % 10 === 0 && i !== 0) {
        toast.info(`Fetching NFDomains' socials... ${i}/${uniqueNfds.length}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return nfdSocials;
  }

  function convertAssetDataToCSV(headers: string[], objArray: any[]) {
    let str = "";
    let row = "";

    for (const index in headers) {
      row += headers[index] + ",";
    }
    str += row + "\r";
    for (let i = 0; i < objArray.length; i++) {
      let line = "";
      for (const index in headers) {
        if (line !== "") line += ",";
        line += objArray[i][headers[index]] || "";
      }
      str += line + "\r";
    }
    return str;
  }

  function exportAssetCSVFile(headers: string[], items: any[], fileTitle: string) {
    const csv = convertAssetDataToCSV(headers, items);
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
  }

  const bonfireAddr = useMemo(() => {
    const appId = BONFIRE_APP_IDS[activeNetwork];
    if (!appId) return "";
    try {
      return algosdk.getApplicationAddress(appId);
    } catch {
      return "";
    }
  }, [activeNetwork]);

  const assetAnalytics = useMemo(() => {
    if (assetHolders.length === 0) return null;

    const targetAssets = selectedAssetId === "all"
      ? assetHolders
      : assetHolders.filter(a => String(a.asset_id) === selectedAssetId);

    let totalVal = 0;
    let creatorReserveVal = 0;
    let burnedVal = 0;
    
    const walletBalances: Record<string, number> = {};
    const walletNfd: Record<string, string> = {};

    targetAssets.forEach(asset => {
      const decimals = asset.decimals || 0;
      const factor = Math.pow(10, decimals);
      const assetTotalSupply = asset.total / factor;
      totalVal += assetTotalSupply;

      const creator = asset.creator;
      const reserve = asset.reserve;

      asset.holders.forEach((h: any) => {
        const amt = parseFloat(h.amount);
        const address = h.address;

        if (address === creator || address === reserve) {
          creatorReserveVal += amt;
        } else if (address === bonfireAddr) {
          burnedVal += amt;
        }

        if (address !== creator && address !== reserve && address !== bonfireAddr) {
          walletBalances[address] = (walletBalances[address] || 0) + amt;
        }
      });

      asset.assetFilteredHolders?.forEach((fh: any) => {
        if (fh.nfdomain) {
          walletNfd[fh.wallet] = fh.nfdomain;
        }
      });
    });

    const circulatingVal = Math.max(0, totalVal - creatorReserveVal - burnedVal);

    const circulatingHolders = Object.entries(walletBalances)
      .map(([wallet, balance]) => ({
        wallet,
        balance,
        nfd: walletNfd[wallet] || ""
      }))
      .sort((a, b) => b.balance - a.balance);

    const totalCirculatingHolders = circulatingHolders.length;

    const top5Sum = circulatingHolders.slice(0, 5).reduce((sum, h) => sum + h.balance, 0);
    const top10Sum = circulatingHolders.slice(0, 10).reduce((sum, h) => sum + h.balance, 0);
    const top20Sum = circulatingHolders.slice(0, 20).reduce((sum, h) => sum + h.balance, 0);

    const top5Pct = circulatingVal > 0 ? ((top5Sum / circulatingVal) * 100).toFixed(2) : "0.00";
    const top10Pct = circulatingVal > 0 ? ((top10Sum / circulatingVal) * 100).toFixed(2) : "0.00";
    const top20Pct = circulatingVal > 0 ? ((top20Sum / circulatingVal) * 100).toFixed(2) : "0.00";

    let modeBalance = 0;
    if (circulatingHolders.length > 0) {
      const frequencies: Record<number, number> = {};
      let maxFreq = 0;
      circulatingHolders.forEach(h => {
        if (h.balance > 0) {
          frequencies[h.balance] = (frequencies[h.balance] || 0) + 1;
          if (frequencies[h.balance] > maxFreq) {
            maxFreq = frequencies[h.balance];
            modeBalance = h.balance;
          }
        }
      });
    }

    const holdersWithNfd = circulatingHolders.filter(h => h.nfd !== "").length;
    const nfdAdoptionRate = totalCirculatingHolders > 0 
      ? ((holdersWithNfd / totalCirculatingHolders) * 100).toFixed(1)
      : "0.0";

    return {
      totalSupply: totalVal,
      creatorReserveBalance: creatorReserveVal,
      burnedBalance: burnedVal,
      circulatingSupply: circulatingVal,
      totalCirculatingHolders,
      top5Pct,
      top10Pct,
      top20Pct,
      modeBalance,
      nfdAdoptionRate,
      circulatingHolders
    };
  }, [assetHolders, selectedAssetId, bonfireAddr]);

  const processedAssetHolders = useMemo(() => {
    if (!assetAnalytics) return [];

    let list = assetAnalytics.circulatingHolders;

    if (assetSearchTerm) {
      const q = assetSearchTerm.toLowerCase();
      list = list.filter(h =>
        h.wallet.toLowerCase().includes(q) ||
        h.nfd.toLowerCase().includes(q)
      );
    }

    list = [...list].sort((a, b) => {
      let valA = 0;
      let valB = 0;

      if (assetSortBy === "total") {
        valA = a.balance;
        valB = b.balance;
      } else if (assetSortBy === "wallet") {
        return assetSortOrder === "desc" 
          ? b.wallet.localeCompare(a.wallet) 
          : a.wallet.localeCompare(b.wallet);
      }

      return assetSortOrder === "desc" ? valB - valA : valA - valB;
    });

    return list;
  }, [assetAnalytics, assetSearchTerm, assetSortBy, assetSortOrder]);

  const paginatedAssetHolders = useMemo(() => {
    const start = (assetCurrentPage - 1) * assetItemsPerPage;
    return processedAssetHolders.slice(start, start + assetItemsPerPage);
  }, [processedAssetHolders, assetCurrentPage]);

  const totalAssetPages = Math.ceil(processedAssetHolders.length / assetItemsPerPage);

  const copyAllAssetWallets = () => {
    if (!assetAnalytics) return;
    navigator.clipboard.writeText(assetAnalytics.circulatingHolders.map(h => h.wallet).join(", "));
    toast.success("Copied all wallets to clipboard!");
  };

  const handleAssetSort = (field: "total" | "wallet") => {
    if (assetSortBy === field) {
      setAssetSortOrder(prev => prev === "desc" ? "asc" : "desc");
    } else {
      setAssetSortBy(field);
      setAssetSortOrder("desc");
    }
    setAssetCurrentPage(1);
  };
  
  async function downloadAssetHoldersDataAsCSV() {
    if (assetHolders.length > 0) {
      const allFilteredData = [];
      for (let i = 0; i < assetHolders.length; i++) {
        const asset = assetHolders[i];
        const assetFilteredHolders = asset.assetFilteredHolders;
        allFilteredData.push(...assetFilteredHolders);
      }
      exportAssetCSVFile(assetHeaders, allFilteredData, "asset_holders.csv");
      toast.success("Downloaded successfully!");
      showDonationToast();
    } else {
      toast.info("Please get collection data first!");
    }
  }

  return (
    <div className="bg-primary-black pt-4 flex justify-center flex-col text-white min-h-screen">
      <Meta
        title="Holdings & Distribution Auditor"
        description="Unified interface to audit Algorand address asset portfolios or inspect distribution balances across standard assets in bulk."
      />

      <article className="mx-auto text-white mb-16 flex flex-col items-center max-w-4xl w-full px-4">
        {/* Header Section */}
        <header className="w-full flex flex-col items-center mt-10 mb-8 text-center">
          <div className="flex items-center gap-3 justify-center">
            <div className="p-2.5 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl shadow-lg shadow-orange-500/20">
              <IoSearch className="text-2xl text-black" aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-orange-300 via-orange-500 to-amber-500 bg-clip-text text-transparent py-1 uppercase">
              Holdings Auditor
            </h1>
          </div>
          <p className="text-slate-400 mt-4 text-sm md:text-base font-medium max-w-xl leading-relaxed">
            Consolidated auditor to review wallet asset inventories and track distribution balances across multiple assets.
          </p>
        </header>

        {/* Tab Selector - Glassmorphism */}
        <div className="flex flex-wrap gap-2 p-1.5 bg-[#121214] border border-white/5 rounded-2xl w-full max-w-md mx-auto mb-8 shadow-xl justify-center">
          <button
            onClick={() => handleTabChange("wallet")}
            className={`flex-1 min-w-[120px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "wallet"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoWallet className="text-lg" />
            <span>Wallet Holdings</span>
          </button>
          <button
            onClick={() => handleTabChange("asset")}
            className={`flex-1 min-w-[120px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "asset"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoBriefcase className="text-lg" />
            <span>Asset Holders</span>
          </button>
        </div>

        {/* Main Action Box */}
        <div className="w-full bg-[#18181c]/90 border border-white/5 rounded-[32px] p-6 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden flex flex-col items-center gap-6">
          <ConnectButton inmain={true} />

          {/* TAB 1: WALLET HOLDINGS VIEW */}
          {activeTab === "wallet" && (
            <div className="w-full flex flex-col items-center gap-6">
              <div className="w-full bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex gap-3 text-sm text-blue-200 items-start text-left leading-relaxed">
                <IoInformationCircle className="text-xl text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white">Wallet Inventory Audit:</span> Retrieve all Algorand Standard Assets (ASAs) held by a target wallet. Ideal for portfolio auditing, export compliance, and asset verification.
                </div>
              </div>

              <div className="w-full flex flex-col items-start gap-1 text-left">
                <label className="text-slate-300 text-sm font-semibold">Wallet Address</label>
                <input
                  type="text"
                  placeholder="Enter Algorand Address (58 characters)"
                  maxLength={58}
                  className="bg-slate-950/80 text-white placeholder-slate-500 border border-slate-800 rounded-xl p-3.5 w-full focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-sm"
                  value={userWallet}
                  onChange={(e) => setUserWallet(e.target.value)}
                  disabled={walletLoading || walletExportLoading}
                />
              </div>

              <div className="flex items-center gap-2 mr-auto cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="includedCreatedAssets"
                  className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                  checked={isIncludedCreatedAssets}
                  onChange={(e) => setIsIncludedCreatedAssets(e.target.checked)}
                  disabled={walletLoading || walletExportLoading}
                />
                <label htmlFor="includedCreatedAssets" className="text-sm text-slate-300 cursor-pointer">
                  Include Created Assets (include creator supply alongside holdings)
                </label>
              </div>

              <button
                className="w-full md:w-auto px-8 py-3 bg-gradient-to-r from-primary-yellow to-secondary-orange hover:from-primary-yellow/90 hover:to-secondary-orange/90 text-black font-bold rounded-xl transition shadow-lg hover:scale-95 duration-200 cursor-pointer disabled:opacity-50"
                onClick={getWalletData}
                disabled={walletLoading || walletExportLoading}
              >
                {walletLoading ? "Querying..." : "Get Wallet Assets"}
              </button>

              {walletData.length > 0 && (
                <div className="w-full mt-2 bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex flex-col items-center gap-4">
                  <p className="text-sm text-slate-300">
                    Wallet has <span className="text-primary-orange font-bold font-mono">{walletData.length}</span> active asset balances.
                  </p>

                  {walletExportLoading ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                      <span className="text-xs text-slate-400 font-mono">
                        Auditing asset: {walletCounter} / {walletData.length}
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={downloadWalletDataAsCSV}
                      className="px-8 py-3 bg-green-500 hover:bg-green-600 text-black font-bold rounded-xl transition shadow-lg hover:scale-95 duration-200 cursor-pointer flex items-center gap-2"
                    >
                      <IoCloudDownload className="text-lg" />
                      <span>Download Holdings CSV</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ASSET HOLDERS VIEW */}
          {activeTab === "asset" && (
            <div className="w-full flex flex-col items-center gap-6">
              <div className="w-full bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex gap-3 text-sm text-blue-200 items-start text-left leading-relaxed">
                <IoInformationCircle className="text-xl text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white">Asset Distribution Audit:</span> Extract holder rosters across multiple separate asset IDs. Apply filters to identify NFD-verified wallets, node runners, or RandGallery listings.
                </div>
              </div>

              <div className="w-full flex flex-col items-start gap-1 text-left">
                <label className="text-slate-300 text-sm font-semibold">Asset ID List</label>
                <textarea
                  placeholder="Enter Asset IDs (comma, space, or newline separated)"
                  className="bg-slate-950/80 text-white placeholder-slate-500 border border-slate-800 rounded-xl p-4 w-full h-24 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-sm leading-relaxed"
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  disabled={assetOwnersLoading || assetLoading}
                />
              </div>

              <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-3.5 p-5 bg-slate-950/40 border border-slate-800/80 rounded-xl text-left">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="check_optin"
                    className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                    checked={checkOptin}
                    onChange={(e) => setCheckOptin(e.target.checked)}
                    disabled={assetOwnersLoading || assetLoading}
                  />
                  <label htmlFor="check_optin" className="text-sm text-slate-300 cursor-pointer select-none">
                    Check Opt-in (include 0 balance accounts)
                  </label>
                </div>
                
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="check_running_node"
                    className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                    checked={checkRunningNode}
                    onChange={(e) => setCheckRunningNode(e.target.checked)}
                    disabled={assetOwnersLoading || assetLoading}
                  />
                  <label htmlFor="check_running_node" className="text-sm text-slate-300 cursor-pointer select-none">
                    Node Runners Only
                  </label>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="nfd_only"
                    className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                    checked={checkNfdOnly}
                    onChange={(e) => setCheckNfdOnly(e.target.checked)}
                    disabled={assetOwnersLoading || assetLoading}
                  />
                  <label htmlFor="nfd_only" className="text-sm text-slate-300 cursor-pointer select-none">
                    NFD Wallets Only
                  </label>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="nfd_verified_only"
                    className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                    checked={checkVerifiedOnly}
                    onChange={(e) => setCheckVerifiedOnly(e.target.checked)}
                    disabled={assetOwnersLoading || assetLoading}
                  />
                  <label htmlFor="nfd_verified_only" className="text-sm text-slate-300 cursor-pointer select-none">
                    NFD Socials Verified Only
                  </label>
                </div>

                <div className="flex items-center md:col-span-2">
                  <input
                    type="checkbox"
                    id="check_rand"
                    className="mr-2 rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                    checked={checkRandSupport}
                    onChange={(e) => setCheckRandSupport(e.target.checked)}
                    disabled={assetOwnersLoading || assetLoading}
                  />
                  <label htmlFor="check_rand" className="text-sm text-slate-300 cursor-pointer select-none">
                    Include RandGallery Listing Support (reconcile escrows to sellers)
                  </label>
                </div>
              </div>

              <button
                className="w-full md:w-auto px-8 py-3 bg-gradient-to-r from-primary-yellow to-secondary-orange hover:from-primary-yellow/90 hover:to-secondary-orange/90 text-black font-bold rounded-xl transition shadow-lg hover:scale-95 duration-200 cursor-pointer disabled:opacity-50"
                onClick={getAssetHolders}
                disabled={assetOwnersLoading || assetLoading}
              >
                {assetOwnersLoading ? "Fetching Holders..." : "Get Asset Holders"}
              </button>

              {assetOwnersLoading && (
                <div className="flex flex-col items-center gap-2 mt-4">
                  <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                  <span className="text-sm text-slate-300">Fetching asset owners from ledger...</span>
                </div>
              )}

              {assetHolders.length > 0 && (
                <div className="w-full mt-8 space-y-8 animate-fadeIn text-left">
                  {assetLoading ? (
                    <div className="w-full flex flex-col items-center gap-2 py-8">
                      <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                      <span className="text-sm text-slate-300">{assetLoadingMessage}</span>
                    </div>
                  ) : (
                    <>
                      {/* Asset Selector (if multiple assets are loaded) */}
                      {assetHolders.length > 1 && (
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-900/40 border border-slate-800 rounded-2xl p-4 w-full">
                          <label className="text-slate-300 text-sm font-semibold whitespace-nowrap">Select Active Asset View:</label>
                          <select
                            value={selectedAssetId}
                            onChange={(e) => {
                              setSelectedAssetId(e.target.value);
                              setAssetCurrentPage(1);
                            }}
                            className="bg-slate-950 border border-slate-800 text-white rounded-xl p-2.5 outline-none text-sm w-full font-semibold focus:ring-2 focus:ring-primary-orange"
                          >
                            <option value="all">All Assets (Aggregated)</option>
                            {assetHolders.map((asset) => (
                              <option key={asset.asset_id} value={String(asset.asset_id)}>
                                {asset.asset_name || "Asset"} ({asset.asset_id})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Analytics Dashboard */}
                      {assetAnalytics && (
                        <>
                          {/* Summary Statistics Cards */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
                            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
                              <div>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Supply</p>
                                <h3 className="text-2xl font-extrabold mt-1 text-white font-mono">
                                  {assetAnalytics.totalSupply.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                </h3>
                              </div>
                              <div className="bg-indigo-500/10 p-3 rounded-xl border border-indigo-500/20 text-indigo-400">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                              </div>
                            </div>

                            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
                              <div>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Circulating Supply</p>
                                <h3 className="text-2xl font-extrabold mt-1 text-white font-mono">
                                  {assetAnalytics.circulatingSupply.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                </h3>
                              </div>
                              <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2m0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                              </div>
                            </div>

                            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
                              <div>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Creator & Reserve</p>
                                <h3 className="text-2xl font-extrabold mt-1 text-white font-mono">
                                  {assetAnalytics.creatorReserveBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                </h3>
                              </div>
                              <div className="bg-orange-500/10 p-3 rounded-xl border border-orange-500/20 text-orange-400">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                              </div>
                            </div>

                            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex items-center justify-between shadow-xl">
                              <div>
                                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">Burned (Bonfire)</p>
                                <h3 className="text-2xl font-extrabold mt-1 text-white font-mono">
                                  {assetAnalytics.burnedBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                </h3>
                              </div>
                              <div className="bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 text-rose-400">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                              </div>
                            </div>
                          </div>

                          {/* Horizontal Token Allocation Breakdown Bar */}
                          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl w-full">
                            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4">Token Allocation Breakdown</h3>
                            <div className="w-full h-6 rounded-full overflow-hidden bg-slate-950 flex border border-slate-800">
                              {assetAnalytics.totalSupply > 0 ? (
                                <>
                                  <div
                                    style={{ width: `${(assetAnalytics.circulatingSupply / assetAnalytics.totalSupply) * 100}%` }}
                                    className="bg-gradient-to-r from-emerald-500 to-green-400 h-full transition-all duration-500 relative group cursor-pointer"
                                    title={`Circulating: ${assetAnalytics.circulatingSupply}`}
                                  />
                                  <div
                                    style={{ width: `${(assetAnalytics.creatorReserveBalance / assetAnalytics.totalSupply) * 100}%` }}
                                    className="bg-gradient-to-r from-orange-500 to-amber-400 h-full transition-all duration-500 border-l border-slate-950 relative group cursor-pointer"
                                    title={`Creator & Reserve: ${assetAnalytics.creatorReserveBalance}`}
                                  />
                                  <div
                                    style={{ width: `${(assetAnalytics.burnedBalance / assetAnalytics.totalSupply) * 100}%` }}
                                    className="bg-gradient-to-r from-pink-500 to-rose-400 h-full transition-all duration-500 border-l border-slate-950 relative group cursor-pointer"
                                    title={`Burned: ${assetAnalytics.burnedBalance}`}
                                  />
                                </>
                              ) : (
                                <div className="w-full h-full bg-slate-800" />
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-6 mt-4 text-xs font-semibold text-slate-400 font-mono">
                              <div className="flex items-center gap-2">
                                <span className="w-3.5 h-3.5 rounded bg-gradient-to-r from-emerald-500 to-green-400" />
                                <span>Circulating: {((assetAnalytics.circulatingSupply / (assetAnalytics.totalSupply || 1)) * 100).toFixed(1)}%</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="w-3.5 h-3.5 rounded bg-gradient-to-r from-orange-500 to-amber-400" />
                                <span>Creator & Reserve: {((assetAnalytics.creatorReserveBalance / (assetAnalytics.totalSupply || 1)) * 100).toFixed(1)}%</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="w-3.5 h-3.5 rounded bg-gradient-to-r from-pink-500 to-rose-400" />
                                <span>Burned: {((assetAnalytics.burnedBalance / (assetAnalytics.totalSupply || 1)) * 100).toFixed(1)}%</span>
                              </div>
                            </div>
                          </div>

                          {/* Whale stats & Extra indicators */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                            {/* Whale Concentration */}
                            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Whale Concentration (% of Circulating)</h3>
                              <div className="space-y-3 font-mono">
                                <div>
                                  <div className="flex justify-between text-xs font-semibold text-slate-400 mb-1">
                                    <span>Top 5 Wallets</span>
                                    <span>{assetAnalytics.top5Pct}%</span>
                                  </div>
                                  <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-850">
                                    <div style={{ width: `${assetAnalytics.top5Pct}%` }} className="bg-gradient-to-r from-orange-500 to-orange-400 h-full" />
                                  </div>
                                </div>
                                <div>
                                  <div className="flex justify-between text-xs font-semibold text-slate-400 mb-1">
                                    <span>Top 10 Wallets</span>
                                    <span>{assetAnalytics.top10Pct}%</span>
                                  </div>
                                  <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-850">
                                    <div style={{ width: `${assetAnalytics.top10Pct}%` }} className="bg-gradient-to-r from-orange-500 to-amber-500 h-full" />
                                  </div>
                                </div>
                                <div>
                                  <div className="flex justify-between text-xs font-semibold text-slate-400 mb-1">
                                    <span>Top 20 Wallets</span>
                                    <span>{assetAnalytics.top20Pct}%</span>
                                  </div>
                                  <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-850">
                                    <div style={{ width: `${assetAnalytics.top20Pct}%` }} className="bg-gradient-to-r from-orange-500 to-yellow-500 h-full" />
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Additional Statistics Panel */}
                            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between gap-4">
                              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Ecosystem Statistics</h3>
                              <div className="grid grid-cols-2 gap-4 flex-1 mt-2">
                                <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-850">
                                  <span className="text-slate-400 text-xs font-semibold">Mode Balance</span>
                                  <p className="text-lg font-bold text-white mt-1 font-mono">{assetAnalytics.modeBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
                                  <span className="text-[10px] text-slate-500 block mt-0.5">Most common balance held</span>
                                </div>
                                <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-850">
                                  <span className="text-slate-400 text-xs font-semibold">Unique Wallets</span>
                                  <p className="text-lg font-bold text-white mt-1 font-mono">{assetAnalytics.totalCirculatingHolders}</p>
                                  <span className="text-[10px] text-slate-500 block mt-0.5">Circulating holder addresses</span>
                                </div>
                                <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-850">
                                  <span className="text-slate-400 text-xs font-semibold">NFD Adoption</span>
                                  <p className="text-lg font-bold text-white mt-1 font-mono">{assetAnalytics.nfdAdoptionRate}%</p>
                                  <span className="text-[10px] text-slate-500 block mt-0.5">Wallets mapped to NFD domains</span>
                                </div>
                                <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-850">
                                  <span className="text-slate-400 text-xs font-semibold">Burn Address</span>
                                  <p className="text-xs font-bold text-rose-400 mt-2 font-mono truncate" title={bonfireAddr}>
                                    {bonfireAddr ? `${bonfireAddr.slice(0, 6)}...${bonfireAddr.slice(-6)}` : "N/A"}
                                  </p>
                                  <span className="text-[10px] text-slate-500 block mt-0.5">Bonfire ARC-54 Address</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Quick Actions & Search Panel */}
                          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row gap-4 items-center justify-between w-full">
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                onClick={downloadAssetHoldersDataAsCSV}
                                className="px-5 py-2.5 bg-green-500 hover:bg-green-600 text-black font-bold rounded-xl text-sm transition flex items-center gap-2 cursor-pointer shadow-md"
                              >
                                <IoCloudDownload className="text-lg" />
                                <span>Download CSV</span>
                              </button>
                              <button
                                onClick={copyAllAssetWallets}
                                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-sm transition flex items-center gap-2 cursor-pointer border border-slate-700"
                              >
                                Copy All Wallets
                              </button>
                            </div>

                            <div className="relative w-full md:max-w-xs">
                              <input
                                type="text"
                                placeholder="Search Wallet or NFD..."
                                className="bg-slate-950/80 text-white placeholder-slate-500 border border-slate-850 rounded-xl px-4 py-2.5 pl-10 w-full focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none text-sm"
                                value={assetSearchTerm}
                                onChange={(e) => {
                                  setAssetSearchTerm(e.target.value);
                                  setAssetCurrentPage(1);
                                }}
                              />
                              <div className="absolute left-3.5 top-3.5 text-slate-500">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                              </div>
                            </div>
                          </div>

                          {/* Holders Table */}
                          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl w-full">
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 text-xs uppercase font-bold">
                                    <th className="p-4 pl-6">Wallet / NFD Domain</th>
                                    <th
                                      onClick={() => handleAssetSort("total")}
                                      className="p-4 cursor-pointer hover:bg-slate-950/65 transition select-none text-center"
                                    >
                                      <div className="flex items-center justify-center gap-1">
                                        Aggregated Balance
                                        {assetSortBy === "total" && (assetSortOrder === "desc" ? "↓" : "↑")}
                                      </div>
                                    </th>
                                    <th className="p-4 text-center">Share of Circulating</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-850 text-sm font-medium">
                                  {paginatedAssetHolders.map((holder) => (
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
                                      <td className="p-4 text-center font-mono text-white text-base font-bold">
                                        {holder.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                      </td>
                                      <td className="p-4 text-center font-mono text-slate-300">
                                        {assetAnalytics.circulatingSupply > 0
                                          ? `${((holder.balance / assetAnalytics.circulatingSupply) * 100).toFixed(3)}%`
                                          : "0.000%"}
                                      </td>
                                    </tr>
                                  ))}
                                  {paginatedAssetHolders.length === 0 && (
                                    <tr>
                                      <td colSpan={3} className="p-8 text-center text-slate-500 font-semibold">
                                        No holder wallets match your search query.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>

                            {/* Pagination Controls */}
                            {totalAssetPages > 1 && (
                              <div className="flex items-center justify-between border-t border-slate-850 px-6 py-4 bg-slate-950/20 text-sm font-semibold w-full">
                                <span className="text-slate-400 font-mono text-xs">
                                  Showing {((assetCurrentPage - 1) * assetItemsPerPage) + 1} to {Math.min(assetCurrentPage * assetItemsPerPage, processedAssetHolders.length)} of {processedAssetHolders.length} wallets
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setAssetCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={assetCurrentPage === 1}
                                    className="px-4 py-2 border border-slate-800 rounded-xl hover:bg-slate-900 hover:text-white transition disabled:opacity-30 disabled:hover:bg-transparent"
                                  >
                                    Previous
                                  </button>
                                  <span className="text-slate-300 px-2">
                                    Page {assetCurrentPage} / {totalAssetPages}
                                  </span>
                                  <button
                                    onClick={() => setAssetCurrentPage(prev => Math.min(totalAssetPages, prev + 1))}
                                    disabled={assetCurrentPage === totalAssetPages}
                                    className="px-4 py-2 border border-slate-800 rounded-xl hover:bg-slate-900 hover:text-white transition disabled:opacity-30 disabled:hover:bg-transparent"
                                  >
                                    Next
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <p className="text-center text-xs text-slate-500 mt-2 max-w-md leading-relaxed">
            ⚠️ If you reload or close this page, you will lose your progress. You can reload the page if you need to stop/restart the process.
          </p>
        </div>

        {/* Practitioner Section */}
        <section className="mt-20 pt-12 border-t border-slate-800 w-full max-w-4xl text-left px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white tracking-tight italic">On-Chain Inventory Auditing</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Professional portfolio management requires structured, high-fidelity data. Auditing wallet holdings provides a clear inventory of asset balances, facilitating accurate tax reporting, compliance auditing, and catalog tracking. Disambiguating creator-issued assets from active acquisitions is essential for mapping developer track records versus retail market participation.
              </p>
            </div>
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white tracking-tight italic">Ledger Balance Optimization</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                On the Algorand blockchain, every asset opt-in locks 0.1 Algo in wallet Minimum Balance Requirements (MBR). Extracting granular holdings allows developers and collectors to run ledger hygiene sweeps. By identifying inactive, low-value, or spam standard assets, users can quickly opt out to return locked liquidity to their spendable balance, improving capital efficiency.
              </p>
            </div>
          </div>
        </section>
      </article>
    </div>
  );
}
