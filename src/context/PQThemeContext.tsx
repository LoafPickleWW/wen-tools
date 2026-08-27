import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import { checkIsPQAccount } from "../utils/pqDetection";
import { toast } from "react-toastify";
import {
  QuantumTheme,
  ThemeTierInfo,
  THEME_TIERS,
  PQThemeContextType,
  getUnlockedThemes,
  triggerQuantumConfetti,
} from "../types/pqTheme";

export type { QuantumTheme, ThemeTierInfo, PQThemeContextType };
export { THEME_TIERS, getUnlockedThemes, triggerQuantumConfetti };

const PQThemeContext = createContext<PQThemeContextType | undefined>(undefined);

export const PQThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeAddress } = useWallet();
  const [isPQAccount, setIsPQAccount] = useState<boolean>(false);
  const [pqTxCount, setPqTxCount] = useState<number>(0);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanReason, setScanReason] = useState<string | undefined>(undefined);

  const [quantumTheme, setQuantumThemeState] = useState<QuantumTheme>(() => {
    return (localStorage.getItem("wentools_pq_theme") as QuantumTheme) || "cyan";
  });

  const [backgroundFxEnabled, setBackgroundFxEnabledState] = useState<boolean>(() => {
    const saved = localStorage.getItem("wentools_pq_fx");
    return saved !== null ? saved === "true" : true;
  });

  const [forceTheme, setForceThemeState] = useState<boolean>(false);

  const setQuantumTheme = (theme: QuantumTheme) => {
    setQuantumThemeState(theme);
    localStorage.setItem("wentools_pq_theme", theme);
  };

  const setBackgroundFxEnabled = (enabled: boolean) => {
    setBackgroundFxEnabledState(enabled);
    localStorage.setItem("wentools_pq_fx", String(enabled));
  };

  const setForceTheme = (force: boolean) => {
    setForceThemeState(force);
  };

  const performScan = useCallback(async (address: string) => {
    setIsScanning(true);
    setScanReason(undefined);
    try {
      const result = await checkIsPQAccount(address);
      setIsPQAccount(result.isPQ);
      setPqTxCount(result.pqTxCount);
      setScanReason(result.reason);

      if (result.isPQ) {
        triggerQuantumConfetti();
        toast.info(`Post-Quantum Verified: ${result.pqTxCount} PQSIG Tx Counted.`, {
          toastId: `pq_detected_${address}`,
        });
      }
    } catch (err) {
      console.error("PQ scan error:", err);
      setIsPQAccount(false);
      setPqTxCount(0);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const recheckPQ = useCallback(async () => {
    if (activeAddress) {
      await performScan(activeAddress);
    }
  }, [activeAddress, performScan]);

  useEffect(() => {
    if (activeAddress) {
      performScan(activeAddress);
    } else {
      setIsPQAccount(false);
      setPqTxCount(0);
      setScanReason(undefined);
      setIsScanning(false);
    }
  }, [activeAddress, performScan]);

  const isThemeActive = isPQAccount || forceTheme;
  const unlockedThemes = getUnlockedThemes(pqTxCount, forceTheme);

  // Auto-switch to highest unlocked theme if current selection is locked
  useEffect(() => {
    if (isThemeActive && unlockedThemes.length > 0 && !unlockedThemes.includes(quantumTheme)) {
      setQuantumThemeState(unlockedThemes[unlockedThemes.length - 1]);
    }
  }, [isThemeActive, unlockedThemes, quantumTheme]);

  // Apply theme dataset attribute to root document element for CSS styling
  useEffect(() => {
    if (isThemeActive) {
      document.documentElement.setAttribute("data-quantum-theme", quantumTheme);
      document.documentElement.classList.add("quantum-mode");
    } else {
      document.documentElement.removeAttribute("data-quantum-theme");
      document.documentElement.classList.remove("quantum-mode");
    }
  }, [isThemeActive, quantumTheme]);

  // Calculate next tier progress info
  const nextTierObj = THEME_TIERS.find((t) => pqTxCount < t.requiredTx);
  const nextTier = nextTierObj ? { nextTheme: nextTierObj, requiredTx: nextTierObj.requiredTx } : null;

  return (
    <PQThemeContext.Provider
      value={{
        isPQAccount,
        isScanning,
        pqTxCount,
        scanReason,
        quantumTheme,
        setQuantumTheme,
        backgroundFxEnabled,
        setBackgroundFxEnabled,
        forceTheme,
        setForceTheme,
        isThemeActive,
        recheckPQ,
        unlockedThemes,
        nextTier,
      }}
    >
      {children}
    </PQThemeContext.Provider>
  );
};

export const usePQTheme = () => {
  const context = useContext(PQThemeContext);
  if (!context) {
    throw new Error("usePQTheme must be used within a PQThemeProvider");
  }
  return context;
};
