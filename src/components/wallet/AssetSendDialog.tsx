import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { isValidAddress } from "algosdk";
import React, { useState } from "react";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import { SingleAssetDataResponse } from "../../types/wallet";
import {
  createAssetSendTransactions,
  getWalletAddressFromNfDomain,
  sendSignedTransaction,
} from "../../utils/wallet";
import { walletSign } from "../../utils";
import useWalletToolStore from "../../store/walletToolStore";

interface AssetSendDialogProps {
  open: boolean;
  balance: number;
  onClose: () => void;
  asset: SingleAssetDataResponse;
}

const AssetSendDialog: React.FC<AssetSendDialogProps> = ({
  open,
  onClose,
  asset,
  balance,
}) => {
  const { activeAddress, algodClient, transactionSigner } = useWallet();
  const [amount, setAmount] = useState(
    (balance / 10 ** asset.params.decimals).toString()
  );
  const [receiver, setReceiver] = useState("");
  const [loading, setLoading] = useState(false);

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
      if (Number(amount) > balance / 10 ** asset.params.decimals) {
        toast.info("Insufficient balance");
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

      const txns = await createAssetSendTransactions(
        [
          {
            amount: Number(amount),
            receiver: walletAddress,
            decimals: asset.params.decimals,
            index: asset.index,
          },
        ],
        activeAddress,
        algodClient
      );

      const signedTxn = await walletSign(txns, transactionSigner);

      await toast.promise(sendSignedTransaction(signedTxn, algodClient), {
        pending: "Sending transaction...",
        success: "Transaction sent successfully 🎉",
      });

      useWalletToolStore.getState().removeSelectedAsset(asset.index);
      setAmount("");
      setReceiver("");
      onClose();
    } catch (error: any) {
      toast.error(
        error.message?.split("TransactionPool.Remember:")[1] ||
          error.message ||
          "Something went wrong 😕"
      );
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle className="text-center max-w-md bg-zinc-900 text-white">
        {asset.params.name} - {asset.index}
      </DialogTitle>
      <DialogContent className="flex flex-col bg-zinc-900 text-white pt-4">
        <div className="flex justify-center items-center gap-2">
          <TextField
            label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            variant="filled"
            placeholder={`Balance: ${balance / 10 ** asset.params.decimals}`}
            sx={{ input: { color: 'white' }, label: { color: 'gray' } }}
          />
          <Button
            variant="outlined"
            color="warning"
            onClick={() =>
              setAmount((balance / 10 ** asset.params.decimals).toString())
            }
          >
            Max
          </Button>
        </div>
        <TextField
          label="Receiver"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          margin="dense"
          variant="filled"
          placeholder="algo or .algo address"
          sx={{ input: { color: 'white' }, label: { color: 'gray' } }}
        />
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

export default AssetSendDialog;
