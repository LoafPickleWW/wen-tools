import { useState, useEffect, useCallback } from "react";
import { IoOpen, IoSwapVertical } from "react-icons/io5";
import type { FalconAccount } from "../../utils/falcon";
import {
  getAccountTransactions,
  getExplorerTxUrl,
  microAlgosToAlgos,
  TransactionRecord,
} from "../../utils/falcon";

interface Props {
  account: FalconAccount;
  refreshKey?: number;
}

export default function TransactionHistoryPanel({ account, refreshKey }: Props) {
  const [txns, setTxns] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTxns = useCallback(async () => {
    setLoading(true);
    try {
      const records = await getAccountTransactions(account.address, account.network);
      setTxns(records);
    } catch {
      setTxns([]);
    } finally {
      setLoading(false);
    }
  }, [account.address, account.network]);

  useEffect(() => {
    fetchTxns();
  }, [fetchTxns, refreshKey]);

  return (
    <div className="border border-slate-800 rounded-2xl p-6 bg-primary-black/40 flex flex-col gap-4">
      <h3 className="font-bold text-base text-white flex items-center gap-2">
        <IoSwapVertical className="text-primary-yellow" />
        Transaction History
      </h3>

      {loading && txns.length === 0 ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-primary-yellow border-t-transparent rounded-full animate-spin" />
        </div>
      ) : txns.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-6">
          No transactions found for this account.
        </p>
      ) : (
        <div className="flex flex-col gap-3 mt-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
          {txns.map((tx) => {
            const isSend = tx.sender === account.address;
            const amount = microAlgosToAlgos(tx.amount);
            const date = new Date(tx.timestamp * 1000).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            });

            return (
              <div
                key={tx.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                      isSend
                        ? "bg-red-500/10 text-red-400"
                        : "bg-green-500/10 text-green-400"
                    }`}
                  >
                    {isSend ? "OUT" : "IN"}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-white">
                      {isSend ? "Sent" : "Received"}
                    </span>
                    <span className="text-xxs text-slate-500">{date}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <span
                    className={`text-sm font-bold ${
                      isSend ? "text-white" : "text-green-400"
                    }`}
                  >
                    {isSend ? "-" : "+"}
                    {amount} ALGO
                  </span>
                  <a
                    href={getExplorerTxUrl(tx.id, account.network)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xxs text-slate-500 hover:text-primary-yellow transition mt-0.5"
                  >
                    {tx.id.slice(0, 8)}... <IoOpen />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
