import { NetworkId, useWallet } from "@txnlab/use-wallet-react";
import algosdk, { Transaction } from "algosdk";
import axios from "axios";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
  generateARC59ClaimTxns,
  getAssetsInAssetInbox,
} from "../arc59-helpers";
import { TOOLS } from "../constants";
import { getIndexerURL, getNfdDomain, SignWithSk, walletSign } from "../utils";
import { EnhancedTable } from "../components/DataGrid";
import InfinityModeComponent from "../components/InfinityModeComponent";
import { HeadCell } from "../types";

interface Asset {
  assetId: number;
  amount: number;
  name: string;
  type: string;
  id: number;
}

interface AssetWithTransactions extends Asset {
  txns: Transaction[];
}

const fetchNFDVaultAssets = async (nfd: string, activeNetwork: NetworkId) => {
  if (!nfd) return [];

  const { data } = await axios.get(
    `https://api.nf.domains/nfd/${nfd}?view=full`
  );
  if (!data.nfdAccount) return [];

  const vaultAddress = data.nfdAccount;
  const indexerUrl = getIndexerURL(activeNetwork);
  let assets: any[] = [];
  let nextToken = null;

  do {
    const url: string = `${indexerUrl}/v2/accounts/${vaultAddress}/assets${
      nextToken ? `?next=${nextToken}` : ""
    }`;
    const { data: response } = await axios.get(url);
    assets = [...assets, ...response.assets];
    nextToken = response["next-token"];
  } while (nextToken);

  return assets
    .filter(
      (asset) => !asset["is-frozen"] && !asset.deleted && asset.amount > 0
    )
    .map((asset) => ({
      assetId: asset["asset-id"],
      amount: asset.amount,
      type: "vault",
    }));
};

const getAssetDetails = async (asset: any, indexerUrl: string) => {
  const { data } = await axios.get(`${indexerUrl}/v2/assets/${asset.assetId}`);
  return {
    id: asset.id,
    assetId: asset.assetId,
    amount: asset.amount / 10 ** data.asset.params.decimals,
    name: data.asset.params.name,
    type: asset.type,
  };
};

const INITIAL_STEP = 0;
const COMPLETED = 1;

