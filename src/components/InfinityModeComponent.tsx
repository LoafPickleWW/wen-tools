import { useState } from "react";
import { AiOutlineInfoCircle } from "react-icons/ai";

const InfinityModeComponent = ({
  mnemonic,
  setMnemonic,
  description = "Infinity Mode allows for no restrictions to the amount of transactions per upload.",
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleAccordion = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="accordion-container bg-banner-grey rounded text-white p-3">
      <div
        className="accordion-header flex justify-between items-center cursor-pointer"
        onClick={toggleAccordion}
      >
        <span className="flex mx-auto text-center">
          Infinity Mode (optional)
        </span>
        <div className="has-tooltip my-2 ml-1 hidden md:block">
          <span className="tooltip rounded shadow-lg p-1 bg-gray-100 text-red-500 -mt-8 max-w-xl">
            Evil Tools does not store any information on the website. As
            precautions, you can use burner wallets, rekey to a burner wallet
            and rekey back, or rekey after using.
          </span>
          <AiOutlineInfoCircle />
        </div>
      </div>
      {isOpen && (
        <div className="flex flex-col items-center rounded bg-banner-grey py-2 px-3 text-sm text-white">
          <input
            type="text"
            placeholder="25-words mnemonics"
            className="bg-black/40 text-white border-2 border-black rounded-lg p-2 mt-1 w-64 text-sm mx-auto placeholder:text-center placeholder:text-white/70 placeholder:text-sm"
            value={mnemonic}
            onChange={(e) => {
              setMnemonic(e.target.value.replace(/,/g, " "));
            }}
          />
          <span className="text-xs mt-2 text-white w-64">{description}</span>
        </div>
      )}
    </div>
  );
};

export default InfinityModeComponent;
