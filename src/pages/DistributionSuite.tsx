import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Papa from "papaparse";
import axios from "axios";
import algosdk, { Transaction } from "algosdk";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";

import {
  createAirdropTransactions,
  getAssetDecimals,
  getCreatedAssets,
  getOwnerAddressOfAsset,
  getOwnerAddressAmountOfAsset,
  getAssetCreatorWallet,
  getNfdomainAPIURL,
  SignWithMnemonic,
  SignWithSk,
  walletSign,
} from "../utils";

import {
  createArc59GroupTxns,
  TxnInfoType,
  convertToCSV,
} from "../arc59-helpers";

import InfinityModeComponent from "../components/InfinityModeComponent";
import FaqSectionComponent from "../components/FaqSectionComponent";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

import {
  IoPaperPlane,
  IoCloudUpload,
  IoWallet,
  IoSparkles,
  IoInformationCircle,
  IoWarning,
  IoCloudDownload,
  IoBriefcase,
  IoGlobe,
  IoHelpCircle,
} from "react-icons/io5";

type MainTab = "custom" | "creator-wallet" | "asset-holders" | "vault";

interface DistributionSuiteProps {
  defaultTab?: MainTab;
  defaultSubMode?: "manual" | "csv";
}

export function DistributionSuite({
  defaultTab = "custom",
  defaultSubMode = "manual",
}: DistributionSuiteProps) {
  const [activeTab, setActiveTab] = useState<MainTab>(defaultTab);
  const [searchParams] = useSearchParams();
  const { activeAddress, activeNetwork, algodClient, transactionSigner } =
    useWallet();

  const [mnemonic, setMnemonic] = useState("");

  // =========================================================================
  // TAB 1: CUSTOM LIST STATES (combines Simple Send and Bulk Airdrop)
  // =========================================================================
  const [customSubMode, setCustomSubMode] = useState<"manual" | "csv">(
    defaultSubMode
  );
  
  // Manual Send States
  const MANUAL_TYPES = [
    { label: "One Asset, Multiple Receivers", value: "oneAssetMultipleReceivers" },
    { label: "Multiple Assets, One Receiver", value: "multipleAssetsOneReceiver" },
  ];
  const [manualType, setManualType] = useState(MANUAL_TYPES[0].value);
  const [manualAssets, setManualAssets] = useState("");
  const [manualReceivers, setManualReceivers] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualInbox, setManualInbox] = useState(false);
  const [manualProcessStep, setManualProcessStep] = useState<
    | "INITIAL"
    | "SENDING_TXNS"
    | "TXNS_FINISHED"
    | "SEND_TO_ASSET_INBOX"
    | "SENDING_TO_ASSET_INBOX"
    | "ASSET_INBOX_TXNS_FINISHED"
    | "CALCULATING_FEES"
  >("INITIAL");
  const [manualInboxInfo, setManualInboxInfo] = useState({} as TxnInfoType);
  const [manualSpendingBalance, setManualSpendingBalance] = useState(0);
  const [manualErrMsg, setManualErrMsg] = useState("");

  // CSV Send States
  const [csvData, setCsvData] = useState<any[] | null>(null);
  const [csvInbox, setCsvInbox] = useState(false);
  const [csvInboxInfo, setCsvInboxInfo] = useState({} as TxnInfoType);
  const [csvSpendingBalance, setCsvSpendingBalance] = useState(0);
  const [csvProcessStep, setCsvProcessStep] = useState<
    | "INITIAL"
    | "CSV_UPLOADED"
    | "SENDING_TXNS"
    | "TXNS_FINISHED"
    | "SEND_TO_ASSET_INBOX"
    | "SENDING_TO_ASSET_INBOX"
    | "ASSET_INBOX_TXNS_FINISHED"
    | "CALCULATING_FEES"
  >("INITIAL");

  // =========================================================================
  // TAB 2: CREATOR WALLET STATES
  // =========================================================================
  const [creatorWallets, setCreatorWallets] = useState("");
  const [creatorPrefixes, setCreatorPrefixes] = useState("");
  const [creatorSpecifiedAssetIds, setCreatorSpecifiedAssetIds] = useState("");
  const [creatorAssetID, setCreatorAssetID] = useState("");
  const [creatorAmount, setCreatorAmount] = useState("");
  const [creatorNote, setCreatorNote] = useState("");
  const [creatorAssetCount, setCreatorAssetCount] = useState(0);
  const [creatorFoundAssetCount, setCreatorFoundAssetCount] = useState(0);
  const [creatorTransactions, setCreatorTransactions] = useState<any[]>([]);
  const [creatorProcessStep, setCreatorProcessStep] = useState(0);
  const [creatorInbox, setCreatorInbox] = useState(false);
  const [creatorInboxInfo, setCreatorInboxInfo] = useState({} as TxnInfoType);
  const [creatorSpendingBalance, setCreatorSpendingBalance] = useState(0);

  // =========================================================================
  // TAB 3: SPECIFIC ASSET HOLDERS STATES
  // =========================================================================
  const [holderSpecifiedAssetId, setHolderSpecifiedAssetId] = useState("");
  const [holderAssetID, setHolderAssetID] = useState("");
  const [holderAmount, setHolderAmount] = useState("");
  const [holderNote, setHolderNote] = useState("");
  const [holderAssetCount, setHolderAssetCount] = useState(0);
  const [holderFoundAssetCount, setHolderFoundAssetCount] = useState(0);
  const [holderTransactions, setHolderTransactions] = useState<any[]>([]);
  const [holderProcessStep, setHolderProcessStep] = useState(0);
  const [holderInbox, setHolderInbox] = useState(false);
  const [holderInboxInfo, setHolderInboxInfo] = useState({} as TxnInfoType);
  const [holderSpendingBalance, setHolderSpendingBalance] = useState(0);

  // =========================================================================
  // TAB 4: NFD VAULTS STATES
  // =========================================================================
  const VAULT_TYPES = [
    { label: "Send to All Segments of Domain", value: "segments" },
    { label: "Send to Individual Domains", value: "domains" },
  ];
  const [vaultType, setVaultType] = useState(VAULT_TYPES[0].value);
  const [vaultDomains, setVaultDomains] = useState("");
  const [vaultAssetID, setVaultAssetID] = useState("");
  const [vaultAmount, setVaultAmount] = useState("");
  const [vaultNote, setVaultNote] = useState("");
  const [vaultTransactions, setVaultTransactions] = useState<any[]>([]);
  const [vaultProcessStep, setVaultProcessStep] = useState(0);

  // =========================================================================
  // ROUTING & SEARCH PARAMS SYNC
  // =========================================================================
  useEffect(() => {
    if (searchParams.has("tab")) {
      const tab = searchParams.get("tab") as MainTab;
      if (
        tab === "custom" ||
        tab === "creator-wallet" ||
        tab === "asset-holders" ||
        tab === "vault"
      ) {
        setActiveTab(tab);
      }
    } else if (defaultTab) {
      setActiveTab(defaultTab);
    }

    if (searchParams.has("mode")) {
      const mode = searchParams.get("mode") as "manual" | "csv";
      if (mode === "manual" || mode === "csv") {
        setCustomSubMode(mode);
      }
    } else if (defaultSubMode) {
      setCustomSubMode(defaultSubMode);
    }
  }, [searchParams, defaultTab, defaultSubMode]);

  // Tab change handler
  const handleTabChange = (tab: MainTab) => {
    setActiveTab(tab);
    // Reset steps
    setManualProcessStep("INITIAL");
    setCsvProcessStep("INITIAL");
    setCreatorProcessStep(0);
    setHolderProcessStep(0);
    setVaultProcessStep(0);
    setManualErrMsg("");
  };

  // =========================================================================
  // TAB 1A: MANUAL SEND LOGIC
  // =========================================================================
  async function handleManualNext() {
    if (!activeAddress) {
      toast.error("Please connect your wallet first!");
      return;
    }
    if (!manualAssets || !manualReceivers || !manualAmount) {
      toast.error("Please fill in all required fields!");
      return;
    }

    setManualProcessStep(manualInbox ? "CALCULATING_FEES" : "SENDING_TXNS");
    setManualErrMsg("");

    let splittedAssetIds: any;
    let splittedReceivers;
    const transaction_data: any[] = [];
    const assetDecimals: any = {};

    try {
      if (manualType === "multipleAssetsOneReceiver") {
        splittedAssetIds = manualAssets.split(/[\n,]/).map((id) => id.trim()).filter((id) => id !== "");
        for (let i = 0; i < splittedAssetIds.length; i++) {
          splittedAssetIds[i] = parseInt(splittedAssetIds[i]);
          if (splittedAssetIds[i] === 1) continue;
          assetDecimals[splittedAssetIds[i]] = await getAssetDecimals(
            splittedAssetIds[i],
            algodClient
          );
        }
        for (let i = 0; i < splittedAssetIds.length; i++) {
          transaction_data.push({
            asset_id: splittedAssetIds[i],
            receiver: manualReceivers.trim().slice(0, 58),
            amount: manualAmount,
          });
        }
      } else if (manualType === "oneAssetMultipleReceivers") {
        toast.info("Creating transactions...");
        splittedAssetIds = parseInt(manualAssets);
        if (splittedAssetIds !== 1) {
          assetDecimals[splittedAssetIds] = await getAssetDecimals(
            splittedAssetIds,
            algodClient
          );
        }
        splittedReceivers = manualReceivers.split(/[\n,]/).map((r) => r.trim()).filter((r) => r !== "");
        for (let i = 0; i < splittedReceivers.length; i++) {
          transaction_data.push({
            asset_id: splittedAssetIds,
            receiver: splittedReceivers[i],
            amount: manualAmount,
          });
        }
      }

      if (manualNote !== "") {
        for (let i = 0; i < transaction_data.length; i++) {
          transaction_data[i].note = manualNote;
        }
      }

      if (mnemonic === "") toast.info("Please sign the transactions!");
      
      const txns = await createAirdropTransactions(
        transaction_data,
        assetDecimals,
        activeAddress,
        algodClient,
        activeNetwork
      );

      if (manualInbox) {
        let mnemonicSigner = null;
        if (mnemonic !== "") {
          const privateKey = algosdk.mnemonicToSecretKey(mnemonic);
          mnemonicSigner = algosdk.makeBasicAccountTransactionSigner(privateKey);
        }
        const sender = {
          addr: activeAddress,
          signer: mnemonic !== "" && mnemonicSigner !== null ? mnemonicSigner : transactionSigner,
        };
        const txnData = await createArc59GroupTxns(
          txns,
          sender,
          activeAddress,
          algodClient,
          activeNetwork
        );
        setManualInboxInfo(txnData);

        const accountInfo = await algodClient.accountInformation(activeAddress).do();
        const spendingBalance = accountInfo.amount - accountInfo["min-balance"];
        setManualSpendingBalance(spendingBalance);
        setManualProcessStep("SEND_TO_ASSET_INBOX");
      } else {
        let signedTransactions = [];
        if (mnemonic !== "") {
          signedTransactions = SignWithMnemonic(txns.flat(), mnemonic);
        } else {
          signedTransactions = await walletSign(txns, transactionSigner);
        }

        for (let i = 0; i < signedTransactions.length; i++) {
          try {
            await algodClient.sendRawTransaction(signedTransactions[i]).do();
            if (i % 5 === 0) {
              toast.success(`Transaction ${i + 1} of ${signedTransactions.length} confirmed!`, {
                autoClose: 1000,
              });
            }
          } catch (err) {
            console.error(err);
            toast.error(`Transaction ${i + 1} of ${signedTransactions.length} failed!`);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        setManualProcessStep("TXNS_FINISHED");
        toast.success("All transactions confirmed!");
      }
    } catch (error: any) {
      setManualProcessStep("INITIAL");
      toast.error("Something went wrong! Please check your form.");
      setManualErrMsg(error.message);
      console.error(error);
    }
  }

  const sendManualAssetInboxTxns = async () => {
    setManualProcessStep("SENDING_TO_ASSET_INBOX");
    const txnsLength = manualInboxInfo.atomicTxns.length;
    try {
      for (let i = 0; i < txnsLength; i++) {
        try {
          await manualInboxInfo.atomicTxns[i].gatherSignatures();
          const result = await manualInboxInfo.atomicTxns[i].submit(algodClient);
          manualInboxInfo.logDataArray[i].txnID = result.flat().toString();
          if (i % 5 === 0) {
            toast.success(`Transaction ${i + 1} of ${txnsLength} confirmed!`, {
              autoClose: 1000,
            });
          }
        } catch (err: any) {
          manualInboxInfo.logDataArray[i].txnID = `Failed: ${err.message}`;
          console.error(err);
          toast.error(`Transaction ${i + 1} of ${txnsLength} failed!`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      manualInboxInfo.csv = await convertToCSV(manualInboxInfo.logDataArray);
      setManualProcessStep("ASSET_INBOX_TXNS_FINISHED");
      toast.success("All transactions confirmed!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setManualProcessStep("SEND_TO_ASSET_INBOX");
    }
  };

  const getManualCSV = () => {
    const blob = new Blob([manualInboxInfo.csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = manualProcessStep === "ASSET_INBOX_TXNS_FINISHED" ? "asset_box_data_atxn.csv" : "asset_box_data_btxn.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // =========================================================================
  // TAB 1B: CSV BULK AIRDROP LOGIC
  // =========================================================================
  async function handleCsvFileData() {
    if (!activeAddress) {
      toast.error("Wallet not connected!");
      return;
    }
    if (!csvData || csvData.length <= 1) {
      toast.error("No CSV data loaded!");
      return;
    }

    setCsvProcessStep(csvInbox ? "CALCULATING_FEES" : "SENDING_TXNS");

    let headers;
    const data = [];
    for (let i = 0; i < csvData.length; i++) {
      if (csvData[i].length === 1 && csvData[i][0].length === 0) continue;
      if (i === 0) {
        headers = csvData[i];
      } else {
        const obj: any = {};
        for (let j = 0; j < headers.length; j++) {
          obj[headers[j]] = csvData[i][j];
        }
        data.push(obj);
      }
    }

    const assetIdsMap: any = {};
    for (let i = 0; i < data.length; i++) {
      if (data[i].asset_id) {
        assetIdsMap[data[i].asset_id] = true;
      }
    }
    const assetIds = Object.keys(assetIdsMap);
    const assetDecimals: any = {};
    for (let i = 0; i < assetIds.length; i++) {
      const aid = parseInt(assetIds[i]);
      if (aid === 1) continue;
      assetDecimals[aid] = await getAssetDecimals(aid, algodClient);
    }

    try {
      const txns = await createAirdropTransactions(
        data,
        assetDecimals,
        activeAddress,
        algodClient,
        activeNetwork
      );

      if (csvInbox) {
        let mnemonicSigner = null;
        if (mnemonic !== "") {
          const privateKey = algosdk.mnemonicToSecretKey(mnemonic);
          mnemonicSigner = algosdk.makeBasicAccountTransactionSigner(privateKey);
        }
        const sender = {
          addr: activeAddress,
          signer: mnemonic !== "" && mnemonicSigner !== null ? mnemonicSigner : transactionSigner,
        };
        const txnData = await createArc59GroupTxns(
          txns,
          sender,
          activeAddress,
          algodClient,
          activeNetwork
        );
        setCsvInboxInfo(txnData);

        const accountInfo = await algodClient.accountInformation(activeAddress).do();
        const spendingBalance = accountInfo.amount - accountInfo["min-balance"];
        setCsvSpendingBalance(spendingBalance);
        setCsvProcessStep("SEND_TO_ASSET_INBOX");
      } else {
        let signedTransactions = [];
        if (mnemonic !== "") {
          signedTransactions = SignWithMnemonic(txns.flat(), mnemonic);
        } else {
          toast.info("Please sign the transactions!");
          signedTransactions = await walletSign(txns, transactionSigner);
        }

        for (let i = 0; i < signedTransactions.length; i++) {
          try {
            await algodClient.sendRawTransaction(signedTransactions[i]).do();
            if (i % 5 === 0) {
              toast.success(`Transaction ${i + 1} of ${signedTransactions.length} confirmed!`, {
                autoClose: 1000,
              });
            }
          } catch (err) {
            console.error(err);
            toast.error(`Transaction ${i + 1} of ${signedTransactions.length} failed!`);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        setCsvProcessStep("TXNS_FINISHED");
        toast.success("All transactions confirmed!");
      }
    } catch (error) {
      setCsvProcessStep("INITIAL");
      console.error(error);
      toast.error("Something went wrong! Please check your file formatting.");
    }
  }

  const sendCsvAssetInboxTxns = async () => {
    setCsvProcessStep("SENDING_TO_ASSET_INBOX");
    const txnsLength = csvInboxInfo.atomicTxns.length;
    try {
      for (let i = 0; i < txnsLength; i++) {
        try {
          await csvInboxInfo.atomicTxns[i].gatherSignatures();
          const result = await csvInboxInfo.atomicTxns[i].submit(algodClient);
          csvInboxInfo.logDataArray[i].txnID = result.flat().toString();
          if (i % 5 === 0) {
            toast.success(`Transaction ${i + 1} of ${txnsLength} confirmed!`, {
              autoClose: 1000,
            });
          }
        } catch (err: any) {
          csvInboxInfo.logDataArray[i].txnID = `Failed: ${err.message}`;
          console.error(err);
          toast.error(`Transaction ${i + 1} of ${txnsLength} failed!`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      csvInboxInfo.csv = await convertToCSV(csvInboxInfo.logDataArray);
      setCsvProcessStep("ASSET_INBOX_TXNS_FINISHED");
      toast.success("All transactions confirmed!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setCsvProcessStep("SEND_TO_ASSET_INBOX");
    }
  };

  const getCsvLogs = () => {
    const blob = new Blob([csvInboxInfo.csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "asset_box_data.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // =========================================================================
  // TAB 2: CREATOR WALLET LOGIC
  // =========================================================================
  async function createCreatorTransactions() {
    try {
      if (!activeAddress) {
        throw Error("Please connect your wallet first!");
      }
      if (creatorWallets === "") {
        throw Error("Please enter creator wallet(s)!");
      }
      if (creatorAssetID === "") {
        throw Error("Please enter target asset ID to distribute!");
      }
      if (creatorAmount === "") {
        throw Error("Please enter amount!");
      }

      setCreatorProcessStep(1);

      let splittedCreatorWallets = creatorWallets
        .split(/[\n,]/)
        .map((w) => w.trim())
        .filter((w) => w !== "");
      splittedCreatorWallets = [...new Set(splittedCreatorWallets)];

      let splittedPrefixes = creatorPrefixes
        .split(/[\n,]/)
        .map((p) => p.trim())
        .filter((p) => p !== "");
      splittedPrefixes = [...new Set(splittedPrefixes)];

      const splittedSpecifiedAssetIds = creatorSpecifiedAssetIds
        .split(/[\n,]/)
        .map((id) => id.trim())
        .filter((id) => id !== "");

      let parsedAssetIds: number[] = [];
      try {
        parsedAssetIds = splittedSpecifiedAssetIds.map((id) => parseInt(id));
      } catch {
        throw Error("Please enter valid specified asset IDs!");
      }

      let createdAssets: any[] = [];
      for (let i = 0; i < splittedCreatorWallets.length; i++) {
        createdAssets = createdAssets.concat(
          await getCreatedAssets(splittedCreatorWallets[i], activeNetwork)
        );
      }

      if (splittedPrefixes.length !== 0) {
        createdAssets = createdAssets.filter((asset) =>
          splittedPrefixes.some((prefix) => asset.unit_name.startsWith(prefix))
        );
      }

      if (parsedAssetIds.length !== 0) {
        createdAssets = createdAssets.filter((asset) =>
          parsedAssetIds.includes(asset.asset_id)
        );
      }

      if (createdAssets.length === 0) {
        throw Error("No assets found with the specified filters!");
      }

      setCreatorAssetCount(createdAssets.length);
      const holders: any = {};

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
        setCreatorFoundAssetCount(i);
      }

      const txns = [];
      for (const holder in holders) {
        const txn: any = {
          asset_id: parseInt(creatorAssetID),
          amount: Number(creatorAmount) * holders[holder],
          receiver: holder,
        };
        if (creatorNote !== "") {
          txn.note = creatorNote;
        }
        txns.push(txn);
      }

      setCreatorTransactions(txns);
      setCreatorProcessStep(2);
      if (mnemonic === "") toast.info("Please sign the transactions!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setCreatorProcessStep(0);
    }
  }

  async function sendCreatorTransactions() {
    setCreatorProcessStep(3);
    try {
      if (creatorAssetID === "") {
        throw Error("Please enter asset ID!");
      }
      if (creatorTransactions.length === 0) {
        throw Error("Please create transactions first!");
      }

      const assetDecimals: any = {};
      const targetAsset = parseInt(creatorAssetID);
      if (targetAsset === 1) {
        assetDecimals[targetAsset] = 6;
      } else {
        assetDecimals[targetAsset] = await getAssetDecimals(targetAsset, algodClient);
      }

      if (!activeAddress) throw Error("Invalid Address");
      const txns = await createAirdropTransactions(
        creatorTransactions,
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

      for (let i = 0; i < signedTransactions.length; i++) {
        try {
          await algodClient.sendRawTransaction(signedTransactions[i]).do();
          if (i % 5 === 0) {
            toast.success(`Transaction ${i + 1} of ${signedTransactions.length} confirmed!`, {
              autoClose: 1000,
            });
          }
        } catch (err) {
          console.error(err);
          toast.error(`Transaction ${i + 1} of ${signedTransactions.length} failed!`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      setCreatorProcessStep(4);
      toast.success("All transactions confirmed!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setCreatorProcessStep(2);
    }
  }

  async function calculateCreatorInboxFees() {
    setCreatorProcessStep(5);
    try {
      if (creatorAssetID === "") throw Error("Please enter asset ID!");
      const assetDecimals: any = {};
      const targetAsset = parseInt(creatorAssetID);
      if (targetAsset === 1) {
        assetDecimals[targetAsset] = 6;
      } else {
        assetDecimals[targetAsset] = await getAssetDecimals(targetAsset, algodClient);
      }

      if (!activeAddress) throw Error("Invalid Address");
      const txns = await createAirdropTransactions(
        creatorTransactions,
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
        signer: mnemonic !== "" && mnemonicSigner !== null ? mnemonicSigner : transactionSigner,
      };

      const txnData = await createArc59GroupTxns(
        txns,
        sender,
        activeAddress,
        algodClient,
        activeNetwork
      );
      setCreatorInboxInfo(txnData);

      const accountInfo = await algodClient.accountInformation(activeAddress).do();
      const spendingBalance = accountInfo.amount - accountInfo["min-balance"];
      setCreatorSpendingBalance(spendingBalance);
      setCreatorProcessStep(6);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setCreatorProcessStep(2);
    }
  }

  async function sendCreatorInboxTransactions() {
    setCreatorProcessStep(3);
    const txnsLength = creatorInboxInfo.atomicTxns.length;
    try {
      for (let i = 0; i < txnsLength; i++) {
        try {
          await creatorInboxInfo.atomicTxns[i].gatherSignatures();
          const result = await creatorInboxInfo.atomicTxns[i].submit(algodClient);
          creatorInboxInfo.logDataArray[i].txnID = result.flat().toString();
        } catch (err: any) {
          creatorInboxInfo.logDataArray[i].txnID = `Failed: ${err.message}`;
          console.error(err);
          toast.error(`Transaction ${i + 1} of ${txnsLength} failed!`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      creatorInboxInfo.csv = await convertToCSV(creatorInboxInfo.logDataArray);
      setCreatorProcessStep(7);
      toast.success("All transactions confirmed!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setCreatorProcessStep(6);
    }
  }

  const getCreatorLogsCSV = () => {
    const blob = new Blob([creatorInboxInfo.csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "asset_box_data.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // =========================================================================
  // TAB 3: SPECIFIC ASSET HOLDERS LOGIC
  // =========================================================================
  async function createHolderTransactions() {
    try {
      if (!activeAddress) {
        throw Error("Please connect your wallet first!");
      }
      if (holderSpecifiedAssetId === "") {
        throw Error("Please enter specified Multi-Mint Asset ID!");
      }
      if (holderAssetID === "") {
        throw Error("Please enter target asset ID to distribute!");
      }
      if (holderAmount === "") {
        throw Error("Please enter amount!");
      }

      setHolderProcessStep(1);

      const multiAsset = parseInt(holderSpecifiedAssetId.trim());
      const creatorWallet = await getAssetCreatorWallet(multiAsset, algodClient);

      const holderObj: any = await getOwnerAddressAmountOfAsset(multiAsset, activeNetwork);
      setHolderAssetCount(holderObj.data.balances.length);

      const holders: any = {};
      for (let i = 0; i < holderObj.data.balances.length; i++) {
        const balanceInfo = holderObj.data.balances[i];
        if (balanceInfo.address === creatorWallet) {
          continue;
        }
        if (holders[balanceInfo.address] === undefined) {
          holders[balanceInfo.address] = 0;
        }
        holders[balanceInfo.address] += balanceInfo.amount;
        await new Promise((r) => setTimeout(r, 50));
        setHolderFoundAssetCount(i);
      }

      const txns = [];
      for (const holder in holders) {
        const txn: any = {
          asset_id: parseInt(holderAssetID),
          amount: Number(holderAmount) * holders[holder],
          receiver: holder,
        };
        if (holderNote !== "") {
          txn.note = holderNote;
        }
        txns.push(txn);
      }

      setHolderTransactions(txns);
      setHolderProcessStep(2);
      if (mnemonic === "") toast.info("Please sign the transactions!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setHolderProcessStep(0);
    }
  }

  async function sendHolderTransactions() {
    setHolderProcessStep(3);
    try {
      if (holderAssetID === "") throw Error("Please enter asset ID!");
      if (holderTransactions.length === 0) throw Error("Please create transactions first!");

      const assetDecimals: any = {};
      const targetAsset = parseInt(holderAssetID);
      if (targetAsset === 1) {
        assetDecimals[targetAsset] = 6;
      } else {
        assetDecimals[targetAsset] = await getAssetDecimals(targetAsset, algodClient);
      }

      if (!activeAddress) throw Error("Invalid Address");
      const txns = await createAirdropTransactions(
        holderTransactions,
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

      for (let i = 0; i < signedTransactions.length; i++) {
        try {
          await algodClient.sendRawTransaction(signedTransactions[i]).do();
          if (i % 5 === 0) {
            toast.success(`Transaction ${i + 1} of ${signedTransactions.length} confirmed!`, {
              autoClose: 1000,
            });
          }
        } catch (err) {
          console.error(err);
          toast.error(`Transaction ${i + 1} of ${signedTransactions.length} failed!`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      setHolderProcessStep(4);
      toast.success("All transactions confirmed!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setHolderProcessStep(2);
    }
  }

  async function calculateHolderInboxFees() {
    setHolderProcessStep(5);
    try {
      if (holderAssetID === "") throw Error("Please enter asset ID!");
      const assetDecimals: any = {};
      const targetAsset = parseInt(holderAssetID);
      if (targetAsset === 1) {
        assetDecimals[targetAsset] = 6;
      } else {
        assetDecimals[targetAsset] = await getAssetDecimals(targetAsset, algodClient);
      }

      if (!activeAddress) throw Error("Invalid Address");
      const txns = await createAirdropTransactions(
        holderTransactions,
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
        signer: mnemonic !== "" && mnemonicSigner !== null ? mnemonicSigner : transactionSigner,
      };

      const txnData = await createArc59GroupTxns(
        txns,
        sender,
        activeAddress,
        algodClient,
        activeNetwork
      );
      setHolderInboxInfo(txnData);

      const accountInfo = await algodClient.accountInformation(activeAddress).do();
      const spendingBalance = accountInfo.amount - accountInfo["min-balance"];
      setHolderSpendingBalance(spendingBalance);
      setHolderProcessStep(6);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setHolderProcessStep(2);
    }
  }

  async function sendHolderInboxTransactions() {
    setHolderProcessStep(3);
    const txnsLength = holderInboxInfo.atomicTxns.length;
    try {
      for (let i = 0; i < txnsLength; i++) {
        try {
          await holderInboxInfo.atomicTxns[i].gatherSignatures();
          const result = await holderInboxInfo.atomicTxns[i].submit(algodClient);
          holderInboxInfo.logDataArray[i].txnID = result.flat().toString();
        } catch (err: any) {
          holderInboxInfo.logDataArray[i].txnID = `Failed: ${err.message}`;
          console.error(err);
          toast.error(`Transaction ${i + 1} of ${txnsLength} failed!`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      holderInboxInfo.csv = await convertToCSV(holderInboxInfo.logDataArray);
      setHolderProcessStep(7);
      toast.success("All transactions confirmed!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setHolderProcessStep(6);
    }
  }

  const getHolderLogsCSV = () => {
    const blob = new Blob([holderInboxInfo.csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "asset_box_data.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // =========================================================================
  // TAB 4: NFD VAULTS SEND LOGIC
  // =========================================================================
  async function getSegmentsFromDomain(domain: string) {
    const segments: any[] = [];
    const limit = 200;
    let offset = 0;
    const nfdomainApiUrl = getNfdomainAPIURL(activeNetwork);
    const domainData = await axios.get(
      `${nfdomainApiUrl}/nfd/${domain.toLowerCase()}?view=brief&poll=false&nocache=false`
    );
    const appId = domainData.data.appID;
    let result = await axios.get(
      `${nfdomainApiUrl}/nfd/v2/search?parentAppID=${appId}&traits=segment&limit=${limit}&offset=${offset}&sort=nameAsc&view=brief&state=owned&state=reserved`,
      { headers: { "Cache-Control": "max-age=180" } }
    );
    result.data.nfds.forEach((element: any) => {
      if (parseFloat(element.properties.internal.ver) >= 2.11) {
        segments.push(element.name.toLowerCase());
      }
    });
    const total = result.data.total;
    if (total >= 10 && mnemonic === "") {
      throw Error(`Please enter your mnemonics to continue to process`);
    }
    while (offset < total) {
      offset += limit;
      result = await axios.get(
        `${nfdomainApiUrl}/nfd/v2/search?parentAppID=${appId}&traits=segment&limit=${limit}&offset=${offset}&sort=nameAsc&view=brief&state=owned&state=reserved`,
        { headers: { "Cache-Control": "max-age=180" } }
      );
      result.data.nfds.forEach((element: any) => {
        if (parseFloat(element.properties.internal.ver) >= 2.11) {
          segments.push(element.name.toLowerCase());
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    toast.info(`Found ${segments.length} segments`);
    return segments;
  }

  async function createVaultTransactions() {
    try {
      if (!activeAddress) {
        toast.warning("Please connect your wallet first!");
        return;
      }

      if (vaultAssetID === "") throw Error("Please enter asset ID!");
      if (vaultAmount === "") throw Error("Please enter amount!");
      if (vaultDomains.length === 0) throw Error("Please enter at least one domain!");

      const decimals = await getAssetDecimals(Number(vaultAssetID), algodClient);
      if (decimals === undefined) throw Error("Invalid Asset");

      const body = {
        amount: Number(vaultAmount) * 10 ** Number(decimals),
        assets: [Number(vaultAssetID)],
        note: vaultNote.trim() || "via wen.tools | " + Math.random().toString(36).substring(2),
        optInOnly: false,
        sender: activeAddress,
      };

      let receiverDomains: string[] = [];
      if (vaultType === "segments") {
        toast.info(`Fetching segments of ${vaultDomains}`);
        setVaultProcessStep(1); // FETCH_SEGMENTS
        receiverDomains = await getSegmentsFromDomain(vaultDomains);
      } else {
        vaultDomains.split(/[\n,]/).forEach((domain) => {
          if (domain.toLowerCase().includes(".algo")) {
            receiverDomains.push(domain.trim().toLowerCase());
          }
        });
      }
      setVaultProcessStep(2); // CREATE_TXNS

      let unsignedTransactions: Transaction[][] = [];
      toast.info(`Creating transactions for ${receiverDomains.length} domains`);
      const nfdomainApiUrl = getNfdomainAPIURL(activeNetwork);

      for (let i = 0; i < receiverDomains.length; i++) {
        try {
          const response = await axios.post(
            `${nfdomainApiUrl}/nfd/vault/sendTo/${receiverDomains[i].toLowerCase()}`,
            body
          );
          const transactionsArray = JSON.parse(response.data);
          unsignedTransactions.push(
            transactionsArray.map(([_type, txn]: any) => {
              const base64Bytes = atob(txn);
              const array = new Uint8Array(base64Bytes.length);
              for (let idx = 0; idx < base64Bytes.length; idx++) {
                array[idx] = base64Bytes.charCodeAt(idx);
              }
              const uTxn = algosdk.decodeUnsignedTransaction(array);
              uTxn.lastRound = uTxn.lastRound + 900;
              uTxn.group = undefined;
              return uTxn;
            })
          );
          if (i % 50 === 0 && i !== 0) {
            toast.info(`Created ${i} of ${receiverDomains.length} transactions`);
          }
        } catch (err: any) {
          console.error(err);
        }
      }

      unsignedTransactions = unsignedTransactions.map((a) => algosdk.assignGroupID(a));
      setVaultTransactions(unsignedTransactions);
      setVaultProcessStep(3); // SIGN_TXNS
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setVaultProcessStep(0);
    }
  }

  async function sendVaultTransactions() {
    try {
      if (!activeAddress) {
        toast.warning("Please connect your wallet first!");
        return;
      }
      if (vaultTransactions.length === 0) {
        throw Error("Please create transactions first!");
      }

      let signedTransactions: any[] = [];
      if (mnemonic !== "") {
        if (mnemonic.split(" ").length !== 25) throw Error("Invalid Mnemonic!");
        const { sk } = algosdk.mnemonicToSecretKey(mnemonic);
        signedTransactions = SignWithSk(vaultTransactions.flat(), sk);
      } else {
        signedTransactions = await walletSign(vaultTransactions, transactionSigner);
      }

      setVaultProcessStep(4); // SENDING

      const sliced: any[] = [];
      let i = 0;
      while (i < signedTransactions.length) {
        const decodedTxn = algosdk.decodeSignedTransaction(signedTransactions[i]);
        if (decodedTxn.txn.group) {
          sliced.push([signedTransactions[i], signedTransactions[i + 1], signedTransactions[i + 2]]);
          i += 3;
        } else {
          sliced.push(signedTransactions[i]);
          i += 1;
        }
      }

      for (let idx = 0; idx < sliced.length; idx++) {
        try {
          await algodClient.sendRawTransaction(sliced[idx]).do();
          if (idx % 50 === 0) {
            toast.success(`Transaction ${idx + 1} of ${sliced.length} confirmed!`, {
              autoClose: 1000,
            });
          }
        } catch (err: any) {
          console.error(err);
          toast.error(`Transaction ${idx + 1} of ${sliced.length} failed!`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      setVaultProcessStep(5); // COMPLETED
      toast.success("All transactions confirmed!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
      setVaultProcessStep(3);
    }
  }

  // =========================================================================
  // FAQS RETRIEVAL
  // =========================================================================
  const getFaqs = () => {
    switch (activeTab) {
      case "custom":
        return [
          {
            question: "What is Custom List distribution?",
            answer:
              "It allows you to distribute assets to a custom list of wallet addresses. You can enter details manually for single/multi-send transfers or upload a structured CSV file for bulk deliveries.",
          },
          {
            question: "Can I distribute standard ALGO?",
            answer:
              "Yes! Simply use the number 1 as the Asset ID to represent ALGO.",
          },
          {
            question: "What format should the CSV file be in?",
            answer:
              "The CSV must contain headers for 'asset_id', 'receiver', and 'amount'. Download our spreadsheet template inside the CSV tab to check the schema.",
          },
          {
            question: "What is the 'Send to Asset Inbox' (ARC-59) checkbox?",
            answer:
              "ARC-59 creates an escrow inbox for receivers who aren't opted into the asset. This requires a 0.1 ALGO minimum balance funding fee per recipient but guarantees the assets are successfully delivered without manual opt-in requirements.",
          },
        ];
      case "creator-wallet":
      case "asset-holders":
        return [
          {
            question: "How does Airdropping to Holders work?",
            answer:
              "This tool scans the Algorand ledger to find all current owner accounts of a specific set of assets (either by creator address or a reference asset ID) and automatically builds transactions to send them target tokens/Algos.",
          },
          {
            question: "What is the difference between Creator Wallet and Specific Asset?",
            answer:
              "Creator Wallet lets you filter and query all active holders of assets created by a designer (e.g. filtered by prefix or specified ids). Specific Asset lets you query holders of one specific multi-mint asset.",
          },
        ];
      case "vault":
        return [
          {
            question: "What is Vault Send?",
            answer:
              "Vault Send targets NFD (Non-Fungible Domain) vaults. NFD vault contracts can automatically accept assets. You must fund the vault's MBR (0.1 ALGO) per asset.",
          },
          {
            question: "What is a Segment Send?",
            answer:
              "Segment Send lets you input a parent NFD domain (e.g., orange.algo) and automatically fetch all sub-domains/segments (e.g., john.orange.algo) to send them assets.",
          },
        ];
    }
  };

  return (
    <div className="bg-primary-black pt-4 flex justify-center flex-col text-white min-h-screen">
      <Meta
        title="Distribution & Airdrop Suite"
        description="Unified hub for Direct Sending, CSV Mass Airdrops, Creator holdings snapshot airdrops, and secure NFD Vault transfers."
      />

      <article className="mx-auto text-white mb-16 flex flex-col items-center max-w-4xl w-full px-4">
        {/* Header Section */}
        <header className="w-full flex flex-col items-center mt-10 mb-8 text-center">
          <div className="flex items-center gap-3 justify-center">
            <div className="p-2.5 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl shadow-lg shadow-orange-500/20">
              <IoPaperPlane className="text-2xl text-black" aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-orange-300 via-orange-500 to-amber-500 bg-clip-text text-transparent py-1 uppercase">
              Distribution Suite
            </h1>
          </div>
          <p className="text-slate-400 mt-4 text-sm md:text-base font-medium max-w-xl leading-relaxed">
            Consolidated workspace for manual sends, bulk CSV airdrops, creator wallet snapshot drops, and secure NFD vault contract transfers.
          </p>
        </header>

        {/* Tab Selector - Glassmorphism */}
        <div className="flex flex-wrap gap-2 p-1.5 bg-[#121214] border border-white/5 rounded-2xl w-full max-w-3xl mx-auto mb-8 shadow-xl justify-center">
          <button
            onClick={() => handleTabChange("custom")}
            className={`flex-1 min-w-[120px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "custom"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoBriefcase className="text-lg" />
            <span>Custom List</span>
          </button>
          <button
            onClick={() => handleTabChange("creator-wallet")}
            className={`flex-1 min-w-[120px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "creator-wallet"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoWallet className="text-lg" />
            <span>Creator Wallet</span>
          </button>
          <button
            onClick={() => handleTabChange("asset-holders")}
            className={`flex-1 min-w-[120px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "asset-holders"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoSparkles className="text-lg" />
            <span>Asset Holders</span>
          </button>
          <button
            onClick={() => handleTabChange("vault")}
            className={`flex-1 min-w-[120px] py-2.5 px-3 rounded-xl font-extrabold flex items-center justify-center gap-2 transition-all duration-300 text-xs md:text-sm ${
              activeTab === "vault"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-lg shadow-orange-500/10"
                : "text-slate-400 hover:text-white hover:bg-white/[0.03]"
            }`}
          >
            <IoGlobe className="text-lg" />
            <span>NFD Vaults</span>
          </button>
        </div>

        {/* Main Action Box */}
        <div className="w-full bg-[#18181c]/90 border border-white/5 rounded-[32px] p-6 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden flex flex-col items-center gap-6">
          <ConnectButton inmain={true} />

          {/* ================================================================= */}
          {/* TAB 1: CUSTOM LIST VIEW (MANUAL vs CSV) */}
          {/* ================================================================= */}
          {activeTab === "custom" && (
            <div className="w-full flex flex-col items-center gap-6">
              {/* Info Box */}
              {customSubMode === "manual" ? (
                <div className="w-full bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex gap-3 text-sm text-blue-200 items-start text-left leading-relaxed">
                  <IoInformationCircle className="text-xl text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-white">Manual Custom Distribution:</span> Enter one asset with a list of recipient addresses, or a list of multiple assets targeting a single wallet address. Ideal for precise token logistics.
                  </div>
                </div>
              ) : (
                <div className="w-full bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex gap-3 text-sm text-blue-200 items-start text-left leading-relaxed">
                  <IoInformationCircle className="text-xl text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-white">CSV Mass Distribution:</span> Upload a spreadsheet mapping recipients to asset IDs and custom amounts. Ensure columns include <code className="text-blue-300">asset_id</code>, <code className="text-blue-300">receiver</code>, and <code className="text-blue-300">amount</code>.
                  </div>
                </div>
              )}

              {/* Toggle Manual / CSV */}
              <div className="flex gap-2 p-1 bg-slate-950 border border-slate-800 rounded-xl w-full max-w-xs justify-center">
                <button
                  onClick={() => {
                    setCustomSubMode("manual");
                    setManualProcessStep("INITIAL");
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-bold text-xs transition duration-200 ${
                    customSubMode === "manual" ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Manual Form
                </button>
                <button
                  onClick={() => {
                    setCustomSubMode("csv");
                    setCsvProcessStep("INITIAL");
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-bold text-xs transition duration-200 ${
                    customSubMode === "csv" ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  CSV Upload
                </button>
              </div>

              {/* Sub-mode: Manual Form */}
              {customSubMode === "manual" && (
                <div className="w-full flex flex-col gap-5">
                  {/* Manual Type Side-by-Side Selector */}
                  <div className="flex flex-col items-center gap-1.5 w-full">
                    <label className="text-slate-400 text-xs font-semibold">Distribution Type</label>
                    <div className="flex gap-2 p-1 bg-slate-950 border border-slate-800 rounded-xl w-full max-w-md justify-center">
                      {MANUAL_TYPES.map((t) => (
                        <button
                          key={t.value}
                          onClick={() => {
                            setManualType(t.value);
                            setManualAssets("");
                            setManualReceivers("");
                            setManualAmount("");
                          }}
                          type="button"
                          className={`flex-1 py-1.5 px-3 rounded-lg font-bold text-xs transition duration-200 ${
                            manualType === t.value ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full text-left">
                    {/* Asset IDs Input */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-slate-300 text-sm font-semibold">
                        {manualType === "multipleAssetsOneReceiver" ? "Asset ID(s)*" : "Asset ID*"}
                      </label>
                      {manualType === "multipleAssetsOneReceiver" ? (
                        <textarea
                          placeholder="Asset IDs (one per line or comma separated)"
                          className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 h-28 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                          value={manualAssets}
                          onChange={(e) => setManualAssets(e.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder="e.g. 1 (for ALGO) or ASA ID"
                          className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                          value={manualAssets}
                          onChange={(e) => setManualAssets(e.target.value)}
                        />
                      )}
                    </div>

                    {/* Receivers Input */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-slate-300 text-sm font-semibold">
                        {manualType === "multipleAssetsOneReceiver" ? "Receiver Address*" : "Receiver Address(es)*"}
                      </label>
                      {manualType === "multipleAssetsOneReceiver" ? (
                        <input
                          type="text"
                          placeholder="Algorand Address (58 chars)"
                          maxLength={58}
                          className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                          value={manualReceivers}
                          onChange={(e) => setManualReceivers(e.target.value)}
                        />
                      ) : (
                        <textarea
                          placeholder="Addresses (one per line or comma separated)"
                          className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 h-28 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                          value={manualReceivers}
                          onChange={(e) => setManualReceivers(e.target.value)}
                        />
                      )}
                    </div>

                    {/* Amount Input */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-slate-300 text-sm font-semibold">Amount per Wallet*</label>
                      <input
                        type="number"
                        placeholder="Amount"
                        className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                        value={manualAmount}
                        onChange={(e) => setManualAmount(e.target.value)}
                        min={0}
                      />
                    </div>
                  </div>

                  {/* Transaction Note */}
                  <div className="w-full flex flex-col items-start gap-1 text-left">
                    <label className="text-slate-300 text-sm font-semibold">Transaction Note (optional)</label>
                    <input
                      type="text"
                      placeholder="Enter custom transaction note memo"
                      className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 w-full focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none text-xs"
                      value={manualNote}
                      onChange={(e) => setManualNote(e.target.value)}
                    />
                  </div>

                  {/* Processing Step Controls */}
                  <div className="w-full flex flex-col items-center gap-4 mt-2">
                    {manualProcessStep === "ASSET_INBOX_TXNS_FINISHED" ? (
                      <div className="text-center space-y-4">
                        <button
                          className="px-6 py-2.5 bg-green-500 hover:bg-green-600 text-black font-extrabold text-sm rounded-xl transition duration-200 flex items-center gap-2 mx-auto"
                          onClick={getManualCSV}
                        >
                          <IoCloudDownload className="text-lg" />
                          <span>Download Asset Inbox Logs</span>
                        </button>
                        <p className="text-green-500 font-bold animate-pulse text-sm">
                          All asset inbox transactions completed successfully!
                        </p>
                      </div>
                    ) : manualProcessStep === "SENDING_TO_ASSET_INBOX" ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                        <span className="text-sm text-slate-300">Sending inbox transactions to the ledger...</span>
                      </div>
                    ) : manualProcessStep === "CALCULATING_FEES" ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                        <span className="text-sm text-slate-300">Calculating ARC-59 Inbox MBR funding fees...</span>
                      </div>
                    ) : manualProcessStep === "SEND_TO_ASSET_INBOX" ? (
                      <div className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col gap-3 text-left">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-400">Total Txns:</span>
                          <span className="text-primary-orange font-bold font-mono">{manualInboxInfo.logDataArray.length}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-400">Total Fees:</span>
                          <span className={`font-bold font-mono ${manualInboxInfo.grandTotal < manualSpendingBalance ? "text-primary-orange" : "text-red-500"}`}>
                            {(manualInboxInfo.grandTotal * 1e-6).toFixed(4)} ALGO
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm border-b border-slate-800/80 pb-3">
                          <span className="text-slate-400">Your Spendable Balance:</span>
                          <span className="text-slate-200 font-bold font-mono">{(manualSpendingBalance * 1e-6).toFixed(4)} ALGO</span>
                        </div>

                        <button
                          className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-extrabold rounded-xl transition duration-200"
                          onClick={sendManualAssetInboxTxns}
                        >
                          Sign & Send Inbox Transactions
                        </button>
                        <button
                          className="w-full py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold text-xs rounded-xl transition"
                          onClick={getManualCSV}
                        >
                          Export Pre-flight Log CSV
                        </button>
                      </div>
                    ) : manualProcessStep === "TXNS_FINISHED" ? (
                      <div className="text-center py-2">
                        <p className="text-green-500 font-bold animate-pulse text-sm">All standard transactions confirmed!</p>
                        <p className="text-xs text-slate-500 mt-1">You can reload or fill the form again to send more.</p>
                      </div>
                    ) : manualProcessStep === "SENDING_TXNS" ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                        <span className="text-sm text-slate-400">Broadcasting transactions to network...</span>
                      </div>
                    ) : (
                      <div className="w-full flex flex-col items-center gap-4">
                        <div className="flex items-center gap-2 select-none">
                          <input
                            type="checkbox"
                            id="manual_inbox"
                            className="rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                            checked={manualInbox}
                            onChange={(e) => setManualInbox(e.target.checked)}
                          />
                          <label htmlFor="manual_inbox" className="text-sm text-slate-300 cursor-pointer">
                            Send via ARC-59 Asset Inbox (Support accounts that are not opted-in)
                          </label>
                        </div>

                        <button
                          className="w-full md:w-auto px-10 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-bold uppercase text-sm rounded-xl transition shadow-lg hover:scale-95 duration-200 disabled:opacity-50"
                          onClick={handleManualNext}
                          disabled={!activeAddress}
                        >
                          {manualInbox ? "Calculate Inbox Fees" : "Approve & Send"}
                        </button>
                      </div>
                    )}

                    {manualErrMsg && <p className="text-red-500 text-xs mt-2">{manualErrMsg}</p>}
                  </div>
                </div>
              )}

              {/* Sub-mode: CSV Bulk Upload */}
              {customSubMode === "csv" && (
                <div className="w-full flex flex-col gap-6">


                  <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
                    <a
                      className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-extrabold text-xs rounded-xl shadow transition duration-300 transform hover:scale-[0.98] text-center"
                      href="https://docs.google.com/spreadsheets/d/1YN7NhxXyNmBZ80nopbcu23Pme-xastrobfIu_MnALiA/edit?usp=sharing"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download CSV Template
                    </a>
                    <a
                      className="px-4 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-extrabold text-xs rounded-xl shadow transition duration-300 transform hover:scale-[0.98] text-center"
                      href="https://loafpickle.medium.com/evil-tools-custom-mass-airdrop-3d5902dd1c94"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mass Airdrop Guide
                    </a>
                  </div>

                  {csvData === null ? (
                    <label
                      htmlFor="csv-dropzone"
                      className="flex flex-col justify-center items-center w-full max-w-md mx-auto h-40 px-4 rounded-2xl border-2 border-dashed cursor-pointer bg-[#0f0f11] border-slate-800 hover:border-orange-500/50 hover:bg-white/[0.02] transition duration-300"
                    >
                      <div className="flex flex-col justify-center items-center text-center">
                        <IoCloudUpload className="text-3xl text-slate-400 mb-2" />
                        <p className="mb-1 text-sm text-slate-300 font-bold">Click or drag to upload CSV file</p>
                        <p className="text-xs text-slate-500">Supports .csv, .xls, .xlsx</p>
                      </div>
                      <input
                        className="hidden"
                        id="csv-dropzone"
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        onChange={(e: any) => {
                          const file = e.target.files[0];
                          if (file) {
                            Papa.parse(file, {
                              complete: function (results) {
                                const filteredData = results.data.filter(
                                  (row: any) => row.length > 0 && row[0]?.length > 0
                                );
                                setCsvData(filteredData);
                                setCsvProcessStep("CSV_UPLOADED");
                              },
                              skipEmptyLines: true,
                            });
                          }
                        }}
                      />
                    </label>
                  ) : (
                    <div className="w-full flex flex-col items-center gap-4">
                      {csvProcessStep === "ASSET_INBOX_TXNS_FINISHED" ? (
                        <div className="text-center space-y-4">
                          <button
                            className="px-6 py-2.5 bg-green-500 hover:bg-green-600 text-black font-extrabold text-sm rounded-xl transition duration-200 flex items-center gap-2 mx-auto"
                            onClick={getCsvLogs}
                          >
                            <IoCloudDownload className="text-lg" />
                            <span>Download Inbox logs CSV</span>
                          </button>
                          <p className="text-green-500 font-bold animate-pulse text-sm">
                            All airdrop inbox transactions completed!
                          </p>
                        </div>
                      ) : csvProcessStep === "SENDING_TO_ASSET_INBOX" ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                          <span className="text-sm text-slate-300">Sending inbox transactions to the network...</span>
                        </div>
                      ) : csvProcessStep === "CALCULATING_FEES" ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                          <span className="text-sm text-slate-300">Calculating fees...</span>
                        </div>
                      ) : csvProcessStep === "SEND_TO_ASSET_INBOX" ? (
                        <div className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col gap-3 text-left">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-400">Total Txns:</span>
                            <span className="text-primary-orange font-bold font-mono">{csvInboxInfo.logDataArray.length}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-400">Total Fees:</span>
                            <span className={`font-bold font-mono ${csvInboxInfo.grandTotal < csvSpendingBalance ? "text-primary-orange" : "text-red-500"}`}>
                              {(csvInboxInfo.grandTotal * 1e-6).toFixed(4)} ALGO
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-sm border-b border-slate-800/80 pb-3">
                            <span className="text-slate-400">Your Spendable Balance:</span>
                            <span className="text-slate-200 font-bold font-mono">{(csvSpendingBalance * 1e-6).toFixed(4)} ALGO</span>
                          </div>

                          <button
                            className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-extrabold rounded-xl transition duration-200"
                            onClick={sendCsvAssetInboxTxns}
                          >
                            Sign & Send Inbox Transactions
                          </button>
                          <button
                            className="w-full py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold text-xs rounded-xl transition"
                            onClick={getCsvLogs}
                          >
                            Export Pre-flight Log CSV
                          </button>
                        </div>
                      ) : csvProcessStep === "TXNS_FINISHED" ? (
                        <div className="text-center py-2">
                          <p className="text-green-500 font-bold animate-pulse text-sm">All standard transactions confirmed!</p>
                          <button
                            className="mt-3 px-5 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold text-xs rounded-xl transition"
                            onClick={() => setCsvData(null)}
                          >
                            Upload Another File
                          </button>
                        </div>
                      ) : csvProcessStep === "SENDING_TXNS" ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                          <span className="text-sm text-slate-400">Broadcasting transactions to ledger...</span>
                        </div>
                      ) : (
                        <div className="w-full flex flex-col items-center gap-4">
                          <div className="text-sm font-bold text-slate-300 bg-[#0f0f11] px-5 py-3 rounded-xl border border-white/5">
                            File uploaded: {csvData.length - 1} records detected.
                          </div>

                          <div className="flex items-center gap-2 select-none">
                            <input
                              type="checkbox"
                              id="csv_inbox"
                              className="rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                              checked={csvInbox}
                              onChange={(e) => setCsvInbox(e.target.checked)}
                            />
                            <label htmlFor="csv_inbox" className="text-sm text-slate-300 cursor-pointer">
                              Send via ARC-59 Asset Inbox (Support accounts that are not opted-in)
                            </label>
                          </div>

                          <div className="flex gap-4 w-full max-w-sm justify-center">
                            <button
                              className="flex-1 px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-bold uppercase text-xs rounded-xl transition shadow-lg hover:scale-95 duration-200"
                              onClick={handleCsvFileData}
                            >
                              {csvInbox ? "Calculate Fees" : "Approve & Send"}
                            </button>
                            <button
                              className="px-6 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold text-xs rounded-xl transition"
                              onClick={() => setCsvData(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: CREATOR WALLET VIEW */}
          {/* ================================================================= */}
          {activeTab === "creator-wallet" && (
            <div className="w-full flex flex-col items-center gap-6">
              <div className="w-full bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex gap-3 text-sm text-blue-200 items-start text-left leading-relaxed">
                <IoInformationCircle className="text-xl text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white">Creator Wallet Distribution:</span> Identify all wallets holding assets created by one or more creator accounts, and distribute target tokens to them proportionally.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full text-left">
                {/* Creator Wallets list */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-300 text-sm font-semibold">Creator Wallet(s)*</label>
                  <textarea
                    placeholder="Creator addresses (one per line or comma separated)"
                    className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 h-28 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                    value={creatorWallets}
                    onChange={(e) => setCreatorWallets(e.target.value)}
                  />
                </div>

                {/* Unit Name Prefixes */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-300 text-sm font-semibold">Asset Name Prefix Filters (optional)</label>
                  <textarea
                    placeholder="e.g. WEN (one per line, comma separated)"
                    className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 h-28 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                    value={creatorPrefixes}
                    onChange={(e) => setCreatorPrefixes(e.target.value)}
                  />
                </div>

                {/* Specific Asset ID filters */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-300 text-sm font-semibold">Creator's Specified Asset IDs (optional)</label>
                  <textarea
                    placeholder="Limit scan to specific created asset IDs"
                    className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 h-20 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                    value={creatorSpecifiedAssetIds}
                    onChange={(e) => setCreatorSpecifiedAssetIds(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-4">
                  {/* Amount per asset held */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-300 text-sm font-semibold">Amount per Asset Held*</label>
                    <input
                      type="number"
                      placeholder="e.g. 10"
                      className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                      value={creatorAmount}
                      onChange={(e) => setCreatorAmount(e.target.value)}
                      min={0}
                    />
                  </div>

                  {/* Airdropped Asset ID */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-slate-300 text-sm font-semibold">Asset ID to Distribute*</label>
                    <input
                      type="text"
                      placeholder="e.g. 1 for ALGO or Custom ASA"
                      className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                      value={creatorAssetID}
                      onChange={(e) => setCreatorAssetID(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Note */}
              <div className="w-full flex flex-col items-start gap-1 text-left">
                <label className="text-slate-300 text-sm font-semibold">Transaction Note (optional)</label>
                <input
                  type="text"
                  placeholder="Enter notes memo"
                  className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 w-full focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none text-xs"
                  value={creatorNote}
                  onChange={(e) => setCreatorNote(e.target.value)}
                />
              </div>

              {/* Steps rendering */}
              <div className="w-full flex flex-col items-center gap-4">
                {creatorProcessStep === 7 ? (
                  <div className="text-center space-y-4">
                    <button
                      className="px-6 py-2.5 bg-green-500 hover:bg-green-600 text-black font-extrabold text-sm rounded-xl transition duration-200 flex items-center gap-2 mx-auto"
                      onClick={getCreatorLogsCSV}
                    >
                      <IoCloudDownload className="text-lg" />
                      <span>Download logs CSV</span>
                    </button>
                    <p className="text-green-500 font-bold animate-pulse text-sm">
                      All creator-holders inbox transactions completed!
                    </p>
                  </div>
                ) : creatorProcessStep === 6 ? (
                  <div className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col gap-3 text-left">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Total Txns:</span>
                      <span className="text-primary-orange font-bold font-mono">{creatorInboxInfo.logDataArray.length}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Total Fees:</span>
                      <span className={`font-bold font-mono ${creatorInboxInfo.grandTotal < creatorSpendingBalance ? "text-primary-orange" : "text-red-500"}`}>
                        {(creatorInboxInfo.grandTotal * 1e-6).toFixed(4)} ALGO
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm border-b border-slate-800/80 pb-3">
                      <span className="text-slate-400">Your Spendable Balance:</span>
                      <span className="text-slate-200 font-bold font-mono">{(creatorSpendingBalance * 1e-6).toFixed(4)} ALGO</span>
                    </div>

                    <button
                      className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-extrabold rounded-xl transition duration-200"
                      onClick={sendCreatorInboxTransactions}
                    >
                      Sign & Send Inbox Transactions
                    </button>
                    <button
                      className="w-full py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold text-xs rounded-xl transition"
                      onClick={getCreatorLogsCSV}
                    >
                      Export Pre-flight Log CSV
                    </button>
                  </div>
                ) : creatorProcessStep === 5 ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                    <span className="text-sm text-slate-300">Calculating fees...</span>
                  </div>
                ) : creatorProcessStep === 4 ? (
                  <div className="text-center py-2">
                    <p className="text-green-500 font-bold animate-pulse text-sm">All standard transactions confirmed!</p>
                  </div>
                ) : creatorProcessStep === 3 ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                    <span className="text-sm text-slate-400">Broadcasting transactions...</span>
                  </div>
                ) : creatorProcessStep === 2 ? (
                  <div className="w-full flex flex-col items-center gap-4">
                    <p className="text-xs text-slate-400 font-bold">
                      Detected {creatorTransactions.length} eligible recipient holder wallets.
                    </p>
                    <div className="flex items-center gap-2 select-none">
                      <input
                        type="checkbox"
                        id="creator_inbox"
                        className="rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                        checked={creatorInbox}
                        onChange={(e) => setCreatorInbox(e.target.checked)}
                      />
                      <label htmlFor="creator_inbox" className="text-sm text-slate-300 cursor-pointer">
                        Send via ARC-59 Asset Inbox (Support accounts that are not opted-in)
                      </label>
                    </div>

                    <div className="flex gap-4 justify-center">
                      <button
                        className="px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-bold uppercase text-xs rounded-xl transition shadow-lg hover:scale-95 duration-200"
                        onClick={creatorInbox ? calculateCreatorInboxFees : sendCreatorTransactions}
                      >
                        {creatorInbox ? "Calculate Fees" : "Sign & Send"}
                      </button>
                      <button
                        className="px-6 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold text-xs rounded-xl transition"
                        onClick={() => setCreatorProcessStep(0)}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                ) : creatorProcessStep === 1 ? (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                    <span className="text-sm text-slate-300">Fetching creator asset balances and owners...</span>
                    {creatorFoundAssetCount > 0 && (
                      <span className="text-xs text-slate-500 font-mono">
                        Scanned {creatorFoundAssetCount + 1} / {creatorAssetCount} created assets
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    className="px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-bold uppercase text-xs rounded-xl transition shadow-lg hover:scale-95 duration-200"
                    onClick={createCreatorTransactions}
                  >
                    Scan & Create Transactions
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: SPECIFIC ASSET HOLDERS VIEW */}
          {/* ================================================================= */}
          {activeTab === "asset-holders" && (
            <div className="w-full flex flex-col items-center gap-6">
              <div className="w-full bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex gap-3 text-sm text-blue-200 items-start text-left leading-relaxed">
                <IoInformationCircle className="text-xl text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white">Specific Asset Airdrop:</span> Duplicate or distribute tokens to all holders of a specific reference asset. Perfect for rewards distributions or governance drops.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full text-left">
                {/* Specific Multi-Mint Reference Asset */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-300 text-sm font-semibold">Reference Asset ID (Holds target list)*</label>
                  <input
                    type="text"
                    placeholder="Enter reference asset ID"
                    className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                    value={holderSpecifiedAssetId}
                    onChange={(e) => setHolderSpecifiedAssetId(e.target.value)}
                  />
                </div>

                {/* Amount per asset held */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-300 text-sm font-semibold">Amount per Asset Held*</label>
                  <input
                    type="number"
                    placeholder="e.g. 5"
                    className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                    value={holderAmount}
                    onChange={(e) => setHolderAmount(e.target.value)}
                    min={0}
                  />
                </div>

                {/* Airdropped Asset ID */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-300 text-sm font-semibold">Asset ID to Distribute*</label>
                  <input
                    type="text"
                    placeholder="e.g. 1 for ALGO or Custom ASA"
                    className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                    value={holderAssetID}
                    onChange={(e) => setHolderAssetID(e.target.value)}
                  />
                </div>
              </div>

              {/* Note */}
              <div className="w-full flex flex-col items-start gap-1 text-left">
                <label className="text-slate-300 text-sm font-semibold">Transaction Note (optional)</label>
                <input
                  type="text"
                  placeholder="Enter note memo"
                  className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 w-full focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none text-xs"
                  value={holderNote}
                  onChange={(e) => setHolderNote(e.target.value)}
                />
              </div>

              {/* Action and processing control */}
              <div className="w-full flex flex-col items-center gap-4">
                {holderProcessStep === 7 ? (
                  <div className="text-center space-y-4">
                    <button
                      className="px-6 py-2.5 bg-green-500 hover:bg-green-600 text-black font-extrabold text-sm rounded-xl transition duration-200 flex items-center gap-2 mx-auto"
                      onClick={getHolderLogsCSV}
                    >
                      <IoCloudDownload className="text-lg" />
                      <span>Download logs CSV</span>
                    </button>
                    <p className="text-green-500 font-bold animate-pulse text-sm">
                      All asset-holders inbox transactions completed successfully!
                    </p>
                  </div>
                ) : holderProcessStep === 6 ? (
                  <div className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col gap-3 text-left">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Total Txns:</span>
                      <span className="text-primary-orange font-bold font-mono">{holderInboxInfo.logDataArray.length}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Total Fees:</span>
                      <span className={`font-bold font-mono ${holderInboxInfo.grandTotal < holderSpendingBalance ? "text-primary-orange" : "text-red-500"}`}>
                        {(holderInboxInfo.grandTotal * 1e-6).toFixed(4)} ALGO
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm border-b border-slate-800/80 pb-3">
                      <span className="text-slate-400">Your Spendable Balance:</span>
                      <span className="text-slate-200 font-bold font-mono">{(holderSpendingBalance * 1e-6).toFixed(4)} ALGO</span>
                    </div>

                    <button
                      className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-extrabold rounded-xl transition duration-200"
                      onClick={sendHolderInboxTransactions}
                    >
                      Sign & Send Inbox Transactions
                    </button>
                    <button
                      className="w-full py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold text-xs rounded-xl transition"
                      onClick={getHolderLogsCSV}
                    >
                      Export Pre-flight Log CSV
                    </button>
                  </div>
                ) : holderProcessStep === 5 ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                    <span className="text-sm text-slate-300">Calculating fees...</span>
                  </div>
                ) : holderProcessStep === 4 ? (
                  <div className="text-center py-2">
                    <p className="text-green-500 font-bold animate-pulse text-sm">All standard transactions confirmed!</p>
                  </div>
                ) : holderProcessStep === 3 ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                    <span className="text-sm text-slate-400">Broadcasting transactions...</span>
                  </div>
                ) : holderProcessStep === 2 ? (
                  <div className="w-full flex flex-col items-center gap-4">
                    <p className="text-xs text-slate-400 font-bold">
                      Detected {holderTransactions.length} eligible recipient holder wallets.
                    </p>
                    <div className="flex items-center gap-2 select-none">
                      <input
                        type="checkbox"
                        id="holder_inbox"
                        className="rounded border-slate-800 text-primary-orange focus:ring-primary-orange bg-slate-950 h-4 w-4"
                        checked={holderInbox}
                        onChange={(e) => setHolderInbox(e.target.checked)}
                      />
                      <label htmlFor="holder_inbox" className="text-sm text-slate-300 cursor-pointer">
                        Send via ARC-59 Asset Inbox (Support accounts that are not opted-in)
                      </label>
                    </div>

                    <div className="flex gap-4 justify-center">
                      <button
                        className="px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-bold uppercase text-xs rounded-xl transition shadow-lg hover:scale-95 duration-200"
                        onClick={holderInbox ? calculateHolderInboxFees : sendHolderTransactions}
                      >
                        {holderInbox ? "Calculate Fees" : "Sign & Send"}
                      </button>
                      <button
                        className="px-6 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold text-xs rounded-xl transition"
                        onClick={() => setHolderProcessStep(0)}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                ) : holderProcessStep === 1 ? (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                    <span className="text-sm text-slate-300">Fetching asset balances and owners...</span>
                    {holderFoundAssetCount > 0 && (
                      <span className="text-xs text-slate-500 font-mono">
                        Scanned {holderFoundAssetCount + 1} / {holderAssetCount} asset balances
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    className="px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-bold uppercase text-xs rounded-xl transition shadow-lg hover:scale-95 duration-200"
                    onClick={createHolderTransactions}
                  >
                    Scan & Create Transactions
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: NFD VAULTS VIEW */}
          {/* ================================================================= */}
          {activeTab === "vault" && (
            <div className="w-full flex flex-col items-center gap-6">
              <div className="w-full bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex gap-3 text-sm text-blue-200 items-start text-left leading-relaxed">
                <IoInformationCircle className="text-xl text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-white">NFD Vault Distribution:</span> Deliver assets securely into NFD smart contract vaults. Vault contracts handles administrative opt-ins automatically without requiring receiver actions.
                </div>
              </div>

              {/* Sub-mode segments vs domains */}
              <div className="flex gap-2 p-1 bg-slate-950 border border-slate-800 rounded-xl w-full max-w-sm justify-center">
                <button
                  onClick={() => {
                    setVaultType("segments");
                    setVaultDomains("");
                    setVaultProcessStep(0);
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-bold text-xs transition duration-200 ${
                    vaultType === "segments" ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Send to All Segments
                </button>
                <button
                  onClick={() => {
                    setVaultType("domains");
                    setVaultDomains("");
                    setVaultProcessStep(0);
                  }}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-bold text-xs transition duration-200 ${
                    vaultType === "domains" ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  Send to Individual Domains
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full text-left">
                {/* Asset ID */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-300 text-sm font-semibold">Asset ID*</label>
                  <input
                    type="text"
                    placeholder="Asset ID"
                    className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                    value={vaultAssetID}
                    onChange={(e) => setVaultAssetID(e.target.value)}
                  />
                </div>

                {/* Target domains / root domain */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-300 text-sm font-semibold">
                    {vaultType === "domains" ? "NFDomains*" : "NFDomain*"}
                  </label>
                  {vaultType === "domains" ? (
                    <textarea
                      placeholder="Domains (one per line, comma separated)"
                      className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 h-20 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                      value={vaultDomains}
                      onChange={(e) => setVaultDomains(e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder="e.g. orange.algo"
                      className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                      value={vaultDomains}
                      onChange={(e) => setVaultDomains(e.target.value)}
                    />
                  )}
                </div>

                {/* Amount per wallet */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-slate-300 text-sm font-semibold">Amount Per Wallet*</label>
                  <input
                    type="number"
                    placeholder="Amount"
                    className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none font-mono text-xs"
                    value={vaultAmount}
                    onChange={(e) => setVaultAmount(e.target.value)}
                    min={0}
                  />
                </div>
              </div>

              {/* Note */}
              <div className="w-full flex flex-col items-start gap-1 text-left">
                <label className="text-slate-300 text-sm font-semibold">Transaction Note (optional)</label>
                <input
                  type="text"
                  placeholder="Enter note memo"
                  className="bg-slate-950/80 text-white placeholder-slate-600 border border-slate-800 rounded-xl p-3 w-full focus:ring-2 focus:ring-primary-orange focus:border-transparent outline-none text-xs"
                  value={vaultNote}
                  onChange={(e) => setVaultNote(e.target.value)}
                />
              </div>

              {/* Steps control for vaults */}
              <div className="w-full flex flex-col items-center gap-4">
                {vaultProcessStep === 5 ? (
                  <div className="text-center py-2">
                    <p className="text-primary-orange font-bold animate-pulse text-sm">All vault transactions completed!</p>
                    <p className="text-xs text-slate-500 mt-1">You can reload or fill the form again to send more.</p>
                  </div>
                ) : vaultProcessStep === 4 ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                    <span className="text-sm text-slate-300">Sending vault transactions to the network...</span>
                  </div>
                ) : vaultProcessStep === 3 ? (
                  <div className="w-full flex flex-col items-center gap-3">
                    <p className="text-xs text-slate-400">
                      Transactions created! Identified {vaultTransactions.length} target receiver vault accounts.
                    </p>
                    <button
                      className="px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-bold uppercase text-xs rounded-xl transition shadow-lg hover:scale-95 duration-200"
                      onClick={sendVaultTransactions}
                    >
                      Sign & Send Transactions
                    </button>
                  </div>
                ) : vaultProcessStep === 2 ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                    <span className="text-sm text-slate-300">Creating smart contract vault transactions...</span>
                  </div>
                ) : vaultProcessStep === 1 ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full border-4 border-slate-800 border-t-primary-orange h-8 w-8"></div>
                    <span className="text-sm text-slate-300">Fetching sub-domain segments of {vaultDomains}...</span>
                  </div>
                ) : (
                  <button
                    className="px-8 py-3 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-bold uppercase text-xs rounded-xl transition shadow-lg hover:scale-95 duration-200"
                    onClick={createVaultTransactions}
                  >
                    Create Vault Transactions
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="w-full flex items-center justify-center gap-1.5 text-[10px] text-red-500 mt-2 italic">
            <IoWarning className="text-xs shrink-0" />
            <span>If you reload or close this page, current transaction status history will be lost.</span>
          </div>
        </div>

        {/* Mnemonic Passkey - Infinity Mode */}
        <div className="w-full max-w-md mx-auto mt-6">

        </div>

        {/* FAQs */}
        <div className="w-full max-w-xl mx-auto mt-8 text-center">
          <FaqSectionComponent faqData={getFaqs()} />
        </div>

        {/* Practitioner Section */}
        <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      <section className="mt-16 pt-12 border-t border-white/5 w-full max-w-4xl text-left px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-white tracking-tight italic uppercase flex items-center gap-2">
                <IoHelpCircle className="text-slate-400 text-xl" />
                <span>On-Chain Airdrop Logistics</span>
              </h2>
              <p className="text-xs md:text-sm text-slate-400 leading-relaxed">
                Distributing assets at scale requires structuring transactions to avoid unnecessary ledger overhead. The **Distribution Suite** combines manual single transfers, bulk CSV operations, and holder snapshots to make coordinate-level distribution frictionless. Using smart contract integrations like ARC-59 helps reach users even if they haven't set up asset records, minimizing client-side drop friction.
              </p>
            </div>
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-white tracking-tight italic uppercase flex items-center gap-2">
                <IoGlobe className="text-slate-400 text-xl" />
                <span>Escrow & Vault Integration</span>
              </h2>
              <p className="text-xs md:text-sm text-slate-400 leading-relaxed">
                By targeting Non-Fungible Domain (NFD) vault smart contract accounts or using standard ARC-59 escrows, creators can distribute tokens to their user base permissionlessly. Doing so deposits assets into contract-controlled buffers, allowing users to pull tokens on-demand. This mitigates wallet state MBR pollution and optimizes user onboarding logistics.
              </p>
            </div>
          </div>
        </section>
      </article>
    </div>
  );
}
