import { showDonationToast } from "../utils";
import { useState, useEffect } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
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
                <div className="w-full mt-4 bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex flex-col items-center gap-4">
                  {assetLoading ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                      <span className="text-sm text-slate-300">{assetLoadingMessage}</span>
                    </div>
                  ) : (
                    <>
                      <div className="w-full flex flex-col gap-2 text-left max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                        {assetHolders.map((assetHolder, index) => (
                          <div key={index} className="flex justify-between items-center text-sm border-b border-slate-800/60 pb-1.5 last:border-b-0">
                            <span className="text-slate-300 font-medium">
                              {assetHolder.asset_name || "Asset"} ({assetHolder.asset_id})
                            </span>
                            <span className="text-primary-orange font-bold font-mono">
                              {assetHolder.assetFilteredHolders?.length || 0} Holders
                            </span>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={downloadAssetHoldersDataAsCSV}
                        className="px-8 py-3 bg-green-500 hover:bg-green-600 text-black font-bold rounded-xl transition shadow-lg hover:scale-95 duration-200 cursor-pointer flex items-center gap-2 mt-2"
                      >
                        <IoCloudDownload className="text-lg" />
                        <span>Download Holders CSV</span>
                      </button>
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
