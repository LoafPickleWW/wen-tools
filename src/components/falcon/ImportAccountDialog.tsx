import { useState, useRef } from "react";
import { IoCloudUpload } from "react-icons/io5";
import { toast } from "react-toastify";
import { importAccount } from "../../utils/falcon";
import { saveAccount, getAccountByAddress } from "../../db/falconDb";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function ImportAccountDialog({ open, onClose, onImported }: Props) {
  const [jsonText, setJsonText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setJsonText(reader.result as string);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    try {
      const account = importAccount(jsonText);

      const existing = await getAccountByAddress(account.address);
      if (existing) {
        toast.warning("This account is already stored in your browser.");
        return;
      }

      await saveAccount(account);
      toast.success("Account imported!");
      setJsonText("");
      onImported();
      onClose();
    } catch (err: any) {
      toast.error(`Import failed: ${err.message || err}`);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-secondary-gray border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-1">
          Import Falcon Account
        </h3>
        <p className="text-sm text-slate-400 mb-5">
          Upload or paste the JSON backup file that was exported from this tool.
        </p>

        <div className="flex flex-col gap-4">
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:border-primary-yellow hover:text-primary-yellow transition font-semibold text-sm"
          >
            <IoCloudUpload /> Choose JSON File
          </button>

          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder="Or paste JSON here..."
            rows={6}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs font-mono text-white placeholder-slate-600 focus:border-primary-yellow focus:outline-none transition resize-none"
          />
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={() => { setJsonText(""); onClose(); }}
            className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:border-slate-500 transition font-semibold text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!jsonText.trim()}
            className="flex-1 py-2.5 rounded-xl bg-primary-yellow text-black font-bold text-sm hover:bg-primary-orange transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
