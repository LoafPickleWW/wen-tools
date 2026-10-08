import { IoGrid, IoList, IoWallet } from "react-icons/io5";
import { ToolHero, TermSpinner } from "../components/cypher/ToolKit";
import { Reticle } from "../components/cypher/Reticle";
import {
  Button,
  Grid,
  InputBase,
  MenuItem,
  OutlinedInput,
  Select,
  SelectChangeEvent,
  useMediaQuery,
} from "@mui/material";
import { isValidAddress } from "algosdk";
import Fuse from "fuse.js";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useWallet } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";

import AssetImageCard from "../components/wallet/AssetCard";
import AssetListRow from "../components/wallet/AssetListRow";
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

const VIEW_MODE_KEY = "wenwallet_view_mode";

function readViewMode(): "grid" | "list" {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

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
  const [viewMode, setViewMode] = useState<"grid" | "list">(readViewMode);
  // List view is a mobile-only option; matches Tailwind's sm breakpoint.
  const isMobile = useMediaQuery("(max-width: 639.98px)");
  const showList = isMobile && viewMode === "list";

  const changeViewMode = (mode: "grid" | "list") => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // storage unavailable; keep the in-memory choice
    }
  };

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

      <ToolHero
        icon={<IoWallet aria-hidden="true" />}
        tag="wallet"
        title="Wen Wallet"
        description="A visual browser for any Algorand account, with bulk send, opt-in, opt-out and destroy built in."
        meta={["any address or NFD", "bulk send", "opt-in / opt-out", "destroy"]}
      />

      {/* Top Search Area */}
      <section className="w-full mb-8">
        <SearchWalletInput />
      </section>

      {isResolving ? (
        <div className="flex justify-center items-center w-full py-20">
          <div className="flex flex-col items-center gap-3"><TermSpinner /><p className="font-mono text-sm text-slate-400">resolving NFD → address…</p></div>
        </div>
      ) : !searchWallet ? (
        <section className="wt-frame group relative flex flex-col text-center justify-center items-center py-20 w-full bg-banner-grey/40 border border-white/[0.07] rounded-3xl [--wt-r:24px] [--wt-in:12px]">
          <Reticle />
          <p className="wt-label">( no account loaded )</p>
          <h2 className="mt-4 text-3xl font-semibold text-white">
            Open any wallet
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
          <div className="mb-6 p-5 bg-banner-grey/50 border border-white/[0.07] rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 backdrop-blur">
            <div>
              <p className="font-mono text-[11px] text-slate-500 mb-1">// active account</p>
              <h3 className="text-lg font-mono text-primary-orange break-all select-all font-medium">
                {resolvedAccountName ? `${resolvedAccountName} (${searchWallet.substring(0, 6)}...)` : searchWallet}
              </h3>
              {!isOwner && (
                <span className="inline-flex items-center gap-1.5 mt-2 px-2 py-0.5 bg-primary-black/50 border border-white/[0.08] text-[10px] text-slate-400 uppercase font-mono rounded-md">
                  Viewing Public Address
                </span>
              )}
            </div>
            {isOwner && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-400/10 border border-emerald-400/20 rounded-xl">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <p className="font-mono text-[11px] text-emerald-400">signer connected · owner actions on</p>
              </div>
            )}
          </div>

          <TopArea tools={activeTools} setFilteredAssets={setFilteredAssets} />
          
          <GridPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onChange={handlePageChange}
          />

          <div className="flex flex-col sm:flex-row justify-between gap-3 mb-6 px-2 items-stretch sm:items-center">
            <InputBase
              placeholder="filter assets…"
              inputProps={{ "aria-label": "search by asset id" }}
              onChange={(e) => handleSearch(e.target.value)}
              className="bg-banner-grey text-white rounded-xl pl-3 py-1.5 border border-white/10 font-mono text-sm w-full sm:w-60 focus-within:border-primary-orange"
              sx={{
                color: "white",
                "& input::placeholder": {
                  color: "white",
                  opacity: 0.7,
                },
              }}
            />
            <div className="flex flex-row gap-2 justify-between sm:justify-end">
              <div
                className="flex sm:hidden shrink-0 rounded-[10px] border border-white/10 bg-banner-grey overflow-hidden"
                role="group"
                aria-label="Asset view"
              >
                {([
                  { mode: "grid", Icon: IoGrid, label: "Grid view" },
                  { mode: "list", Icon: IoList, label: "List view" },
                ] as const).map(({ mode, Icon, label }) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={label}
                    aria-pressed={viewMode === mode}
                    onClick={() => changeViewMode(mode)}
                    className={`h-9 w-9 flex items-center justify-center transition ${
                      viewMode === mode
                        ? "bg-primary-orange text-[#0c0a08]"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
              <Button
                variant="contained"
                size="medium"
                sx={{
                  background: "linear-gradient(135deg, rgb(var(--brand)), rgb(var(--brand-2)))",
                  color: "#0c0a08",
                  boxShadow: "0 8px 28px -12px rgb(var(--brand) / 0.9)",
                  "&:hover": { filter: "brightness(1.07)", boxShadow: "0 8px 28px -12px rgb(var(--brand))" },
                  height: "2.25rem",
                  fontWeight: "bold",
                  fontSize: "0.85rem",
                  borderRadius: "10px",
                  textTransform: "none",
                  whiteSpace: "nowrap",
                  flex: { xs: 1, sm: "initial" },
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
                input={<OutlinedInput sx={{ borderRadius: "10px" }} />}
                sx={{
                  height: "2.25rem",
                  color: "white",
                  backgroundColor: "rgb(var(--surface))",
                  fontWeight: "bold",
                  fontSize: "0.85rem",
                  minWidth: { xs: "120px", sm: "160px" },
                  flex: { xs: 1, sm: "initial" },
                }}
                inputProps={{ "aria-label": "Without label" }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      bgcolor: "rgb(var(--surface-3))",
                      color: "white",
                      border: "1px solid rgb(255 255 255 / 0.1)",
                      borderRadius: "12px",
                      marginTop: "4px",
                      boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.5)",
                      "& .MuiMenuItem-root": {
                        fontSize: "13px",
                        color: "#e4e4e7",
                        paddingY: "8px",
                        "&:hover": {
                          bgcolor: "rgb(var(--surface))",
                        },
                        "&.Mui-selected": {
                          bgcolor: "rgb(var(--surface-2))",
                          color: "rgb(var(--brand))",
                          fontWeight: "bold",
                          "&:hover": {
                            bgcolor: "rgb(var(--surface-2))",
                          },
                        },
                      },
                      "& .MuiListSubheader-root": {
                        bgcolor: "rgb(var(--surface-3))",
                        color: "#a1a1aa",
                        fontWeight: "bold",
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        lineHeight: "26px",
                      },
                    },
                  },
                }}
              >
                <SelectSubHeader>Sort</SelectSubHeader>
                {orderByOptions.map((option: any) => (
                  <MenuItem
                    value={option.value}
                    key={option.value}
                    id={option.value}
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
                  >
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </div>
          </div>

          {showList ? (
            <ul className="flex flex-col gap-1.5 px-2 mb-8">
              {filteredAssets
                .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                .map((asset) => (
                  <AssetListRow key={asset["asset-id"]} asset={asset} />
                ))}
            </ul>
          ) : (
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
          )}

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
