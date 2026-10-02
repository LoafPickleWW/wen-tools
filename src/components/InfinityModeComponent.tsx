import { useState } from "react";
import { LuChevronDown, LuEye, LuEyeOff, LuInfinity } from "react-icons/lu";
import { InfinityData } from "../types";

const InfinityModeComponent = ({
  mnemonic,
  setMnemonic,
  description = "Infinity Mode allows for no restrictions to the amount of transactions per upload.",
}: InfinityData) => {
  const [isOpen, setIsOpen] = useState(false);
  const [reveal, setReveal] = useState(false);

  const toggleAccordion = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div
      className={`w-full overflow-hidden rounded-2xl border bg-banner-grey/50 text-left text-white backdrop-blur transition-colors ${
        isOpen ? "border-primary-orange/40" : "border-white/[0.07]"
      }`}
    >
      <button
        type="button"
        onClick={toggleAccordion}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02]"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary-orange/30 bg-primary-orange/10 text-primary-orange">
          <LuInfinity />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold text-white">Infinity Mode</span>
          <span className="block font-mono text-[11px] text-slate-500">optional · sign everything in one go</span>
        </span>
        <LuChevronDown
          className={`shrink-0 text-slate-500 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="space-y-3 border-t border-white/[0.06] px-4 pb-4 pt-3">
          <div className="relative">
            {/* Masked by default: this is a seed phrase */}
            <input
              type={reveal ? "text" : "password"}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="25-word mnemonic"
              placeholder="25-word mnemonic"
              className="w-full rounded-xl border border-white/10 bg-primary-black/60 py-3 pl-3 pr-11 font-mono text-sm text-white placeholder:text-slate-600"
              value={mnemonic}
              onChange={(e) => {
                setMnemonic(e.target.value.replace(/,/g, " "));
              }}
            />
            <button
              type="button"
              onClick={() => setReveal(!reveal)}
              aria-label={reveal ? "Hide mnemonic" : "Show mnemonic"}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-500 transition hover:bg-white/5 hover:text-white"
            >
              {reveal ? <LuEyeOff /> : <LuEye />}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">{description}</p>
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-100/90">
            <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-amber-400">
              // opsec
            </span>
            Wen Tools does not store any information on the website. As precautions, you can use burner
            wallets, rekey to a burner wallet and rekey back, or rekey after using.
          </p>
        </div>
      )}
    </div>
  );
};

export default InfinityModeComponent;
