import {
  Button,
  Grid,
  InputBase,
  MenuItem,
  OutlinedInput,
  Select,
  SelectChangeEvent,
} from "@mui/material";
import { isValidAddress } from "algosdk";
import Fuse from "fuse.js";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";

import AssetImageCard from "../components/wallet/AssetCard";
import GridPagination from "../components/wallet/GridPagination";
import SearchWalletInput from "../components/wallet/SearchWalletInput";
import TopArea from "../components/wallet/TopArea";
import SelectSubHeader from "../components/wallet/selects/SelectSubHeader";
import ConnectButton from "../components/ConnectButton";
import { Meta } from "../components/Meta";

import {
  PAGE_SIZE,
  filterByOptions,
  fuseSearchOptions,
  orderByOptions,
} from "../utils/wallet";
import { AssetsType } from "../types/wallet";
import {
  getAssetsFromAddress,
  getCreatedAssetsFromAddress,
  getWalletAddressFromNfDomain,
  getIndexerUrl,
} from "../utils/wallet";
import useWalletAssetStore from "../store/walletAssetStore";
import useWalletToolStore from "../store/walletToolStore";

const HOME_TOOLS = [
  { name: "Multi Send", id: "asset-send" },
  { name: "Multi Transfer", id: "asset-transfer" },
  { name: "Multi Opt-out", id: "asset-opt-out" },
  { name: "Multi Destroy", id: "asset-destroy" },
  { name: "Multi Copy", id: "asset-copy" },
];

const ACCOUNT_TOOLS = [
  { name: "Multi Opt-in", id: "asset-opt-in" },
  { name: "Multi Copy", id: "asset-copy" },
];

