import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import { IoSend, IoOpen, IoSearch, IoWallet } from "react-icons/io5";
import { toast } from "react-toastify";
import type { FalconAccount } from "../../utils/falcon";
import {
  sendFalconPayment,
  algosToMicroAlgos,
  getExplorerTxUrl,
  getDecryptedAccount,
  resolveNfd,
} from "../../utils/falcon";
import PassphraseDialog from "./PassphraseDialog";
import ConnectButton from "../ConnectButton";

interface Props {
  account: FalconAccount;
  onSent?: () => void;
}

export default function SendTransactionPanel({ account, onSent }: Props) {
  const { activeAddress, transactionSigner } = useWallet();

  const [receiver, setReceiver] = useState("");
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolvingNfd, setResolvingNfd] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [passphraseOpen, setPassphraseOpen] = useState(false);

  // Debounced NFD resolution
  const resolveReceiver = useCallback(
    async (input: string) => {
      // Reset
      setResolvedAddress(null);

      // If it's exactly 58 chars, it's a raw address
      if (input.length === 58) {
        setResolvedAddress(input);
        return;
      }

      // If it looks like an NFD name (contains .algo)
      if (input.includes(".algo") && input.length > 5) {
        setResolvingNfd(true);
        try {
          const addr = await resolveNfd(input, account.network);
          if (addr) {
            setResolvedAddress(addr);
          }
        } catch {
          // ignore
        } finally {
          setResolvingNfd(false);
        }
      }
    },
    [account.network],
  );

  useEffect(() => {
    if (!receiver.trim()) {
      setResolvedAddress(null);
      return;
    }
    const timer = setTimeout(() => resolveReceiver(receiver.trim()), 400);
    return () => clearTimeout(timer);
  }, [receiver, resolveReceiver]);

  const getEffectiveReceiver = (): string | null => {
    return resolvedAddress;
  };

  const doSend = async (decryptedAccount: FalconAccount) => {
    const effectiveReceiver = getEffectiveReceiver();
    if (!effectiveReceiver) {
      toast.error("Could not resolve receiver address.");
      return;
    }
    if (!activeAddress || !transactionSigner) {
      toast.error("Connect your wallet first — it's needed to co-sign the transaction group.");
      return;
    }

    setSending(true);
    setLastTxId(null);
    try {
      const microAlgos = algosToMicroAlgos(amount);
      const txId = await sendFalconPayment(
        decryptedAccount,
        {
          receiver: effectiveReceiver,
          amount: microAlgos,
          note: note || undefined,
        },
        activeAddress,
        transactionSigner,
      );
      setLastTxId(txId);
      toast.success("Transaction sent!");
      setReceiver("");
      setResolvedAddress(null);
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

    const effectiveReceiver = getEffectiveReceiver();
    if (!effectiveReceiver) {
      toast.warning(
        receiver.includes(".algo")
          ? "Could not resolve that NFD name."
          : "Invalid Algorand address (should be 58 characters or an NFD name).",
      );
      return;
    }

    const microAlgos = algosToMicroAlgos(amount);
    if (microAlgos <= 0) {
      toast.warning("Amount must be greater than 0.");
      return;
    }

    if (!activeAddress) {
      toast.warning("Connect your wallet first — it's needed to co-sign the transaction group.");
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

        {/* Wallet requirement notice */}
        {!activeAddress ? (
          <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-primary-orange/5 border border-primary-orange/20">
            <p className="text-xs text-slate-400 text-center">
              <IoWallet className="inline mr-1" />
              A connected wallet is required to co-sign the transaction group.
              Falcon LogicSigs exceed the per-transaction byte limit, so 3
              zero-cost padding transactions from your wallet are needed to pool
              the budget.
            </p>
            <ConnectButton inmain={false} />
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            <IoWallet className="inline mr-1 text-primary-yellow" />
            Co-signing with{" "}
            <code className="text-slate-400">
              {activeAddress.slice(0, 6)}…{activeAddress.slice(-4)}
            </code>{" "}
            — your wallet signs 3 zero-cost padding txns so the Falcon LogicSig
            fits within the byte pool. All fees are paid by the Falcon account.
          </p>
        )}

        {/* Receiver with NFD */}
        <div>
          <div className="relative">
            <input
              type="text"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder="Receiver — Algorand address or name.algo"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 pr-10 text-sm font-mono text-white placeholder-slate-600 focus:border-primary-yellow focus:outline-none transition"
            />
            {resolvingNfd && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-primary-yellow border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!resolvingNfd && resolvedAddress && receiver.includes(".algo") && (
              <IoSearch className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400" />
            )}
          </div>
          {resolvedAddress && receiver.includes(".algo") && (
            <p className="text-xxs text-green-400 mt-1 font-mono truncate">
              → {resolvedAddress}
            </p>
          )}
          {!resolvingNfd &&
            !resolvedAddress &&
            receiver.includes(".algo") &&
            receiver.length > 5 && (
              <p className="text-xxs text-red-400 mt-1">
                NFD not found
              </p>
            )}
        </div>

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
          disabled={sending || !activeAddress}
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
            <span className="text-sm font-bold text-green-400">Success!</span>
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
