import { IpfsProvider } from "../types";

interface IpfsProviderSelectProps {
  provider: IpfsProvider;
  setProvider: (p: IpfsProvider) => void;
  isTestnet: boolean;
  showNone?: boolean;
  hideCrust?: boolean;
  pinataToken?: string;
  setPinataToken?: (t: string) => void;
  filebaseToken?: string;
  setFilebaseToken?: (t: string) => void;
  label?: string;
}

export default function IpfsProviderSelect({
  provider,
  setProvider,
  isTestnet,
  showNone = false,
  hideCrust = false,
  pinataToken = "",
  setPinataToken,
  filebaseToken = "",
  setFilebaseToken,
  label = "IPFS Pinning Provider*"
}: IpfsProviderSelectProps) {
  // Crust is disabled on testnet
  const effectiveProvider = isTestnet && provider === "crust" ? "pinata" : provider;

  return (
    <div className="space-y-4">
      <div className="flex flex-col">
        <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          {label}
        </label>
        
        {isTestnet && provider === "crust" && (
          <div className="bg-slate-900/60 p-4 border border-slate-800 rounded-xl text-xs text-amber-500 font-medium mb-3">
            ⚠️ Crust is disabled on Testnet. Pinata or Filebase can be used instead.
          </div>
        )}

        <div className="flex bg-slate-900/80 p-1.5 rounded-xl border border-slate-700 w-full gap-1">
          {!hideCrust && (
            <button
              type="button"
              disabled={isTestnet}
              className={`flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-300 ${
                effectiveProvider === "crust"
                  ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-md font-extrabold"
                  : isTestnet
                  ? "text-slate-650 cursor-not-allowed opacity-50"
                  : "text-slate-400 hover:text-white"
              }`}
              onClick={() => setProvider("crust")}
            >
              Crust Network
            </button>
          )}
          
          <button
            type="button"
            className={`flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-300 ${
              effectiveProvider === "pinata"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-md font-extrabold"
                : "text-slate-400 hover:text-white"
            }`}
            onClick={() => setProvider("pinata")}
          >
            Pinata (JWT)
          </button>

          <button
            type="button"
            className={`flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-300 ${
              effectiveProvider === "filebase"
                ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-md font-extrabold"
                : "text-slate-400 hover:text-white"
            }`}
            onClick={() => setProvider("filebase")}
          >
            Filebase
          </button>

          {showNone && (
            <button
              type="button"
              className={`flex-1 py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-300 ${
                effectiveProvider === "none"
                  ? "bg-gradient-to-r from-orange-500 to-amber-500 text-black shadow-md font-extrabold"
                  : "text-slate-400 hover:text-white"
              }`}
              onClick={() => setProvider("none")}
            >
              None
            </button>
          )}
        </div>
      </div>

      {effectiveProvider === "pinata" && setPinataToken && (
        <div className="flex flex-col animate-fadeIn bg-slate-900/40 p-4 rounded-xl border border-slate-800">
          <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            Pinata JWT Token*
          </label>
          <input
            type="password"
            placeholder="Paste Pinata JWT Token"
            className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
            required
            value={pinataToken}
            onChange={(e) => setPinataToken(e.target.value)}
          />
          <span className="text-[11px] text-slate-500 mt-2 block">
            Need a token? Create one in your{" "}
            <a
              href="https://knowledge.pinata.cloud/en/articles/6191471-how-to-create-an-pinata-api-key"
              target="_blank"
              rel="noreferrer"
              className="text-orange-400 hover:underline"
            >
              Pinata account
            </a>.
          </span>
        </div>
      )}

      {effectiveProvider === "filebase" && setFilebaseToken && (
        <div className="flex flex-col animate-fadeIn bg-slate-900/40 p-4 rounded-xl border border-slate-800">
          <label className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            Filebase API Token*
          </label>
          <input
            type="password"
            placeholder="Paste Filebase API Token"
            className="w-full bg-slate-900/60 border border-slate-700 text-sm font-medium text-white placeholder:text-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-orange focus:border-primary-orange transition-all"
            required
            value={filebaseToken}
            onChange={(e) => setFilebaseToken(e.target.value)}
          />
          <span className="text-[11px] text-slate-500 mt-2 block">
            Need a token? Create or find one in your{" "}
            <a
              href="https://console.filebase.com/keys"
              target="_blank"
              rel="noreferrer"
              className="text-orange-400 hover:underline"
            >
              Filebase console
            </a>.
          </span>
        </div>
      )}
    </div>
  );
}
