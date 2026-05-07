import { useState, useEffect, useCallback } from "react";
import { Button, Divider, Chip } from "@mui/material";
import { IoAdd, IoCloudUpload, IoShield } from "react-icons/io5";
import PQWarningBanner from "../components/falcon/PQWarningBanner";
import FalconAccountCard from "../components/falcon/FalconAccountCard";
import CreateAccountDialog from "../components/falcon/CreateAccountDialog";
import ImportAccountDialog from "../components/falcon/ImportAccountDialog";
import SendTransactionPanel from "../components/falcon/SendTransactionPanel";
import FundAccountPanel from "../components/falcon/FundAccountPanel";
import type { FalconAccount } from "../utils/falcon";
import { getAllAccounts } from "../db/falconDb";

export default function PostQuantum() {
  const [accounts, setAccounts] = useState<FalconAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<FalconAccount | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadAccounts = useCallback(async () => {
    const all = await getAllAccounts();
    setAccounts(all);
    // If selected account was deleted, clear selection
    if (
      selectedAccount &&
      !all.find((a) => a.id === selectedAccount.id)
    ) {
      setSelectedAccount(null);
    }
  }, [selectedAccount]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <IoShield className="text-3xl text-orange-500" />
          <div>
            <h1 className="text-2xl font-bold leading-tight">
              Post-Quantum Wallet
            </h1>
            <p className="text-sm opacity-60">
              Falcon-1024 signatures on Algorand
            </p>
          </div>
          <Chip
            label="Experimental"
            size="small"
            color="warning"
            sx={{ ml: "auto" }}
          />
        </div>
      </div>

      {/* Warning */}
      <PQWarningBanner />

      {/* Info blurb */}
      <div className="text-sm opacity-70 leading-relaxed space-y-2">
        <p>
          This tool lets you create Algorand accounts protected by{" "}
          <strong>Falcon-1024</strong> post-quantum signatures — the same NIST-selected
          scheme Algorand uses for State Proofs. All cryptography runs locally in
          your browser via WebAssembly. No keys ever leave your device.
        </p>
        <p>
          Falcon accounts use{" "}
          <strong>Logic Signatures</strong> to verify Falcon signatures on-chain.
          They look like normal Algorand addresses and can receive funds from any
          wallet, but only this tool can sign transactions from them.
        </p>
      </div>

      <Divider />

      {/* Accounts section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your Falcon Accounts</h2>
          <div className="flex gap-2">
            <Button
              variant="outlined"
              size="small"
              startIcon={<IoCloudUpload />}
              onClick={() => setImportOpen(true)}
            >
              Import
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<IoAdd />}
              onClick={() => setCreateOpen(true)}
            >
              Create
            </Button>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="text-center py-12 opacity-50">
            <IoShield className="text-5xl mx-auto mb-3 opacity-30" />
            <p className="text-sm">No Falcon accounts yet.</p>
            <p className="text-xs mt-1">
              Create one to get started, or import an existing backup.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {accounts.map((acc) => (
              <FalconAccountCard
                key={acc.id}
                account={acc}
                selected={selectedAccount?.id === acc.id}
                onSelect={setSelectedAccount}
                onDeleted={loadAccounts}
                refreshKey={refreshKey}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selected account actions */}
      {selectedAccount && (
        <>
          <Divider />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FundAccountPanel account={selectedAccount} />
            <SendTransactionPanel
              account={selectedAccount}
              onSent={() => setRefreshKey((k) => k + 1)}
            />
          </div>
        </>
      )}

      {/* Learn more */}
      <Divider />
      <div className="text-xs opacity-50 space-y-1 pb-4">
        <p>
          <strong>Learn more:</strong>{" "}
          <a
            href="https://algorand.co/blog/technical-brief-quantum-resistant-transactions-on-algorand-with-falcon-signatures"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Algorand's Falcon Technical Brief
          </a>
          {" · "}
          <a
            href="https://github.com/algorandfoundation/falcon-signatures"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Falcon CLI (Go)
          </a>
          {" · "}
          <a
            href="https://github.com/GoPlausible/falcon-signatures-js"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Falcon JS/WASM
          </a>
        </p>
        <p>
          Powered by{" "}
          <code className="bg-black/5 dark:bg-white/10 px-1 rounded">
            falcon-signatures
          </code>{" "}
          and{" "}
          <code className="bg-black/5 dark:bg-white/10 px-1 rounded">
            falcon-algo-sdk
          </code>{" "}
          by GoPlausible. All crypto runs client-side in WASM. Zero custody.
        </p>
      </div>

      {/* Dialogs */}
      <CreateAccountDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={loadAccounts}
      />
      <ImportAccountDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={loadAccounts}
      />
    </div>
  );
}
