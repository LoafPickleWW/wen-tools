import React, { useState, useRef, useEffect } from "react";
import { usePQTheme, type QuantumTheme } from "../../context/PQThemeContext";
import { IoPlanet, IoShieldCheckmark, IoRefresh, IoOptions } from "react-icons/io5";

const THEME_OPTIONS: { id: QuantumTheme; name: string; color: string; bgClass: string; borderClass: string }[] = [
  { id: "cyan", name: "Cyan Pulse", color: "#00f0ff", bgClass: "bg-cyan-500/20 text-cyan-300", borderClass: "border-cyan-500/50" },
  { id: "violet", name: "Antimatter Violet", color: "#c084fc", bgClass: "bg-purple-500/20 text-purple-300", borderClass: "border-purple-500/50" },
  { id: "emerald", name: "Zero-Point Mint", color: "#34d399", bgClass: "bg-emerald-500/20 text-emerald-300", borderClass: "border-emerald-500/50" },
  { id: "amber", name: "Solar Fusion", color: "#fbbf24", bgClass: "bg-amber-500/20 text-amber-300", borderClass: "border-amber-500/50" },
];

export const PQAccountBadge: React.FC = () => {
  const {
    isPQAccount,
    isScanning,
    scanReason,
    quantumTheme,
    setQuantumTheme,
    backgroundFxEnabled,
    setBackgroundFxEnabled,
    forceTheme,
    setForceTheme,
    isThemeActive,
    recheckPQ,
  } = usePQTheme();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activeOption = THEME_OPTIONS.find((t) => t.id === quantumTheme) || THEME_OPTIONS[0];

  if (!isThemeActive && !isScanning) {
    return null;
  }

  return (
    <div className="relative inline-block text-left z-30" ref={dropdownRef}>
      {/* Badge Button */}
      {isScanning ? (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-slate-700/60 text-slate-400 text-xs animate-pulse">
          <IoRefresh className="animate-spin text-cyan-400 text-sm" />
          <span className="hidden sm:inline">Scanning PQSIG...</span>
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-300 border shadow-lg hover:scale-105 ${activeOption.bgClass} ${activeOption.borderClass}`}
          title="Post-Quantum Account Active"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
          </span>
          <IoPlanet className="text-sm animate-spin-slow" />
          <span className="tracking-wide uppercase font-extrabold text-[11px]">
            {isPQAccount ? "PQ SECURED" : "PQ THEME"}
          </span>
        </button>
      )}

      {/* Popover / Control Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-slate-950/95 border border-slate-800 shadow-2xl p-4 backdrop-blur-2xl text-white text-xs animate-fade-in space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <IoPlanet className="text-lg text-cyan-400 animate-pulse" />
              <div>
                <h4 className="font-bold text-sm bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
                  Quantum Theme Engine
                </h4>
                <p className="text-[10px] text-slate-400">
                  {isPQAccount
                    ? `PQSIG Verified (${scanReason || "falcon-1024"})`
                    : forceTheme
                    ? "Preview Mode Active"
                    : "Standard Account Connected"}
                </p>
              </div>
            </div>
            {isPQAccount && (
              <span className="flex items-center gap-1 bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold text-[10px] border border-emerald-500/30">
                <IoShieldCheckmark /> Verified
              </span>
            )}
          </div>

          {/* Theme Selector */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-2 flex items-center justify-between">
              <span>Atomic Color Scheme</span>
              <IoOptions className="text-slate-500" />
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setQuantumTheme(opt.id)}
                  className={`flex items-center gap-2 p-2 rounded-xl border text-left transition-all ${
                    quantumTheme === opt.id
                      ? `${opt.bgClass} ${opt.borderClass} font-bold ring-1 ring-current`
                      : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: opt.color }}
                  />
                  <span className="text-[11px] truncate">{opt.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* FX Toggles */}
          <div className="space-y-2 pt-1 border-t border-slate-800/80">
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-300 text-[11px]">Orbital FX Animation</span>
              <button
                onClick={() => setBackgroundFxEnabled(!backgroundFxEnabled)}
                className={`w-10 h-5 flex items-center rounded-full p-0.5 transition-colors ${
                  backgroundFxEnabled ? "bg-cyan-500" : "bg-slate-800"
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    backgroundFxEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-300 text-[11px]">Force Quantum Theme</span>
              <button
                onClick={() => setForceTheme(!forceTheme)}
                className={`w-10 h-5 flex items-center rounded-full p-0.5 transition-colors ${
                  forceTheme ? "bg-purple-500" : "bg-slate-800"
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    forceTheme ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Re-scan button */}
          <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-[10px]">
            <button
              onClick={() => {
                recheckPQ();
              }}
              className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 transition font-medium"
            >
              <IoRefresh className={isScanning ? "animate-spin" : ""} />
              Rescan Tx History
            </button>
            <span className="text-slate-500">PQSIG Tag Standard</span>
          </div>
        </div>
      )}
    </div>
  );
};
