import confetti from "canvas-confetti";

/** "classic" is the standard wen.tools look and is always available. */
export type QuantumTheme = "classic" | "cyan" | "violet" | "emerald" | "amber";

export interface ThemeTierInfo {
  id: QuantumTheme;
  name: string;
  title: string;
  requiredTx: number;
  color: string;
  /** Second gradient stop, used for swatch previews */
  color2: string;
  badge: string;
}

export const THEME_TIERS: ThemeTierInfo[] = [
  { id: "cyan", name: "Cyan Pulse", title: "Quantum Initiate", requiredTx: 1, color: "#00f0ff", color2: "#7dd3fc", badge: "1+ Tx" },
  { id: "violet", name: "Antimatter Violet", title: "Quantum Archon", requiredTx: 100, color: "#c084fc", color2: "#f0abfc", badge: "100+ Tx" },
  { id: "emerald", name: "Zero-Point Mint", title: "Subatomic Sovereign", requiredTx: 1000, color: "#34d399", color2: "#5eead4", badge: "1,000+ Tx" },
  { id: "amber", name: "Solar Fusion", title: "Singularity Deity", requiredTx: 10000, color: "#fbbf24", color2: "#fde047", badge: "10,000+ Tx" },
];

/** The always-available standard theme, shown alongside the unlockable tiers. */
export const CLASSIC_THEME: ThemeTierInfo = {
  id: "classic",
  name: "Classic",
  title: "wen.tools",
  requiredTx: 0,
  color: "#f57b14",
  color2: "#ffc000",
  badge: "Default",
};

export interface PQThemeContextType {
  isPQAccount: boolean;
  isScanning: boolean;
  pqTxCount: number;
  scanReason: string | undefined;
  quantumTheme: QuantumTheme;
  setQuantumTheme: (theme: QuantumTheme) => void;
  backgroundFxEnabled: boolean;
  setBackgroundFxEnabled: (enabled: boolean) => void;
  forceTheme: boolean;
  setForceTheme: (force: boolean) => void;
  isThemeActive: boolean;
  recheckPQ: () => Promise<void>;
  unlockedThemes: QuantumTheme[];
  nextTier: { nextTheme: ThemeTierInfo; requiredTx: number } | null;
}

export function getUnlockedThemes(txCount: number, force: boolean): QuantumTheme[] {
  if (force) return ["cyan", "violet", "emerald", "amber"];
  return THEME_TIERS.filter((t) => txCount >= t.requiredTx).map((t) => t.id);
}

export function triggerQuantumConfetti() {
  try {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.2 },
      colors: ["#00f0ff", "#c084fc", "#34d399", "#fbbf24"],
    });
  } catch (e) {
    console.warn("Confetti error:", e);
  }
}
