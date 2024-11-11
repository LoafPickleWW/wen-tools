import algosdk from "algosdk";
import Papa from "papaparse";
import { useState } from "react";
import { toast } from "react-toastify";
import { TOOLS } from "../constants";
import {
  createARC3AssetMintArray,
  sliceIntoChunks,
  SignWithSk,
  walletSign,
} from "../utils";

import InfinityModeComponent from "../components/InfinityModeComponent";
import { useWallet } from "@txnlab/use-wallet-react";

export function ARC3MintTool() {
  const [csvData, setCsvData] = useState(null);
  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [token, setToken] = useState("");
  const [assetTransactions, setAssetTransactions] = useState([]);
  const [mnemonic, setMnemonic] = useState("");
  const { activeAddress, algodClient, transactionSigner } = useWallet();

  const handleFileData = async () => {
    const wallet = activeAddress;
    if (wallet === null || wallet === undefined) {
      toast.error("Please connect your wallet first!");
      return;
    }
    if (token === "") {
      toast.error("Please enter a token!");
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
          if (headers[j].startsWith("metadata_")) {
            obj[headers[j].replace("metadata_", "")] = csvData[i][j];
          } else {
            obj[headers[j]] = csvData[i][j];
          }
        }
        data.push(obj);
      }
    }

    const resp = await algodClient.accountInformation(wallet).do();
    const min_balance = resp.amount - resp["min-balance"] / 10 ** 6;
    if (min_balance < (0.1 + 0.1 + 0.001) * data.length) {
      toast.error("You don't have enough balance to mint these assets!");
      return;
    }

    let data_for_txns = [];
    data.forEach((item) => {
      const asset_name = item.name;
      const unit_name = item.unit_name;
      const has_clawback = item.has_clawback;
      const has_freeze = item.has_freeze;
      const decimals = item.decimals;
      const total_supply = item.total_supply;

      let ipfs_data = {
        name: asset_name,
        standard: "arc3",
        image: item.image_ipfs_cid ? "ipfs://" + item.image_ipfs_cid : "",
        image_mime_type: item.mime_type,
        description: item.description,
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
        if (key.startsWith("property_")) {
          ipfs_data.properties.traits[key.replace("property_", "")] = item[key];
        }
        if (key.startsWith("extra_")) {
          ipfs_data.extra[key.replace("extra_", "")] = item[key];
        }
        if (key.startsWith("filters_")) {
          ipfs_data.properties.filters[key.replace("filters_", "")] = item[key];
        }
      });
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
        total_supply,
        ipfs_data,
      };
      data_for_txns.push(transaction_data);
    });
    try {
      toast.info("Uploading metadata to IPFS...");
      setTxSendingInProgress(true);
      const unsignedAssetTransactions = await createARC3AssetMintArray(
        data_for_txns,
        activeAddress,
        algodClient,
        token
      );
      setAssetTransactions(unsignedAssetTransactions);
      setTxSendingInProgress(false);
      toast.info("Please sign the transactions!");
    } catch (error) {
      toast.error(error.message);
      setTxSendingInProgress(false);
    }
  };

  const sendTransactions = async () => {
    try {
      const wallet = activeAddress;
      if (wallet === null || wallet === undefined) {
        toast.error("Please connect your wallet first!");
        return;
      }
      if (assetTransactions.length === 0) {
        toast.error("Please create transactions first!");
        return;
      }
      setTxSendingInProgress(true);

      let signedAssetTransactions;
      if (mnemonic !== "") {
        if (mnemonic.split(" ").length !== 25)
          throw new Error("Invalid Mnemonic!");
        const { sk } = algosdk.mnemonicToSecretKey(mnemonic);
        signedAssetTransactions = SignWithSk(assetTransactions.flat(), sk);
      } else {
        signedAssetTransactions = await walletSign(
          assetTransactions,
          transactionSigner
        );
      }

      signedAssetTransactions = sliceIntoChunks(signedAssetTransactions, 2);

      for (let i = 0; i < signedAssetTransactions.length; i++) {
        try {
          await algodClient.sendRawTransaction(signedAssetTransactions[i]).do();
          if (i % 5 === 0) {
            toast.success(
              `Transaction ${i + 1} of ${
                signedAssetTransactions.length / 2
              } confirmed!`,
              {
                autoClose: 1000,
              }
            );
          }
        } catch (error) {
          toast.error(
            `Transaction ${i + 1} of ${
              signedAssetTransactions.length / 2
            } failed!`,
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
      toast.error(error.message);
      setTxSendingInProgress(false);
    }
  };

  return (
    <div className="mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 mx-auto text-white min-h-screen">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      {/* mnemonic */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      {/* end mnemonic */}
      <button className="text-center text-lg text-black mt-2 bg-primary-orange px-4 py-2 rounded">
        <a
          className="hover:text-black transition"
          href="https://loafpickle.medium.com/mass-arc3-19-mint-tool-742b2a595a60"
          target="_blank"
          rel="noopener noreferrer"
        >
          Check Guide Here
        </a>
      </button>
      <button className="text-center text-lg text-black mt-2 bg-primary-orange px-4 py-2 rounded">
        <a
          className="hover:text-black transition"
          href="https://docs.google.com/spreadsheets/d/1rN4QEcuiXhsh7j6AsAoAe530pdsl2HW0QBHrbIwC6p8/edit?usp=sharing"
          target="_blank"
          rel="noopener noreferrer"
        >
          CSV Template
        </a>
      </button>
      <p>Enter Pinata JWT</p>
      <input
        type="text"
        id="ipfs-token"
        placeholder="token"
        className="text-center bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-2 mb-2 w-48 mx-auto placeholder:text-center placeholder:text-sm"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <p className="text-xs text-slate-400 font-roboto -mt-2 mb-2">
        you can get your token{" "}
        <a
          href="https://knowledge.pinata.cloud/en/articles/6191471-how-to-create-an-pinata-api-key"
          target="_blank"
          className="text-primary-orange/70 hover:text-secondary-orange/80 transition"
          rel="noreferrer"
        >
          here
        </a>
      </p>
      <p>3- Upload CSV file</p>
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
              <p className="mb-1 text-sm text-slate-300 font-bold rounded-lg border-2 py-6 px-4 border-dashed border-slate-400">
                File uploaded
              </p>
              <p className="text-sm text-gray-400">
                {csvData.length - 1} assets found!
              </p>
              <p className="text-sm italic py-1">
                {assetTransactions.length > 0
                  ? "4- Approve & Send"
                  : "3- Create Transactions"}
              </p>
              {!txSendingInProgress ? (
                <button
                  id="approve-send"
                  className="mb-2 bg-primary-orange hover:bg-green-700 text-black text-base font-semibold rounded py-2 w-fit px-2 mx-auto mt-1 hover:scale-95 duration-700"
                  onClick={
                    assetTransactions.length > 0
                      ? sendTransactions
                      : handleFileData
                  }
                >
                  {assetTransactions.length > 0
                    ? "Approve & Send"
                    : "Create Transactions"}
                </button>
              ) : (
                <div className="mx-auto flex flex-col">
                  <div
                    className="spinner-border animate-spin inline-block mx-auto w-8 h-8 border-4 rounded-full"
                    role="status"
                  ></div>
                  Please wait...{" "}
                  {assetTransactions.length > 0
                    ? "Sending transactions to network.."
                    : "Creating transactions..."}
                </div>
              )}
            </>
          )}
          <p className="text-sm italic py-1 text-slate-200">Fee: Free</p>
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
