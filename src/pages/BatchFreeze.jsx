import { useState } from "react";
import Papa from "papaparse";
import ConnectButton from "../components/ConnectButton";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import { createFreezeTransactions, getNodeURL } from "../utils";
import { TOOLS } from "../constants";
import { AiOutlineInfoCircle } from "react-icons/ai";

export function BatchFreeze() {
  const [csvData, setCsvData] = useState(null);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [mnemonic, setMnemonic] = useState("");

  const handleFileData = async () => {
    if (
      localStorage.getItem("wallet") === null ||
      localStorage.getItem("wallet") === undefined
    ) {
      toast.error("Wallet not found!");
      return;
    }
    let headers;
    let data = [];
    for (let i = 0; i < csvData.length; i++) {
      if (csvData[i].length === 1) continue;
      if (i === 0) {
        headers = csvData[i];
      } else {
        let obj = {};
        for (let j = 0; j < headers.length; j++) {
          obj[headers[j]] = csvData[i][j];
        }
        data.push(obj);
      }
    }
    try {
      const nodeURL = getNodeURL();
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });
      try {
        if (mnemonic === "") toast.info("Please sign the transactions!");
        const signedTransactions = await createFreezeTransactions(
          data,
          nodeURL,
          mnemonic
        );
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
          } catch (error) {
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
      } catch (error) {
        setTxSendingInProgress(false);
        toast.error("Something went wrong!");
        return;
      }
    } catch (error) {
      toast.error(error.message);
      setTxSendingInProgress(false);
    }
  };

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      <button className="text-center text-lg text-pink-200 mt-2 bg-pink-700 px-4 py-2 rounded">
        <a
          className="hover:text-pink-400 transition"
          href="https://docs.google.com/spreadsheets/d/1RAJ_9GZfYQmqIYMVHAxwfTim8fiWTi7E5TGnWQlrKC8/edit?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
        >
          CSV Template
        </a>
      </button>
      <button className="text-center text-lg text-pink-200 mt-2 bg-pink-700 px-4 py-2 rounded">
        <a
          className="hover:text-pink-400 transition"
          href="https://loafpickle.medium.com/evil-tools-mass-freeze-and-clawback-1e4c677fc574"
          target="_blank"
          rel="noopener noreferrer"
        >
          How to Guide
        </a>
      </button>
      <SelectNetworkComponent />
      <span className="text-center text-yellow-400">
        Pera doesn't support freeze transactions.
        <br />
        You can use Defly or mnemonic.
      </span>
      <p>1- Connect Sender Wallet</p>
      <ConnectButton />
      {/* mnemonic */}
      <div class="container">
        <h2>Infinity Mode for 65+ Transactions</h2>
        <button type="button" class="btn btn-info" data-toggle="collapse" data-target="infinity">Open Infinity Mode</button>
        <div id="infinity" class="collapse">
            Evil Tools does not store any information on the website. As
            precautions, you can use burner wallets, rekey to a burner wallet
            and rekey back, or rekey after using.
        <input
          type="text"
          placeholder="25-words mnemonics"
          className="bg-black/40 text-white border-2 border-black rounded-lg p-2 mt-1 w-64 text-sm mx-auto placeholder:text-center placeholder:text-white/70 placeholder:text-sm"
          value={mnemonic}
          onChange={(e) => {
            setMnemonic(e.target.value.replace(/,/g, " "));
          }}
        />
        </div>  
      </div>
      {/* end mnemonic */}
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
                {csvData.length - 1} transactions found!
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