export const BlukClaimTool = () => {
  const { activeAddress, activeNetwork, algodClient, transactionSigner } =
    useWallet();
  const [mnemonic, setMnemonic] = useState("");
  const [isLoadingAssets, setIsLoadingAssets] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nfd, setNFD] = useState("");
  const [processStep, setProcessStep] = useState(INITIAL_STEP);

  useEffect(() => {
    const loadAssets = async () => {
      if (!activeAddress) {
        toast.error("Wallet not connected");
        return;
      }

      try {
        const [inboxAssets, userNfd] = await Promise.all([
          getAssetsInAssetInbox(activeAddress, algodClient, activeNetwork),
          getNfdDomain(activeAddress),
        ]);

        setNFD(userNfd);
        const vaultAssets = await fetchNFDVaultAssets(userNfd, activeNetwork);

        const indexerUrl = getIndexerURL(activeNetwork);
        const allAssets = await Promise.all(
          [...inboxAssets, ...vaultAssets].map((asset, index) =>
            getAssetDetails({ ...asset, id: index }, indexerUrl)
          )
        );

        setAssets(allAssets);
      } catch (error) {
        console.error("Error loading assets:", error);
        toast.error("Failed to load assets");
      } finally {
        setIsLoadingAssets(false);
      }
    };

    loadAssets();
  }, [activeAddress, activeNetwork, algodClient]);

  const handleClaimAssets = async (
    selected: Asset[],
    setDisabled: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    if (!activeAddress) {
      toast.error("Please connect your wallet");
      return;
    }

    setDisabled(true);
    try {
      const vaultAssets = selected.filter((s) => s.type === "vault");
      const inboxAssets = selected.filter((s) => s.type === "inbox");

      const assetsWithTransactions = await Promise.all([
        ...vaultAssets.map(async (asset) => {
          const { data } = await axios.post(
            `https://api.nf.domains/nfd/vault/sendFrom/${nfd}`,
            {
              amount: 0,
              assets: [asset.assetId],
              receiver: activeAddress,
              receiverType: "account",
              sender: activeAddress,
            }
          );

          const txns = JSON.parse(data).map((txn: string[]) =>
            algosdk.decodeUnsignedTransaction(Buffer.from(txn[1], "base64"))
          );

          return { ...asset, txns };
        }),
        ...inboxAssets.map(async (asset) => ({
          ...asset,
          txns: await generateARC59ClaimTxns(
            BigInt(asset.assetId),
            activeAddress,
            algodClient,
            activeNetwork
          ),
        })),
      ]);

      const allTransactions = assetsWithTransactions.flatMap(
        (asset) => asset.txns
      );
      if (!allTransactions.length) {
        toast.error("No assets to claim");
        return;
      }

      if (allTransactions.length > 200 && !mnemonic) {
        toast.error("Please enter your mnemonic using Infinity Mode");
        return;
      }

      const signedTransactions = await processTransactions(
        allTransactions,
        mnemonic,
        transactionSigner
      );

      await submitTransactions(
        signedTransactions,
        assetsWithTransactions,
        algodClient
      );

      toast.success("All transactions confirmed");
      toast.info("You can support by donating :)");
      setProcessStep(COMPLETED);

    } catch (error: any) {
      console.error("Claim error:", error);
      toast.error(`Failed to claim assets: ${error.message}`);
    } finally {
      setDisabled(false);
    }
  };

  const tableConfig = {
    headCells: [
      { id: "assetId", numeric: true, disablePadding: true, label: "Asset ID" },
      { id: "name", numeric: false, disablePadding: true, label: "Asset Name" },
      { id: "amount", numeric: true, disablePadding: true, label: "Amount" },
      {
        id: "type",
        numeric: false,
        disablePadding: true,
        label: "Asset Is In",
      },
    ] as HeadCell[],
    actions: [
      {
        tooltipTitle: "Claim",
        icon: <CallReceivedIcon />,
        onClick: handleClaimAssets,
      },
    ],
  };

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2 min-h-screen">
      <h1 className="text-2xl font-bold mt-1">
        {TOOLS.find((tool) => tool.path === window.location.pathname)?.label}
      </h1>

      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />

      {!activeAddress && (
        <p className="text-red-500">Please Connect your wallet!</p>
      )}

      {activeAddress && !isLoadingAssets && assets.length > 0 && processStep===INITIAL_STEP && (
        <EnhancedTable
          actions={tableConfig.actions}
          data={assets}
          headCells={tableConfig.headCells}
          title="Assets in Inbox & NFD Vault"
        />
      )}

      {activeAddress && !isLoadingAssets && assets.length > 0 && processStep===COMPLETED && (
        <div className="flex flex-col justify-center items-center w-[16rem]">
          <p className="pt-4 text-green-500 text-sm">
              Assets Claimed successfully!
              <br />
            </p>
            <p className="pb-2 text-slate-400 text-xs">
              You can reload the page if you want to use again.
            </p>
        </div>
      )}

      {activeAddress && !isLoadingAssets && !assets.length && (
        <p className="text-white">No assets to claim!</p>
      )}

      {activeAddress && isLoadingAssets && (
        <div className="mx-auto flex flex-col">
          <div className="spinner-border animate-spin inline-block mx-auto mt-4 w-8 h-8 border-4 rounded-full" />
          <p>Fetching Assets to be Claimed...</p>
        </div>
      )}

      <p className="text-center text-xs text-slate-400 py-2">
        ⚠️If you reload or close this page, you will lose your progress⚠️
        <br />
        You can reload the page if you want to stop/restart the process!
      </p>
    </div>
  );
};

const processTransactions = async (
  transactions: Transaction[],
  mnemonic: string,
  transactionSigner: any
) => {
  if (mnemonic) {
    if (mnemonic.split(" ").length !== 25) {
      throw new Error("Invalid Mnemonic");
    }
    const { sk } = algosdk.mnemonicToSecretKey(mnemonic);
    return SignWithSk(transactions, sk);
  }

  toast.info("Waiting for wallet to sign transactions...");
  const signed = await walletSign(transactions, transactionSigner);
  toast.success("Transactions signed!");
  return signed;
};

const submitTransactions = async (
  signedTransactions: any[],
  assetsWithTransactions: AssetWithTransactions[],
  algodClient: any
) => {
  let offset = 0;
  for (const [index, asset] of assetsWithTransactions.entries()) {
    const txns = signedTransactions.slice(offset, offset + asset.txns.length);
    offset += asset.txns.length;

    try {
      await algodClient.sendRawTransaction(txns).do();
      toast.success(
        `Transaction ${index + 1} of ${
          assetsWithTransactions.length
        } confirmed!`,
        {
          autoClose: 1000,
        }
      );
    } catch (error) {
      console.error("Transaction error:", error);
      toast.error(
        `Transaction ${index + 1} of ${assetsWithTransactions.length} failed!`,
        {
          autoClose: 1000,
        }
      );
    }
  }
};
