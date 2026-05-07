import { useState } from "react";
import { IoLockClosed } from "react-icons/io5";
import { toast } from "react-toastify";
import {
  createAccount,
  encryptSecretKey,
  type NetworkName,
} from "../../utils/falcon";
import { saveAccount } from "../../db/falconDb";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateAccountDialog({ open, onClose, onCreated }: Props) {
  const [label, setLabel] = useState("");
  const [network, setNetwork] = useState<NetworkName>("testnet");
  const [creating, setCreating] = useState(false);

  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");

  const resetForm = () => {
    setLabel("");
    setUsePassphrase(false);
    setPassphrase("");
    setConfirmPassphrase("");
  };

  const handleCreate = async () => {
    if (usePassphrase) {
      if (!passphrase) {
        toast.warning("Please enter a passphrase.");
        return;
      }
      if (passphrase.length < 8) {
        toast.warning("Passphrase must be at least 8 characters.");
        return;
      }
      if (passphrase !== confirmPassphrase) {
        toast.warning("Passphrases don't match.");
        return;
      }
    }

    setCreating(true);
    try {
      const account = await createAccount(network, label || undefined);

      let accountToSave = account;
      if (usePassphrase && passphrase) {
        const enc = await encryptSecretKey(account.secretKey, passphrase);
        accountToSave = {
          ...account,
          secretKey: enc.ciphertext,
          encrypted: true,
          salt: enc.salt,
          iv: enc.iv,
        };
      }

      await saveAccount(accountToSave);
      toast.success(
        usePassphrase
          ? "Falcon account created & encrypted!"
          : "Falcon account created!",
      );
      resetForm();
      onCreated();
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to create account: ${err.message || err}`);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-secondary-gray border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-1">
          Create Post-Quantum Account
        </h3>
        <p className="text-sm text-slate-400 mb-5">
          This generates a Falcon-1024 keypair entirely in your browser using
          WebAssembly. The private key never leaves your device.
        </p>

        <div className="flex flex-col gap-4">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Account Label (optional)"
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-primary-yellow focus:outline-none transition"
          />

          <div>
            <label className="text-xs text-slate-500 font-semibold mb-1 block">
              Network
            </label>
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value as NetworkName)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:border-primary-yellow focus:outline-none transition appearance-none cursor-pointer"
            >
              <option value="testnet">TestNet</option>
              <option value="mainnet">MainNet (caution!)</option>
              <option value="betanet">BetaNet</option>
            </select>
            <p className="text-xxs text-slate-600 mt-1">
              Use Testnet for experimentation. Do not store real funds.
            </p>
          </div>

          {/* Passphrase protection */}
          <div className="border border-slate-700 rounded-xl p-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={usePassphrase}
                onChange={(e) => setUsePassphrase(e.target.checked)}
                className="accent-primary-yellow w-4 h-4"
              />
              <span className="flex items-center gap-1.5 text-sm text-white font-semibold">
                <IoLockClosed className="text-slate-500" />
                Protect with passphrase
              </span>
            </label>

            {usePassphrase && (
              <div className="flex flex-col gap-3 mt-4">
                <p className="text-xs text-slate-500">
                  Your secret key will be encrypted with AES-256-GCM before
                  storage. You'll need this passphrase to send transactions or
                  export the account.
                </p>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Passphrase (min. 8 characters)"
                  className={`w-full bg-slate-900 border rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition ${
                    passphrase && passphrase.length < 8
                      ? "border-red-500"
                      : "border-slate-700 focus:border-primary-yellow"
                  }`}
                />
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Confirm passphrase"
                  className={`w-full bg-slate-900 border rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none transition ${
                    confirmPassphrase && passphrase !== confirmPassphrase
                      ? "border-red-500"
                      : "border-slate-700 focus:border-primary-yellow"
                  }`}
                />
                {confirmPassphrase && passphrase !== confirmPassphrase && (
                  <p className="text-xs text-red-400">
                    Passphrases don't match
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => { resetForm(); onClose(); }}
            disabled={creating}
            className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:border-slate-500 transition font-semibold text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex-1 py-2.5 rounded-xl bg-primary-yellow text-black font-bold text-sm hover:bg-primary-orange transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {creating ? (
              <>
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Generating Keys…
              </>
            ) : (
              "Create Account"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
