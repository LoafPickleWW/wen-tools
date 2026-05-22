import { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { useSearchParams } from "react-router-dom";
import Papa from "papaparse";
import {
  createAssetOptInTransactions,
  createAssetOptoutTransactions,
  createAssetDeleteTransactions,
  createFreezeTransactions,
  createClawbackTransactions,
  getAssetDecimals,
  SignWithMnemonic,
  sliceIntoChunks,
  walletSign,
  trackEvent,
} from "../utils";
import InfinityModeComponent from "../components/InfinityModeComponent";
import FaqSectionComponent from "../components/FaqSectionComponent";
import { useWallet } from "@txnlab/use-wallet-react";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";
import {
  IoAddCircle,
  IoRemoveCircle,
  IoTrash,
  IoCopy,
  IoCheckmark,
  IoInformationCircle,
  IoWarning,
  IoAlertCircle,
  IoSparkles,
  IoLockClosed,
  IoRefreshCircle,
} from "react-icons/io5";

type TabMode = "optin" | "optout" | "destroy" | "freeze" | "clawback";

interface BulkAssetManagerProps {
  defaultTab?: TabMode;
}

export function BulkAssetManager({ defaultTab = "optin" }: BulkAssetManagerProps) {
  const [activeTab, setActiveTab] = useState<TabMode>(defaultTab);
  const [csvData, setCsvData] = useState<any[] | null>(null);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [assetIds, setAssetIds] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [searchParams] = useSearchParams();
  const { activeAddress, algodClient, transactionSigner } = useWallet();

  useEffect(() => {
    if (searchParams.has("ids")) {
      setAssetIds(searchParams.get("ids")!);
    }
    if (searchParams.has("tab")) {
      const tab = searchParams.get("tab") as TabMode;
      if (
        tab === "optin" ||
        tab === "optout" ||
        tab === "destroy" ||
        tab === "freeze" ||
        tab === "clawback"
      ) {
        setActiveTab(tab);
      }
    } else if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [searchParams, defaultTab]);

  // Reset progress state when switching tabs
  const handleTabChange = (tab: TabMode) => {
    setActiveTab(tab);
    setCsvData(null);
    setIsTransactionsFinished(false);
    setTxSendingInProgress(false);
  };

  const handleCopyLink = () => {
    const baseUrl = window.location.href.split("?")[0];
    const idsPart = assetIds ? `&ids=${assetIds.replaceAll("\n", ",")}` : "";
    const url = `${baseUrl}?tab=${activeTab}${idsPart}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    toast.success("Link copied!");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleExecuteAssetAction = async () => {
    if (!csvData || csvData.length <= 1) {
      toast.error("No assets found!");
      return;
    }

    if (!activeAddress) {
      toast.error("Wallet not connected!");
      return;
    }

    try {
      if (mnemonic === "") toast.info("Please sign the transactions!");
      
      let groups: any[] = [];
      let signedTransactions: any[] = [];

      if (
        activeTab === "optin" ||
        activeTab === "optout" ||
        activeTab === "destroy"
      ) {
        const assets: number[] = [];
        for (let i = 1; i < csvData.length; i++) {
          assets.push(parseInt(csvData[i][0]));
        }

        if (assets.some(isNaN)) {
          toast.error("Invalid Asset IDs detected in the input!");
          return;
        }

        if (activeTab === "optin") {
          const rawGroups = await createAssetOptInTransactions(
            assets,
            activeAddress,
            algodClient
          );
          if (mnemonic !== "") {
            const flat = SignWithMnemonic(rawGroups.flat(), mnemonic);
            groups = sliceIntoChunks(flat, 16);
          } else {
            const flat = await walletSign(rawGroups, transactionSigner);
            groups = sliceIntoChunks(flat, 16);
          }
        } else if (activeTab === "optout") {
          const rawGroups = await createAssetOptoutTransactions(
            assets,
            activeAddress,
            algodClient
          );
          if (mnemonic !== "") {
            const flat = SignWithMnemonic(rawGroups.flat(), mnemonic);
            groups = sliceIntoChunks(flat, 16);
          } else {
            const flat = await walletSign(rawGroups, transactionSigner);
            groups = sliceIntoChunks(flat, 16);
          }
        } else if (activeTab === "destroy") {
          const rawTxns = await createAssetDeleteTransactions(
            assets,
            activeAddress,
            algodClient
          );
          if (mnemonic !== "") {
            signedTransactions = SignWithMnemonic(rawTxns.flat(), mnemonic);
          } else {
            signedTransactions = await walletSign(rawTxns, transactionSigner);
          }
          groups = sliceIntoChunks(signedTransactions, 2);
        }
      } else if (activeTab === "freeze") {
        let headers;
        const data = [];
        for (let i = 0; i < csvData.length; i++) {
          if (csvData[i].length === 1 && csvData[i][0].length === 0) continue;
          if (i === 0) {
            headers = csvData[i];
          } else {
            const obj: any = {};
            for (let j = 0; j < headers.length; j++) {
              obj[headers[j]] = csvData[i][j];
            }
            data.push(obj);
          }
        }

        const rawGroups = await createFreezeTransactions(
          data,
          activeAddress,
          algodClient
        );
        if (mnemonic !== "") {
          const flat = SignWithMnemonic(rawGroups.flat(), mnemonic);
          groups = sliceIntoChunks(flat, 16);
        } else {
          const flat = await walletSign(rawGroups, transactionSigner);
          groups = sliceIntoChunks(flat, 16);
        }
      } else if (activeTab === "clawback") {
        let headers;
        const data = [];
        for (let i = 0; i < csvData.length; i++) {
          if (csvData[i].length === 1 && csvData[i][0].length === 0) continue;
          if (i === 0) {
            headers = csvData[i];
          } else {
            const obj: any = {};
            for (let j = 0; j < headers.length; j++) {
              obj[headers[j]] = csvData[i][j];
            }
            data.push(obj);
          }
        }

        const uniqueAssetIdsMap: any = {};
        for (let i = 0; i < data.length; i++) {
          if (data[i].asset_id) {
            uniqueAssetIdsMap[data[i].asset_id] = true;
          }
        }
        const uniqueAssetIds = Object.keys(uniqueAssetIdsMap);
        const assetDecimals: any = {};
        for (let i = 0; i < uniqueAssetIds.length; i++) {
          const assetId = parseInt(uniqueAssetIds[i]);
          if (assetId === 1) continue;
          assetDecimals[assetId] = await getAssetDecimals(
            assetId,
            algodClient
          );
        }

        const rawGroups = await createClawbackTransactions(
          data,
          assetDecimals,
          activeAddress,
          algodClient
        );
        if (mnemonic !== "") {
          const flat = SignWithMnemonic(rawGroups.flat(), mnemonic);
          groups = sliceIntoChunks(flat, 16);
        } else {
          const flat = await walletSign(rawGroups, transactionSigner);
          groups = sliceIntoChunks(flat, 16);
        }
      }

      setTxSendingInProgress(true);
      for (let i = 0; i < groups.length; i++) {
        try {
          await algodClient.sendRawTransaction(groups[i]).do();
          if (i % 5 === 0) {
            toast.success(
              `Transaction ${i + 1} of ${groups.length} confirmed!`,
              {
                autoClose: 1000,
              }
            );
          }
        } catch (err) {
          console.error(err);
          toast.error(
            `Transaction ${i + 1} of ${groups.length} failed!`,
            {
              autoClose: 1000,
            }
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      setIsTransactionsFinished(true);
      setTxSendingInProgress(false);
      toast.success("All transactions processed!");
      toast.info("You can support by donating :)");
      trackEvent("bulk_asset_success", "bulk_manager", activeTab);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Something went wrong!");
      setTxSendingInProgress(false);
    }
  };

  const getFaqs = () => {
    switch (activeTab) {
      case "optin":
        return [
          {
            question: "What is Opting into an Asset?",
            answer:
              "On Algorand, you cannot receive an Asset unless your wallet explicitly gives permission to receive it. This prevents malicious actors from sending unwanted spam assets to your account.",
          },
          {
            question: "How much does it cost to Opt into an Asset?",
            answer:
              "There is a Minimum Balance Requirement (MBR) of 0.1 ALGO per asset class. This amount is locked up in your wallet and will be released once you opt out of the asset.",
          },
        ];
      case "optout":
        return [
          {
            question: "What is Opting out of an Asset?",
            answer:
              "Opting out clears the asset record from your account balance sheet, releasing the 0.1 ALGO MBR lockup back into your spendable balance.",
          },
          {
            question: "What happens to remaining balances when I opt out?",
            answer:
              "WARNING: If you opt out of an asset with a balance greater than 0, the remaining balance will be returned to the asset's creator wallet. Always verify your balances before opting out.",
          },
        ];
      case "destroy":
        return [
          {
            question: "What does destroying an asset do?",
            answer:
              "Destroying (deleting) an asset permanently retires it from the Algorand ledger, freeing up any associated creator MBR state. This action is completely irreversible.",
          },
          {
            question: "Who can destroy an asset?",
            answer:
              "Only the creator account of an asset can initiate its destruction. Furthermore, you must hold the entire supply of the asset (balance equals total supply).",
          },
        ];
      case "freeze":
        return [
          {
            question: "What is asset freezing?",
            answer:
              "Asset freezing allows the designated freeze address to restrict transfers of a specific asset to or from a target account. This is typically used for compliance, lockup periods, or security containment.",
          },
          {
            question: "Can I freeze any asset?",
            answer:
              "No, you can only execute a freeze transaction if you are signing from the designated Freeze Address specified in the asset's parameters, and the asset was created with freeze capability enabled.",
          },
        ];
      case "clawback":
        return [
          {
            question: "What is asset clawback?",
            answer:
              "The clawback mechanism allows a designated administrative account to move assets out of an account wallet to a specified receiver address without the holder's signature.",
          },
          {
            question: "When is clawback used?",
            answer:
              "It is used for recovering tokens from lost wallets, correcting erroneous distributions, or enforcing administrative control in regulated tokenized systems. It requires the signing wallet to be the asset's Clawback Address.",
          },
        ];
    }
  };

  return (
    <div className="bg-primary-black pt-4 flex justify-center flex-col text-white min-h-screen">
      <Meta
        title="Bulk Asset Manager"
        description="Unified interface to mass Opt-in, Opt-out, or Destroy Algorand assets in bulk. Streamline your wallet state, reclaim MBR, and manage creator assets."
      />

      <article className="mx-auto text-white mb-16 flex flex-col items-center max-w-3xl w-full px-4">
        {/* Header Section */}
        <header className="w-full flex flex-col items-center mt-10 mb-8 text-center">
          <div className="flex items-center gap-3 justify-center">
            <div className="p-2.5 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl shadow-lg shadow-orange-500/20">
              <IoSparkles className="text-2xl text-black" aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-orange-300 via-orange-500 to-amber-500 bg-clip-text text-transparent py-1 uppercase">
              Bulk Asset Manager
            </h1>
          </div>
          <p className="text-slate-400 mt-4 text-sm md:text-base font-medium max-w-xl leading-relaxed">
            Unified command center to add, remove, and destroy Algorand assets in bulk. Reclaim locked Algos and optimize your wallet lifecycle.
          </p>
        </header>

        {/* Tab Selector - Glassmorphism */}
        <div className="flex flex-wrap gap-2 p-1.5 bg-[#121214] border border-white/5 rounded-2xl w-full max-w-2xl mx-auto mb-8 shadow-xl justify-center">
          <button
            onClick={() => handleTabChange("optin")}
            className={`flex-1 min-w-[90px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "optin"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoAddCircle className="text-lg" />
            <span>Opt-in</span>
          </button>
          <button
            onClick={() => handleTabChange("optout")}
            className={`flex-1 min-w-[90px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "optout"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoRemoveCircle className="text-lg" />
            <span>Opt-out</span>
          </button>
          <button
            onClick={() => handleTabChange("destroy")}
            className={`flex-1 min-w-[90px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "destroy"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoTrash className="text-lg" />
            <span>Destroy</span>
          </button>
          <button
            onClick={() => handleTabChange("freeze")}
            className={`flex-1 min-w-[90px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "freeze"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoLockClosed className="text-lg" />
            <span>Freeze</span>
          </button>
          <button
            onClick={() => handleTabChange("clawback")}
            className={`flex-1 min-w-[90px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "clawback"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoRefreshCircle className="text-lg" />
            <span>Clawback</span>
          </button>
        </div>

        {/* Main Action Box */}
        <div className="w-full bg-[#18181c]/90 border border-white/5 rounded-[32px] p-6 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center gap-6">
            <ConnectButton inmain={true} />

            {/* Context Warning Banner */}
            {activeTab === "optin" && (
              <div className="w-full bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex gap-3 text-sm text-blue-200 items-start text-left leading-relaxed">
                <IoInformationCircle className="text-xl text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white">Minimum Balance Requirement (MBR):</span> Each asset opt-in locks <span className="font-bold text-blue-300">0.1 ALGO</span> in your wallet. This MBR is fully reclaimed once you opt out.
                </div>
              </div>
            )}

            {activeTab === "optout" && (
              <div className="w-full bg-red-500/5 border border-red-500/20 rounded-2xl p-4 flex gap-3 text-sm text-red-255 items-start text-left leading-relaxed">
                <IoWarning className="text-xl text-red-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white text-red-400">Warning:</span> Opting out of assets with a balance &gt; 0 will return those balances to the creator wallet. You cannot opt-out of assets you created.
                </div>
              </div>
            )}

            {activeTab === "destroy" && (
              <div className="w-full bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex gap-3 text-sm text-amber-255 items-start text-left leading-relaxed">
                <IoAlertCircle className="text-xl text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white text-amber-400">Permanent Ledger Deletion:</span> You must be the creator and hold 100% of the supply to delete/destroy an asset. This action is irreversible.
                </div>
              </div>
            )}

            {activeTab === "freeze" && (
              <div className="w-full bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex gap-3 text-sm text-amber-255 items-start text-left leading-relaxed">
                <IoWarning className="text-xl text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white text-amber-400">Pera Wallet Constraint:</span> Pera doesn't support freeze transactions. You can use Defly, Lute, or a mnemonic passkey.
                </div>
              </div>
            )}

            {activeTab === "clawback" && (
              <div className="w-full bg-red-500/5 border border-red-500/20 rounded-2xl p-4 flex gap-3 text-sm text-red-255 items-start text-left leading-relaxed">
                <IoAlertCircle className="text-xl text-red-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white text-red-400">Administrative Token Clawback:</span> This action moves assets out of target wallets. You must be the designated clawback address for these assets to proceed.
                </div>
              </div>
            )}

            {/* Guide & Template links for Freeze and Clawback */}
            {(activeTab === "freeze" || activeTab === "clawback") && (
              <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                <a
                  className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-extrabold text-xs rounded-xl shadow transition duration-300 transform hover:scale-[0.98] text-center"
                  href={
                    activeTab === "freeze"
                      ? "https://docs.google.com/spreadsheets/d/1RAJ_9GZfYQmqIYMVHAxwfTim8fiWTi7E5TGnWQlrKC8/edit?usp=sharing"
                      : "https://docs.google.com/spreadsheets/d/1U_U_5qTIrEETl1I-8pnpwBZ4qDlJKKRIvEIbhZkXTpA/edit?usp=sharing"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download CSV Template
                </a>
                <a
                  className="px-4 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-extrabold text-xs rounded-xl shadow transition duration-300 transform hover:scale-[0.98] text-center"
                  href="https://loafpickle.medium.com/evil-tools-mass-freeze-and-clawback-1e4c677fc574"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  How-to Guide
                </a>
              </div>
            )}

            {/* Infinity Mode (Mnemonic option) */}
            <div className="w-full max-w-md">
              <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
            </div>

            {/* Inputs Section */}
            <div className="w-full flex flex-col items-center">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
                {activeTab === "freeze" || activeTab === "clawback" ? "Upload CSV File" : "Enter Asset IDs"}
              </h3>

              {csvData === null ? (
                activeTab === "freeze" || activeTab === "clawback" ? (
                  <div className="flex flex-col items-center w-full gap-5">
                    <label
                      htmlFor="dropzone-file"
                      className="flex flex-col justify-center items-center w-full max-w-md h-40 px-4 rounded-2xl border-2 border-dashed cursor-pointer bg-[#0f0f11] border-slate-800 hover:border-orange-500/50 hover:bg-white/[0.02] transition duration-300"
                    >
                      <div className="flex flex-col justify-center items-center pt-5 pb-6 text-center">
                        <IoAddCircle className="text-3xl text-slate-400 mb-2" />
                        <p className="mb-1 text-sm text-slate-300 font-bold">
                          Click or drag to upload CSV file
                        </p>
                        <p className="text-xs text-slate-500">Ensure no empty rows at the end of the file</p>
                      </div>
                      <input
                        className="hidden"
                        id="dropzone-file"
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={(e: any) => {
                          const file = e.target.files[0];
                          if (file) {
                            Papa.parse(file, {
                              complete: function (results) {
                                const filteredData = results.data.filter(
                                  (row: any) => row.length > 0 && row[0]?.length > 0
                                );
                                setCsvData(filteredData);
                              },
                              skipEmptyLines: true,
                            });
                          }
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="flex flex-col items-center w-full gap-5">
                    <textarea
                      id="asset_id_list"
                      placeholder="Asset IDs (one per line, space, or comma separated)"
                      className="w-full max-w-md bg-[#0f0f11] text-white border border-white/10 rounded-2xl p-4 text-sm font-mono focus:border-orange-500/50 outline-none transition-all placeholder:text-slate-600 focus:ring-1 focus:ring-orange-500/30"
                      style={{ height: "10rem" }}
                      value={assetIds}
                      onChange={(e) => setAssetIds(e.target.value)}
                    />
                    <button
                      id="confirm-input"
                      className="w-full max-w-xs bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-black uppercase text-sm rounded-xl py-3.5 px-8 transition-all duration-300 shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 hover:scale-[0.98]"
                      onClick={() => {
                        const splitted = assetIds
                          .split(/[\n,\s]+/)
                          .map((id) => id.trim())
                          .filter((id) => id !== "");

                        if (splitted.length === 0) {
                          toast.error("Please enter at least one Asset ID!");
                          return;
                        }

                        const parsed = splitted.map((id) => [id]);
                        parsed.unshift(["asset_id"]); // header row
                        setCsvData(parsed);
                      }}
                    >
                      Next
                    </button>
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center gap-5 w-full">
                  {isTransactionsFinished ? (
                    <div className="text-center py-4 space-y-4">
                      <p className="text-primary-orange animate-pulse text-lg font-bold">
                        All transactions completed!
                      </p>
                      <p className="text-slate-400 text-xs">
                        You can reload the page if you want to use the tool again.
                      </p>
                      <button
                        className="bg-white/5 hover:bg-white/10 text-white font-bold text-xs rounded-xl py-2.5 px-5 transition border border-white/10"
                        onClick={() => {
                          setCsvData(null);
                          setIsTransactionsFinished(false);
                        }}
                      >
                        Process More
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm font-bold text-slate-300 bg-[#0f0f11] px-5 py-3 rounded-xl border border-white/5">
                        {activeTab === "freeze" || activeTab === "clawback"
                          ? `${csvData.length - 1} records detected`
                          : `${csvData.length - 1} assets detected`}
                      </div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                        Step 3: Approve & Sign
                      </p>
                      {!txSendingInProgress ? (
                        <div className="flex gap-4 w-full max-w-md justify-center">
                          <button
                            id="approve-send"
                            className="flex-1 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-black uppercase text-sm rounded-xl py-3.5 px-6 transition-all duration-300 shadow-lg shadow-orange-500/20 hover:scale-[0.98]"
                            onClick={handleExecuteAssetAction}
                          >
                            Approve & Send
                          </button>
                          <button
                            className="bg-white/5 hover:bg-white/10 text-white font-bold text-sm rounded-xl py-3.5 px-6 transition border border-white/10"
                            onClick={() => setCsvData(null)}
                          >
                            Back
                          </button>
                        </div>
                      ) : (
                        <div className="mx-auto flex flex-col items-center gap-3 text-center">
                          <div
                            className="spinner-border animate-spin inline-block w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"
                            role="status"
                          ></div>
                          <p className="text-sm text-slate-400">
                            Please wait... Sending transactions to the network.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Copy Shareable Link */}
            <button
              id="copy-link"
              className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-bold rounded-xl py-2.5 px-4 transition border border-white/5 hover:scale-[0.98]"
              onClick={handleCopyLink}
            >
              {copiedLink ? <IoCheckmark className="text-green-400" /> : <IoCopy />}
              <span>{copiedLink ? "Link Copied!" : "Copy Shareable Link 🔗"}</span>
            </button>
          </div>
        </div>

        {/* FAQs */}
        <div className="w-full max-w-md mx-auto mt-8 text-center">
          <FaqSectionComponent faqData={getFaqs()} />
        </div>

        {/* Practitioner Section: Asset Lifecycle & Economics */}
        <section className="mt-16 pt-12 border-t border-white/5 w-full max-w-3xl text-left px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-4">
              <h2 className="text-lg font-black text-white tracking-tight italic uppercase">Permissioned Onboarding & MBR</h2>
              <p className="text-xs md:text-sm text-slate-400 leading-relaxed">
                Algorand's opt-in requirement is a foundational security mechanism engineered to eliminate unsolicited asset distribution ("airdrop spam"). While preventing unsolicited ledger clutter, it creates a Minimum Balance Requirement (MBR) of 0.1 ALGO per asset class. The **Bulk Asset Manager** provides administrative scaling to manage these economics directly.
              </p>
            </div>
            <div className="space-y-4">
              <h2 className="text-lg font-black text-white tracking-tight italic uppercase">State Optimization & Lifecycle</h2>
              <p className="text-xs md:text-sm text-slate-400 leading-relaxed">
                Reclaiming capital from historical asset participations requires clean lifecycle deletion or opt-out. When opting out of assets with residual balances, the units are returned back to the creator balance sheet. For creators, asset destruction removes the contract state entirely, releasing developer reserves back into the liquid pool.
              </p>
            </div>
          </div>
        </section>

        {/* Warning info */}
        <div className="mt-8 text-center text-xs text-slate-600 space-y-1 pb-10 italic">
          <p>⚠️ Reloading or closing this page will lose transaction status tracking.</p>
          <p>Fee: Standard Algorand transaction fee applies per call.</p>
        </div>
      </article>
    </div>
  );
}
