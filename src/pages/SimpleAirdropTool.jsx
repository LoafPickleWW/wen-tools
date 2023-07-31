import { useState } from "react";
import ConnectButton from "../components/ConnectButton";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import {
  createAirdropTransactions,
  getCreatedAssets,
  getOwnerAddressOfAsset,
  getNodeURL,
  isWalletHolder,
} from "../utils";
import { TOOLS } from "../constants";
import { AiOutlineInfoCircle } from "react-icons/ai";

export function SimpleAirdropTool() {
  const [creatorWallets, setCreatorWallets] = useState("");
  const [prefixes, setPrefixes] = useState("");
  const [assetID, setAssetID] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const [assetCount, setAssetCount] = useState(0);
  const [foundAssetCount, setFoundAssetCount] = useState(0);

  const [transactions, setTransactions] = useState([]);

  const [processStep, setProcessStep] = useState(0);
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

  async function createTransactions() {
    try {
      const wallet = localStorage.getItem("wallet");
      if (wallet === "" || wallet === undefined) {
        throw new Error(
          "You need to connect your wallet first, if using mnemonic too!"
        );
      }

      if (creatorWallets === "") {
        throw new Error("Please enter creator wallet(s)!");
      }
      if (assetID === "") {
        throw new Error("Please enter asset ID!");
      }
      if (amount === "") {
        throw new Error("Please enter amount!");
      }
      const isHolder = await isWalletHolder(wallet);
      if (!isHolder) {
        throw new Error(
          "This tool is a PREMIUM tool, you need to be a holder!"
        );
      }
      setProcessStep(1);

      let splittedCreatorWallets;
      let splittedPrefixes;

      splittedCreatorWallets = creatorWallets.split(/[\n,]/);
      splittedCreatorWallets = splittedCreatorWallets.filter(
        (wallet) => wallet !== ""
      );
      splittedPrefixes = prefixes.split(/[\n,]/);
      splittedPrefixes = splittedPrefixes.filter((prefix) => prefix !== "");

      splittedCreatorWallets = [...new Set(splittedCreatorWallets)];
      splittedCreatorWallets = splittedCreatorWallets.map((wallet) =>
        wallet.trim()
      );
      splittedPrefixes = [...new Set(splittedPrefixes)];
      splittedPrefixes = splittedPrefixes.map((prefix) => prefix.trim());


      let createdAssets = [];
      for (let i = 0; i < splittedCreatorWallets.length; i++) {
        createdAssets = createdAssets.concat(
          await getCreatedAssets(splittedCreatorWallets[i])
        );
      }

      if (splittedPrefixes.length !== 0) {
        createdAssets = createdAssets.filter((asset) =>
          splittedPrefixes.some((prefix) => asset.unit_name.startsWith(prefix))
        );
      }
      setAssetCount(createdAssets.length);
      let holders = {};
      for (let i = 0; i < createdAssets.length; i++) {
        const holder = await getOwnerAddressOfAsset(createdAssets[i].asset_id);
        if (holders[holder] === undefined) {
          holders[holder] = 0;
        }
        holders[holder] += 1;
        await new Promise((r) => setTimeout(r, 50));
        setFoundAssetCount(i);
      }
      let txns = [];
      for (const holder in holders) {
        const txn = {
          asset_id: parseInt(assetID),
          amount: parseInt(amount) * holders[holder],
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
    } catch (error) {
      toast.error(error.message);
      setProcessStep(0);
    }
  }

  async function sendTransactions() {
    try {
      const nodeURL = getNodeURL();
      if (assetID === "") {
        throw new Error("Please enter asset ID!");
      }
      if (transactions.length === 0) {
        throw new Error("Please create transactions first!");
      }
      let assetDecimals = {};
      if (parseInt(assetID) === 1) {
        assetDecimals[assetID] = 6;
      } else {
        assetDecimals[assetID] = await getAssetDecimals(assetID);
      }
      const signedTransactions = await createAirdropTransactions(
        transactions,
        nodeURL,
        assetDecimals,
        mnemonic
      );
      if (signedTransactions.length === 0) {
        throw new Error("Something went wrong while signing transactions!");
      }
      setProcessStep(3);
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });
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
      setProcessStep(4);
      toast.success("All transactions confirmed!");
      toast.info("You can support by donating :)");
    } catch (error) {
      toast.error(error.message);
      setProcessStep(2);
    }
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      <label className="text-xs text-slate-400">
        <p className="text-sm italic text-slate-400">
          If you have any{" "}
          <a
            href="https://www.nftexplorer.app/collections?q=thurstober"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-slate-300 transition"
          >
            ASA from Thurstober Digital Studios
          </a>
          , you can use this tool.
        </p>
      </label>
      <button className="text-center text-lg text-pink-200 mt-2 bg-pink-700 px-4 py-2 rounded">
        <a
          className="hover:text-pink-400 transition"
          href="https://loafpickle.medium.com/evil-tools-custom-mass-airdrop-3d5902dd1c94"
          target="_blank"
          rel="noopener noreferrer"
        >
          INSTRUCTIONS
        </a>
      </button>
      <SelectNetworkComponent />
      <p>1- Connect Sender Wallet</p>
      <ConnectButton />
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
          onChange={(e) => {
            setMnemonic(e.target.value.replace(/,/g, " "));
          }}
        />
        <span className="text-xs mt-2 text-black">
          Infinity Mode allows for no restrictions <br />
          to the amount of transactions per upload.
        </span>
      </div>
      <div className="container flex flex-col pt-2 gap-y-2">
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
        <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
          <label className="text-xs text-slate-400">Amount*</label>
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
          <label className="text-xs text-slate-400">Asset ID*</label>
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
        <label className="text-xs text-slate-400">
          Note
        </label>
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
        {processStep === 4 ? (
          <>
            <p className="pt-4 text-green-500 animate-pulse text-sm">
              All transactions completed!
              <br />
            </p>
            <p className="pb-2 text-slate-400 text-xs">
              You can reload the page if you want to use again.
            </p>
          </>
        ) : processStep === 3 ? (
          <>
            <p className="pt-4 text-green-500 animate-pulse text-sm">
              Sending transactions...
            </p>
          </>
        ) : processStep === 2 ? (
          <>
            <p className="mt-1 text-slate-200/60 text-sm">
              Transactions created!
            </p>
            <button
              id="create_transactions_id"
              className="mb-2 bg-green-500 hover:bg-green-700 text-black text-sm font-semibold rounded py-2 w-fit px-4 mx-auto mt-1 duration-700"
              onClick={() => {
                sendTransactions();
              }}
            >
              Sign & Send
            </button>
          </>
        ) : processStep === 1 ? (
          <>
            <p className="pt-4 text-green-500 animate-pulse text-sm">
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
          <button
            id="create_transactions_id"
            className="mb-2 bg-green-500 hover:bg-green-700 text-black text-sm font-semibold rounded py-2 w-fit px-4 mx-auto mt-1 duration-700"
            onClick={() => {
              createTransactions();
            }}
          >
            Create Transactions
          </button>
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
