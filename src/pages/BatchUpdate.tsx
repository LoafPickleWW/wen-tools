import { useState } from "react";
import algosdk from "algosdk";
import Papa from "papaparse";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import {
  createAssetConfigArray,
  updateARC19AssetMintArray,
  SignWithMnemonic,
  sliceIntoChunks,
  walletSign,
} from "../utils";
import IpfsProviderSelect from "../components/IpfsProviderSelect";
import { IpfsProvider } from "../types";

import InfinityModeComponent from "../components/InfinityModeComponent";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

export function BatchUpdate() {
  const [updateFormat, setUpdateFormat] = useState("ARC69"); // ARC69 or ARC19
  const [csvData, setCsvData] = useState(null as null | any);
  const [effectiveProvider, setPinningProvider] = useState("pinata");
  const [token, setToken] = useState("");
  const [filebaseToken, setFilebaseToken] = useState("");
  const [assetTransactions, setAssetTransactions] = useState([] as algosdk.Transaction[][]);
  const [mnemonic, setMnemonic] = useState("");
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [isLedger, setIsLedger] = useState(false);

  const { activeAddress, activeNetwork, algodClient, transactionSigner, activeWallet } = useWallet();

  const handleReset = () => {
    setCsvData(null);
    setAssetTransactions([]);
    setIsTransactionsFinished(false);
    setTxSendingInProgress(false);
  };

  const handleCsvUpload = (file: File) => {
    Papa.parse(file, {
      complete: function (results) {
        const filteredData = results.data.filter(
          (row: any) => row[0] && row[0].length > 0
        );
        setCsvData(filteredData);
        toast.success(`CSV file parsed: ${filteredData.length - 1} rows found.`);
      },
      error: function (err) {
        console.error(err);
        toast.error("Failed to parse CSV file");
      }
    });
  };

  const createTransactions = async () => {
    if (!activeAddress) {
      toast.error("Please connect your wallet first!");
      return;
    }
    if (!csvData || csvData.length <= 1) {
      toast.error("Please upload a valid CSV file first!");
      return;
    }
    if (updateFormat === "ARC19" && effectiveProvider === "pinata" && !token) {
      toast.error("Please enter a Pinata JWT token for ARC-19 updates!");
      return;
    }
    if (updateFormat === "ARC19" && effectiveProvider === "filebase" && !filebaseToken) {
      toast.error("Please enter a Filebase API token for ARC-19 updates!");
      return;
    }

    try {
      setTxSendingInProgress(true);

      // Parse headers and rows
      let headers: string[] = [];
      const data: any[] = [];
      for (let i = 0; i < csvData.length; i++) {
        if (csvData[i].length <= 1) continue;
        if (i === 0) {
          headers = csvData[i].map((h: string) => h.trim());
        } else {
          const obj: any = {};
          for (let j = 0; j < headers.length; j++) {
            const header = headers[j];
            if (header.startsWith("metadata_")) {
              obj[header.replace("metadata_", "")] = csvData[i][j];
            } else {
              obj[header] = csvData[i][j];
            }
          }
          data.push(obj);
        }
      }

      if (data.length === 0) {
        toast.error("No valid assets found in CSV!");
        setTxSendingInProgress(false);
        return;
      }

      // Check balance
      const accountInfo = await algodClient.accountInformation(activeAddress).exclude("all").do();
      const minBalance = accountInfo.amount - accountInfo["min-balance"] / 10 ** 6;
      // fee per asset update is 0.001 (tx fee) + 0.05 (site fee) + 0.001 (payment tx fee) = 0.052 ALGO
      const estimatedCost = 0.052 * data.length;

      if (minBalance < estimatedCost) {
        toast.error(`Insufficient balance. Estimated ALGO needed: ${estimatedCost.toFixed(3)} ALGO`);
        setTxSendingInProgress(false);
        return;
      }

      let txns: algosdk.Transaction[][] = [];

      if (updateFormat === "ARC69") {
        const data_for_txns = data.map((item) => {
          const asset_note: any = {
            mime_type: item.mime_type,
            description: item.description,
            external_url: item.external_url,
            properties: {},
            extra: {},
          };

          Object.keys(asset_note).forEach((key) => {
            if (asset_note[key] === "") {
              delete asset_note[key];
            }
          });

          Object.keys(item).forEach((key) => {
            if (key.startsWith("properties_") || key.startsWith("property_")) {
              const cleanKey = key.replace("properties_", "").replace("property_", "");
              asset_note.properties[cleanKey] = item[key];
            }
            if (key.startsWith("extra_")) {
              asset_note.extra[key.replace("extra_", "")] = item[key];
            }
          });

          if (Object.keys(asset_note.properties).length === 0) delete asset_note.properties;
          if (Object.keys(asset_note.extra).length === 0) delete asset_note.extra;

          const itemCopy = { ...item };
          itemCopy.asset_id = parseInt(item.index || item.asset_id);
          itemCopy.note = asset_note;
          if (!itemCopy.note.standard) {
            itemCopy.note.standard = "arc69";
          }
          return itemCopy;
        });

        toast.info("Compiling ARC-69 config transactions...");
        txns = await createAssetConfigArray(data_for_txns, activeAddress, algodClient);
      } else {
        // ARC-19 Update
        const data_for_txns: any[] = [];
        data.forEach((item) => {
          const asset_id = parseInt(item.asset_id || item.index);
          const name = item.name;
          let ipfs_cid = item.image_ipfs_cid;

          if (ipfs_cid && ipfs_cid.startsWith("ipfs://")) {
            ipfs_cid = ipfs_cid.replace("ipfs://", "");
          }

          const ipfs_data: any = {
            name: name,
            standard: "arc3",
            image: ipfs_cid ? "ipfs://" + ipfs_cid : "",
            image_mime_type: item.mime_type,
            description: item.description,
            animation_url: item.animation_url,
            animation_mime_type: item.animation_mime_type,
            properties: {
              traits: {},
              filters: {},
            },
            extra: {},
          };

          Object.keys(ipfs_data).forEach((key) => {
            if (ipfs_data[key] === "") {
              delete ipfs_data[key];
            }
          });

          Object.keys(item).forEach((key) => {
            if (key.startsWith("property_") || key.startsWith("properties_")) {
              const cleanKey = key.replace("properties_", "").replace("property_", "");
              ipfs_data.properties.traits[cleanKey] = item[key];
            }
            if (key.startsWith("extra_")) {
              ipfs_data.extra[key.replace("extra_", "")] = item[key];
            }
            if (key.startsWith("filters_")) {
              ipfs_data.properties.filters[key.replace("filters_", "")] = item[key];
            }
          });

          if (Object.keys(ipfs_data.properties.traits).length === 0) delete ipfs_data.properties.traits;
          if (Object.keys(ipfs_data.properties.filters).length === 0) delete ipfs_data.properties.filters;
          if (Object.keys(ipfs_data.properties).length === 0) delete ipfs_data.properties;
          if (Object.keys(ipfs_data.extra).length === 0) delete ipfs_data.extra;

          data_for_txns.push({
            asset_id,
            ipfs_data,
          });
        });

        const currentToken = effectiveProvider === "filebase" ? filebaseToken : token;
        if (effectiveProvider === "pinata" || effectiveProvider === "filebase") {
          toast.info(`Uploading metadata CIDs to ${effectiveProvider === "filebase" ? "Filebase" : "Pinata"} IPFS & generating reserve address configs...`);
          txns = await updateARC19AssetMintArray(data_for_txns, activeAddress, algodClient, currentToken, effectiveProvider as any);
        } else {
          toast.info("Uploading metadata CIDs to Crust IPFS & generating reserve address configs...");
          let params = await algodClient.getTransactionParams().do();
          const authBasic = localStorage.getItem("authBasic");
          
          for (let i = 0; i < data_for_txns.length; i++) {
            const jsonString = JSON.stringify(data_for_txns[i].ipfs_data);
            const cid = await (await import("../crust")).pinJSONToCrust(authBasic, jsonString);
            const { reserveAddress } = (await import("../utils")).createReserveAddressFromIpfsCid(cid);
            
            const update_tx = algosdk.makeAssetConfigTxnWithSuggestedParamsFromObject({
              from: activeAddress,
              assetIndex: parseInt(data_for_txns[i].asset_id),
              note: new TextEncoder().encode(JSON.stringify(data_for_txns[i].ipfs_data)),
              manager: activeAddress,
              reserve: reserveAddress,
              freeze: data_for_txns[i].freeze || undefined,
              clawback: data_for_txns[i].clawback || undefined,
              suggestedParams: params,
              strictEmptyAddressChecking: false,
            });

            const fee_tx = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              from: activeAddress,
              to: "WEN7BTVZXXGTYZXZ4LFWUUTN5YVUM3242Z26GOKOIKG4FUKQUTHTV74KSE",
              amount: algosdk.algosToMicroalgos(0.05),
              suggestedParams: params,
              note: new TextEncoder().encode("via wen.tools - free tools for creators and collectors"),
            });

            const { makeCrustPinTx } = await import("../crust");
            const atc = new algosdk.AtomicTransactionComposer();
            atc.addTransaction({ txn: update_tx, signer: transactionSigner });
            atc.addTransaction({ txn: fee_tx, signer: transactionSigner });
            atc.addMethodCall(await makeCrustPinTx(cid, transactionSigner, activeAddress, algodClient));

            const group = atc.buildGroup().map(t => t.txn);
            txns.push(group);
            
            if (i % 50 === 0) {
              params = await algodClient.getTransactionParams().do();
            }
          }
        }
      }

      if (txns.length === 0) {
        throw new Error("No transactions were created. Check your CSV format.");
      }

      setAssetTransactions(txns);
      toast.success("Transactions compiled successfully! Ready to sign.");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to create transactions");
    } finally {
      setTxSendingInProgress(false);
    }
  };

  const sendTransactions = async () => {
    if (!activeAddress) {
      toast.error("Please connect your wallet first!");
      return;
    }
    if (assetTransactions.length === 0) {
      toast.error("Please compile transactions first!");
      return;
    }

    try {
      setTxSendingInProgress(true);

      let signedTxns;
      if (mnemonic !== "") {
        signedTxns = SignWithMnemonic(assetTransactions.flat(), mnemonic);
      } else {
        signedTxns = await walletSign(
          assetTransactions,
          transactionSigner,
          isLedger || activeWallet?.id === ("ledger" as any)
        );
      }

      if (!signedTxns || signedTxns.length === 0) {
        toast.error("Transactions signature rejected or failed.");
        setTxSendingInProgress(false);
        return;
      }

      const chunks = sliceIntoChunks(signedTxns, 2);
      toast.info(`Broadcasting ${chunks.length} updates...`);

      for (let i = 0; i < chunks.length; i++) {
        try {
          await algodClient.sendRawTransaction(chunks[i]).do();
          if (i % 5 === 0) {
            toast.success(`Batch ${i + 1} of ${chunks.length} broadcast successfully!`, {
              autoClose: 1000,
            });
          }
        } catch (err) {
          console.error(err);
          toast.error(`Batch ${i + 1} failed to broadcast.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      setIsTransactionsFinished(true);
      toast.success("All updates broadcast successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Broadcasting failed");
    } finally {
      setTxSendingInProgress(false);
    }
  };

  const getFormatGuide = () => {
    if (updateFormat === "ARC69") {
      return "https://loafpickle.medium.com/evil-tools-arc69-made-easy-c7913885cfd2";
    }
    return "https://loafpickle.medium.com/mass-arc3-19-mint-tool-742b2a595a60";
  };

  const getFormatTemplate = () => {
    if (updateFormat === "ARC69") {
      return "https://docs.google.com/spreadsheets/d/1126-7l0B2Z139bN1s6H-MpeE81UqA1hW9Q0q8g1u2Yw/edit?usp=sharing"; // General ARC69 structure
    }
    return "https://docs.google.com/spreadsheets/d/1tmFBd_taaxPTaDU18OsDIJlBXJfBa3ajA7Qfdk5pUHs/edit?usp=sharing";
  };

  return (
    <div className="mx-auto text-white mb-8 text-center flex flex-col items-center max-w-4xl gap-y-4 min-h-screen px-4">
      <Meta
        title="Bulk Update Metadata"
        description="Consolidated Algorand bulk metadata updater for ARC-69 and ARC-19 standards."
      />

      <div className="w-full max-w-2xl bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 p-6 md:p-8 mt-6 shadow-2xl">
        <h1 className="text-3xl font-extrabold bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent mb-2">
          Bulk Update
        </h1>
        <p className="text-gray-300 text-sm mb-6">
          Update metadata note fields or reserve address CIDs across multiple Algorand assets simultaneously.
        </p>

        <ConnectButton inmain={true} />

        {/* Mnemonic / Infinity Mode */}
        <div className="mt-6 w-full">

        </div>

        {/* Selector Switch */}
        <div className="mt-6 text-left space-y-6">
          <div>
            <label className="block mb-2 text-xs font-semibold text-gray-300 uppercase tracking-wider">
              Asset Standard / Format
            </label>
            <div className="flex bg-slate-900/80 p-1.5 rounded-xl border border-slate-700 w-full">
              <button
                type="button"
                className={`flex-1 py-2.5 text-xs md:text-sm font-bold rounded-lg transition-all duration-300 ${
                  updateFormat === "ARC69"
                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-md font-extrabold"
                    : "text-slate-400 hover:text-white"
                }`}
                onClick={() => {
                  setUpdateFormat("ARC69");
                  handleReset();
                }}
              >
                ARC-69 (Note-based)
              </button>
              <button
                type="button"
                className={`flex-1 py-2.5 text-xs md:text-sm font-bold rounded-lg transition-all duration-300 ${
                  updateFormat === "ARC19"
                    ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-md font-extrabold"
                    : "text-slate-400 hover:text-white"
                }`}
                onClick={() => {
                  setUpdateFormat("ARC19");
                  handleReset();
                }}
              >
                ARC-19 (Reserve-based)
              </button>
            </div>
          </div>

          {/* Guide and Templates */}
          <div className="flex flex-wrap gap-3">
            <a
              href={getFormatGuide()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-lg py-1.5 px-3 transition"
            >
              📖 Check Guide Here
            </a>
            <a
              href={getFormatTemplate()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-xs text-orange-400 hover:text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-lg py-1.5 px-3 transition"
            >
              📊 CSV Template
            </a>
          </div>

          {/* IPFS Pinning Provider Select for ARC-19 */}
          {updateFormat === "ARC19" && (
            <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800 animate-fadeIn space-y-4">
              <IpfsProviderSelect
                provider={effectiveProvider as IpfsProvider}
                setProvider={(p) => setPinningProvider(p)}
                isTestnet={activeNetwork === "testnet"}
                pinataToken={token}
                setPinataToken={setToken}
                filebaseToken={filebaseToken}
                setFilebaseToken={setFilebaseToken}
              />
              <span className="block text-xs text-red-400 font-medium">
                ⚠️ This tool is not compatible with NFTs minted from algonfts.art ⚠️
              </span>
            </div>
          )}

          {/* CSV File Upload Section */}
          <div className="space-y-4">
            <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider">
              Upload CSV Metadata
            </label>
            {csvData === null ? (
              <div className="flex justify-center items-center w-full">
                <label
                  htmlFor="csv-upload"
                  className="flex flex-col justify-center items-center w-full h-32 px-4 bg-slate-900/30 rounded-xl border-2 border-slate-700 border-dashed cursor-pointer hover:bg-slate-900/50 hover:border-slate-500 transition"
                >
                  <div className="flex flex-col justify-center items-center pt-5 pb-6 text-center">
                    <p className="mb-1 text-sm text-gray-300 font-bold">
                      Click to select or drop CSV file
                    </p>
                    <p className="text-xs text-gray-400">CSV file with asset IDs and update values</p>
                  </div>
                  <input
                    className="hidden"
                    id="csv-upload"
                    type="file"
                    accept=".csv"
                    onChange={(e: any) => {
                      const file = e.target.files[0];
                      if (file) handleCsvUpload(file);
                    }}
                  />
                </label>
              </div>
            ) : (
              <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800 flex justify-between items-center animate-fadeIn">
                <div className="text-left">
                  <span className="text-green-400 font-semibold text-sm block">CSV File Loaded Successfully</span>
                  <span className="text-xs text-gray-400">{csvData.length - 1} assets detected in file.</span>
                </div>
                <button
                  className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 py-1.5 px-3 rounded-lg transition"
                  onClick={handleReset}
                >
                  Remove File
                </button>
              </div>
            )}
          </div>

          {/* Action Step Buttons */}
          {csvData !== null && (
            <div className="pt-4 border-t border-slate-800 space-y-4">
              {isTransactionsFinished ? (
                <div className="w-full text-center space-y-3 bg-green-500/10 border border-green-500/20 p-4 rounded-xl">
                  <p className="text-green-400 text-sm font-bold animate-pulse">
                    🎉 All asset updates broadcast successfully!
                  </p>
                  <p className="text-slate-400 text-xs">
                    You can clear/reload the page to start a new update.
                  </p>
                </div>
              ) : txSendingInProgress ? (
                <div className="w-full py-4 text-center space-y-2">
                  <div className="spinner-border animate-spin inline-block w-8 h-8 border-4 border-t-orange-500 border-r-transparent rounded-full"></div>
                  <p className="text-orange-400 animate-pulse text-sm font-bold">
                    {assetTransactions.length > 0 ? "Broadcasting transactions..." : "Generating updates (IPFS uploads in progress)..."}
                  </p>
                </div>
              ) : assetTransactions.length > 0 ? (
                <div className="space-y-4 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                  <p className="text-green-400 text-sm font-bold">
                    ✓ Transactions generated successfully!
                  </p>
                  {mnemonic === "" && (
                    <div className="flex items-center justify-center gap-2">
                      <input
                        type="checkbox"
                        id="ledger-mode"
                        checked={isLedger}
                        onChange={(e) => setIsLedger(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-primary-orange focus:ring-primary-orange"
                      />
                      <label htmlFor="ledger-mode" className="text-xs text-slate-300 cursor-pointer select-none">
                        Ledger Mode (Sign one-by-one)
                      </label>
                    </div>
                  )}
                  <button
                    className="w-full py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-black font-extrabold rounded-xl transition shadow-lg flex items-center justify-center gap-2 text-base"
                    onClick={sendTransactions}
                  >
                    🚀 Step 2: Sign &amp; Submit Updates
                  </button>
                </div>
              ) : (
                <button
                  className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-black font-extrabold rounded-xl transition shadow-lg text-base flex items-center justify-center gap-2"
                  onClick={createTransactions}
                >
                  ⚙️ Step 1: Create Transactions
                </button>
              )}
            </div>
          )}

          {/* Fee Summary Box */}
          <div className="bg-orange-500/5 p-4 rounded-xl border border-orange-500/20 text-sm">
            <h4 className="text-orange-400 font-semibold mb-1">Fee breakdown</h4>
            <ul className="space-y-1 text-xs text-gray-300">
              <li>• Network fee: <span className="font-semibold text-white">0.001 ALGO per transaction (2 txs per update)</span></li>
              <li>• Platform update fee: <span className="font-semibold text-white">0.05 ALGO per asset</span></li>
              <li>• IPFS metadata upload fee: <span className="font-semibold text-white">Free (ARC-19 Pinata JWT requires your own API limits)</span></li>
            </ul>
          </div>

          <p className="text-center text-[10px] text-slate-500 italic">
            ⚠️ If you reload or close this page, you will lose your current session progress.
          </p>
        </div>
      </div>

      {/* Practitioner Section */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      <section className="mt-16 pt-12 border-t border-slate-800 w-full text-left px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Metadata Update Mechanisms</h2>
            <p className="text-sm text-slate-400 leading-relaxed text-justify">
              Updating assets in bulk requires an understanding of how metadata is associated on-chain. For ARC-69, metadata is written inside the transaction note field of an asset configuration transaction, which makes updates immediate but leaves legacy data readable in block history. For ARC-19, updates are managed by changing the asset's reserve address to point to a new IPFS CID.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Manager Address Rights</h2>
            <p className="text-sm text-slate-400 leading-relaxed text-justify">
              To successfully broadcast metadata updates, the signing account MUST be configured as the asset's **Manager** address on the ledger. If management permissions have been cleared (set to zero) or pointing to a different account, updating configuration parameters will fail with a transaction verification error.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
