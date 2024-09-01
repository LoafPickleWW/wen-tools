import { useState } from "react";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import { createAirdropTransactions, getNodeURL } from "../utils";
import { TOOLS } from "../constants";

import InfinityModeComponent from "../components/InfinityModeComponent";
import FaqSectionComponent from "../components/FaqSectionComponent";

export function SimpleSendTool() {
  const TOOL_TYPES = [
    {
      label: "One Asset, Multiple Receivers",
      value: "oneAssetMultipleReceivers",
    },
    {
      label: "Multiple Assets, One Receiver",
      value: "multipleAssetsOneReceiver",
    },
  ];
  const [toolType, setToolType] = useState(TOOL_TYPES[0].value);
  const [assets, setAssets] = useState([]);
  const [receivers, setReceivers] = useState([]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const [isTransactionsFinished, setIsTransactionsFinished] = useState(false);
  const [txSendingInProgress, setTxSendingInProgress] = useState(false);
  const [mnemonic, setMnemonic] = useState("");

  async function getAssetDecimals(assetId) {
    try {
      const nodeURL = getNodeURL();
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });
      const assetInfo = await algodClient.getAssetByID(assetId).do();
      return assetInfo.params.decimals;
    } catch (error) {
      toast.error(
        "Something went wrong! Please check your form and network type."
      );
    }
  }

  async function handleNext() {
    const wallet = localStorage.getItem("wallet");
    if (wallet === "" || wallet === undefined) {
      throw new Error(
        "You need to connect your wallet first, if using mnemonic too!"
      );
    }
    let splittedAssetIds;
    let splittedReceivers;
    let transaction_data = [];
    let assetDecimals = {};
    if (toolType === "multipleAssetsOneReceiver") {
      splittedAssetIds = assets.split(/[\n,]/);
      splittedAssetIds = splittedAssetIds.filter((assetId) => assetId !== "");
      for (let i = 0; i < splittedAssetIds.length; i++) {
        splittedAssetIds[i] = splittedAssetIds[i].trim();
      }
      for (let i = 0; i < splittedAssetIds.length; i++) {
        splittedAssetIds[i] = parseInt(splittedAssetIds[i]);
        if (splittedAssetIds[i] === 1) continue;
        assetDecimals[splittedAssetIds[i]] = await getAssetDecimals(
          splittedAssetIds[i]
        );
      }
      for (let i = 0; i < splittedAssetIds.length; i++) {
        transaction_data.push({
          asset_id: splittedAssetIds[i],
          receiver: receivers.trim().slice(0, 58),
          amount: amount,
        });
      }
    } else if (toolType === "oneAssetMultipleReceivers") {
      toast.info("Transactions are creating...");
      splittedAssetIds = parseInt(assets);
      if (splittedAssetIds !== 1) {
        assetDecimals[splittedAssetIds] = await getAssetDecimals(
          splittedAssetIds
        );
      }
      splittedReceivers = receivers.split(/[\n,]/);
      splittedReceivers = splittedReceivers.filter(
        (receiver) => receiver !== ""
      );
      for (let j = 0; j < splittedReceivers.length; j++) {
        splittedReceivers[j] = splittedReceivers[j].trim();
      }
      for (let i = 0; i < splittedReceivers.length; i++) {
        transaction_data.push({
          asset_id: splittedAssetIds,
          receiver: splittedReceivers[i],
          amount: amount,
        });
      }
    }
    if (note !== "") {
      for (let i = 0; i < transaction_data.length; i++) {
        transaction_data[i].note = note;
      }
    }
    try {
      const nodeURL = getNodeURL();
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });
      try {
        if (mnemonic === "") toast.info("Please sign the transactions!");
        const signedTransactions = await createAirdropTransactions(
          transaction_data,
          nodeURL,
          assetDecimals,
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
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        setIsTransactionsFinished(true);
        setTxSendingInProgress(false);
        toast.success("All transactions confirmed!");
        toast.info("You can support by donating :)");
      } catch (error) {
        setTxSendingInProgress(false);
        toast.error("Something went wrong! Please check your form!");
        return;
      }
    } catch (error) {
      toast.error(error.message);
      setTxSendingInProgress(false);
    }
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 min-h-screen">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      {/* mnemonic */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      {/* end mnemonic */}
      <p>2- Select Tool Type</p>
      <div className="flex flex-col items-center">
        <select
          className="text-base rounded border-gray-300 text-secondary-black transition focus:ring-secondary-orange px-2"
          value={toolType}
          onChange={(e) => {
            setToolType(e.target.value);
            setAssets("");
            setReceivers("");
            setAmount("");
          }}
        >
          {TOOL_TYPES.map((toolType) => (
            <option key={toolType.value} value={toolType.value}>
              {toolType.label}
            </option>
          ))}
        </select>
      </div>
      <div className="container mx-auto grid sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 pt-2 gap-2">
        <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
          <label className="text-xs text-slate-400">Asset ID(s)</label>
          {toolType === "multipleAssetsOneReceiver" ? (
            <textarea
              id="asset_id_list"
              placeholder="Asset IDs, one per line or comma separated"
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem", height: "8rem" }}
              value={assets}
              onChange={(e) => {
                setAssets(e.target.value);
              }}
            />
          ) : (
            <input
              type="text"
              placeholder="Asset ID"
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem" }}
              value={assets}
              onChange={(e) => {
                setAssets(e.target.value);
              }}
            />
          )}
        </div>
        <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
          <label className="text-xs text-slate-400">Receiver Address(es)</label>
          {toolType === "multipleAssetsOneReceiver" ? (
            <input
              type="text"
              placeholder="Receiver Address"
              maxLength={58}
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem" }}
              value={receivers}
              onChange={(e) => {
                setReceivers(e.target.value);
              }}
            />
          ) : (
            <textarea
              id="receiver_address_list"
              placeholder="Receiver Addresses, one per line or comma separated"
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem", height: "8rem" }}
              value={receivers}
              onChange={(e) => {
                setReceivers(e.target.value);
              }}
            />
          )}
        </div>
        <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
          <label className="text-xs text-slate-400">Amount</label>
          <input
            type="number"
            placeholder="Amount"
            className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
            style={{ width: "10rem" }}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            min={0}
          />
        </div>
      </div>
      <input
        type="text"
        placeholder="Note"
        className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
        style={{ width: "10rem" }}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
        }}
      />
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
            {!txSendingInProgress ? (
              <button
                id="approve-send"
                className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-sm font-semibold rounded py-2 w-fit px-4 mx-auto mt-1 hover:scale-95 duration-700"
                onClick={() => handleNext()}
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
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
      <FaqSectionComponent
         faqData={[
           {
             question: "What is Simple Send?",
             answer:
               "Simple Send is a tool that allows you to send an ASA to multiple wallet addresses or send multiple ASAs to a single wallet.",
           },
           {
             question: "How much does it cost to Send?",
             answer:
               "There is a network transaction fee of 0.001A. If you send 1000 Assets, it will cost only 1A.",
           },
           {
             question: "What happens if the person isn't opted in?",
             answer:
               "If the person is not opted in, the transaction will fail. If you want to send to people not opted in, use our Vault Send tool.",
           },
         ]}
       />
    </div>
  );
}
