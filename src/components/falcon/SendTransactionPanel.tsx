import { useState } from "react";
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
      <div className="border border-slate-800 rounded-2xl p-6 bg-primary-black/40 flex flex-col gap-4">
        <h3 className="font-bold text-base text-white">
          Send from Falcon Account
        </h3>
        <p className="text-xs text-slate-500">
          Signing happens locally with your Falcon private key via WASM. The
          signed transaction is submitted directly to an Algorand node.
        </p>

        <input
          type="text"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          placeholder="Receiver Address (ALGO...)"
          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-white placeholder-slate-600 focus:border-primary-yellow focus:outline-none transition"
        />

        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 pr-16 text-sm text-white placeholder-slate-600 focus:border-primary-yellow focus:outline-none transition"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-semibold">
            Algo
          </span>
        </div>

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-primary-yellow focus:outline-none transition"
        />

        <button
          onClick={handleSend}
          disabled={sending}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary-yellow text-black font-bold text-sm hover:bg-primary-orange transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? (
            <>
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Signing & Submitting…
            </>
          ) : (
            <>
              <IoSend /> Send Transaction
            </>
          )}
        </button>

        {lastTxId && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/30">
            <span className="text-sm font-bold text-green-400">
              Success!
            </span>
            <code className="text-xs font-mono truncate flex-1 text-green-300">
              {lastTxId}
            </code>
            <button
              onClick={() =>
                window.open(
                  getExplorerTxUrl(lastTxId, account.network),
                  "_blank",
                )
              }
              className="flex items-center gap-1 text-xs font-semibold text-green-400 hover:text-green-300 transition"
            >
              <IoOpen /> View
            </button>
          </div>
        )}
      </div>

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
