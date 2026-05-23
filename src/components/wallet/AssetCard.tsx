import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  MenuList,
} from "@mui/material";
import React, { MouseEvent, useEffect, useState } from "react";
import { IoMdMore } from "react-icons/io";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import { AssetsType, SingleAssetDataResponse } from "../../types/wallet";
import {
  copyAssetIds,
  createAssetDestroyTransactions,
  createAssetOptInTransactions,
  createAssetOptoutTransactions,
  createDeletedAssetOptoutTransactions,
  getAssetData,
  getAssetDirectionUrl,
  getAssetType,
  getWalletDirectionUrl,
  ipfsToUrl,
  getIndexerUrl,
  sendSignedTransaction,
  shortenAddress,
  formatWithCommas,
  MAX_SELECT_COUNT,
} from "../../utils/wallet";
import { walletSign } from "../../utils";
import useWalletAssetStore from "../../store/walletAssetStore";
import useWalletToolStore from "../../store/walletToolStore";
import AssetSendDialog from "./AssetSendDialog";

interface AssetImageCardProps {
  asset: AssetsType;
  page: "home" | "account";
  setFilteredAssets: React.Dispatch<React.SetStateAction<AssetsType[]>>;
}

const AssetImageCard = ({
  asset,
  page,
  setFilteredAssets,
}: AssetImageCardProps) => {
  const { activeAddress, algodClient, transactionSigner, activeNetwork } = useWallet();
  const [assetData, setAssetData] = useState<SingleAssetDataResponse>();
  const [assetUrl, setAssetUrl] = useState<string>("/images/wallet/loading.gif");
  const toolState = useWalletToolStore((state) => state);

  const indexerUrl = getIndexerUrl(activeNetwork);

  const AssetCardOptions = () => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const rowOptionsOpen = Boolean(anchorEl);

    const handleRowOptionsClick = (event: MouseEvent<HTMLElement>) => {
      setAnchorEl(event.currentTarget);
    };

    const handleRowOptionsClose = () => {
      setAnchorEl(null);
    };

    async function itemOnClick(
      pendingMessage: string,
      successMessage: string,
      transactionFunction: any
    ) {
      try {
        if (!activeAddress) {
          toast.error("Please connect your wallet!");
          return;
        }
        if (!assetData) return null;
        setIsLoading(true);
        
        let txns;
        if (transactionFunction === createAssetDestroyTransactions) {
          txns = await createAssetDestroyTransactions([assetData.index], activeAddress, algodClient, indexerUrl);
        } else if (transactionFunction === createAssetOptoutTransactions) {
          txns = await createAssetOptoutTransactions([assetData.index], activeAddress, algodClient, indexerUrl);
        } else if (transactionFunction === createAssetOptInTransactions) {
          txns = await createAssetOptInTransactions([assetData.index], activeAddress, algodClient);
        } else if (transactionFunction === createDeletedAssetOptoutTransactions) {
          txns = await createDeletedAssetOptoutTransactions([assetData.index], activeAddress, algodClient);
        } else {
          throw new Error("Invalid transaction function");
        }

        const signedTxn = await walletSign(txns, transactionSigner);
        
        await toast.promise(sendSignedTransaction(signedTxn, algodClient), {
          pending: pendingMessage,
          success: successMessage,
        });
        handleRowOptionsClose();
        if (
          transactionFunction === createAssetDestroyTransactions ||
          transactionFunction === createAssetOptoutTransactions
        ) {
          setFilteredAssets((prev) =>
            prev.filter((a) => a["asset-id"] !== assetData.index)
          );
        }
      } catch (error: any) {
        toast.error(
          error.message?.split("TransactionPool.Remember:")[1] ||
            error.message ||
            "Something went wrong"
        );
      }
      setIsLoading(false);
    }

    if (!assetData) return null;

    const handleDialog = () => {
      setOpen(!open);
    };

    const MenuItems = () => {
      return (
        <MenuList disablePadding className="bg-zinc-950 text-white">
          {page === "home" ? (
            <div>
              {asset.amount > 0 && (
                <MenuItem
                  onClick={() => {
                    handleRowOptionsClose();
                    handleDialog();
                  }}
                  sx={{ "& svg": { mr: 2 }, ":hover": { backgroundColor: "#f57b14", color: "white" } }}
                >
                  Send
                </MenuItem>
              )}
              {assetData.params.creator === activeAddress && (
                <MenuItem
                  sx={{ "& svg": { mr: 2 }, ":hover": { backgroundColor: "#f57b14", color: "white" } }}
                  onClick={async () =>
                    await itemOnClick(
                      "Asset destroying...",
                      "Asset destroyed successfully 🎉",
                      createAssetDestroyTransactions
                    )
                  }
                >
                  Destroy
                </MenuItem>
              )}
              {assetData.params.creator !== activeAddress &&
                !assetData.deleted && (
                  <MenuItem
                    sx={{ "& svg": { mr: 2 }, ":hover": { backgroundColor: "#f57b14", color: "white" } }}
                    onClick={async () =>
                      await itemOnClick(
                        "Opting-out...",
                        "Opted-out successfully 🎉",
                        createAssetOptoutTransactions
                      )
                    }
                  >
                    Opt-out
                  </MenuItem>
                )}
            </div>
          ) : (
            <MenuItem
              sx={{ "& svg": { mr: 2 }, ":hover": { backgroundColor: "#f57b14", color: "white" } }}
              onClick={async () => {
                await itemOnClick(
                  "Opting-in...",
                  "Opted-in successfully 🎉",
                  createAssetOptInTransactions
                );
              }}
            >
              Opt-in
            </MenuItem>
          )}
          <MenuItem
            sx={{ "& svg": { mr: 2 }, ":hover": { backgroundColor: "#f57b14", color: "white" } }}
            onClick={() => {
              copyAssetIds([assetData.index]);
              handleRowOptionsClose();
            }}
          >
            Copy Id
          </MenuItem>
        </MenuList>
      );
    };

    return (
      <React.Fragment>
        <IconButton size="small" onClick={handleRowOptionsClick} sx={{ color: "white" }}>
          <IoMdMore />
        </IconButton>
        <Menu
          keepMounted
          anchorEl={anchorEl}
          open={rowOptionsOpen}
          onClose={handleRowOptionsClose}
          anchorOrigin={{
            vertical: "bottom",
            horizontal: "right",
          }}
          transformOrigin={{
            vertical: "top",
            horizontal: "right",
          }}
          PaperProps={{ style: { minWidth: "6rem", backgroundColor: "#1A171A" } }}
        >
          {isLoading ? (
            <MenuItem disabled>
              <CircularProgress color="warning" size={24} sx={{ ml: 2 }} />
            </MenuItem>
          ) : (
            <MenuItems />
          )}
        </Menu>
        <AssetSendDialog
          balance={asset.amount}
          asset={assetData}
          onClose={handleDialog}
          open={open}
        />
      </React.Fragment>
    );
  };

  useEffect(() => {
    async function getData() {
      const stateData = useWalletAssetStore
        .getState()
        .assets.find((a) => a.index === asset["asset-id"]);
      if (stateData) {
        setAssetData(stateData);
        const url = await ipfsToUrl(
          stateData.params.url,
          stateData.params.reserve
        );
        setAssetUrl(url);
        return;
      }
      const response = await getAssetData(asset["asset-id"], indexerUrl);
      setAssetData(response);
      useWalletAssetStore.getState().addAsset(response);
      const url = await ipfsToUrl(response.params.url, response.params.reserve);
      setAssetUrl(url);
    }
    if (!asset["asset-id"]) return;
    getData();
  }, [asset, indexerUrl]);

  const handleCardClick = (assetId: number) => {
    const selectedAssets = toolState.selectedAssets;
    if (selectedAssets.includes(assetId)) {
      toolState.removeSelectedAsset(assetId);
      return;
    }
    if (selectedAssets.length < MAX_SELECT_COUNT) {
      toolState.addSelectedAsset(assetId);
    } else {
      toast.info(`You can only select ${MAX_SELECT_COUNT} assets at a time.`);
    }
  };

  return (
    <>
      {assetData && (
        <Card sx={{ minHeight: "100%", backgroundColor: "#1c191c", border: "1px solid #2d292d" }}>
          <CardActionArea onClick={() => handleCardClick(asset["asset-id"])}>
            <CardMedia
              component="img"
              alt={assetData.params.name}
              height="150"
              image={assetUrl || "/images/wallet/404.webp"}
              className="w-full aspect-square p-1"
              loading="lazy"
              onError={() => setAssetUrl("/images/wallet/404.webp")}
            />
            <Checkbox
              checked={toolState.selectedAssets.includes(asset["asset-id"])}
              style={{
                position: "absolute",
                top: "0px",
                right: "0px",
                color: toolState.selectedAssets.includes(asset["asset-id"])
                  ? "#f57b14"
                  : "black",
              }}
              inputProps={{ "aria-label": `Select image ${asset["asset-id"]}` }}
            />
            {assetData?.params && (
              <>
                {getAssetType(assetData.params.url) !== "-" && (
                  <Chip
                    label={getAssetType(assetData.params.url)}
                    size="small"
                    className="absolute bottom-2 left-2"
                    variant="filled"
                    color="warning"
                    title="Asset Type"
                  />
                )}
                <Chip
                  label={`Balance: ${
                    formatWithCommas(asset.amount / 10 ** assetData.params.decimals)
                  }`}
                  size="small"
                  className="absolute bottom-2 right-2"
                  variant="filled"
                  color="warning"
                />
              </>
            )}
          </CardActionArea>
          <CardContent
            sx={{
              paddingBottom: "8px !important",
            }}
          >
            {!assetData.deleted ? (
              <>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    my: -1,
                  }}
                >
                  <span className="text-lg text-secondary-orange ml-0.5 font-medium flex items-center">
                    {assetData.params.name}
                  </span>
                  <AssetCardOptions />
                </Box>
                <div className="flex flex-col mt-2">
                  <a
                    href={getAssetDirectionUrl(asset["asset-id"])}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-0.5 text-slate-400 text-sm font-medium hover:text-white transition"
                  >
                    {assetData?.params["unit-name"]
                      ? assetData?.params["unit-name"] + " - "
                      : ""}{" "}
                    {asset["asset-id"]}
                  </a>
                  <a
                    href={getWalletDirectionUrl(assetData.params.creator)}
                    className="ml-0.5 text-slate-400 text-sm font-medium hover:text-white transition"
                  >
                    Creator: {shortenAddress(assetData.params.creator)}
                  </a>
                </div>
              </>
            ) : (
              <>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    my: -1,
                  }}
                >
                  <a
                    href={getAssetDirectionUrl(asset["asset-id"])}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-0.5 text-slate-400 text-sm font-medium hover:underline hover:text-white transition duration-150"
                  >
                    {asset["asset-id"]}
                  </a>
                  <AssetCardOptions />
                </Box>
                <div className="flex flex-col mt-2">
                  <p className="ml-0.5 text-red-500 text-sm font-medium text-center my-2">
                    DELETED
                  </p>
                  {!window.location.pathname.includes("/account") && (
                    <Button
                      variant="contained"
                      color="error"
                      fullWidth
                      sx={{
                        "&:hover": { backgroundColor: "#e53935" },
                        mt: 2,
                        width: "50%",
                        margin: "auto",
                      }}
                      onClick={async () => {
                        try {
                          if (!activeAddress) {
                            toast.error("Please connect your wallet!");
                            return;
                          }
                          await toast.promise(
                            sendSignedTransaction(
                              await walletSign(
                                [await createDeletedAssetOptoutTransactions([assetData.index], activeAddress, algodClient)],
                                transactionSigner
                              ),
                              algodClient
                            ),
                            {
                              pending: "Opting-out...",
                              success: "Opted-out successfully 🎉",
                            }
                          );
                          setFilteredAssets((prev) =>
                            prev.filter(
                              (a) => a["asset-id"] !== assetData.index
                            )
                          );
                        } catch (error: any) {
                          toast.error(
                            error.message?.split(
                              "TransactionPool.Remember:"
                            )[1] ||
                              error.message ||
                              "Something went wrong"
                          );
                        }
                      }}
                    >
                      Opt-out
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
};

export default AssetImageCard;
