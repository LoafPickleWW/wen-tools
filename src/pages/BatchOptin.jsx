import { useState, useEffect } from "react";
//import Papa from "papaparse";
import ConnectButton from "../components/ConnectButton";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import { createAssetOptInTransactions, getNodeURL } from "../utils";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import { TOOLS } from "../constants";
import { AiOutlineInfoCircle } from "react-icons/ai";
import {useSearchParams} from "react-router-dom";

export function BatchOptin() {
  const [csvData, setCsvData] = useState(null);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [assetIds, setAssetIds] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.has("ids")) {
        setAssetIds(searchParams.get("ids"));
    }
  }, [searchParams]);

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
        if (mnemonic === "") toast.info("Please sign the transactions!");
        const signedTransactions = await createAssetOptInTransactions(
          assets,
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
          await new Promise((resolve) => setTimeout(resolve, 150));
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
      <SelectNetworkComponent />
      <p>1- Connect Opt In Wallet</p>
      <ConnectButton />
      {/* mnemonic */}
      <div className="flex flex-col items-center rounded bg-primary-green py-2 px-3 text-sm text-black">
        <span>Infinity Mode (optional)</span>
        <div className="has-tooltip my-2">
          <span className="tooltip rounded shadow-lg p-1 bg-gray-100 text-red-500 -mt-8 max-w-xl">
            Evil Tools does not store any information on the website. As
            precautions, you can use burner wallets, rekey to a burner wallet
            and rekey back, or rekey after using.
          </span>
          <AiOutlineInfoCircle />
        </div>
        <input
          type="text"
          placeholder="25-words mnemonics"
          className="bg-black/40 text-white border-2 border-black rounded-lg p-2 mt-1 w-64 text-sm mx-auto placeholder:text-center placeholder:text-white/70 placeholder:text-sm"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
        />
        <span className="text-xs mt-2 text-black">
          Infinity Mode allows for no restrictions <br />
          to the amount of transactions per upload.
        </span>
      </div>
      {/* end mnemonic */}
      <p>2- Enter Assets</p>
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
                className="mb-2 bg-green-500 hover:bg-green-700 text-black text-sm font-semibold rounded py-1 w-fit px-4 mx-auto mt-1 hover:scale-95 duration-700"
                onClick={() => {
                  // split with comma or newline
                  let splittedAssetIds = assetIds.split(/[\n,]/);
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
      <button
        id="copy-link"
        className="mb-2 bg-green-500 hover:bg-green-700 text-black text-sm font-semibold rounded py-1 w-fit px-4 mx-auto mt-1 hover:scale-95 duration-700"
        onClick={() => {
          navigator.clipboard.writeText(window.location.href.split("?")[0] + "?ids=" + assetIds.replaceAll("\n", ","));
          toast.success("Link copied!");
        }}
        >
        Copy link 🔗
      </button>
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
    </div>
  );
}
