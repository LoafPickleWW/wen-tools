import { Link, NavLink } from "react-router-dom";
import ConnectButton from "./ConnectButton";
import SelectNetworkComponent from "./SelectNetworkComponent";
import DonationDialog from "./DonationDialog";
import { Wordmark } from "./Wordmark";

const NAV = [
  { label: "Wallet", to: "/wallet" },
  { label: "Swap", to: "/wen-swap" },
  { label: "Agents", to: "/agents" },
  { label: "Encyclopedia", to: "/encyclopedia" },
];

export function Header() {
  return (
    <header className="wentools-header sticky top-0 z-40 border-b border-white/[0.07] bg-primary-black/70 backdrop-blur-xl backdrop-saturate-150 transition-colors duration-500">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <Link
          to="/"
          aria-label="wen.tools Home"
          className="wentools-logo shrink-0 text-xl transition hover:opacity-90 sm:text-[1.4rem]"
        >
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="ml-6 hidden items-center gap-0.5 lg:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-white/[0.06] text-white"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <SelectNetworkComponent />
          <DonationDialog />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
