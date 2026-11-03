import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import { useMidnight } from "../midnight/MidnightContext";

export type Chain = "algorand" | "midnight";

const STORAGE_KEY = "wt-chain";

interface ChainContextValue {
  /** The chain the UI is showing: whichever wallet is connected, or the user's pick when both are */
  activeChain: Chain;
  /** Call when the user explicitly connects a wallet so that chain takes over */
  setActiveChain: (chain: Chain) => void;
  algorandConnected: boolean;
  midnightConnected: boolean;
}

const ChainContext = createContext<ChainContextValue | null>(null);

function readPreferred(): Chain {
  try {
    return localStorage.getItem(STORAGE_KEY) === "midnight" ? "midnight" : "algorand";
  } catch {
    return "algorand";
  }
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const { activeAddress } = useWallet();
  const { status } = useMidnight();
  const [preferred, setPreferred] = useState<Chain>(readPreferred);

  const algorandConnected = !!activeAddress;
  const midnightConnected = status === "connected";

  const activeChain: Chain =
    algorandConnected && midnightConnected
      ? preferred
      : midnightConnected
        ? "midnight"
        : "algorand";

  const setActiveChain = useCallback((chain: Chain) => {
    setPreferred(chain);
    try {
      localStorage.setItem(STORAGE_KEY, chain);
    } catch {
      // not persisted; fine
    }
  }, []);

  const value = useMemo(
    () => ({ activeChain, setActiveChain, algorandConnected, midnightConnected }),
    [activeChain, setActiveChain, algorandConnected, midnightConnected],
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain(): ChainContextValue {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChain must be used inside <ChainProvider>");
  return ctx;
}
