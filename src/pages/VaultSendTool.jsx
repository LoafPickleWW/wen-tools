import { useState } from "react";
import ConnectButton from "../components/ConnectButton";
import SelectNetworkComponent from "../components/SelectNetworkComponent";
import algosdk from "algosdk";
import { toast } from "react-toastify";
import {
  getNfdomainAPIURL,
  getNodeURL,
  signNfdVaultTransactions,
} from "../utils";
import { TOOLS } from "../constants";
import { AiOutlineInfoCircle } from "react-icons/ai";
import axios from "axios";

export function VaultSendTool() {
  const TOOL_TYPES = [
    {
      label: "Send to All Segments of Domain",
      value: "segments",
    },
    {
      label: "Send to Individual Domains",
      value: "domains",
    },
  ];

  const START_PROCESS = 0;
  const FETCH_SEGMENTS_PROCESS = 1;
  const CREATE_TRANSACTIONS_PROCESS = 2;
  const SIGN_TRANSACTIONS_PROCESS = 3;
  const SENDING_TRANSACTIONS_PROCESS = 4;
  const TRANSACTIONS_COMPLETED_PROCESS = 5;

  const [toolType, setToolType] = useState(TOOL_TYPES[0].value);
  const [domains, setDomains] = useState("");

  const [assetID, setAssetID] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const [transactions, setTransactions] = useState([]);

  const [processStep, setProcessStep] = useState(START_PROCESS);
  const [mnemonic, setMnemonic] = useState("");

  function base64ToByteArray(blob) {
    return stringToByteArray(atob(blob));
  }

  function stringToByteArray(str) {
    const array = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      array[i] = str.charCodeAt(i);
    }
    return array;
  }

  function encodeNFDTransactionsArray(transactionsArray) {
    return transactionsArray.map(([_type, txn]) => {
      return base64ToByteArray(txn);
    });
  }

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

  async function getSegmentsFromDomain(domain) {
    var segments = [];
    const limit = 200;
    var offset = 0;
    const nfdomainApiUrl = getNfdomainAPIURL();
    const domainData = await axios.get(
      `${nfdomainApiUrl}/nfd/${domain}?view=brief&poll=false&nocache=false`
    );
    const appId = domainData.data.appID;
    var result = await axios.get(
      `${nfdomainApiUrl}/nfd/v2/search?parentAppID=${appId}&traits=segment&limit=${limit}&offset=${offset}&sort=nameAsc&view=brief&state=owned&state=reserved`,
      { headers: { "Cache-Control": "max-age=180" } }
    );
    result.data.nfds.forEach((element) => {
      if (parseFloat(element.properties.internal.ver) >= 2.11) {
        segments.push(element.name);
      }
    });
    const total = result.data.total;
    if (total >= 10 && mnemonic === "") {
      throw new Error(`Please enter your mnemonics to continue to process`);
    }
    while (offset < total) {
      offset += limit;
      result = await axios.get(
        `${nfdomainApiUrl}/nfd/v2/search?parentAppID=${appId}&traits=segment&limit=${limit}&offset=${offset}&sort=nameAsc&view=brief&state=owned&state=reserved`,
        { headers: { "Cache-Control": "max-age=180" } }
      );
      result.data.nfds.forEach((element) => {
        if (parseFloat(element.properties.internal.ver) >= 2.11) {
          segments.push(element.name);
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    toast.info(`Found ${segments.length} segments`);
    return segments;
  }

  async function createTransactions() {
    try {
      const wallet = localStorage.getItem("wallet");
      if (!wallet) {
        toast.warning(
          "You need to connect your wallet first, if using mnemonic too!"
        );
        return;
      }

      if (assetID === "") {
        throw new Error("Please enter asset ID!");
      } else if (amount === "") {
        throw new Error("Please enter amount!");
      } else if (domains.length === 0) {
        throw new Error("Please enter at least one domain!");
      }

      const decimals = await getAssetDecimals(parseInt(assetID));

      var body = {
        amount: amount * 10 ** decimals,
        assets: [parseInt(assetID)],
        note:
          note.trim() ??
          "via Thurstober Digital Studios | " +
            Math.random().toString(36).substring(2),
        optInOnly: false,
        sender: wallet,
      };

      var receiverDomains = [];
      if (toolType === "segments") {
        toast.info(`Fetching segments of ${domains}`);
        setProcessStep(FETCH_SEGMENTS_PROCESS);
        receiverDomains = await getSegmentsFromDomain(domains);
      } else if (toolType === "domains") {
        domains.split(/[\n,]/).forEach((domain) => {
          if (domain.toLowerCase().includes(".algo")) {
            receiverDomains.push(domain.trim().toLowerCase());
          }
        });
      } else {
        throw new Error("Please select a valid tool type!");
      }
      setProcessStep(CREATE_TRANSACTIONS_PROCESS);

      var unsignedTransactions = [];
      toast.info(`Creating transactions for ${receiverDomains.length} domains`);
      var nfdomainApiUrl = getNfdomainAPIURL();
      for (var i = 0; i < receiverDomains.length; i++) {
        try {
          const response = await axios.post(
            `${nfdomainApiUrl}/nfd/vault/sendTo/${receiverDomains[i]}`,
            body
          );
          const transactionsArray = JSON.parse(response.data);
          unsignedTransactions.push(
            encodeNFDTransactionsArray(transactionsArray).map((a) =>
              algosdk.decodeUnsignedTransaction(a)
            )
          );
          if (i % 50 === 0 && i !== 0) {
            toast.info(
              `Created ${i} of ${receiverDomains.length} transactions`
            );
          }
        } catch (error) {
          console.log(
            `${receiverDomains[i]}: ${
              error.response.data.message ?? error.message
            }`
          );
        }
      }
      setTransactions(unsignedTransactions);
      setProcessStep(SIGN_TRANSACTIONS_PROCESS);
    } catch (error) {
      console.error(error);
      toast.error(error.message);
      setProcessStep(START_PROCESS);
    }
  }

  async function sendTransactions() {
    try {
      const wallet = localStorage.getItem("wallet");
      if (!wallet) {
        toast.warning(
          "You need to connect your wallet first, if using mnemonic too!"
        );
        return;
      }

      const nodeURL = getNodeURL();
      if (transactions.length === 0) {
        throw new Error("Please create transactions first!");
      }
      try {
        var signedTransactions = await signNfdVaultTransactions(
          transactions,
          wallet,
          mnemonic
        );
      } catch (error) {
        toast.error(error.message);
      }

      function sliceIntoChunksForDifferentSizes(arr) {
        const res = [];
        var i = 0;
        while (i < arr.length) {
          var decodedTxn = algosdk.decodeSignedTransaction(arr[i]);
          if (decodedTxn.txn.group) {
            res.push([arr[i], arr[i + 1], arr[i + 2]]);
            i += 3;
          } else {
            res.push(arr[i]);
            i += 1;
          }
        }
        return res;
      }
      signedTransactions = sliceIntoChunksForDifferentSizes(signedTransactions);
      const algodClient = new algosdk.Algodv2("", nodeURL, {
        "User-Agent": "evil-tools",
      });
      for (let i = 0; i < signedTransactions.length; i++) {
        try {
          await algodClient.sendRawTransaction(signedTransactions[i]).do();
          if (i % 50 === 0) {
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
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      setProcessStep(TRANSACTIONS_COMPLETED_PROCESS);
      toast.success("All transactions confirmed!");
      toast.info("You can support by donating :)");
    } catch (error) {
      toast.error(error.message);
      setProcessStep(SIGN_TRANSACTIONS_PROCESS);
      console.error(error);
    }
  }

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2">
      <p className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname).label}
      </p>
      <span className="text-base text-slate-300">
        A vault is an Algorand account controlled by an NFD's smart contract
        that can automatically opt-in to assets it receives. Check{" "}
        <a
          className="hover:text-primary-green text-green-500 transition"
          target="_blank"
          rel="noopener noreferrer"
          href="https://api-docs.nf.domains/reference/integrators-guide/using-vaults-2.x+"
        >
          here
        </a>{" "}
        for more details.
      </span>
      <SelectNetworkComponent />
      <p>1- Connect Sender Wallet</p>
      <ConnectButton />
      <div className="flex flex-col items-center rounded bg-primary-green py-2 px-3 text-sm text-black">
        <span>Infinity Mode - Recommended via Escrow</span>
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
      <p>2- Select Tool Type</p>
      <div className="flex flex-col items-center">
        <select
          className="text-base rounded border-gray-300 text-secondary-green transition focus:ring-secondary-green px-2"
          value={toolType}
          onChange={(e) => {
            setToolType(e.target.value);
            setDomains("");
          }}
        >
          {TOOL_TYPES.map((toolType) => (
            <option
              key={toolType.value}
              value={toolType.value}
              className="text-center"
            >
              {toolType.label}
            </option>
          ))}
        </select>
      </div>
      <div className="container flex flex-col pt-2 gap-y-2">
        <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
          <label className="text-xs text-slate-400">Asset ID*</label>
          <input
            type="text"
            className="bg-gray-800 text-white border-2 text-center border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
            style={{ width: "10rem" }}
            value={assetID}
            onChange={(e) => {
              setAssetID(e.target.value);
            }}
          />
        </div>
        {toolType === "domains" ? (
          <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
            <label className="text-xs text-slate-400">NFDomains*</label>
            <textarea
              id="domains"
              placeholder="one per line or comma separated"
              className="bg-gray-800 text-white border-2 border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem", height: "5rem" }}
              value={domains}
              onChange={(e) => {
                setDomains(e.target.value);
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
            <label className="text-xs text-slate-400">NFDomain*</label>
            <input
              id="domains"
              placeholder="ex: orange.algo"
              className="bg-gray-800 text-white border-2 text-center border-gray-700 rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
              style={{ width: "10rem" }}
              value={domains}
              onChange={(e) => {
                setDomains(e.target.value);
              }}
            />
          </div>
        )}
        <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
          <label className="text-xs text-slate-400">Amount Per Wallet*</label>
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
      </div>
      <div className="flex flex-col rounded border-gray-300  dark:border-gray-700">
        <label className="text-xs text-slate-400">Note</label>
        <input
          type="text"
          placeholder="(optional)"
          className="bg-gray-800 text-white border-2 border-gray-700 text-center rounded-lg p-1 text-sm mx-auto placeholder:text-center placeholder:text-sm"
          style={{ width: "10rem" }}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </div>
      <div className="flex flex-col justify-center items-center w-[16rem]">
        {processStep === TRANSACTIONS_COMPLETED_PROCESS ? (
          <>
            <p className="pt-4 text-green-500 animate-pulse text-sm">
              All transactions completed!
              <br />
            </p>
            <p className="pb-2 text-slate-400 text-xs">
              You can reload the page if you want to use again.
            </p>
          </>
        ) : processStep === SENDING_TRANSACTIONS_PROCESS ? (
          <>
            <p className="pt-4 text-green-500 animate-pulse text-sm">
              Sending transactions...
            </p>
          </>
        ) : processStep === SIGN_TRANSACTIONS_PROCESS ? (
          <>
            <p className="mt-1 text-slate-200/60 text-sm">
              Transactions created! There is {transactions.length} receivers.
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
        ) : processStep === CREATE_TRANSACTIONS_PROCESS ? (
          <>
            <p className="pt-4 text-green-500 animate-pulse text-sm">
              Creating transactions...
              <br />
            </p>
            <p className="pb-2 text-slate-400 text-xs">
              This may take a while, please wait.
            </p>
          </>
        ) : processStep === FETCH_SEGMENTS_PROCESS ? (
          <>
            <p className="pt-4 text-green-500 animate-pulse text-sm">
              Fetching segments of {domains}..
              <br />
            </p>
            <p className="pb-2 text-slate-400 text-xs">
              This may take a while, please wait.
            </p>
          </>
        ) : (
          <>
            {" "}
            <button
              id="create_transactions_id"
              className="mb-2 bg-green-500 hover:bg-green-700 text-black text-sm font-semibold rounded py-2 w-fit px-4 mx-auto mt-1 duration-700"
              onClick={() => {
                createTransactions();
              }}
            >
              Create Transactions
            </button>
            <span className="text-xs font-bold mt-2 text-slate-400">
              Use Infinity Mode when sending more than 10 receivers.
            </span>
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
