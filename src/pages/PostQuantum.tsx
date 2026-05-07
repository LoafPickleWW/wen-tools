import { useState, useEffect, useCallback } from "react";
import { IoAdd, IoCloudUpload, IoShield } from "react-icons/io5";
import PQWarningBanner from "../components/falcon/PQWarningBanner";
import FalconAccountCard from "../components/falcon/FalconAccountCard";
import CreateAccountDialog from "../components/falcon/CreateAccountDialog";
import ImportAccountDialog from "../components/falcon/ImportAccountDialog";
import SendTransactionPanel from "../components/falcon/SendTransactionPanel";
import FundAccountPanel from "../components/falcon/FundAccountPanel";
import TransactionHistoryPanel from "../components/falcon/TransactionHistoryPanel";
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
    <div className="mx-auto text-white mb-4 flex flex-col items-center max-w-4xl w-full px-4 min-h-screen">
      {/* Header */}
      <div className="w-full flex flex-col items-center mt-8 mb-2">
        <div className="flex items-center gap-3">
          <IoShield className="text-4xl text-primary-yellow" />
          <h1 className="text-4xl font-black bg-gradient-to-r from-primary-yellow to-secondary-orange bg-clip-text text-transparent">
            POST-QUANTUM WALLET
          </h1>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <p className="text-slate-400 italic">
            Falcon-1024 signatures on Algorand
          </p>
          <span className="text-xxs font-bold uppercase tracking-wider bg-primary-orange/20 text-primary-orange border border-primary-orange/30 px-2 py-0.5 rounded-full">
            Experimental
          </span>
        </div>
      </div>

      {/* Warning */}
      <div className="w-full mt-4">
        <PQWarningBanner />
      </div>

      {/* Info blurb */}
      <div className="w-full mt-6 text-sm text-slate-400 leading-relaxed space-y-3 bg-primary-black/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl">
        <p>
          This tool lets you create Algorand accounts protected by{" "}
          <strong className="text-primary-yellow">Falcon-1024</strong> post-quantum
          signatures — the same NIST-selected scheme Algorand uses for State
          Proofs. All cryptography runs locally in your browser via WebAssembly.
          No keys ever leave your device.
        </p>
        <p>
          Falcon accounts use{" "}
          <strong className="text-white">Logic Signatures</strong> to verify
          Falcon signatures on-chain. They look like normal Algorand addresses
          and can receive funds from any wallet, but only this tool can sign
          transactions from them.
        </p>
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-slate-800 my-8" />

      {/* Accounts section */}
      <div className="w-full flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Your Falcon Accounts</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:border-primary-yellow hover:text-primary-yellow transition font-semibold text-sm"
            >
              <IoCloudUpload /> Import
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-yellow text-black font-bold text-sm hover:bg-primary-orange transition"
            >
              <IoAdd /> Create
            </button>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="text-center py-16 bg-primary-black/40 border border-slate-800 rounded-2xl">
            <IoShield className="text-5xl mx-auto mb-3 text-slate-700" />
            <p className="text-slate-400 font-medium">No Falcon accounts yet.</p>
            <p className="text-xs text-slate-600 mt-1">
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
          <div className="w-full h-px bg-slate-800 my-8" />
          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
            <FundAccountPanel account={selectedAccount} />
            <SendTransactionPanel
              account={selectedAccount}
              onSent={() => setRefreshKey((k) => k + 1)}
            />
            <div className="md:col-span-2">
              <TransactionHistoryPanel
                account={selectedAccount}
                refreshKey={refreshKey}
              />
            </div>
          </div>
        </>
      )}

      {/* Learn more */}
      <div className="w-full h-px bg-slate-800 my-8" />
      <div className="w-full text-xs text-slate-600 space-y-1 pb-4">
        <p>
          <strong className="text-slate-500">Learn more:</strong>{" "}
          <a
            href="https://algorand.co/blog/technical-brief-quantum-resistant-transactions-on-algorand-with-falcon-signatures"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary-yellow transition"
          >
            Algorand's Falcon Technical Brief
          </a>
          {" · "}
          <a
            href="https://github.com/algorandfoundation/falcon-signatures"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary-yellow transition"
          >
            Falcon CLI (Go)
          </a>
          {" · "}
          <a
            href="https://github.com/GoPlausible/falcon-signatures-js"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary-yellow transition"
          >
            Falcon JS/WASM
          </a>
        </p>
        <p>
          Powered by{" "}
          <code className="bg-slate-800 px-1 rounded text-slate-400">
            falcon-signatures
          </code>{" "}
          and{" "}
          <code className="bg-slate-800 px-1 rounded text-slate-400">
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
