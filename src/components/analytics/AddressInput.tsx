import React, { useState } from "react";
import { MdAdd, MdClose } from "react-icons/md";
import { toast } from "react-toastify";
import axios from "axios";

interface AddressInputProps {
  onAddressesChange: (addresses: string[]) => void;
}

export function AddressInput({ onAddressesChange }: AddressInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);

  const validateAddress = (address: string) => {
    // Algorand address format check: 58 characters, alphanumeric
    const algoRegex = /^[A-Z2-7]{58}$/;
    return algoRegex.test(address);
  };

  const addAddressOrNfd = async (rawInput: string) => {
    const trimmed = rawInput.trim();
    if (!trimmed) return;

    if (chips.includes(trimmed)) {
      toast.warn("Address/NFD already added.");
      return;
    }

    // If it's an NFD (.algo), let's attempt to resolve it
    if (trimmed.toLowerCase().endsWith(".algo")) {
      setResolving(true);
      try {
        const response = await axios.get(
          `https://api.nf.domains/nfd/${trimmed.toLowerCase()}?view=tiny`
        );
        if (response.data && response.data.depositAccount) {
          const resolvedAddress = response.data.depositAccount;
          if (!chips.includes(resolvedAddress)) {
            const updated = [...chips, resolvedAddress];
            setChips(updated);
            onAddressesChange(updated);
            toast.success(`Resolved ${trimmed}`);
          } else {
            toast.warn("Resolved address is already in the list.");
          }
          setInputValue("");
        } else {
          toast.error(`Could not resolve NFD: ${trimmed}`);
        }
      } catch {
        toast.error(`Error resolving NFD: ${trimmed}`);
      } finally {
        setResolving(false);
      }
      return;
    }

    // Check if it's a standard Algorand address
    if (validateAddress(trimmed)) {
      const updated = [...chips, trimmed];
      setChips(updated);
      onAddressesChange(updated);
      setInputValue("");
    } else {
      toast.error("Invalid Algorand address or NFD name.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addAddressOrNfd(inputValue);
    }
  };

  const removeChip = (indexToRemove: number) => {
    const updated = chips.filter((_, i) => i !== indexToRemove);
    setChips(updated);
    onAddressesChange(updated);
  };

  return (
    <div className="w-full bg-secondary-black/40 border border-secondary-gray p-4 rounded-2xl shadow-xl flex flex-col gap-3">
      <label className="text-sm font-semibold text-slate-300">
        Algorand Wallet Address or NFD (.algo)
      </label>

      {/* Chip Area */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-1">
          {chips.map((chip, idx) => (
            <div
              key={chip}
              className="flex items-center gap-1 bg-amber-400/10 border border-amber-400/30 text-amber-300 text-xs px-3 py-1.5 rounded-full font-mono shadow-sm"
            >
              <span>{`${chip.slice(0, 6)}...${chip.slice(-6)}`}</span>
              <button
                type="button"
                onClick={() => removeChip(idx)}
                className="hover:text-amber-100 transition-colors focus:outline-none"
              >
                <MdClose className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={resolving}
          placeholder="Paste address or NFD and press Enter..."
          className="flex-1 bg-banner-grey border border-secondary-gray rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition-all font-mono text-sm"
        />
        <button
          type="button"
          onClick={() => addAddressOrNfd(inputValue)}
          disabled={resolving || !inputValue.trim()}
          className="bg-amber-400 hover:bg-amber-500 disabled:bg-amber-400/40 text-black font-semibold px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all text-sm shadow-md w-full sm:w-auto"
        >
          {resolving ? "Resolving..." : <><MdAdd className="w-4 h-4" /> Add</>}
        </button>
      </div>
    </div>
  );
}
