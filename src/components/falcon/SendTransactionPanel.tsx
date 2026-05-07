import { useState } from "react";
import {
  Card,
  CardContent,
  TextField,
  Button,
  CircularProgress,
  InputAdornment,
} from "@mui/material";
import { IoSend, IoOpen } from "react-icons/io5";
import { toast } from "react-toastify";
import type { FalconAccount } from "../../utils/falcon";
import {
  sendTransaction,
  algosToMicroAlgos,
  getExplorerTxUrl,
  getDecryptedAccount,
} from "../../utils/falcon";
import PassphraseDialog from "./PassphraseDialog";

interface Props {
  account: FalconAccount;
  /** Called after a successful send so the parent can refresh balances */
  onSent?: () => void;
}

export default function SendTransactionPanel({ account, onSent }: Props) {
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [passphraseOpen, setPassphraseOpen] = useState(false);

  const doSend = async (decryptedAccount: FalconAccount) => {
    setSending(true);
    setLastTxId(null);
    try {
      const microAlgos = algosToMicroAlgos(amount);
      const txId = await sendTransaction(decryptedAccount, {
        receiver,
        amount: microAlgos,
        note: note || undefined,
      });
      setLastTxId(txId);
      toast.success("Transaction sent!");
      setReceiver("");
      setAmount("");
      setNote("");
      onSent?.();
    } catch (err: any) {
      console.error(err);
      toast.error(`Transaction failed: ${err.message || err}`);
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!receiver || !amount) {
      toast.warning("Please enter a receiver address and amount.");
      return;
    }

    const microAlgos = algosToMicroAlgos(amount);
    if (microAlgos <= 0) {
      toast.warning("Amount must be greater than 0.");
      return;
    }

    if (receiver.length !== 58) {
      toast.warning("Invalid Algorand address (should be 58 characters).");
      return;
    }

    if (account.encrypted) {
      setPassphraseOpen(true);
    } else {
      await doSend(account);
    }
  };

  const handlePassphraseSubmit = async (passphrase: string) => {
    const decrypted = await getDecryptedAccount(account, passphrase);
    setPassphraseOpen(false);
    await doSend(decrypted);
  };

  return (
    <>
      <Card variant="outlined">
        <CardContent className="flex flex-col gap-3">
          <h3 className="font-semibold text-base">Send from Falcon Account</h3>
          <p className="text-xs opacity-60">
            Signing happens locally with your Falcon private key via WASM. The
            signed transaction is submitted directly to an Algorand node.
          </p>

          <TextField
            label="Receiver Address"
            value={receiver}
            onChange={(e) => setReceiver(e.target.value)}
            placeholder="ALGO..."
            size="small"
            fullWidth
            InputProps={{
              sx: { fontFamily: "monospace", fontSize: "0.85rem" },
            }}
          />

          <TextField
            label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            size="small"
            type="number"
            fullWidth
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">Algo</InputAdornment>
              ),
            }}
          />

          <TextField
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. PQ test payment"
            size="small"
            fullWidth
          />

          <Button
            variant="contained"
            onClick={handleSend}
            disabled={sending}
            startIcon={
              sending ? <CircularProgress size={16} /> : <IoSend />
            }
            fullWidth
          >
            {sending ? "Signing & Submitting…" : "Send Transaction"}
          </Button>

          {lastTxId && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
              <span className="text-sm font-medium text-green-700 dark:text-green-400">
                Success!
              </span>
              <code className="text-xs font-mono truncate flex-1">
                {lastTxId}
              </code>
              <Button
                size="small"
                startIcon={<IoOpen />}
                onClick={() =>
                  window.open(
                    getExplorerTxUrl(lastTxId, account.network),
                    "_blank",
                  )
                }
              >
                View
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Passphrase dialog for encrypted accounts */}
      <PassphraseDialog
        open={passphraseOpen}
        onClose={() => setPassphraseOpen(false)}
        onSubmit={handlePassphraseSubmit}
        title="Unlock to Send"
        description="Enter your passphrase to decrypt the signing key for this transaction."
      />
    </>
  );
}
