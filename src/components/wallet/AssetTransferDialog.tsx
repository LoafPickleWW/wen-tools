import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Tooltip,
} from "@mui/material";
import { isValidAddress } from "algosdk";
import React, { useState } from "react";
import { toast } from "react-toastify";
import { useWallet } from "@txnlab/use-wallet-react";
import {
  createAssetTransferTransactions,
  getAssetData,
  getWalletAddressFromNfDomain,
  getIndexerUrl,
  sendSignedTransaction,
  shortenAddress,
} from "../../utils/wallet";
import { walletSign } from "../../utils";
import useWalletAssetStore from "../../store/walletAssetStore";
import useWalletToolStore from "../../store/walletToolStore";

interface AssetTransferDialogProps {
  open: boolean;
  onClose: () => void;
}

const AssetTransferDialog: React.FC<AssetTransferDialogProps> = ({
  open,
  onClose,
}) => {
  const { activeAddress, activeWallet, algodClient, transactionSigner, activeNetwork } = useWallet();
  const toolState = useWalletToolStore((s) => s);
  const [amount, setAmount] = useState("1");
  const [receiver, setReceiver] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [unsignedAssets, setUnsignedAssets] = useState([] as any[]); // holds Transaction[][]

  const accounts = activeWallet?.accounts || [];
  const indexerUrl = getIndexerUrl(activeNetwork);

  const handleCreate = async () => {
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

      const createdTxns = await createAssetTransferTransactions(
        assetsForTransfer,
        activeAddress,
        algodClient
      );

      // Now we need the receiver to sign. 
      // In use-wallet-react, we sign using transactionSigner. If the receiver is connected in the active wallet,
      // use-wallet-react's signer will sign if the user selects that account or if the wallet signs for it.
      // We pass the flat list to walletSign.
      const signedOptin = await walletSign(createdTxns.flat(), transactionSigner);
      setUnsignedAssets(signedOptin);
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
      <DialogTitle className="text-center max-w-sm bg-zinc-900 text-white">Multi Transfer</DialogTitle>
      <DialogContent className="flex flex-col bg-zinc-900 text-white pt-4">
        <DialogContentText
          className="max-w-sm text-center text-slate-400"
          sx={{ fontSize: 14, mb: 2, px: 1 }}
        >
          Transfer multiple assets to a single address at once. You need to
          connect multiple accounts in your wallet to use this tool.
        </DialogContentText>
        <div className="flex flex-col gap-2">
          <TextField
            fullWidth
            label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            variant="filled"
            placeholder="Enter amount to send"
            sx={{ input: { color: 'white' }, label: { color: 'gray' } }}
          />
          {accounts.length > 1 ? (
            <FormControl variant="filled">
              <InputLabel id="receiver-label" sx={{ color: 'gray' }}>Receiver</InputLabel>
              <Select
                fullWidth
                labelId="receiver-label"
                id="receiver"
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                sx={{ color: 'white' }}
              >
                {accounts
                  .filter(
                    (account) => account.address !== activeAddress
                  )
                  .map((account) => (
                    <MenuItem key={account.address} value={account.address}>
                      {shortenAddress(account.address, 6)}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          ) : (
            <Alert severity="warning" className="text-center">
              You need to connect multiple accounts in your wallet to use this tool.
            </Alert>
          )}
        </div>
        <p className="max-w-sm text-center mt-2 font-roboto text-slate-300">
          {toolState.selectedAssets.length}
          <Tooltip
            title={toolState.selectedAssets.join(", ")}
            placement="left-start"
          >
            <span className="cursor-pointer text-primary-orange animate-pulse">
              {" "}
              assets{"  "}
            </span>
          </Tooltip>
          {sendLoading ? "left" : "selected"}
        </p>
        {unsignedAssets.length > 0 && (
          <Button
            variant="outlined"
            color="warning"
            disabled={sendLoading}
            sx={{ mt: 2, width: "70%", alignSelf: "center" }}
            onClick={async () => {
              setSendLoading(true);
              const assets = toolState.selectedAssets;
              for (let i = 0; i < unsignedAssets.length; i += 2) {
                try {
                  const group = [unsignedAssets[i], unsignedAssets[i + 1]];
                  await toast.promise(sendSignedTransaction(group, algodClient), {
                    pending: `${assets[i / 2]} sending...`,
                    success: `${assets[i / 2]} sent 🎉`,
                  });
                  toolState.removeSelectedAsset(assets[i / 2]);
                } catch (error: any) {
                  toast.error(
                    error.message?.split("TransactionPool.Remember:")[1] ||
                      error.message ||
                      `${assets[i / 2]} failed 😕`
                  );
                }
              }
              onClose();
              setAmount("1");
              setReceiver("");
              setUnsignedAssets([]);
              setSendLoading(false);
            }}
          >
            {sendLoading ? "Sending..." : "Send Transactions"}
          </Button>
        )}
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
          onClick={handleCreate}
          variant="contained"
          color="warning"
          disabled={
            loading ||
            accounts.length <= 1 ||
            unsignedAssets.length > 0
          }
        >
          {loading ? "Creating..." : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AssetTransferDialog;
