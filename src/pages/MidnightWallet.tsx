import { Link } from "react-router-dom";
import { FaCopy } from "react-icons/fa";
import { IoRefresh, IoWallet } from "react-icons/io5";
import { toast } from "react-toastify";
import { Reticle } from "../components/cypher/Reticle";
import { ToolHero } from "../components/cypher/ToolKit";
import ConnectButton from "../components/ConnectButton";
import { GetNightCard } from "../components/GetNightCard";
import { Meta } from "../components/Meta";
import { decimalsFor, formatDust, formatUnits, tokenLabel } from "../midnight/amounts";
import { useMidnight } from "../midnight/MidnightContext";
import { TokenType } from "../midnight/types";

function copy(value: string, what: string) {
  navigator.clipboard.writeText(value);
  toast.success(`${what} copied!`);
}

function AddressRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-primary-black/40 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
        <div className="truncate font-mono text-xs text-slate-200">{value ?? "Not provided by wallet"}</div>
      </div>
      {value && (
        <button
          onClick={() => copy(value, "Address")}
          className="shrink-0 p-1.5 text-slate-400 hover:text-white"
          title={`Copy ${label.toLowerCase()} address`}
        >
          <FaCopy className="text-xs" />
        </button>
      )}
    </div>
  );
}

function BalanceTable({ title, balances }: { title: string; balances: Record<TokenType, bigint> }) {
  const rows = Object.entries(balances).sort(([, a], [, b]) => (b > a ? 1 : b < a ? -1 : 0));
  return (
    <section className="w-full">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-white/10 px-3 py-3 text-xs text-slate-500">No tokens held.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 text-sm">
          {rows.map(([type, value]) => (
            <li key={type} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <button
                className="truncate text-left font-semibold text-slate-200 hover:text-white"
                title={`${type} (click to copy token type)`}
                onClick={() => copy(type, "Token type")}
              >
                {tokenLabel(type)}
              </button>
              <span className="font-mono text-xs text-white">{formatUnits(value, decimalsFor(type))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MidnightWallet() {
  const { status, wallet, networkId, unshieldedAddress, shieldedAddress, balances, refresh } = useMidnight();
  const dust = balances?.dust ?? null;
  const dustPct = dust && dust.cap > 0n ? Number((dust.balance * 100n) / dust.cap) : 0;

  return (
    <div className="pt-4 flex justify-center flex-col text-white min-h-screen">
      <Meta title="Midnight Wallet" description="Balances and addresses for your Midnight wallet." noindex />
      <article className="mx-auto text-white mb-16 flex flex-col items-center max-w-4xl w-full px-4">
        <ToolHero
          icon={<IoWallet aria-hidden="true" />}
          tag="midnight"
          title="Midnight Wallet"
          description="Your NIGHT, shielded and unshielded balances, DUST and addresses."
          meta={["NIGHT", "DUST", "shielded", "unshielded"]}
        />

        <div className="w-full bg-asset-detail-bg/90 border border-white/5 rounded-[32px] p-6 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden wt-frame [--wt-r:32px] [--wt-in:12px] flex flex-col items-center gap-6">
          <Reticle />
          {status !== "connected" ? (
            <>
              <ConnectButton inmain={true} />
              <p className="text-sm text-slate-400 text-center">
                Connect a Midnight wallet (1AM or Lace) to see your balances.
              </p>
            </>
          ) : (
            <div className="w-full flex flex-col gap-6 text-left">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-slate-300">
                  {wallet?.name} on <span className="font-bold text-white">{networkId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => refresh().catch(() => toast.error("Could not refresh"))}
                    className="wt-btn wt-btn-ghost h-9 gap-1.5 px-3 text-xs"
                  >
                    <IoRefresh /> Refresh
                  </button>
                  <Link to="/midnight-send" className="wt-btn wt-btn-primary h-9 px-4 text-xs">
                    Send
                  </Link>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <AddressRow label="Unshielded" value={unshieldedAddress} />
                <AddressRow label="Shielded" value={shieldedAddress} />
              </div>

              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">DUST (fees)</h2>
                {dust ? (
                  <div className="rounded-xl border border-white/10 p-3">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-mono">{formatDust(dust.balance)} DUST</span>
                      <span className="text-xs text-slate-500">cap {formatDust(dust.cap)}</span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
                      <div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.min(100, dustPct)}%` }} />
                    </div>
                    {dust.balance === 0n && (
                      <p className="mt-2 text-xs text-amber-400">
                        No DUST yet, so transfers will fail. DUST is generated by held NIGHT once it is registered
                        for DUST generation in your wallet.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="rounded-xl border border-white/10 px-3 py-3 text-xs text-slate-500">
                    Your wallet didn't report a DUST balance.
                  </p>
                )}
              </section>

              <div className="grid gap-6 sm:grid-cols-2">
                <BalanceTable title="Unshielded" balances={balances?.unshielded ?? {}} />
                <BalanceTable title="Shielded" balances={balances?.shielded ?? {}} />
              </div>

              <GetNightCard unshieldedAddress={unshieldedAddress} />
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

export default MidnightWallet;
