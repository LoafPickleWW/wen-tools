import { useState } from "react";
import Papa from "papaparse";
import ConnectButton from "../components/ConnectButton";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import { TOOLS, createAssetMintArray, sliceIntoChunks } from "../utils";
import SelectNetworkComponent from "../components/SelectNetworkComponent";

export function BatchCollectionMint(props) {
  const [csvData, setCsvData] = useState(null);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);

  const handleFileData = async () => {
    let headers;
    let data = [];
    for (let i = 0; i < csvData.length; i++) {
      if (csvData[i].length === 1) continue;
      if (i === 0) {
        headers = csvData[i];
      } else {
        let obj = {};
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
    const wallet = localStorage.getItem("wallet");
    if (wallet === null || wallet === undefined) {
      toast.error("Please connect your wallet first!");
      return;
    }
    const resp = await fetch(
      `https://mainnet-api.algonode.cloud/v2/accounts/${wallet}?exclude=all`
    ).then((res) => res.json());
    const min_balance = resp.amount - resp["min-balance"] / 10 ** 6;
    if (min_balance < (0.1 + 0.1 + 0.001) * data.length) {
      toast.error("You don't have enough balance to mint these assets!");
      return;
    }
    let data_for_txns = [];
    data.forEach((item) => {
      let asset_note = {
        standard: "arc69",
        external_url: item.external_url,
        mime_type: item.mime_type,
        description: item.description,
        properties: {},
      };
      Object.keys(asset_note).forEach((key) => {
        if (asset_note[key] === "") {
          delete asset_note[key];
        }
      });
      Object.keys(item).forEach((key) => {
        if (key.startsWith("property_")) {
          asset_note.properties[key.replace("property_", "")] = item[key];
        }
      });
      const asset_name = item.name;
      const unit_name = item.unit_name;
      const has_clawback = item.has_clawback;
      const has_freeze = item.has_freeze;
      const decimals = item.decimals;
      const total_supply = item.total_supply;
      const asset_url = item.url;
      if (asset_url.length > 96) {
        toast.error(
          `Asset URL cannot be longer than 96 characters, too long for ${asset_name}`
        );
        return;
      }
      if (asset_name.length > 32) {
        toast.error(
          `Asset name cannot be longer than 32 characters, too long for ${asset_name}`
        );
        return;
      }
      if (unit_name.length > 8) {
        toast.error(
          `Unit name cannot be longer than 8 characters, too long for ${asset_name}`
        );
        return;
      }
      if (decimals > 19) {
        toast.error(
          `Decimals cannot be more than 19, too many for ${asset_name}`
        );
        return;
      }
      const transaction_data = {
        asset_name,
        unit_name,
        has_clawback,
        has_freeze,
        decimals,
        asset_url,
        total_supply,
        asset_note,
      };
      data_for_txns.push(transaction_data);
    });
    if (
      localStorage.getItem("wallet") === null ||
      localStorage.getItem("wallet") === undefined
    ) {
      toast.error("You must connect your wallet first");
      return;
    }
    try {
      toast.info("Please sign the transactions!");
      const nodeURL =
        localStorage.getItem("networkType") == "mainnet"
          ? "https://node.algoexplorerapi.io/"
          : "https://node.testnet.algoexplorerapi.io/";
      const signedTransactions = await createAssetMintArray(
        data_for_txns,
        nodeURL
      );
      const groups = sliceIntoChunks(signedTransactions, 2);
      setTxSendingInProgress(true);
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });
      for (let i = 0; i < groups.length; i++) {
        //toast.info(`Sending group ${i + 1} of ${groups.length}`);
        const { txId } = await algodClient.sendRawTransaction(groups[i]).do();
        await algosdk.waitForConfirmation(algodClient, txId, 3);
        toast.success(`Transaction ${i + 1} of ${groups.length} confirmed!`, {
          autoClose: 1000,
        });
      }
      setIsTransactionsFinished(true);
      setTxSendingInProgress(false);
      toast.success("All transactions confirmed!");
      toast.info("You can support by donating :)");
    } catch (error) {
      toast.error(error.message);
      setTxSendingInProgress(false);
    }
  };

  return (
    <div className="mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 mx-auto text-white">
      <p className="text-2xl font-bold mt-1">{TOOLS.find((tool) => tool.path ===  window.location.pathname).label}</p>
      <SelectNetworkComponent/>
      <p>1- Connect Creator Wallet</p>
      <ConnectButton />
      <p className="text-center text-lg text-red-200 hover:underline">
        <a
          className="hover:text-pink-400 transition"
          href="https://loafpickle.medium.com/evil-tools-mass-mint-tool-d06b8fc054b1"
          target="_blank"
          rel="noopener noreferrer"
        >
          ⚠️ CHECK DOCS BEFORE USING ⚠️
        </a>
      </p>
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
            <p className="text-xs text-gray-300">
              To be sure there is no empty row at the end of the file
            </p>
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
              <p className="mb-1 text-sm text-slate-300 font-bold rounded-lg border-2 py-6 px-4 border-dashed border-slate-400">
                File uploaded
              </p>
              <p className="text-sm text-gray-400">
                {csvData.length - 1} assets found!
              </p>
              <p className="text-sm italic py-1">3- Sign Your Transactions</p>
              <p className="text-sm italic py-1 text-slate-200">
                Fee: 0.1A/ASA
              </p>
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
