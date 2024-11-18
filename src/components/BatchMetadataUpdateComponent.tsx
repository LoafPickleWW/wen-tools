import { useState } from "react";
import Papa from "papaparse";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import { createAssetConfigArray, sliceIntoChunks, walletSign } from "../utils";
import { useWallet } from "@txnlab/use-wallet-react";

export function BatchCollectionMetadataUpdate() {
  const [csvData, setCsvData] = useState(null as null | any[]);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const { activeAddress, algodClient, transactionSigner } = useWallet();

  const handleFileData = async () => {
    let headers;
    const data = [];
    if (!csvData) throw Error("Invalid CSV");
    for (let i = 0; i < csvData.length; i++) {
      if (csvData[i].length == 1) continue;
      if (i === 0) {
        headers = csvData[i];
      } else {
        const obj: any = {};
        for (let j = 0; j < headers.length; j++) {
          if (headers[j].startsWith("metadata_")) {
            obj[headers[j].replace("metadata_", "")] = csvData[i][j];
          } else {
            obj[headers[j]] = csvData[i][j];
          }
        }
        data.push(obj);
      }
    }
    const data_for_txns = data;
    data_for_txns.forEach((item) => {
      const asset_note: any = {
        properties: {},
      };
      Object.keys(item).forEach((key) => {
        if (
          key != "index" &&
          key != "description" &&
          key != "mime_type" &&
          key != "standard" &&
          key != "external_url"
        ) {
          asset_note.properties[key] = item[key];
          delete item[key];
        }
        if (
          key == "external_url" ||
          key == "standard" ||
          key == "description" ||
          key == "mime_type"
        ) {
          asset_note[key] = item[key];
          delete item[key];
        }
      });
      item.asset_id = parseInt(item.index);
      delete item.index;
      item.note = asset_note;
      if (!item.note.standard) {
        item.note.standard = "arc69";
      }
    });

    if (activeAddress === null || activeAddress === undefined) {
      toast.error("Wallet not found!");
      return;
    }
    try {
      toast.info("Please sign the transactions!");
      const txns = await createAssetConfigArray(
        data_for_txns,
        activeAddress,
        algodClient
      );
      const signedTransactions = await walletSign(txns, transactionSigner);
      const groups = sliceIntoChunks(signedTransactions, 16);
      setTxSendingInProgress(true);
      for (let i = 0; i < groups.length; i++) {
        toast.info(`Sending transaction ${i + 1} of ${groups.length}`);
        const { txId } = await algodClient
          .sendRawTransaction(groups[i].map((txn) => txn.blob))
          .do();
        await algosdk.waitForConfirmation(algodClient, txId, 3);
        toast.success(`Transaction ${i + 1} of ${groups.length} confirmed!`);
      }
      setIsTransactionsFinished(true);
      setTxSendingInProgress(false);
      toast.success("All transactions confirmed!");
      toast.info("You can support by donating :)");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2">
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
                  setCsvData(results.data);
                },
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
                You can reload the page if you want to use another tool.
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
    </div>
  );
}
