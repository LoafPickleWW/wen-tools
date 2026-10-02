import { ToolHero, TermSpinner } from "../components/cypher/ToolKit";
import { showDonationToast } from "../utils";
import { NetworkId, useWallet } from "@txnlab/use-wallet-react";
import algosdk, { Transaction } from "algosdk";
import axios from "axios";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
  generateARC59ClaimTxns,
  getAssetsInAssetInbox,
} from "../arc59-helpers";
import { TOOLS } from "../constants";
import { getIndexerURL, getNfdDomain, SignWithSk, walletSign } from "../utils";
import { EnhancedTable } from "../components/DataGrid";
import {
  ALGOXNFT_ADMIN,
  buildAlgoxClosePlan,
  findAlgoxListings,
  findAppListings,
  buildAppCancelGroup,
  simulateAppCancel,
  submitAppCancels,
  type AppListing,
  simulateAlgoxClose,
  submitAlgoxCloses,
  type AlgoxListing,
} from "../utils/algoxnft";
import InfinityModeComponent from "../components/InfinityModeComponent";
import { HeadCell } from "../types";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

interface Asset {
  assetId: number;
  amount: number;
  name: string;
  type: string;
  orgAmount:number;
  decimals:number;
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
  try {
    const version = data.properties.internal.ver;
    const [major, minor] = version.split(".").map(Number);
    if (major < 2 || (major === 2 && minor < 6)) {
      toast.error(
        "To Claim NFD vault Assets Please Upgrade Your NFD version to greater than 2.6"
      );
      return [];
    }
  } catch (error: any) {
    toast.error(`Error fetching NFD vault assets: ${error.message}`);
    console.error("Error fetching NFD vault assets:", error);
    return [];
  }

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
    orgAmount:asset.amount,
    decimals:data.asset.params.decimals,
    name: data.asset.params.name,
    type: asset.type,
  };
};

const ALGOX_TYPE = "AlgoxNFT listing";
const ALGOX_OPTIN_TYPE = "AlgoxNFT listing · opt-in";
const isAlgoxRow = (a: { type: string }) => a.type.startsWith("AlgoxNFT");

const INITIAL_STEP = 0;
const COMPLETED = 1;

