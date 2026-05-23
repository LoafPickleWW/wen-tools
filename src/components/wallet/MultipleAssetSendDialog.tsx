import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  Tooltip,
} from "@mui/material";
import { isValidAddress } from "algosdk";
import React, { useState } from "react";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import {
  createAssetSendTransactions,
  getAssetData,
  getWalletAddressFromNfDomain,
  getIndexerUrl,
  sendSignedTransaction,
} from "../../utils/wallet";
import { walletSign } from "../../utils";
import useWalletAssetStore from "../../store/walletAssetStore";
import useWalletToolStore from "../../store/walletToolStore";

interface MultipleAssetSendDialogProps {
  open: boolean;
  onClose: () => void;
}

const MultipleAssetSendDialog: React.FC<MultipleAssetSendDialogProps> = ({
  open,
  onClose,
}) => {
  const { activeAddress, algodClient, transactionSigner, activeNetwork } = useWallet();
  const toolState = useWalletToolStore((s) => s);

  const [amount, setAmount] = useState("1");
  const [receiver, setReceiver] = useState("");
  const [loading, setLoading] = useState(false);

  const indexerUrl = getIndexerUrl(activeNetwork);

  const handleSend = async () => {
    try {
      if (!activeAddress) {
        toast.error("Please connect your wallet!");
        return;
      }
      if (!amount || !receiver) {
        toast.info("Please fill all fields");
        return;
      }
      if (Number(amount) <= 0) {
        toast.info("Amount must be greater than 0");
        return;
      }
      let walletAddress = receiver.trim();
      setLoading(true);
      if (walletAddress.toLowerCase().includes(".algo")) {
        const response = await getWalletAddressFromNfDomain(
          walletAddress.toLowerCase()
        );
        if (isValidAddress(response)) {
          walletAddress = response;
        } else {
          toast.error("Invalid receiver address!");
          setLoading(false);
          return;
        }
      } else if (!isValidAddress(walletAddress)) {
        toast.error("Invalid receiver address!");
        setLoading(false);
        return;
      }

      let assetsForTransfer = [];
      const assets = toolState.selectedAssets;
      for (let i = 0; i < assets.length; i++) {
        let storedAsset = useWalletAssetStore.getState().assets.find(a => a.index === assets[i]);
        if (!storedAsset) {
          storedAsset = await getAssetData(assets[i], indexerUrl);
        }
        assetsForTransfer.push({
          index: assets[i],
          amount: Number(amount),
          decimals: storedAsset.params.decimals,
          receiver: walletAddress,
        });
      }

      const txns = await createAssetSendTransactions(
        assetsForTransfer,
        activeAddress,
        algodClient
      );

      const signedTransactions = await walletSign(txns, transactionSigner);

      for (let i = 0; i < signedTransactions.length; i++) {
        await toast.promise(sendSignedTransaction([signedTransactions[i]], algodClient), {
          pending: `${assets[i]} sending...`,
          success: `${assets[i]} sent 🎉`,
        });
        toolState.removeSelectedAsset(assets[i]);
      }
      setAmount("1");
      setReceiver("");
      onClose();
    } catch (error: any) {
      toast.error(
        error.message?.split("TransactionPool.Remember:")[1] ||
          error.message ||
          "Something went wrong"
      );
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle className="text-center max-w-sm bg-zinc-900 text-white">Multi Send</DialogTitle>
      <DialogContent className="flex flex-col bg-zinc-900 text-white pt-4">
        <DialogContentText
          className="max-w-sm text-center text-slate-400"
          sx={{ fontSize: 14, mb: 2, px: 1 }}
        >
          Send multiple assets to a single address at once.
        </DialogContentText>
        <TextField
          label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          variant="filled"
          placeholder="Amount"
          sx={{ input: { color: 'white' }, label: { color: 'gray' }, mb: 2 }}
        />
        <TextField
          label="Receiver"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          margin="dense"
          variant="filled"
          placeholder="algo or .algo address"
          sx={{ input: { color: 'white' }, label: { color: 'gray' } }}
        />
        <p className="max-w-sm text-center mt-2 font-roboto text-slate-300">
          {toolState.selectedAssets.length}
          <Tooltip
            title={toolState.selectedAssets.join(", ")}
            placement="left-start"
          >
            <span className="cursor-pointer text-primary-orange animate-pulse">
              {" "}
              assets{" "}
            </span>
          </Tooltip>
          selected
        </p>
      </DialogContent>
      <DialogActions className="flex justify-center bg-zinc-900 pb-4">
        <Button
          variant="text"
          color="warning"
          onClick={() => {
            setAmount("");
            setReceiver("");
            onClose();
          }}
        >
          Close
        </Button>
        <Button
          onClick={handleSend}
          variant="contained"
          color="warning"
          disabled={loading}
        >
          {loading ? "Sending..." : "Send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MultipleAssetSendDialog;
