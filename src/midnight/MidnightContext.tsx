import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MidnightConnectedAPI,
  MidnightInitialAPI,
  MidnightWalletInfo,
  TokenType,
} from "./types";

const STORAGE_KEY = "wt-midnight";

interface Saved {
  rdns: string;
  networkId: string;
}

export interface MidnightBalances {
  shielded: Record<TokenType, bigint>;
  unshielded: Record<TokenType, bigint>;
  dust: { cap: bigint; balance: bigint } | null;
}

type Status = "idle" | "connecting" | "connected";

interface MidnightContextValue {
  /** Wallets currently injected under window.midnight */
  wallets: MidnightWalletInfo[];
  status: Status;
  wallet: MidnightWalletInfo | null;
  api: MidnightConnectedAPI | null;
  /** Network the wallet actually connected to */
  networkId: string | null;
  /** Network used for the next connect() */
  preferredNetwork: string;
  setPreferredNetwork: (id: string) => void;
  unshieldedAddress: string | null;
  shieldedAddress: string | null;
  balances: MidnightBalances | null;
  connect: (rdns: string, networkId?: string) => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
}

const MidnightContext = createContext<MidnightContextValue | null>(null);

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function writeSaved(value: Saved | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private window); the connection simply won't persist
  }
}

/**
 * Wallets are matched by rdns, never by key: Lace injects under a new UUID on
 * every page load, while 1AM uses the fixed key '1am' (rdns com.midnight.1am).
 */
function discoverWallets(): MidnightWalletInfo[] {
  const injected = (window as unknown as { midnight?: Record<string, unknown> }).midnight;
  if (!injected) return [];
  return Object.entries(injected)
    .filter(([, v]) => v && typeof (v as MidnightInitialAPI).connect === "function")
    .map(([key, v]) => {
      const initial = v as MidnightInitialAPI;
      return {
        key,
        rdns: initial.rdns ?? key,
        name: initial.name ?? key,
        icon: initial.icon ?? "",
        apiVersion: initial.apiVersion ?? "",
        compatible: String(initial.apiVersion ?? "").startsWith("4."),
        initial,
      };
    });
}

const sameWallets = (a: MidnightWalletInfo[], b: MidnightWalletInfo[]) =>
  a.length === b.length && a.every((w, i) => w.key === b[i].key && w.rdns === b[i].rdns);

export function MidnightProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<MidnightWalletInfo[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [wallet, setWallet] = useState<MidnightWalletInfo | null>(null);
  const [api, setApi] = useState<MidnightConnectedAPI | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [preferredNetwork, setPreferredNetworkState] = useState(
    () => readSaved()?.networkId ?? "mainnet",
  );
  const [unshieldedAddress, setUnshieldedAddress] = useState<string | null>(null);
  const [shieldedAddress, setShieldedAddress] = useState<string | null>(null);
  const [balances, setBalances] = useState<MidnightBalances | null>(null);
  const triedRestore = useRef(false);

  // Extensions inject after page load, so poll briefly and re-check on focus
  useEffect(() => {
    const scan = () => {
      const found = discoverWallets();
      setWallets((prev) => (sameWallets(prev, found) ? prev : found));
    };
    scan();
    const timer = setInterval(scan, 500);
    const stop = setTimeout(() => clearInterval(timer), 5000);
    window.addEventListener("focus", scan);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
      window.removeEventListener("focus", scan);
    };
  }, []);

  const loadAccount = useCallback(async (connected: MidnightConnectedAPI) => {
    // Lace doesn't implement every method, so each read fails independently
    const [unshielded, shielded, shieldedBal, unshieldedBal, dust] = await Promise.allSettled([
      connected.getUnshieldedAddress(),
      connected.getShieldedAddresses(),
      connected.getShieldedBalances(),
      connected.getUnshieldedBalances(),
      connected.getDustBalance(),
    ]);
    setUnshieldedAddress(unshielded.status === "fulfilled" ? unshielded.value.unshieldedAddress : null);
    setShieldedAddress(shielded.status === "fulfilled" ? shielded.value.shieldedAddress : null);
    setBalances({
      shielded: shieldedBal.status === "fulfilled" ? shieldedBal.value : {},
      unshielded: unshieldedBal.status === "fulfilled" ? unshieldedBal.value : {},
      dust: dust.status === "fulfilled" ? dust.value : null,
    });
  }, []);

  const connect = useCallback(
    async (rdns: string, requested?: string) => {
      const info = discoverWallets().find((w) => w.rdns === rdns);
      if (!info) throw new Error("Wallet not found. Is the extension installed and unlocked?");
      if (!info.compatible) {
        throw new Error(`${info.name} uses connector v${info.apiVersion}; v4 is required.`);
      }
      const target = requested ?? preferredNetwork;
      setStatus("connecting");
      try {
        // Must run synchronously from the click handler or the approval popup can be blocked
        const connected = await info.initial.connect(target);
        const conn = await connected.getConnectionStatus();
        const actual = conn.status === "connected" ? conn.networkId : target;
        await connected.hintUsage?.([
          "getShieldedBalances",
          "getUnshieldedBalances",
          "getDustBalance",
          "getShieldedAddresses",
          "getUnshieldedAddress",
          "makeTransfer",
          "submitTransaction",
        ]).catch(() => {});
        setWallet(info);
        setApi(connected);
        setNetworkId(actual);
        setPreferredNetworkState(actual);
        writeSaved({ rdns: info.rdns, networkId: actual });
        setStatus("connected");
        await loadAccount(connected);
      } catch (e) {
        setStatus(api ? "connected" : "idle");
        throw e;
      }
    },
    [api, loadAccount, preferredNetwork],
  );

  const disconnect = useCallback(() => {
    setWallet(null);
    setApi(null);
    setNetworkId(null);
    setUnshieldedAddress(null);
    setShieldedAddress(null);
    setBalances(null);
    setStatus("idle");
    writeSaved(null);
  }, []);

  const refresh = useCallback(async () => {
    if (api) await loadAccount(api);
  }, [api, loadAccount]);

  const setPreferredNetwork = useCallback((id: string) => {
    setPreferredNetworkState(id);
  }, []);

  // Reconnect a previously authorised wallet once it has injected. Failures are silent:
  // the user may need to approve again, which they can do from the connect menu.
  useEffect(() => {
    if (triedRestore.current || wallets.length === 0) return;
    const saved = readSaved();
    if (!saved || !wallets.some((w) => w.rdns === saved.rdns)) return;
    triedRestore.current = true;
    connect(saved.rdns, saved.networkId).catch(() => {});
  }, [wallets, connect]);

  const value = useMemo<MidnightContextValue>(
    () => ({
      wallets,
      status,
      wallet,
      api,
      networkId,
      preferredNetwork,
      setPreferredNetwork,
      unshieldedAddress,
      shieldedAddress,
      balances,
      connect,
      disconnect,
      refresh,
    }),
    [
      wallets,
      status,
      wallet,
      api,
      networkId,
      preferredNetwork,
      setPreferredNetwork,
      unshieldedAddress,
      shieldedAddress,
      balances,
      connect,
      disconnect,
      refresh,
    ],
  );

  return <MidnightContext.Provider value={value}>{children}</MidnightContext.Provider>;
}

export function useMidnight(): MidnightContextValue {
  const ctx = useContext(MidnightContext);
  if (!ctx) throw new Error("useMidnight must be used inside <MidnightProvider>");
  return ctx;
}