export function WenWallet() {
  const { activeAddress, activeNetwork } = useWallet();
  const toolState = useWalletToolStore((state) => state);
  const { account } = useParams();

  const [searchWallet, setSearchWallet] = useState("");
  const [resolvedAccountName, setResolvedAccountName] = useState("");
  const [assets, setAssets] = useState<AssetsType[]>([]);
  const [filteredAssets, setFilteredAssets] = useState<AssetsType[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [orderBy, setOrderBy] = useState("newest");
  const [isResolving, setIsResolving] = useState(false);

  const indexerUrl = getIndexerUrl(activeNetwork);
  const fuse = new Fuse(assets, fuseSearchOptions);

  const isOwner = !account || (searchWallet !== "" && searchWallet === activeAddress);
  const activeTools = isOwner ? HOME_TOOLS : ACCOUNT_TOOLS;

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleSearch = (search: string) => {
    if (search === "") {
      setFilteredAssets(assets);
      setTotalPages(Math.ceil(assets.length / PAGE_SIZE));
      setCurrentPage(1);
    } else {
      const results = fuse.search(search);
      setFilteredAssets(
        assets.filter((asset) =>
          results.find(
            (result) => result.item["asset-id"] === asset["asset-id"]
          )
        )
      );
      setTotalPages(Math.ceil(results.length / PAGE_SIZE));
      setCurrentPage(1);
    }
  };

  const handleOrderBy = (orderBy: SelectChangeEvent<string>) => {
    const { value } = orderBy.target;
    switch (value) {
      case "newest": {
        const newestAssets = [...filteredAssets].sort(
          (a, b) => b["opted-in-at-round"] - a["opted-in-at-round"]
        );
        setFilteredAssets(newestAssets);
        setTotalPages(Math.ceil(newestAssets.length / PAGE_SIZE));
        setCurrentPage(1);
        break;
      }
      case "oldest": {
        const oldestAssets = [...filteredAssets].sort(
          (a, b) => a["opted-in-at-round"] - b["opted-in-at-round"]
        );
        setFilteredAssets(oldestAssets);
        setTotalPages(Math.ceil(oldestAssets.length / PAGE_SIZE));
        setCurrentPage(1);
        break;
      }
      case "asset-id-asc": {
        const assetIdAsc = [...filteredAssets].sort(
          (a, b) => a["asset-id"] - b["asset-id"]
        );
        setFilteredAssets(assetIdAsc);
        setTotalPages(Math.ceil(assetIdAsc.length / PAGE_SIZE));
        setCurrentPage(1);
        break;
      }
      case "asset-id-desc": {
        const assetIdDesc = [...filteredAssets].sort(
          (a, b) => b["asset-id"] - a["asset-id"]
        );
        setFilteredAssets(assetIdDesc);
        setTotalPages(Math.ceil(assetIdDesc.length / PAGE_SIZE));
        setCurrentPage(1);
        break;
      }
      case "showAll":
        setFilteredAssets(assets);
        setTotalPages(Math.ceil(assets.length / PAGE_SIZE));
        setCurrentPage(1);
        break;
      case "showZero": {
        const showZeroResult = assets.filter((asset) => asset.amount === 0);
        setFilteredAssets(showZeroResult);
        setTotalPages(Math.ceil(showZeroResult.length / PAGE_SIZE));
        setCurrentPage(1);
        break;
      }
      case "showNonZero": {
        const showNonZeroResult = assets.filter((asset) => asset.amount !== 0);
        setFilteredAssets(showNonZeroResult);
        setTotalPages(Math.ceil(showNonZeroResult.length / PAGE_SIZE));
        setCurrentPage(1);
        break;
      }
      case "showCreated": {
        const createdAssetsIds = useWalletAssetStore
          .getState()
          .assets.filter((asset) => asset.params.creator === searchWallet)
          .map((asset) => asset.index);
        const showCreatedResult = assets.filter((asset) =>
          createdAssetsIds.includes(asset["asset-id"])
        );
        setFilteredAssets(showCreatedResult);
        setTotalPages(Math.ceil(showCreatedResult.length / PAGE_SIZE));
        setCurrentPage(1);
        break;
      }
      case "showNonCreated": {
        const nonCreatedAssetsIds = useWalletAssetStore
          .getState()
          .assets.filter((asset) => asset.params.creator !== searchWallet)
          .map((asset) => asset.index);
        const showNonCreatedResult = assets.filter((asset) =>
          nonCreatedAssetsIds.includes(asset["asset-id"])
        );
        setFilteredAssets(showNonCreatedResult);
        setTotalPages(Math.ceil(showNonCreatedResult.length / PAGE_SIZE));
        setCurrentPage(1);
        break;
      }
      default:
        break;
    }
    setOrderBy(value);
  };

  useEffect(() => {
    async function convertDomainToWalletAddress() {
      if (account) {
        const walletAddress = account.trim();
        setIsResolving(true);
        if (walletAddress.toLowerCase().includes(".algo")) {
          setResolvedAccountName(walletAddress.toLowerCase());
          const response = await getWalletAddressFromNfDomain(
            walletAddress.toLowerCase()
          );
          if (isValidAddress(response)) {
            setSearchWallet(response);
          } else {
            toast.error("NFD Domain could not be resolved!");
            setSearchWallet("");
          }
        } else if (isValidAddress(walletAddress)) {
          setResolvedAccountName("");
          setSearchWallet(walletAddress);
        } else {
          toast.error("Invalid address format!");
          setSearchWallet("");
        }
        setIsResolving(false);
      } else {
        setResolvedAccountName("");
        if (activeAddress) {
          setSearchWallet(activeAddress);
        } else {
          setSearchWallet("");
        }
      }
    }
    convertDomainToWalletAddress();
  }, [account, activeAddress]);

  useEffect(() => {
    async function getAssets() {
      const response = await getAssetsFromAddress(searchWallet, indexerUrl);
      setAssets(response);
      setFilteredAssets(response);
      setTotalPages(Math.ceil(response.length / PAGE_SIZE));
      setCurrentPage(1);
    }
    async function getCreatedAssets() {
      const response = await getCreatedAssetsFromAddress(searchWallet, indexerUrl);
      useWalletAssetStore.getState().setAssets(response);
    }

    if (searchWallet) {
      getCreatedAssets();
      getAssets();
    } else {
      setAssets([]);
      setFilteredAssets([]);
      setTotalPages(1);
      setCurrentPage(1);
    }
  }, [searchWallet, indexerUrl]);

  return (
    <article className="mx-auto text-white mb-20 flex flex-col items-start max-w-7xl w-full px-6 pt-12 min-h-screen">
      <Meta
        title={resolvedAccountName || (searchWallet ? `Wallet: ${searchWallet.substring(0, 8)}...` : "Wen Wallet")}
        description="Browse, manage, send, opt-in, opt-out, and destroy Algorand assets in bulk. Visual asset explorer for creators and collectors."
      />

      <header className="mb-10 border-b border-slate-800 pb-8 w-full">
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4 bg-gradient-to-r from-white via-slate-400 to-slate-600 bg-clip-text text-transparent italic uppercase">
          Wen Wallet
        </h1>
        <p className="text-lg text-slate-400 max-w-3xl leading-relaxed">
          visual portfolio asset browser with integrated bulk operations.
        </p>
      </header>

      {/* Top Search Area */}
      <section className="w-full mb-8">
        <SearchWalletInput />
      </section>

      {isResolving ? (
        <div className="flex justify-center items-center w-full py-20">
          <p className="text-slate-400 animate-pulse text-lg font-medium">Resolving domain address...</p>
        </div>
      ) : !searchWallet ? (
        <section className="flex flex-col text-center justify-center items-center py-20 w-full bg-zinc-900/40 border border-zinc-800 rounded-3xl">
          <h2 className="text-3xl font-black italic text-slate-300 uppercase">
            No Account Loaded
          </h2>
          <p className="text-slate-500 mt-4 max-w-sm">
            Connect your wallet to browse your assets, or type an address/NFD name in the search bar above.
          </p>
          <div className="mt-6">
            <ConnectButton inmain={true} />
          </div>
        </section>
      ) : (
        <section className="w-full">
          {/* Account Title details */}
          <div className="mb-6 p-5 bg-zinc-900/50 border border-zinc-800 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Active Account</p>
              <h3 className="text-xl font-mono text-amber-400 break-all select-all font-bold">
                {resolvedAccountName ? `${resolvedAccountName} (${searchWallet.substring(0, 6)}...)` : searchWallet}
              </h3>
              {!isOwner && (
                <span className="inline-block mt-2 px-2.5 py-0.5 bg-zinc-800 border border-zinc-700 text-[10px] text-slate-400 uppercase font-mono rounded">
                  Viewing Public Address
                </span>
              )}
            </div>
            {isOwner && (
              <div className="px-4 py-2 bg-amber-400/10 border border-amber-400/20 rounded-xl">
                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Owner Actions Enabled</p>
              </div>
            )}
          </div>

          <TopArea tools={activeTools} setFilteredAssets={setFilteredAssets} />
          
          <GridPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onChange={handlePageChange}
          />

          <div className="flex flex-row justify-between gap-x-2 sm:gap-x-0 mb-4 px-2 items-center">
            <InputBase
              placeholder="search within assets..."
              inputProps={{ "aria-label": "search by asset id" }}
              onChange={(e) => handleSearch(e.target.value)}
              className="bg-zinc-800 text-white rounded pl-3 py-1 my-2 border border-zinc-700 text-sm w-44 md:w-60 focus-within:border-amber-400"
              sx={{
                color: "white",
                "& input::placeholder": {
                  color: "white",
                  opacity: 0.7,
                },
              }}
            />
            <div className="flex flex-row gap-x-2">
              <Button
                variant="contained"
                color="warning"
                size="medium"
                sx={{
                  height: "2rem",
                  fontWeight: "bold",
                  fontSize: "0.8rem",
                }}
                onClick={() => {
                  filteredAssets
                    .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                    .forEach((asset) => {
                      if (!toolState.selectedAssets.includes(asset["asset-id"])) {
                        toolState.addSelectedAsset(asset["asset-id"]);
                      }
                    });
                }}
              >
                Select Page
              </Button>
              <Select
                displayEmpty
                value={orderBy}
                onChange={handleOrderBy}
                input={<OutlinedInput />}
                sx={{
                  height: "2rem",
                  color: "white",
                  backgroundColor: "#262626",
                  fontWeight: "bold",
                  fontSize: "0.9rem",
                  maxWidth: {
                    xs: "8rem",
                    sm: "100%",
                  },
                }}
                inputProps={{ "aria-label": "Without label" }}
              >
                <SelectSubHeader>Sort</SelectSubHeader>
                {orderByOptions.map((option: any) => (
                  <MenuItem
                    value={option.value}
                    key={option.value}
                    id={option.value}
                    sx={{ fontSize: "14px", color: "white" }}
                  >
                    {option.label}
                  </MenuItem>
                ))}
                <SelectSubHeader>Filter</SelectSubHeader>
                {filterByOptions.map((option: any) => (
                  <MenuItem
                    value={option.value}
                    key={option.value}
                    id={option.value}
                    sx={{ fontSize: "14px", color: "white" }}
                  >
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </div>
          </div>

          <Grid container spacing={3} sx={{ paddingX: "8px", marginBottom: 4 }}>
            {filteredAssets
              .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
              .map((asset) => (
                <Grid item xs={12} sm={6} md={4} lg={3} xl={2} key={asset["asset-id"]}>
                  <AssetImageCard
                    asset={asset}
                    page={isOwner ? "home" : "account"}
                    setFilteredAssets={setFilteredAssets}
                  />
                </Grid>
              ))}
          </Grid>

          <GridPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onChange={handlePageChange}
          />
        </section>
      )}
    </article>
  );
}
