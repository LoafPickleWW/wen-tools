import { useState } from "react";
//import Papa from "papaparse";
import { toast } from "react-toastify";
import {
  createAssetOptoutTransactions,
  SignWithMnemonic,
  sliceIntoChunks,
  walletSign,
} from "../utils";

import { TOOLS } from "../constants";

import InfinityModeComponent from "../components/InfinityModeComponent";
import { useWallet } from "@txnlab/use-wallet-react";

export function BatchOptout() {
  const [csvData, setCsvData] = useState(null as null | any);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [assetIds, setAssetIds] = useState("");
  const { activeAddress, algodClient, transactionSigner } = useWallet();

  const handleFileData = async () => {
    const assets = [];
    for (let i = 0; i < csvData.length; i++) {
      if (i !== 0) {
        assets.push(parseInt(csvData[i][0]));
      }
    }
    if (assets.length === 0) {
      toast.error("No assets found in the file!");
      return;
    }
    if (activeAddress === null || activeAddress === undefined) {
      toast.error("Wallet not found!");
      return;
    }

    try {
      try {
        if (mnemonic === "") toast.info("Please sign the transactions!");
        const groups = await createAssetOptoutTransactions(
          assets,
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
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        setIsTransactionsFinished(true);
        setTxSendingInProgress(false);
        toast.success("All transactions confirmed!");
        toast.info("You can support by donating :)");
      } catch (err) {
        console.error(err);
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

  return (
    <div className="mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 mx-auto text-white min-h-screen">
      <h1 className="text-2xl font-bold mt-6">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </h1>
      <p className="text-sm mt-1 -mb-1 text-gray-400">
        ⚠️ ⚠️ ⚠️ ⚠️ <br />
        You can not opt-out of assets that you created.
        <br />
        <span className="text-secondary-orange font-semibold">
          WARNING: Opting out of assets with a balance greater than 0 will send
          the asset back to the creator wallet and opt you out!
        </span>
      </p>
      {/* mnemonic */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      {/* end mnemonic */}
      <p>Enter Assets</p>
      {csvData == null ? (
        <div>
          {/* <label
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
          </label> */}
          <div>
            {/*<p className="text-center text-xs text-slate-300 py-1">or</p>*/}
            <div className="flex flex-col items-center">
              <textarea
                id="asset_id_list"
                placeholder="Asset IDs, one per line or comma separated"
                className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
                style={{ width: "10rem", height: "8rem" }}
                value={assetIds}
                onChange={(e) => {
                  setAssetIds(e.target.value);
                }}
              />
              <button
                id="confirm-input"
                className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-sm font-semibold rounded py-1 w-fit px-4 mx-auto mt-1 hover:scale-95 duration-700"
                onClick={() => {
                  // split with comma or newline
                  const splittedAssetIds: any = assetIds.split(/[\n,]/);
                  for (let i = 0; i < splittedAssetIds.length; i++) {
                    splittedAssetIds[i] = [splittedAssetIds[i].trim()];
                  }
                  splittedAssetIds.unshift(["asset_id"]);
                  setCsvData(splittedAssetIds);
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
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
              <p className="text-sm text-gray-400">
                {csvData.length - 1} assets found!
              </p>
              <p>3- Sign Your Transactions</p>
              {!txSendingInProgress ? (
                <button
                  id="approve-send"
                  className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
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
