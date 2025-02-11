import { useState } from "react";
import Papa from "papaparse";
import { toast } from "react-toastify";
import {
  createAirdropTransactions,
  getAssetDecimals,
  SignWithMnemonic,
  walletSign,
} from "../utils";
import FileDownloadIcon from "@mui/icons-material/FileDownload";

import { TOOLS } from "../constants";
import InfinityModeComponent from "../components/InfinityModeComponent";
import { useWallet } from "@txnlab/use-wallet-react";
import {
  createArc59GroupTxns,
  TxnInfoType,
  convertToCSV,
} from "../arc59-helpers";
import algosdk from "algosdk";

type PageState =
  | "INITIAL"
  | "CSV_UPLOADED"
  | "SENDING_TXNS"
  | "TXNS_FINISHED"
  | "CALCULATE_FEES"
  | "CALCULATING_FEES"
  | "SEND_TO_ASSET_INBOX"
  | "SENDING_TO_ASSET_INBOX"
  | "ASSET_INBOX_TXNS_FINISHED";

export function AirdropTool() {
  const [csvData, setCsvData] = useState(null as null | any);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [assetInbox, setAssetInbox] = useState(false);
  const [assetInboxInfo, setAssetInboxInfo] = useState({} as TxnInfoType);
  const [currentSpendingBalance, setCurrentSpendingBalance] = useState(0);

  const [processStep, setProcessStep] = useState<PageState>("INITIAL");
  const { activeAddress, activeNetwork, algodClient, transactionSigner } =
    useWallet();

  const handleFileData = async () => {
    if (activeAddress === null || activeAddress === undefined) {
      toast.error("Wallet not found!");
      return;
    }

    setProcessStep(assetInbox ? "CALCULATING_FEES" : "SENDING_TXNS");

    let headers;
    const data = [];
    for (let i = 0; i < csvData.length; i++) {
      if (csvData[i].length === 1) continue;
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
    let assetIds: any = {};
    for (let i = 0; i < data.length; i++) {
      if (data[i].asset_id) {
        assetIds[data[i].asset_id] = true;
      }
    }
    assetIds = Object.keys(assetIds);
    const assetDecimals: any = {};
    for (let i = 0; i < assetIds.length; i++) {
      assetIds[i] = parseInt(assetIds[i]);
      if (assetIds[i] === 1) continue;
      assetDecimals[assetIds[i]] = await getAssetDecimals(
        assetIds[i],
        algodClient
      );
    }
    try {
      try {
        const txns = await createAirdropTransactions(
          data,
          assetDecimals,
          activeAddress,
          algodClient,
          activeNetwork
        );
        if (assetInbox) {
          let mnemonicSigner = null;
          if (mnemonic !== "") {
            const privateKey = algosdk.mnemonicToSecretKey(mnemonic);
            mnemonicSigner =
              algosdk.makeBasicAccountTransactionSigner(privateKey);
          }
          const sender = {
            addr: activeAddress,
            signer:
              mnemonic !== "" && mnemonicSigner !== null
                ? mnemonicSigner
                : transactionSigner,
          };
          const txnData = await createArc59GroupTxns(
            txns,
            sender,
            activeAddress,
            algodClient,
            activeNetwork
          );
          console.log("txnData " + JSON.stringify(txnData.logDataArray));
          console.log("Totals " + JSON.stringify(txnData.grandTotal));
          setAssetInboxInfo(txnData);

          // Calculate the spending balance for the current account to see if it can cover the fees
          const accountInfo = await algodClient
            .accountInformation(activeAddress as string)
            .do();
          const spendingBalance =
            accountInfo.amount - accountInfo["min-balance"];
          setCurrentSpendingBalance(spendingBalance);
          setProcessStep("SEND_TO_ASSET_INBOX");
        } else {
          let signedTransactions = [];
          if (mnemonic !== "") {
            signedTransactions = SignWithMnemonic(txns.flat(), mnemonic);
          } else {
            toast.info("Please sign the transactions!");
            signedTransactions = await walletSign(txns, transactionSigner);
          }
          setTxSendingInProgress(true);
          for (let i = 0; i < signedTransactions.length; i++) {
            try {
              await algodClient.sendRawTransaction(signedTransactions[i]).do();
              if (i % 5 === 0) {
                toast.success(
                  `Transaction ${i + 1} of ${
                    signedTransactions.length
                  } confirmed!`,
                  {
                    autoClose: 1000,
                  }
                );
              }
            } catch (err) {
              console.error(err);
              toast.error(
                `Transaction ${i + 1} of ${signedTransactions.length} failed!`,
                {
                  autoClose: 1000,
                }
              );
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          setIsTransactionsFinished(true);
          setTxSendingInProgress(false);
          toast.success("All transactions confirmed!");
          toast.info("You can support by donating :)");
        }
      } catch (error) {
        console.log(error);
        setTxSendingInProgress(false);
        toast.error("Something went wrong! Please check your file!");
        return;
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setTxSendingInProgress(false);
    }
  };

  const getCSV = () => {
    // Create blob and download
    const blob = new Blob([assetInboxInfo.csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "asset_box_data.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const sendAssetInboxTxns = async () => {
    setProcessStep("SENDING_TO_ASSET_INBOX");
    const txnsLength = assetInboxInfo.atomicTxns.length;
    try {
      for (let i = 0; i < txnsLength; i++) {
        try {
          await assetInboxInfo.atomicTxns[i].gatherSignatures();
          const result = await assetInboxInfo.atomicTxns[i].submit(algodClient);
          assetInboxInfo.logDataArray[i].txnID = result.flat().toString();
          if (i % 5 === 0) {
            toast.success(`Transaction ${i + 1} of ${txnsLength} confirmed!`, {
              autoClose: 1000,
            });
          }
        } catch (err: any) {
          assetInboxInfo.logDataArray[i].txnID = `Failed: ${err.message}`;
          console.error(err);
          toast.error(`Transaction ${i + 1} of ${txnsLength} failed!`, {
            autoClose: 1000,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assetInboxInfo.csv = await convertToCSV(assetInboxInfo.logDataArray);
      setProcessStep("ASSET_INBOX_TXNS_FINISHED");
      toast.success("All transactions confirmed!");
      toast.info("You can support by donating :)");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setProcessStep("SEND_TO_ASSET_INBOX");
    }
  };

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 min-h-screen">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </p>
      <button className="text-center text-lg text-black mt-2 bg-primary-orange px-4 py-2 rounded">
        <a
          className="hover:text-primary-orange transition"
          href="https://loafpickle.medium.com/evil-tools-custom-mass-airdrop-3d5902dd1c94"
          target="_blank"
          rel="noopener noreferrer"
        >
          INSTRUCTIONS
        </a>
      </button>
      <button className="text-center text-lg text-black mt-2 bg-primary-orange px-4 py-2 rounded">
        <a
          className="hover:text-primary-orange transition"
          href="https://docs.google.com/spreadsheets/d/1YN7NhxXyNmBZ80nopbcu23Pme-xastrobfIu_MnALiA/edit?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
        >
          CSV Template
        </a>
      </button>
      {/* mnemonic */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      {/* end mnemonic */}
      <p>Upload CSV file</p>
      {csvData == null ? (
        <label
          htmlFor="dropzone-file"
          className="flex flex-col justify-center items-center w-[16rem] h-[8rem] px-4  rounded-lg border-2  border-dashed cursor-pointer hover:bg-bray-800 bg-gray-700  border-gray-600 hover:border-gray-500 hover:bg-gray-600"
        >
          <div className="flex flex-col justify-center items-center pt-5 pb-6">
            <p className="mb-1 text-sm text-gray-400 font-bold">
              Click to upload file
            </p>
            <p className="text-xs text-gray-400">(CSV,XLS,XLSX)</p>
            <p className="text-xs text-gray-300">
              To be sure there is no empty row at the end of the file
            </p>
          </div>
          <input
            className="hidden"
            id="dropzone-file"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e: any) => {
              const file = e.target.files[0];
              Papa.parse(file, {
                complete: function (results) {
                  const filteredData = results.data.filter(
                    (row: any) => row[0].length > 1
                  );
                  setCsvData(filteredData);
                  setProcessStep("CSV_UPLOADED");
                },
                skipEmptyLines: true,
              });
            }}
          />
        </label>
      ) : (
        <div className="flex flex-col justify-center items-center w-[16rem]">
          {processStep === "ASSET_INBOX_TXNS_FINISHED" ? (
            <>
              <button
                className="mb-2 text-sm  rounded py-2 w-fit mx-auto flex flex-col items-center"
                onClick={getCSV}
              >
                <FileDownloadIcon />
                <span>Download asset inbox logs</span>
                <span className="text-xs text-gray-300">
                  This csv does include transaction ID's
                </span>
              </button>
              <p className="pt-4 text-green-500 animate-pulse text-sm">
                All asset inbox transactions completed!
                <br />
              </p>
              <p className="pb-2 text-slate-400 text-xs">
                You can reload the page if you want to use again.
              </p>
            </>
          ) : processStep === "SENDING_TO_ASSET_INBOX" ? (
            <div className="mx-auto flex flex-col">
              <div className="flex justify-center items-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-200"></div>
              </div>
              Please wait... Transactions are sending to the network
            </div>
          ) : processStep === "CALCULATING_FEES" ? (
            <>
              <div className="mx-auto flex flex-col space-y-2">
                <div className="flex justify-center items-center m-2">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-200"></div>
                </div>
                <span className="text-primary-orange">Calculating Fee's</span>
              </div>
            </>
          ) : processStep === "SEND_TO_ASSET_INBOX" ? (
            <div className="flex flex-col justify-start items-center space-y-2">
              <div className="flex flex-col ps-3 mt-2">
                <div className="flex flex-row gap-2">
                  <div className="text-xs text-slate-100">Total Txn's:</div>
                  <div className="text-xs text-primary-orange">
                    {assetInboxInfo.logDataArray.length}
                  </div>
                </div>
                <div className="flex flex-row gap-2">
                  <div className="text-xs text-slate-100">Total Fee's:</div>
                  <div
                    className={`${
                      assetInboxInfo.grandTotal < currentSpendingBalance
                        ? "text-primary-orange"
                        : "text-primary-red"
                    } text-xs `}
                  >
                    {(assetInboxInfo.grandTotal * 1e-6).toFixed(4)} Algos
                  </div>
                </div>
                <div className="flex flex-row gap-2">
                  <div className="text-xs text-slate-100">Balance:</div>
                  <div className="text-xs text-primary-orange">
                    {(currentSpendingBalance * 1e-6).toFixed(4)} Algos
                  </div>
                </div>
              </div>
              <button
                className="mb-2 text-sm  rounded py-2 w-fit mx-auto flex flex-col items-center"
                onClick={getCSV}
              >
                <FileDownloadIcon />
                <span>Download CSV Logs</span>
                <span className="text-xs text-gray-400">
                  This csv does NOT include transaction ID's
                </span>
              </button>
              <button
                id="send_asset_inbox_transactions_id"
                className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-sm font-semibold rounded py-2 w-fit px-4 mx-auto mt-1 duration-700"
                onClick={() => {
                  sendAssetInboxTxns();
                }}
              >
                Sign & Send
              </button>
            </div>
          ) : processStep === "TXNS_FINISHED" ? (
            <>
              <p className="pt-4 text-primary-orange animate-pulse text-sm">
                All transactions completed!
                <br />
              </p>
              <p className="pb-2 text-slate-400 text-xs">
                You can reload the page if you want to use again.
              </p>
            </>
          ) : processStep === "SENDING_TXNS" ? (
            <>
              <div className="mx-auto flex flex-col gap-2">
                <div className="flex justify-center items-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-200"></div>
                </div>
                Please wait... Transactions are sending to the network.
              </div>
            </>
          ) : processStep === "CSV_UPLOADED" ? (
            <>
              <p className="mb-1 text-sm font-bold">File uploaded</p>
              <p className="text-sm text-gray-400">
                {csvData.length - 1} transactions found!
              </p>
              <p>3- Sign Your Transactions</p>
              <>
                <>
                  <label className="flex flex-row items-center text-slate-400 gap-2">
                    <input
                      type="checkbox"
                      checked={assetInbox}
                      onChange={(e) => setAssetInbox(e.target.checked)}
                      className="size-4"
                    />
                    <div className="flex flex-row text-sm justify-start items-baseline">
                      <span>Send to Asset Inbox</span>
                    </div>
                  </label>
                  <span className="text-sm">
                    Asset Inbox Recommended with Infinity Mode
                  </span>
                </>

                <button
                  id="approve-send"
                  className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
                  onClick={handleFileData}
                >
                  {assetInbox ? "Calculate Fee's" : "Approve & Send"}
                </button>
              </>
            </>
          ) : (
            <></>
          )}
        </div>
      )}
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
    </div>
  );
}
