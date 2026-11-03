import { NetworkId } from "@txnlab/use-wallet-react";
import { toast } from "react-toastify";
import { useAppNetwork } from "../hooks/useAppNetwork";
import { useChain } from "../context/ChainContext";
import { useMidnight } from "../midnight/MidnightContext";
import { MIDNIGHT_NETWORKS } from "../midnight/types";

const NETWORKS = [
  { id: NetworkId.MAINNET, label: "Mainnet", short: "Main", dot: "bg-emerald-400" },
  { id: NetworkId.TESTNET, label: "Testnet", short: "Test", dot: "bg-sky-400" },
];

const MIDNIGHT_DOT: Record<string, string> = {
  mainnet: "bg-emerald-400",
  preview: "bg-violet-400",
  preprod: "bg-sky-400",
};

interface Option {
  id: string;
  label: string;
  short: string;
  dot: string;
}

function Segmented({
  options,
  activeId,
  onSelect,
}: {
  options: Option[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Network"
      className="flex items-center rounded-xl border border-white/10 bg-banner-grey/60 p-0.5 text-xs font-medium backdrop-blur"
    >
      {options.map((n) => {
        const active = activeId === n.id;
        return (
          <button
            key={n.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !active && onSelect(n.id)}
            className={`flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 transition sm:px-2.5 ${
              active
                ? "bg-secondary-gray/80 text-white shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full transition ${
                active ? n.dot : "bg-slate-600"
              }`}
            />
            <span className="hidden md:inline">{n.label}</span>
            <span className="md:hidden">{n.short}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Network switch for whichever chain is active: Mainnet / Testnet on Algorand, Midnight's networks on Midnight. */
export default function SelectNetworkComponent() {
  const { activeNetwork, setActiveNetwork } = useAppNetwork();
  const { activeChain } = useChain();
  const { wallet, status, networkId, preferredNetwork, setPreferredNetwork, connect } = useMidnight();

  if (activeChain === "algorand") {
    return <Segmented options={NETWORKS} activeId={activeNetwork} onSelect={(id) => setActiveNetwork(id)} />;
  }

  const options = MIDNIGHT_NETWORKS.map((n) => ({ ...n, dot: MIDNIGHT_DOT[n.id] ?? "bg-slate-400" }));
  return (
    <Segmented
      options={options}
      activeId={status === "connected" ? networkId : preferredNetwork}
      onSelect={(id) => {
        if (status === "connected" && wallet) {
          // The connector binds a session to one network, so switching means reconnecting
          connect(wallet.rdns, id).catch((e: Error) =>
            toast.error(e?.message || `Could not switch to ${id}`),
          );
        } else {
          setPreferredNetwork(id);
        }
      }}
    />
  );
}
