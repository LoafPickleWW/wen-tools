import { useState } from "react";
import Papa from "papaparse";
import ConnectButton from "../components/ConnectButton";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import { createAssetOptoutTransactions, getNodeURL } from "../utils";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import { TOOLS } from "../constants";

export function BatchOptout() {
  const [csvData, setCsvData] = useState(null);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);

  const handleFileData = async () => {
    let assets = [];
    for (let i = 0; i < csvData.length; i++) {
      if (i !== 0) {
        assets.push(parseInt(csvData[i][0]));
      }
    }
    if (assets.length === 0) {
      toast.error("No assets found in the file!");
      return;
    }
    if (
      localStorage.getItem("wallet") === null ||
      localStorage.getItem("wallet") === undefined
    ) {
      toast.error("Wallet not found!");
      return;
    }

    try {
      const nodeURL = getNodeURL();
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });

      try {
        toast.info("Please sign the transactions!");
        const signedTransactions = await createAssetOptoutTransactions(
          assets,
          nodeURL,
          localStorage.getItem("networkType")
        );
        setTxSendingInProgress(true);
        for (let i = 0; i < signedTransactions.length; i++) {
          try {
            const { txId } = await algodClient
              .sendRawTransaction(signedTransactions[i])
              .do();
            await algosdk.waitForConfirmation(algodClient, txId, 3);
            toast.success(
              `Transaction ${i + 1} of ${signedTransactions.length} confirmed!`,
              {
                autoClose: 1000,
              }
            );
          } catch (error) {
            toast.error(
              `Transaction ${i + 1} of ${signedTransactions.length} failed!`
            );
          }
        }
        setIsTransactionsFinished(true);
        setTxSendingInProgress(false);
        toast.success("All transactions confirmed!");
        toast.info("You can support by donating :)");
      } catch (error) {
        setTxSendingInProgress(false);
        toast.error("Something went wrong! Please check your file!");
        return;
      }
    } catch (error) {
      toast.error(error.message);
      setTxSendingInProgress(false);
    }
  };

  return (
    <div className="mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 mx-auto text-white">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      <p className="text-center text-lg text-pink-200 mt-2">
        <a
          className="hover:text-pink-400 transition"
          href="https://loafpickle.medium.com/evil-tools-batch-asset-add-f5aa28db2fc7"
          target="_blank"
          rel="noopener noreferrer"
        >
          INSTRUCTIONS
          <br /> (Click here)
        </a>
        <p className="text-sm mt-1 -mb-1 text-gray-400">
          ⚠️ ⚠️ ⚠️ ⚠️ <br />
          You can not opt-out of assets that you created.
          <br />
          <span className="text-secondary-green font-semibold">WARNING: Opting out of assets with a balance greater than 0 will send the asset back to the creator wallet and opt you out!</span>
        </p>
      </p>
      <SelectNetworkComponent />
      <p>1- Connect Opt-out Wallet</p>
      <ConnectButton />
      <p>2- Upload CSV file</p>
      {csvData == null ? (
        <label
          htmlFor="dropzone-file"
          className="flex flex-col justify-center items-center w-[16rem] h-[8rem] px-4  rounded-lg border-2  border-dashed cursor-pointer hover:bg-bray-800 bg-gray-700  border-gray-600 hover:border-gray-500 hover:bg-gray-600"
        >
          <div className="flex flex-col justify-center items-center pt-5 pb-6">
            <p className="mb-1 text-sm text-gray-400 font-bold">
              Click to upload file
            </p>
            <p className="text-xs text-gray-400">(CSV)</p>
          </div>
          <input
            className="hidden"
            id="dropzone-file"
            type="file"
            accept=".csv"
            onChange={(e) => {
              const file = e.target.files[0];
              Papa.parse(file, {
                complete: function (results) {
                  const filteredData = results.data.filter(
                    (row) => row[0].length > 1
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
              <p className="pt-4 text-green-500 animate-pulse text-sm">
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
                {csvData.length - 1} assets found!
              </p>
              <p>3- Sign Your Transactions</p>
              {!txSendingInProgress ? (
                <button
                  id="approve-send"
                  className="mb-2 bg-green-500 hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
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
