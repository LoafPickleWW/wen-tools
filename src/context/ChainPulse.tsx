/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useWallet } from "@txnlab/use-wallet-react";

export interface PulseBlock {
  round: number;
  /** Base32 block hash, when the node returns it */
  hash?: string;
  /** Local arrival time in ms */
  at: number;
}

interface ChainPulseState {
  network: string;
  blocks: PulseBlock[]; // newest first
  live: boolean;
}

const KEEP = 24;

const ChainPulseContext = createContext<ChainPulseState>({
  network: "mainnet",
  blocks: [],
  live: false,
});

/**
 * Follows the chain tip with algod's status-after-block long poll, so the UI
 * can show real rounds arriving instead of decorative fake data. Pauses while
 * the tab is hidden to stay light on the public node.
 */
export function ChainPulseProvider({ children }: { children: ReactNode }) {
  const { algodClient, activeNetwork } = useWallet();
  const [blocks, setBlocks] = useState<PulseBlock[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lastRound = 0;
    setBlocks([]);
    setLive(false);

    const push = async (round: number) => {
      const block: PulseBlock = { round, at: Date.now() };
      setBlocks((prev) => [block, ...prev.filter((b) => b.round !== round)].slice(0, KEEP));
      try {
        const res: any = await algodClient.getBlockHash(round).do();
        const hash = res?.blockHash ?? res?.["block-hash"];
        if (!cancelled && hash) {
          setBlocks((prev) => prev.map((b) => (b.round === round ? { ...b, hash } : b)));
        }
      } catch {
        // Hash is a nice-to-have; the round alone is still shown.
      }
    };

    const loop = async () => {
      while (!cancelled) {
        if (document.hidden) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        try {
          const status: any = lastRound
            ? await algodClient.statusAfterBlock(lastRound).do()
            : await algodClient.status().do();
          if (cancelled) return;
          const round = Number(status["last-round"] ?? status.lastRound);
          if (round > lastRound) {
            lastRound = round;
            setLive(true);
            push(round);
          }
        } catch {
          setLive(false);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    };

    loop();
    return () => {
      cancelled = true;
    };
  }, [algodClient, activeNetwork]);

  return (
    <ChainPulseContext.Provider value={{ network: activeNetwork, blocks, live }}>
      {children}
    </ChainPulseContext.Provider>
  );
}

export const useChainPulse = () => useContext(ChainPulseContext);
