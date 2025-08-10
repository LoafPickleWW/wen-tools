import { useState } from "react";
import { toast } from "react-toastify";
import {
  createAirdropTransactions,
  getCreatedAssets,
  getOwnerAddressOfAsset,
  getOwnerAddressAmountOfAsset,
  getAssetCreatorWallet,
  SignWithMnemonic,
  walletSign,
  getAssetDecimals,
} from "../utils";
import { TOOLS } from "../constants";

import InfinityModeComponent from "../components/InfinityModeComponent";
import { useWallet } from "@txnlab/use-wallet-react";
import {
  createArc59GroupTxns,
  TxnInfoType,
  convertToCSV,
} from "../arc59-helpers";
import algosdk from "algosdk";

import FileDownloadIcon from "@mui/icons-material/FileDownload";

export function SimpleAirdropTool() {
  const [creatorWallets, setCreatorWallets] = useState("");
  const [prefixes, setPrefixes] = useState("");
  const [specifiedAssetIds, setSpecifiedAssetIds] = useState("");
  const [assetID, setAssetID] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const [assetCount, setAssetCount] = useState(0);
  const [foundAssetCount, setFoundAssetCount] = useState(0);

  const [transactions, setTransactions] = useState([] as any[]);

  const [processStep, setProcessStep] = useState(0);
  const [mnemonic, setMnemonic] = useState("");
  const [assetInbox, setAssetInbox] = useState(false);
  const [assetInboxInfo, setAssetInboxInfo] = useState({} as TxnInfoType);
  const [currentSpendingBalance, setCurrentSpendingBalance] = useState(0);
  const { activeAddress, activeNetwork, algodClient, transactionSigner } =
    useWallet();

  const TOOL_TYPES = [
    {
      label: "Creator Wallet",
      value: "creatorWallet",
    },
    {
      label: "Multi-Mint Asset",
      value: "multiMintAsset",
    },
  ];
  const [toolType, setToolType] = useState(TOOL_TYPES[0].value);

  async function createTransactions() {
    try {
      if (!activeAddress) {
        throw Error(
          "You need to connect your wallet first, if using mnemonic too!"
        );
      }

      if (toolType === "creatorWallet" && creatorWallets === "") {
        throw Error("Please enter creator wallet(s)!");
      }
      if (assetID === "") {
        throw Error("Please enter asset ID!");
      }
      if (amount === "") {
        throw Error("Please enter amount!");
      }
      setProcessStep(1);

      let splittedCreatorWallets;
      let splittedPrefixes;
      let splittedSpecifiedAssetIds: any;

      splittedCreatorWallets = creatorWallets.split(/[\n,]/);
      splittedCreatorWallets = splittedCreatorWallets.filter(
        (wallet) => wallet !== ""
      );
      splittedPrefixes = prefixes.split(/[\n,]/);
      splittedPrefixes = splittedPrefixes.filter((prefix) => prefix !== "");

      splittedCreatorWallets = splittedCreatorWallets.map((wallet) =>
        wallet.trim()
      );
      splittedCreatorWallets = [...new Set(splittedCreatorWallets)];

      splittedPrefixes = splittedPrefixes.map((prefix) => prefix.trim());
      splittedPrefixes = [...new Set(splittedPrefixes)];

      splittedSpecifiedAssetIds = specifiedAssetIds.split(/[\n,]/);
      splittedSpecifiedAssetIds = splittedSpecifiedAssetIds.filter(
        (assetId: string) => assetId !== ""
      );

      try {
        splittedSpecifiedAssetIds = splittedSpecifiedAssetIds.map(
          (assetId: string) => parseInt(assetId.trim())
        );
        console.log("splittedSpecifiedAssetIds " + splittedSpecifiedAssetIds);
      } catch (err) {
        console.error(err);
        toast.error("Please enter valid specified asset IDs!");
        setProcessStep(0);
        return;
      }
      splittedSpecifiedAssetIds = [...new Set(splittedSpecifiedAssetIds)];

      if (toolType === "multiMintAsset") {
        if (splittedSpecifiedAssetIds.length !== 0) {
          splittedCreatorWallets.push(
            await getAssetCreatorWallet(splittedSpecifiedAssetIds, algodClient)
          );
          console.log(
            "multiMintAsset splittedCreatorWallets " + splittedCreatorWallets
          );
        }
      }
      let createdAssets: any[] = [];
      for (let i = 0; i < splittedCreatorWallets.length; i++) {
        console.log("splittedCreatorWallets " + splittedCreatorWallets.length);

        createdAssets = createdAssets.concat(
          await getCreatedAssets(splittedCreatorWallets[i], activeNetwork)
        );
        console.log(
          "splittedCreatorWallets createdAssets" + JSON.stringify(createdAssets)
        );
      }

      if (splittedPrefixes.length !== 0) {
        createdAssets = createdAssets.filter((asset) =>
          splittedPrefixes.some((prefix) => asset.unit_name.startsWith(prefix))
        );
      }

      if (splittedSpecifiedAssetIds.length !== 0) {
        createdAssets = createdAssets.filter((asset) =>
          splittedSpecifiedAssetIds.includes(asset.asset_id)
        );
      }

      if (createdAssets.length === 0) {
        throw Error("No assets found with the specified filters!");
      }

      setAssetCount(createdAssets.length);

      const holders: any = {};

      if (toolType === "creatorWallet") {
        //original
        for (let i = 0; i < createdAssets.length; i++) {
          const holder = await getOwnerAddressOfAsset(
            createdAssets[i].asset_id,
            activeNetwork
          );
          if (holders[holder] === undefined) {
            holders[holder] = 0;
          }
          holders[holder] += 1;
          await new Promise((r) => setTimeout(r, 50));
          setFoundAssetCount(i);
        }
        console.log("holders " + JSON.stringify(holders));
      } else {
        console.log(
          "running getOwnerAddressAmountOfAsset createdAssets.length =>" +
            createdAssets.length
        );
        //multimint
        for (let i = 0; i < createdAssets.length; i++) {
          const holderObj: any = await getOwnerAddressAmountOfAsset(
            createdAssets[i].asset_id,
            activeNetwork
          );
          const currentAssetCount = assetCount + holderObj.data.balances.length;
          setAssetCount(currentAssetCount);
          console.log("in multimint assetCount => " + assetCount);
          for (let i = 0; i < holderObj.data.balances.length; i++) {
            if (
              holderObj.data.balances[i].address === splittedCreatorWallets[0]
            ) {
              continue;
            }
            if (holders[holderObj.data.balances[i].address] === undefined) {
              holders[holderObj.data.balances[i].address] = 0;
            }
            holders[holderObj.data.balances[i].address] +=
              holderObj.data.balances[i].amount;
            await new Promise((r) => setTimeout(r, 50));
            setFoundAssetCount(i);
          }
        }
      }

      console.log("holders => " + JSON.stringify(holders));
      //restart
      const txns = [];
      for (const holder in holders) {
        const txn: any = {
          asset_id: parseInt(assetID),
          amount: Number(amount) * holders[holder],
          receiver: holder,
        };
        if (note !== "") {
          txn.note = note;
        }
        txns.push(txn);
      }
      setTransactions(txns);
      setProcessStep(2);
      if (mnemonic === "") toast.info("Please sign the transactions!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setProcessStep(0);
    }
  }

  async function sendTransactions() {
    setProcessStep(3);
    try {
      if (assetID === "") {
        throw Error("Please enter asset ID!");
      }
      if (transactions.length === 0) {
        throw Error("Please create transactions first!");
      }
      const assetDecimals: any = {};
      if (parseInt(assetID) === 1) {
        assetDecimals[assetID] = 6;
      } else {
        assetDecimals[assetID] = await getAssetDecimals(
          Number(assetID),
          algodClient
        );
      }
      if (!activeAddress) throw Error("Invalid Address");
      const txns = await createAirdropTransactions(
        transactions,
        assetDecimals,
        activeAddress,
        algodClient,
        activeNetwork
      );
      let signedTransactions = [];
      if (mnemonic !== "") {
        signedTransactions = SignWithMnemonic(txns.flat(), mnemonic);
      } else {
        toast.info("Please sign the transactions!");
        signedTransactions = await walletSign(txns, transactionSigner);
      }
      if (signedTransactions.length === 0) {
        throw Error("Something went wrong while signing transactions!");
      }
      setProcessStep(3);
      for (let i = 0; i < signedTransactions.length; i++) {
        try {
          await algodClient.sendRawTransaction(signedTransactions[i]).do();
          if (i % 5 === 0) {
            toast.success(
              `Transaction ${i + 1} of ${signedTransactions.length} confirmed!`,
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
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      setProcessStep(4);
      toast.success("All transactions confirmed!");
      toast.info("You can support by donating :)");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setProcessStep(2);
    }
  }

  async function calculateAssetInboxFees() {
    setProcessStep(5);
    try {
      if (assetID === "") {
        throw Error("Please enter asset ID!");
      }
      if (transactions.length === 0) {
        throw Error("Please create transactions first!");
      }
      const assetDecimals: any = {};
      if (parseInt(assetID) === 1) {
        assetDecimals[assetID] = 6;
      } else {
        assetDecimals[assetID] = await getAssetDecimals(
          Number(assetID),
          algodClient
        );
      }
      if (!activeAddress) throw Error("Invalid Address");
      const txns = await createAirdropTransactions(
        transactions,
        assetDecimals,
        activeAddress,
        algodClient,
        activeNetwork
      );
      let mnemonicSigner = null;
      if (mnemonic !== "") {
        const privateKey = algosdk.mnemonicToSecretKey(mnemonic);
        mnemonicSigner = algosdk.makeBasicAccountTransactionSigner(privateKey);
      }
      const sender = {
        addr: activeAddress,
        signer:
          mnemonic !== "" && mnemonicSigner !== null
            ? mnemonicSigner
            : transactionSigner,
      };
      const txnData: TxnInfoType = await createArc59GroupTxns(
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
      const spendingBalance = accountInfo.amount - accountInfo["min-balance"];
      setCurrentSpendingBalance(spendingBalance);
      setProcessStep(6);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setProcessStep(2);
    }
  }

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

  async function sendAssetInboxTransactions() {
    setProcessStep(3);
    const txnsLength = assetInboxInfo.atomicTxns.length;
    try {
      for (let i = 0; i < assetInboxInfo.atomicTxns.length; i++) {
        try {
          await assetInboxInfo.atomicTxns[i].gatherSignatures();
          const result = await assetInboxInfo.atomicTxns[i].submit(algodClient);
          assetInboxInfo.logDataArray[i].txnID = result.flat().toString();
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
      setProcessStep(7);
      toast.success("All transactions confirmed!");
      toast.info("You can support by donating :)");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setProcessStep(6);
    }
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 min-h-screen">
      <h1 className="text-2xl font-bold mt-6">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </h1>
      <label className="text-xs text-slate-400"></label>
      {/* mnemonic */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      {/* end mnemonic */}
      <p>Select Tool Type</p>
      <div className="flex flex-col items-center">
        <select
          className="text-base rounded border-gray-300 text-secondary-black transition focus:ring-secondary-orange px-2"
          value={toolType}
          onChange={(e) => {
            setToolType(e.target.value);
            setCreatorWallets("");
            setPrefixes("");
            setAssetCount(0);
          }}
        >
          {TOOL_TYPES.map((toolType) => (
            <option key={toolType.value} value={toolType.value}>
              {toolType.label}
            </option>
          ))}
        </select>
      </div>
      <div className="container flex flex-col pt-2 gap-y-2">
        {toolType === "creatorWallet" ? (
          <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
            <label className="text-xs text-slate-400">Creator Wallet(s)*</label>
            <textarea
              id="creator_wallets_id"
              placeholder="one per line or comma separated"
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem", height: "5rem" }}
              value={creatorWallets}
              onChange={(e) => {
                setCreatorWallets(e.target.value);
              }}
            />
          </div>
        ) : (
          <p></p>
        )}
        {toolType === "creatorWallet" ? (
          <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
            <label className="text-xs text-slate-400">
              Unit-name Prefix(es)
            </label>
            <textarea
              id="prefixes_id"
              placeholder="one per line or comma separated (optional)"
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem", height: "5rem" }}
              value={prefixes}
              onChange={(e) => {
                setPrefixes(e.target.value);
              }}
            />
          </div>
        ) : (
          <p></p>
        )}
        {toolType === "creatorWallet" ? (
          <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
            <label className="text-xs text-slate-400">
              Specified Asset ID(s)
            </label>
            <textarea
              id="specified_asset_ids_id"
              placeholder="one per line or comma separated (optional)"
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem", height: "5rem" }}
              value={specifiedAssetIds}
              onChange={(e) => {
                setSpecifiedAssetIds(e.target.value);
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
            <label className="text-xs text-slate-400">
              Specified Multi-Mint Asset ID*
            </label>
            <textarea
              id="specified_asset_ids_id"
              placeholder="Multimint Aasset ID"
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem" }}
              value={specifiedAssetIds}
              onChange={(e) => {
                setSpecifiedAssetIds(e.target.value);
              }}
            />
          </div>
        )}
        <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
          <label className="text-xs text-slate-400">
            Amount per asset held*
          </label>
          <input
            type="number"
            className="bg-gray-800 text-white border-2 text-center border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
            style={{ width: "10rem" }}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            min={0}
          />
        </div>
        <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
          <label className="text-xs text-slate-400">Asset ID Airdropped*</label>
          <input
            type="text"
            className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
            style={{ width: "10rem" }}
            value={assetID}
            onChange={(e) => {
              setAssetID(e.target.value);
            }}
          />
        </div>
      </div>
      <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
        <label className="text-xs text-slate-400">Note</label>
        <input
          type="text"
          placeholder="(optional)"
          className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
          style={{ width: "10rem" }}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </div>
      <div className="flex flex-col justify-center items-center w-[16rem]">
        {processStep === 7 ? (
          <>
            <button
              className="mb-2 text-sm  rounded py-2 w-fit mx-auto flex flex-col items-center"
              onClick={getCSV}
            >
              <FileDownloadIcon />
              <span>Download asset inbox logs</span>
              <span className="text-xs text-gray-400">
                This csv does include transaction ID's
              </span>
            </button>
            <p className="pt-4 text-primary-orange animate-pulse text-sm">
              All transactions completed!
              <br />
            </p>
            <p className="pb-2 text-slate-400 text-xs">
              You can reload the page if you want to use again.
            </p>
          </>
        ) : processStep === 6 ? (
          <div className="flex flex-col justify-start items-center space-y-2">
            {/* <p className="mt-1 text-slate-200/60 text-sm">Fee's Calculated!</p> */}
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
              <span>Download asset inbox logs</span>
              <span className="text-xs text-gray-400">
                This csv does NOT include transaction ID's
              </span>
            </button>
            <button
              id="send_asset_inbox_transactions_id"
              className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-sm font-semibold rounded py-2 w-fit px-4 mx-auto mt-1 duration-700"
              onClick={() => {
                sendAssetInboxTransactions();
              }}
            >
              Sign & Send
            </button>
          </div>
        ) : processStep === 5 ? (
          <>
            <p className="pt-4 text-primary-orange animate-pulse text-sm">
              Calculating fees...
            </p>
          </>
        ) : processStep === 4 ? (
          <>
            <p className="pt-4 text-primary-orange animate-pulse text-sm">
              All transactions completed!
              <br />
            </p>
            <p className="pb-2 text-slate-400 text-xs">
              You can reload the page if you want to use again.
            </p>
          </>
        ) : processStep === 3 ? (
          <>
            <p className="pt-4 text-primary-orange animate-pulse text-sm">
              Sending transactions...
            </p>
          </>
        ) : processStep === 2 ? (
          assetInbox ? (
            <>
              <p className="pt-4 text-primary-orange animate-pulse text-sm">
                Transactions created!
                <br />
              </p>
              <button
                id="create_transactions_id"
                className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-sm font-semibold rounded py-2 w-fit px-4 mx-auto mt-1 duration-700"
                onClick={() => {
                  calculateAssetInboxFees();
                }}
              >
                Calculate Fees
              </button>
            </>
          ) : (
            <>
              <p className="mt-1 text-slate-200/60 text-sm">
                Transactions created!
              </p>
              <button
                id="create_transactions_id"
                className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-sm font-semibold rounded py-2 w-fit px-4 mx-auto mt-1 duration-700"
                onClick={() => {
                  sendTransactions();
                }}
              >
                Sign & Send
              </button>
            </>
          )
        ) : processStep === 1 ? (
          <>
            <p className="pt-4 text-primary-orange animate-pulse text-sm">
              Fetching holders and creating transactions...
              <br />
            </p>
            {foundAssetCount !== 0 && (
              <p className="pb-2 text-slate-400 text-xs">
                Fetched {foundAssetCount + 1}/{assetCount} assets.
              </p>
            )}
            <p className="pb-2 text-slate-400 text-xs">
              This may take a while, please wait.
            </p>
          </>
        ) : (
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
            <button
              id="create_transactions_id"
              className="mb-2 bg-primary-orange hover:bg-primary-orange text-black text-sm font-semibold rounded py-2 w-fit px-4 mx-auto mt-1 duration-700"
              onClick={() => {
                createTransactions();
              }}
            >
              Create Transactions
            </button>
          </>
        )}
      </div>
      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
    </div>
  );
}
