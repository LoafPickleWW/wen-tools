import { useEffect, useState, useCallback } from "react";
import {
  IoCopy,
  IoTrash,
  IoOpen,
  IoRefresh,
  IoDownload,
  IoLockClosed,
} from "react-icons/io5";
import { toast } from "react-toastify";
import type { FalconAccount } from "../../utils/falcon";
import {
  getBalance,
  microAlgosToAlgos,
  getExplorerAddressUrl,
  exportAccount,
  getDecryptedAccount,
} from "../../utils/falcon";
import { deleteAccount } from "../../db/falconDb";
import PassphraseDialog from "./PassphraseDialog";

interface Props {
  account: FalconAccount;
  onSelect: (account: FalconAccount) => void;
  onDeleted: () => void;
  selected?: boolean;
  refreshKey?: number;
}

export default function FalconAccountCard({
  account,
  onSelect,
  onDeleted,
  selected,
  refreshKey,
}: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [passphraseOpen, setPassphraseOpen] = useState(false);

  const fetchBalance = useCallback(async () => {
    setLoading(true);
    try {
      const bal = await getBalance(account.address, account.network);
      setBalance(bal);
    } catch {
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, [account.address, account.network]);

  useEffect(() => {
    fetchBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchBalance, refreshKey]);

  const handleCopy = () => {
    navigator.clipboard.writeText(account.address);
    toast.success("Address copied!");
  };

  // ---- Export (with passphrase gate for encrypted accounts) ----
  const doExport = (acc: FalconAccount) => {
    const json = exportAccount(acc);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `falcon-${acc.address.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Account exported!");
  };

  const handleExport = () => {
    if (account.encrypted) {
      setPassphraseOpen(true);
    } else {
      doExport(account);
    }
  };

  const handlePassphraseSubmit = async (passphrase: string) => {
    const decrypted = await getDecryptedAccount(account, passphrase);
    doExport(decrypted);
    setPassphraseOpen(false);
  };

  // ---- Delete ----
  const handleDelete = async () => {
    if (!account.id) return;
    await deleteAccount(account.id);
    toast.info("Account removed from browser.");
    setDeleteOpen(false);
    onDeleted();
  };

  const shortAddr = `${account.address.slice(0, 6)}...${account.address.slice(-6)}`;

  return (
    <>
      <button
        onClick={() => onSelect(account)}
        className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 ${
          selected
            ? "border-primary-yellow bg-primary-yellow/5"
            : "border-slate-800 hover:border-slate-600 bg-primary-black/40"
        }`}
      >
        {/* Header row */}
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-sm text-white flex items-center gap-1.5">
            {account.encrypted && (
              <IoLockClosed className="text-primary-orange text-xs" title="Passphrase protected" />
            )}
            {account.label}
          </span>
          <span
            className={`text-xxs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
              account.network === "mainnet"
                ? "bg-red-500/10 text-red-400 border-red-500/30"
                : "bg-primary-blue/10 text-primary-blue border-primary-blue/30"
            }`}
          >
            {account.network}
          </span>
        </div>

        {/* Address row */}
        <div className="flex items-center gap-1.5 mb-3">
          <code className="text-xs bg-slate-800 px-2 py-1 rounded-lg flex-1 font-mono truncate text-slate-400">
            {shortAddr}
          </code>
          <IconBtn
            title="Copy address"
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
          >
            <IoCopy />
          </IconBtn>
          <IconBtn
            title="View in explorer"
            onClick={(e) => {
              e.stopPropagation();
              window.open(
                getExplorerAddressUrl(account.address, account.network),
                "_blank",
              );
            }}
          >
            <IoOpen />
          </IconBtn>
        </div>

        {/* Balance row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {loading ? (
              <div className="w-4 h-4 border-2 border-primary-yellow border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="text-lg font-black text-white">
                {balance !== null
                  ? `${microAlgosToAlgos(balance)} Algo`
                  : "—"}
              </span>
            )}
            <IconBtn
              title="Refresh balance"
              onClick={(e) => { e.stopPropagation(); fetchBalance(); }}
            >
              <IoRefresh />
            </IconBtn>
          </div>

          {/* Actions */}
          <div className="flex gap-1">
            <IconBtn
              title="Export keys"
              onClick={(e) => { e.stopPropagation(); handleExport(); }}
            >
              <IoDownload />
            </IconBtn>
            <IconBtn
              title="Remove from browser"
              onClick={(e) => { e.stopPropagation(); setDeleteOpen(true); }}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              <IoTrash />
            </IconBtn>
          </div>
        </div>
      </button>

      {/* Delete confirmation dialog */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-secondary-gray border border-slate-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-3">Remove Account?</h3>
            <p className="text-sm text-slate-400">
              Are you sure you want to remove{" "}
              <strong className="text-white">{account.label}</strong> from your
              browser?
            </p>
            <p className="text-sm text-slate-500 mt-2">
              If you haven't exported this account, the keys will be{" "}
              <strong className="text-primary-orange">lost forever</strong>. This
              cannot be undone.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setDeleteOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:border-slate-500 transition font-semibold text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-bold text-sm hover:bg-red-500 transition"
              >
                Remove Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Passphrase dialog for encrypted export */}
      <PassphraseDialog
        open={passphraseOpen}
        onClose={() => setPassphraseOpen(false)}
        onSubmit={handlePassphraseSubmit}
        title="Unlock to Export"
        description="Enter your passphrase to decrypt the secret key for export."
      />
    </>
  );
}

/** Tiny icon button matching the site's style */
function IconBtn({
  children,
  onClick,
  title,
  className = "",
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition text-sm ${className}`}
    >
      {children}
    </button>
  );
}
