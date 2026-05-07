import { useState } from "react";
import { IoLockClosed } from "react-icons/io5";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (passphrase: string) => Promise<void>;
  title?: string;
  description?: string;
}

export default function PassphraseDialog({
  open,
  onClose,
  onSubmit,
  title = "Enter Passphrase",
  description = "This account is protected with a passphrase. Enter it to continue.",
}: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!passphrase) return;
    setLoading(true);
    setError("");
    try {
      await onSubmit(passphrase);
      setPassphrase("");
    } catch (err: any) {
      setError(
        err.message?.includes("Unsupported")
          ? "Incorrect passphrase"
          : err.message || "Incorrect passphrase",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPassphrase("");
    setError("");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-secondary-gray border border-slate-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
          <IoLockClosed className="text-primary-yellow" /> {title}
        </h3>
        <p className="text-sm text-slate-400 mb-4">{description}</p>

        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Enter passphrase"
          autoFocus
          className={`w-full bg-slate-900 border rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition ${
            error
              ? "border-red-500 focus:border-red-500"
              : "border-slate-700 focus:border-primary-yellow"
          }`}
        />
        {error && (
          <p className="text-xs text-red-400 mt-1.5">{error}</p>
        )}

        <div className="flex gap-3 mt-5">
          <button
            onClick={handleClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:border-slate-500 transition font-semibold text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!passphrase || loading}
            className="flex-1 py-2.5 rounded-xl bg-primary-yellow text-black font-bold text-sm hover:bg-primary-orange transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Decrypting…
              </>
            ) : (
              "Unlock"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
