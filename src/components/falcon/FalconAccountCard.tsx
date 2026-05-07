import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  IconButton,
  Tooltip,
  Chip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
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
  /** Increment to trigger a balance refresh from outside */
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
    // refreshKey triggers re-fetch when parent signals a change
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

  // ---- Delete (MUI confirm dialog) ----
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
      <Card
        onClick={() => onSelect(account)}
        sx={{
          cursor: "pointer",
          border: selected ? "2px solid" : "1px solid",
          borderColor: selected ? "primary.main" : "divider",
          transition: "all 0.2s",
          "&:hover": { borderColor: "primary.light" },
        }}
      >
        <CardContent className="flex flex-col gap-2">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm flex items-center gap-1">
              {account.encrypted && (
                <Tooltip title="Passphrase protected">
                  <span>
                    <IoLockClosed className="text-amber-500 text-xs" />
                  </span>
                </Tooltip>
              )}
              {account.label}
            </span>
            <Chip
              label={account.network}
              size="small"
              color={account.network === "mainnet" ? "error" : "info"}
              variant="outlined"
            />
          </div>

          {/* Address row */}
          <div className="flex items-center gap-1">
            <code className="text-xs bg-black/5 dark:bg-white/10 px-2 py-1 rounded flex-1 font-mono truncate">
              {shortAddr}
            </code>
            <Tooltip title="Copy address">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopy();
                }}
              >
                <IoCopy className="text-sm" />
              </IconButton>
            </Tooltip>
            <Tooltip title="View in explorer">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(
                    getExplorerAddressUrl(account.address, account.network),
                    "_blank",
                  );
                }}
              >
                <IoOpen className="text-sm" />
              </IconButton>
            </Tooltip>
          </div>

          {/* Balance row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {loading ? (
                <CircularProgress size={14} />
              ) : (
                <span className="text-lg font-bold">
                  {balance !== null
                    ? `${microAlgosToAlgos(balance)} Algo`
                    : "—"}
                </span>
              )}
              <Tooltip title="Refresh balance">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    fetchBalance();
                  }}
                >
                  <IoRefresh className="text-sm" />
                </IconButton>
              </Tooltip>
            </div>

            {/* Actions */}
            <div className="flex gap-1">
              <Tooltip title="Export keys">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExport();
                  }}
                >
                  <IoDownload className="text-sm" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Remove from browser">
                <IconButton
                  size="small"
                  color="error"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteOpen(true);
                  }}
                >
                  <IoTrash className="text-sm" />
                </IconButton>
              </Tooltip>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Remove Account?</DialogTitle>
        <DialogContent>
          <p className="text-sm opacity-80">
            Are you sure you want to remove{" "}
            <strong>{account.label}</strong> from your browser?
          </p>
          <p className="text-sm opacity-60 mt-2">
            If you haven't exported this account, the keys will be{" "}
            <strong>lost forever</strong>. This cannot be undone.
          </p>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
          >
            Remove Permanently
          </Button>
        </DialogActions>
      </Dialog>

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