export const BlukClaimTool = () => {
  const { activeAddress, activeNetwork, algodClient, transactionSigner, signTransactions } =
    useWallet();
  const [mnemonic, setMnemonic] = useState("");
  const [isLoadingAssets, setIsLoadingAssets] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nfd, setNFD] = useState("");
  const [processStep, setProcessStep] = useState(INITIAL_STEP);
  // AlgoxNFT escrow details for each table row id
  const [algoxListings, setAlgoxListings] = useState<Map<number, AlgoxListing>>(new Map());
  // Newer AlgoxNFT listings (Asalytic marketplace listing apps), by table row id
  const [appListings, setAppListings] = useState<Map<number, AppListing>>(new Map());

  useEffect(() => {
    const loadAssets = async () => {
      if (!activeAddress) {
        setIsLoadingAssets(false);
        return;
      }

      try {
        const indexerUrl = getIndexerURL(activeNetwork);
        const [inboxAssets, userNfd, listings, marketListings] = await Promise.all([
          getAssetsInAssetInbox(activeAddress, algodClient, activeNetwork),
          getNfdDomain(activeAddress),
          // Isolated: a failure here must not hide inbox/vault assets
          findAlgoxListings(activeAddress, algodClient, indexerUrl).catch((e) => {
            console.error("AlgoxNFT listing scan failed:", e);
            return [] as AlgoxListing[];
          }),
          findAppListings(activeAddress, algodClient, indexerUrl).catch((e) => {
            console.error("AlgoxNFT marketplace listing scan failed:", e);
            return [] as AppListing[];
          }),
        ]);

        setNFD(userNfd);
        const vaultAssets = await fetchNFDVaultAssets(userNfd, activeNetwork);

        const algoxRows = [...listings, ...marketListings].map((l) => ({
          assetId: l.assetId,
          amount: 1,
          type: l.needsOptIn ? ALGOX_OPTIN_TYPE : ALGOX_TYPE,
        }));
        const combined = [...inboxAssets, ...vaultAssets, ...algoxRows];
        const allAssets = await Promise.all(
          combined.map((asset, index) => getAssetDetails({ ...asset, id: index }, indexerUrl))
        );

        const byRow = new Map<number, AlgoxListing>();
        const firstAlgoxRow = inboxAssets.length + vaultAssets.length;
        listings.forEach((l, i) => byRow.set(firstAlgoxRow + i, l));
        setAlgoxListings(byRow);
        const byRowApp = new Map<number, AppListing>();
        marketListings.forEach((l, i) => byRowApp.set(firstAlgoxRow + listings.length + i, l));
        setAppListings(byRowApp);
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
      let claimedAny = false;
      const algoxSelected = selected.filter(isAlgoxRow);
      if (algoxSelected.length) {
        claimedAny = await claimAlgoxListings(algoxSelected);
      }
      const otherSelected = selected.filter((s) => !isAlgoxRow(s));
      if (!otherSelected.length) {
        if (claimedAny) {
          showDonationToast();
          setProcessStep(COMPLETED);
        }
        return;
      }

      const vaultAssets = otherSelected.filter((s) => s.type === "vault");
      const inboxAssets = otherSelected.filter((s) => s.type === "inbox");

      const assetsWithTransactions = await Promise.all([
        ...vaultAssets.map(async (asset) => {
          const { data } = await axios.post(
            `https://api.nf.domains/nfd/vault/sendFrom/${nfd}`,
            {
              amount: asset.orgAmount,
              amountStr: asset.orgAmount.toString(),
              assets: [asset.assetId],
              receiver: activeAddress,
              receiverType: "account",
              sender: activeAddress,
              receiverCanSign:true,
              note:
                "via wen.tools - free tools for creators and collectors | " +
                Math.random().toString(36).substring(2),
            }
          );

          const txns = JSON.parse(data).map((txn: string[]) =>
            algosdk.decodeUnsignedTransaction(Buffer.from(txn[1], "base64"))
          );

          console.log(txns, "txns",asset.assetId);

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
      showDonationToast();
      setProcessStep(COMPLETED);
    } catch (error: any) {
      console.error("Claim error:", error);
      toast.error(`Failed to claim assets: ${error.message}`);
    } finally {
      setDisabled(false);
    }
  };

  const signerFor = (count: number): { signer: (g: algosdk.Transaction[][], i: number[]) => Promise<(Uint8Array | null)[]> } | { sk: Uint8Array } => {
    if (mnemonic) {
      if (mnemonic.split(" ").length !== 25) throw new Error("Invalid Mnemonic");
      return { sk: algosdk.mnemonicToSecretKey(mnemonic).sk };
    }
    toast.info(`Approve ${count} AlgoxNFT claim${count > 1 ? "s" : ""} in your wallet…`);
    return { signer: (groups, indexes) => signTransactions(groups, indexes) };
  };

  /** Verifies (simulation), signs and cancels the selected marketplace listings. */
  const claimAppListings = async (rows: Asset[]): Promise<number> => {
    if (!activeAddress) return 0;
    const params = await algodClient.getTransactionParams().do();
    const groups = rows
      .map((r) => appListings.get(r.id))
      .filter((l): l is AppListing => !!l)
      .map((listing) => ({ listing, txns: buildAppCancelGroup(listing, activeAddress, params) }));
    if (!groups.length) return 0;

    const sims = await Promise.all(groups.map((g) => simulateAppCancel(algodClient, g.txns)));
    const ready = groups.filter((_, i) => sims[i].status === "ready");
    const rejected = sims.filter((r) => r.status === "rejected").length;
    const accountIssue = sims.find((r) => r.status === "account");
    if (rejected) toast.warn(`${rejected} AlgoxNFT listing${rejected > 1 ? "s" : ""} couldn't be cancelled and ${rejected > 1 ? "were" : "was"} skipped`);
    if (accountIssue && accountIssue.status === "account") toast.error(accountIssue.message);
    if (!ready.length) return 0;

    const results = await submitAppCancels(algodClient, ready, signerFor(ready.length), (done, total, assetId, ok) => {
      if (ok) toast.success(`Recovered ${assetId} (${done}/${total})`, { autoClose: 1200 });
      else toast.error(`Could not recover ${assetId} (${done}/${total})`, { autoClose: 2000 });
    });
    return results.filter((r) => r.txId).length;
  };

  /** Verifies, signs (one prompt per listing type) and closes the selected AlgoxNFT listings. */
  const claimAlgoxListings = async (rows: Asset[]): Promise<boolean> => {
    if (!activeAddress) return false;
    toast.info("Verifying AlgoxNFT listings on-chain…", { autoClose: 1500 });
    const marketRecovered = await claimAppListings(rows.filter((r) => appListings.has(r.id)));
    rows = rows.filter((r) => algoxListings.has(r.id));
    if (!rows.length) {
      if (marketRecovered) toast.success(`${marketRecovered} NFT${marketRecovered > 1 ? "s" : ""} recovered from AlgoxNFT`);
      return marketRecovered > 0;
    }
    const params = await algodClient.getTransactionParams().do();
    const plans = rows
      .map((r) => algoxListings.get(r.id))
      .filter((l): l is AlgoxListing => !!l)
      .map((l) => buildAlgoxClosePlan(l, activeAddress, params));

    const sims = await Promise.all(plans.map((p) => simulateAlgoxClose(algodClient, p)));
    const ready = plans.filter((_, i) => sims[i].status === "ready");
    const rejected = sims.filter((r) => r.status === "rejected").length;
    const accountIssue = sims.find((r) => r.status === "account");
    if (rejected) {
      toast.warn(`${rejected} AlgoxNFT listing${rejected > 1 ? "s" : ""} can't be closed this way and ${rejected > 1 ? "were" : "was"} skipped`);
    }
    if (accountIssue && accountIssue.status === "account") toast.error(accountIssue.message);
    if (!ready.length) return marketRecovered > 0;

    const results = await submitAlgoxCloses(algodClient, ready, signerFor(ready.length), (done, total, assetId, ok) => {
      if (ok) toast.success(`Recovered ${assetId} (${done}/${total})`, { autoClose: 1200 });
      else toast.error(`Could not recover ${assetId} (${done}/${total})`, { autoClose: 2000 });
    });
    const okCount = results.filter((r) => r.txId).length + marketRecovered;
    if (okCount) toast.success(`${okCount} NFT${okCount > 1 ? "s" : ""} recovered from AlgoxNFT`);
    return okCount > 0;
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
        icon: <span>Claim</span>,
        onClick: handleClaimAssets,
      },
    ],
  };

  return (
    <div className="mx-auto text-white mb-4 text-center flex flex-col items-center w-full max-w-[40rem] gap-y-3 px-4 min-h-screen">
      <Meta 
        title="Bulk Claim Tool" 
        description="Consolidate and claim your Algorand assets from ARC-59 Asset Inboxes and NFD Vaults in a single session. Professional asset recovery for active collectors."
      />
      <ToolHero
        tag="bulk claim"
        title={TOOLS.find((tool) => tool.path === window.location.pathname)?.label || "Bulk Claim"}
        description="Claim your Algorand assets from ARC-59 asset inboxes, NFD vaults and old AlgoxNFT listings in a single session."
        meta={["ARC-59 inbox", "NFD vaults", "AlgoxNFT listings", "auto opt-in"]}
      />
      <ConnectButton inmain={true} />



      {!activeAddress && (
        <p className="font-mono text-xs text-slate-500">// connect a wallet to scan your inbox, vaults and old AlgoxNFT listings</p>
      )}

      {activeAddress &&
        !isLoadingAssets &&
        assets.length > 0 &&
        processStep === INITIAL_STEP && (
          <EnhancedTable
            actions={tableConfig.actions}
            data={assets}
            headCells={tableConfig.headCells}
            title="Assets in Inbox & NFD Vault"
          />
        )}

      {activeAddress &&
        !isLoadingAssets &&
        assets.length > 0 &&
        processStep === COMPLETED && (
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
        <p className="font-mono text-sm text-slate-400">// nothing waiting in your inbox, vaults or AlgoxNFT listings</p>
      )}

      {activeAddress && isLoadingAssets && (
        <div className="mx-auto mt-4 flex flex-col items-center gap-3">
          <TermSpinner />
          <p className="font-mono text-xs text-slate-400">scanning inbox, vaults &amp; AlgoxNFT listings…</p>
        </div>
      )}

      {/* Practitioner Section: Asset Recovery (ARC-59) */}
      <InfinityModeComponent mnemonic={mnemonic} setMnemonic={setMnemonic} />
      <section className="mt-16 pt-12 border-t border-slate-800 w-full text-left px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">Asset Recovery (ARC-59)</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              ARC-59 introduces the concept of an "Asset Inbox", a decentralized mechanism for receiving assets without prior opt-ins. This tool scans your inbox and allows you to claim multiple assets in a single, coordinated operation. It is the gold standard for frictionless airdrops and community rewards, ensuring that your participation is rewarded without administrative overhead.
            </p>
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight italic">The NFD Vault Ecosystem</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Non-Fungible Domains (NFDs) provide sophisticated vault infrastructure for asset management. Assets sent to an NFD vault are secure and easily accessible via this interface. By consolidating your claims, you maintain a unified view of your on-chain inventory, leveraging the synergy between the NFD protocol and modern Algorand logistics tools.
            </p>
          </div>
          <div className="space-y-4 md:col-span-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Old AlgoxNFT Listings</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              NFTs listed for sale on AlgoxNFT and never sold are still held on-chain. Bulk Claim finds both kinds of
              listing, checks each one on-chain before you sign, opts you back in to the asset if needed, and returns
              the NFT to you. Newer listings (Asalytic composable marketplace) are cancelled through the marketplace
              itself, which also refunds the listing&apos;s ALGO deposit to you. For older escrow listings you only sign
              a 0 ALGO permission transaction; as written in that contract, the escrow&apos;s leftover ALGO goes to{" "}
              <span className="font-mono text-slate-300">algoxnft.algo</span>
              <span className="sr-only"> ({ALGOXNFT_ADMIN})</span>.
            </p>
          </div>
        </div>
      </section>
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
