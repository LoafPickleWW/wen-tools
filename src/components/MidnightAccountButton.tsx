import { useState } from "react";
import Menu from "@mui/material/Menu";
import Tooltip from "@mui/material/Tooltip";
import { FaCopy } from "react-icons/fa";
import { IoRefresh } from "react-icons/io5";
import { toast } from "react-toastify";
import { useChain } from "../context/ChainContext";
import { formatDust, formatUnits } from "../midnight/amounts";
import { useMidnight } from "../midnight/MidnightContext";
import { NIGHT_DECIMALS, NIGHT_TOKEN_TYPE } from "../midnight/types";

const short = (a: string) => a.slice(0, 8) + "..." + a.slice(-4);

/** Header account control while the Midnight chain is active. */
export default function MidnightAccountButton() {
  const { wallet, unshieldedAddress, balances, disconnect, refresh } = useMidnight();
  const { algorandConnected, setActiveChain } = useChain();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const night = balances?.unshielded[NIGHT_TOKEN_TYPE] ?? 0n;
  const dust = balances?.dust?.balance ?? 0n;

  return (
    <div className="flex flex-row justify-center items-center font-sans rounded-2xl mx-2">
      <Tooltip title="Midnight account" placement="bottom-end">
        <button
          onClick={(e) => setAnchorEl(e.currentTarget)}
          className="wt-btn wt-btn-ghost h-9 gap-2 pl-1.5 pr-3 text-xs"
        >
          <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-slate-900 p-1">
            {wallet?.icon && <img src={wallet.icon} alt="" className="h-full w-full object-contain" />}
          </span>
          <span className="hidden max-w-[9rem] truncate font-medium sm:inline">
            {unshieldedAddress ? short(unshieldedAddress) : wallet?.name}
          </span>
        </button>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        disableScrollLock
        sx={{
          mt: 1,
          "& .MuiMenu-paper": {
            backgroundColor: "transparent",
            boxShadow: "none",
            borderRadius: "1rem",
            overflow: "visible",
          },
          "& .MuiList-root": { padding: 0 },
        }}
      >
        <div className="w-[320px] p-4 rounded-3xl bg-asset-detail-bg/95 border border-white/10 text-white shadow-2xl backdrop-blur-2xl space-y-3.5 font-sans">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.07]">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center p-1.5 shrink-0">
                {wallet?.icon && <img src={wallet.icon} alt={wallet.name} className="w-full h-full object-contain" />}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm tracking-tight">
                    {unshieldedAddress ? short(unshieldedAddress) : "Connected"}
                  </span>
                  {unshieldedAddress && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(unshieldedAddress);
                        toast.success("Address copied!");
                      }}
                      className="text-slate-400 hover:opacity-80 transition p-1"
                      title="Copy unshielded address"
                    >
                      <FaCopy className="text-xs" />
                    </button>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 font-medium">{wallet?.name} Wallet</span>
              </div>
            </div>
            <button
              onClick={() => refresh()}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
              title="Refresh balances"
            >
              <IoRefresh className="text-sm" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-banner-grey/70 p-2.5 rounded-2xl border border-white/[0.07]">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Balance</span>
              <div className="flex items-center justify-between mt-1">
                <span className="font-extrabold text-sm">{formatUnits(night, NIGHT_DECIMALS)}</span>
                <span className="font-bold text-xxs text-violet-300">NIGHT</span>
              </div>
            </div>
            <div className="bg-banner-grey/70 p-2.5 rounded-2xl border border-white/[0.07]">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Fees</span>
              <div className="flex items-center justify-between mt-1">
                <span className="font-bold text-sm text-slate-300">{formatDust(dust)}</span>
                <span className="text-slate-500 font-medium text-xxs">DUST</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-white/[0.07] space-y-2">
            {algorandConnected && (
              <button
                onClick={() => {
                  setActiveChain("algorand");
                  setAnchorEl(null);
                }}
                className="w-full py-2 px-3 rounded-xl bg-slate-800/60 hover:bg-slate-700/70 border border-white/10 text-slate-200 text-xs font-semibold transition"
              >
                Switch to Algorand
              </button>
            )}
            <button
              onClick={() => {
                setAnchorEl(null);
                disconnect();
                toast.success("Disconnected!");
              }}
              className="w-full py-2 px-3 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-800/50 text-red-300 hover:text-white text-xs font-semibold transition"
            >
              Disconnect Wallet
            </button>
          </div>
        </div>
      </Menu>
    </div>
  );
}
