import { toast } from "react-toastify";
import { useChain } from "../context/ChainContext";
import { useMidnight } from "../midnight/MidnightContext";

const ONE_AM_EXTENSION =
  "https://chromewebstore.google.com/detail/1am/bphnkdkcnfhompoegfpgnkidcjfbojjp";
const ONE_AM_IOS = "https://apps.apple.com/us/app/1am-wallet/id6761093596";
const ONE_AM_ANDROID = "https://play.google.com/store/apps/details?id=com.webisoft.oneam";

const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const ONE_AM_MOBILE = /Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "")
  ? ONE_AM_ANDROID
  : ONE_AM_IOS;

/** Midnight wallets detected in the browser, for the connect menu. */
export function MidnightWalletList({ onPicked }: { onPicked?: () => void }) {
  const { wallets, connect, status } = useMidnight();
  const { setActiveChain } = useChain();

  const pick = (rdns: string, name: string) => {
    onPicked?.();
    connect(rdns)
      .then(() => {
        setActiveChain("midnight");
        toast.success(`Connected to ${name}!`);
      })
      .catch((e: Error) => toast.error(e?.message || "Failed to connect!"));
  };

  return (
    <>
      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-white/[0.07] my-1">
        Midnight
      </div>
      {wallets.length === 0 ? (
        <p className="px-3 py-2 text-[11px] leading-snug text-slate-500">
          No Midnight wallet detected.{" "}
          {isMobile ? (
            <>
              On mobile, open <span className="text-slate-300">wen.tools</span> in the browser inside the{" "}
              <a className="text-slate-300 underline" href={ONE_AM_MOBILE} target="_blank" rel="noreferrer">
                1AM app
              </a>
              .
            </>
          ) : (
            <>
              Install{" "}
              <a className="text-slate-300 underline" href={ONE_AM_EXTENSION} target="_blank" rel="noreferrer">
                1AM
              </a>{" "}
              or Lace, then reload. On mobile, use the 1AM app's built-in browser.
            </>
          )}
        </p>
      ) : (
        wallets.map((w) => (
          <button
            key={w.rdns}
            disabled={!w.compatible || status === "connecting"}
            title={w.compatible ? undefined : `Needs connector v4 (wallet reports ${w.apiVersion})`}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-violet-500/10 hover:border-violet-500/30 border border-transparent transition-all text-left text-xs font-bold text-slate-200 hover:text-violet-300 group disabled:opacity-40"
            onClick={() => pick(w.rdns, w.name)}
          >
            <div className="w-7 h-7 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-center p-1.5 shrink-0 group-hover:border-violet-500/40 group-hover:scale-105 transition-all">
              {w.icon && <img src={w.icon} alt={w.name} className="w-full h-full object-contain" />}
            </div>
            <span className="truncate">{w.name}</span>
          </button>
        ))
      )}
    </>
  );
}
