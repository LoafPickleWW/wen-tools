import { useState } from "react";
import Papa from "papaparse";
import { toast } from "react-toastify";
import {
  createClawbackTransactions,
  getAssetDecimals,
  SignWithMnemonic,
  sliceIntoChunks,
  walletSign,
} from "../utils";
import { TOOLS } from "../constants";

import InfinityModeComponent from "../components/InfinityModeComponent";
import { useWallet } from "@txnlab/use-wallet-react";

export function BatchClawback() {
  const [csvData, setCsvData] = useState(null as null | any);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const { activeAddress, algodClient, transactionSigner } = useWallet();

  const handleFileData = async () => {
    if (activeAddress === null || activeAddress === undefined) {
      toast.error("Wallet not found!");
      return;
    }
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
        if (mnemonic === "") toast.info("Please sign the transactions!");
        const groups = await createClawbackTransactions(
          data,
          assetDecimals,
          activeAddress,
          algodClient
        );
        let signedTransactions = [];
        if (mnemonic !== "") {
          signedTransactions = SignWithMnemonic(groups.flat(), mnemonic);
        } else {
          const flat = await walletSign(groups, transactionSigner);
          signedTransactions = sliceIntoChunks(flat, 16);
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
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        setIsTransactionsFinished(true);
        setTxSendingInProgress(false);
        toast.success("All transactions confirmed!");
        toast.info("You can support by donating :)");
      } catch (err) {
        console.error(err);
        setTxSendingInProgress(false);
        toast.error("Something went wrong!");
        return;
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setTxSendingInProgress(false);
    }
  };

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 min-h-screen">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </p>
      <button className="text-center text-lg text-black mt-2 bg-primary-orange px-4 py-2 rounded">
        <a
          className="hover:text-black transition"
          href="https://docs.google.com/spreadsheets/d/1U_U_5qTIrEETl1I-8pnpwBZ4qDlJKKRIvEIbhZkXTpA/edit?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
        >
          CSV Template
        </a>
      </button>
      <button className="text-center text-lg text-black mt-2 bg-primary-orange px-4 py-2 rounded">
        <a
          className="hover:text-black transition"
          href="https://loafpickle.medium.com/evil-tools-mass-freeze-and-clawback-1e4c677fc574"
          target="_blank"
          rel="noopener noreferrer"
        >
          How to Guide
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
                },
                skipEmptyLines: true,
              });
            }}
          />
        </label>
      ) : (
        <div className="flex flex-col justify-center items-center w-[16rem]">
          {isTransactionsFinished ? (
            <>
              <p className="pt-4 text-primary-orange animate-pulse text-sm">
                All transactions completed!
                <br />
              </p>
              <p className="pb-2 text-slate-400 text-xs">
                You can reload the page if you want to use again.
              </p>
            </>
          ) : (
            <>
              <p className="mb-1 text-sm font-bold">File uploaded</p>
              <p className="text-sm text-gray-400">
                {csvData.length - 1} transactions found!
              </p>
              <p>3- Sign Your Transactions</p>
              {!txSendingInProgress ? (
                <button
                  id="approve-send"
                  className="mb-2 bg-primary-orange hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
                  onClick={handleFileData}
                >
                  Approve & Send
                </button>
              ) : (
                <div className="mx-auto flex flex-col">
                  <div
                    className="spinner-border animate-spin inline-block mx-auto w-8 h-8 border-4 rounded-full"
                    role="status"
                  ></div>
                  Please wait... Transactions are sending to the network.
                </div>
              )}
            </>
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
