import { useState } from "react";
import { AiOutlineInfoCircle } from "react-icons/ai";
import { InfinityData } from "../types";

const InfinityModeComponent = ({
  mnemonic,
  setMnemonic,
  description = "Infinity Mode allows for no restrictions to the amount of transactions per upload.",
}: InfinityData) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleAccordion = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="w-full bg-[#121214]/60 border border-white/5 rounded-2xl text-white p-4 transition-all duration-300">
      <div
        className="accordion-header flex justify-between items-center cursor-pointer select-none"
        onClick={toggleAccordion}
      >
        <span className="flex mx-auto text-center font-bold text-sm text-slate-300 hover:text-white transition-colors">
          Infinity Mode (optional)
        </span>
        <div className="has-tooltip my-2 ml-1 hidden md:block">
          <span className="tooltip rounded-xl shadow-lg p-2 bg-[#1a1a1a] text-[11px] text-red-400 -mt-16 max-w-xs border border-red-500/20">
            Wen Tools does not store any information on the website. As
            precautions, you can use burner wallets, rekey to a burner wallet
            and rekey back, or rekey after using.
          </span>
          <AiOutlineInfoCircle className="text-slate-400 hover:text-white" />
        </div>
      </div>
      {isOpen && (
        <div className="flex flex-col items-center rounded-xl bg-black/45 border border-white/5 py-3.5 px-4 mt-3 text-sm text-white space-y-2">
          <input
            type="text"
            placeholder="25-words mnemonics"
            className="w-full bg-[#0a0a0c] text-white border border-white/10 rounded-xl p-3 text-sm focus:border-orange-500/50 outline-none transition-all placeholder:text-slate-600 font-mono text-center"
            value={mnemonic}
            onChange={(e) => {
              setMnemonic(e.target.value.replace(/,/g, " "));
            }}
          />
          <span className="text-xs text-slate-400 leading-relaxed text-center">{description}</span>
        </div>
      )}
    </div>
  );
};

export default InfinityModeComponent;
