import { NetworkId, useWallet } from "@txnlab/use-wallet-react";

const NETWORKS = [
  { id: NetworkId.MAINNET, label: "Mainnet", short: "Main", dot: "bg-emerald-400" },
  { id: NetworkId.TESTNET, label: "Testnet", short: "Test", dot: "bg-sky-400" },
];

/** Segmented Mainnet / Testnet switch. */
export default function SelectNetworkComponent() {
  const { activeNetwork, setActiveNetwork } = useWallet();

  return (
    <div
      role="radiogroup"
      aria-label="Network"
      className="flex items-center rounded-xl border border-white/10 bg-banner-grey/60 p-0.5 text-xs font-medium backdrop-blur"
    >
      {NETWORKS.map((n) => {
        const active = activeNetwork === n.id;
        return (
          <button
            key={n.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !active && setActiveNetwork(n.id)}
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
