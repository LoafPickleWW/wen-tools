import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import OutlinedInput from "@mui/material/OutlinedInput";
import Select from "@mui/material/Select";
import { Fragment, useState } from "react";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import { ToolSelectProps } from "../../../types/wallet";
import {
  createAssetDestroyTransactions,
  createAssetOptInTransactions,
  createAssetOptoutTransactions,
  copyAssetIds,
  sendSignedTransaction,
  getIndexerUrl,
} from "../../../utils/wallet";
import { walletSign } from "../../../utils";
import useWalletToolStore from "../../../store/walletToolStore";
import AssetTransferDialog from "../AssetTransferDialog";
import MultipleAssetSendDialog from "../MultipleAssetSendDialog";

export default function ToolSelect({
  tools,
  setFilteredAssets,
}: ToolSelectProps) {
  const { activeAddress, algodClient, transactionSigner, activeNetwork } = useWallet();
  const toolState = useWalletToolStore();
  const [isLoading, setIsLoading] = useState(false);
  const [openMultiSend, setOpenMultiSend] = useState(false);
  const [openAssetTransfer, setOpenAssetTransfer] = useState(false);

  const indexerUrl = getIndexerUrl(activeNetwork);

  const handleMultiSendDialog = () => {
    setOpenMultiSend(!openMultiSend);
  };

  const handleAssetTransferDialog = () => {
    setOpenAssetTransfer(!openAssetTransfer);
  };

  const handleOnClick = async () => {
    if (!activeAddress) {
      toast.error("Please connect your wallet!");
      return;
    }
    if (toolState.tool) {
      const toolId = toolState.tool.id;
      
      if (["asset-opt-out", "asset-opt-in", "asset-destroy"].includes(toolId)) {
        let signedTransactions;
        try {
          setIsLoading(true);
          
          let txns;
          if (toolId === "asset-opt-out") {
            txns = await createAssetOptoutTransactions(
              toolState.selectedAssets,
              activeAddress,
              algodClient,
              indexerUrl
            );
          } else if (toolId === "asset-opt-in") {
            txns = await createAssetOptInTransactions(
              toolState.selectedAssets,
              activeAddress,
              algodClient
            );
          } else { // asset-destroy
            txns = await createAssetDestroyTransactions(
              toolState.selectedAssets,
              activeAddress,
              algodClient,
              indexerUrl
            );
          }
          
          signedTransactions = await walletSign(txns, transactionSigner);
        } catch (error: any) {
          toast.error(
            error.message || "Something went wrong while creating transactions"
          );
          setIsLoading(false);
          return;
        }

        if (signedTransactions) {
          for (let i = 0; i < signedTransactions.length; i++) {
            try {
              await toast.promise(
                sendSignedTransaction([signedTransactions[i]], algodClient),
                {
                  pending: `${toolState.selectedAssets[i]}'s transaction sending...`,
                  success: `${toolState.selectedAssets[i]}'s transaction sent 🎉`,
                }
              );
              
              if (toolId === "asset-opt-out" || toolId === "asset-destroy") {
                setFilteredAssets((prev) =>
                  prev.filter(
                    (a) => a["asset-id"] !== toolState.selectedAssets[i]
                  )
                );
                toolState.removeSelectedAsset(toolState.selectedAssets[i]);
              }
            } catch (error: any) {
              toast.error(
                `${toolState.selectedAssets[i]}'s transaction is not sent: ` +
                  (error.message?.split("TransactionPool.Remember:")[1] ||
                    error.message ||
                    "Something went wrong")
              );
            }
          }
        }
      } else if (toolId === "asset-send") {
        handleMultiSendDialog();
      } else if (toolId === "asset-transfer") {
        handleAssetTransferDialog();
      } else if (toolId === "asset-copy") {
        copyAssetIds(toolState.selectedAssets);
      }
      setIsLoading(false);
    }
  };

  return (
    <div>
      {toolState.tool?.id === "asset-opt-out" && (
        <Alert severity="warning" className="my-1 sm:my-0 ml-0 sm:ml-2">
          Opting out of assets with a non-zero balance will result in a{" "}
          <strong>loss</strong> of asset.
        </Alert>
      )}
      <div className="flex flex-col sm:flex-row justify-start items-center">
        <FormControl sx={{ m: 1, minWidth: 120 }}>
          <Select
            native
            value={toolState.tool?.id || ""}
            input={<OutlinedInput />}
            sx={{
              height: "2rem",
              color: "white",
              fontWeight: "bold",
              fontSize: "1rem",
              backgroundColor: "#262626",
            }}
            inputProps={{ "aria-label": "Without label" }}
            id="tool-select-input"
            label="Select Tool"
            onChange={(e) => {
              const toolId = e.target.value;
              if (!toolId) {
                toolState.setTool(null);
                return;
              }
              const result = tools.find((tool) => tool.id === toolId);
              if (result) {
                toolState.setTool(result);
              }
            }}
          >
            <option aria-label="None" value="" style={{ color: "black" }}>
              Select Tool
            </option>
            {tools.map((tool) => (
              <option key={tool.id} value={tool.id} style={{ color: "black" }}>
                {tool.name}
              </option>
            ))}
          </Select>
        </FormControl>
        {toolState.selectedAssets.length > 0 && (
          <div className="flex flex-col sm:flex-row justify-between items-center gap-y-2 sm:gap-x-2">
            <p className="text-slate-400 text-sm">
              {toolState.selectedAssets.length} asset
              {toolState.selectedAssets.length > 1 ? "s" : ""} selected
            </p>
            {toolState.tool ? (
              <Button
                variant="contained"
                color="warning"
                onClick={handleOnClick}
                disabled={isLoading}
              >
                {isLoading ? "Sending..." : toolState.tool.name.split(" ")[1]}
              </Button>
            ) : (
              <Button
                variant="contained"
                color="inherit"
                sx={{ color: "black" }}
                onClick={toolState.clearSelectedAssets}
              >
                Clear
              </Button>
            )}
          </div>
        )}
        {toolState.selectedAssets.length === 0 && toolState.tool && (
          <p className="text-slate-400 text-sm">
            Please select assets to use {toolState.tool.name}.
          </p>
        )}
        <Fragment>
          <MultipleAssetSendDialog
            open={openMultiSend}
            onClose={handleMultiSendDialog}
          />
          <AssetTransferDialog
            open={openAssetTransfer}
            onClose={handleAssetTransferDialog}
          />
        </Fragment>
      </div>
    </div>
  );
}
