import { Link } from "react-router-dom";
import { Reticle } from "./Reticle";

const PRINCIPLES = [
  {
    tag: "permissionless",
    title: "No accounts. Ever.",
    body: "No sign-ups, no emails, no approval queue. Connect a wallet and go.",
  },
  {
    tag: "non-custodial",
    title: "Your keys, your coins.",
    body: "Transactions are built in your browser and signed in your own wallet. We never hold your assets.",
  },
  {
    tag: "open-source",
    title: "Read the code.",
    body: "MIT licensed. Every line is on GitHub — audit it, fork it, ship your own.",
    href: "https://github.com/LoafPickleWW/wen-tools",
  },
  {
    tag: "free",
    title: "No paywall.",
    body: "No subscriptions, no premium tier. Community donations keep the lights on.",
  },
  {
    tag: "post-quantum",
    title: "Ready for what's next.",
    body: "Falcon-1024 post-quantum accounts on Algorand, today — not someday.",
    to: "/post-quantum",
  },
  {
    tag: "verifiable",
    title: "Don't trust. Verify.",
    body: "Everything you do lands on a public ledger. Check every block yourself.",
  },
];

/** The values strip: what wen.tools stands for, in plain terms. */
export function Manifesto() {
  return (
    <section className="relative mx-auto w-full max-w-7xl px-4" aria-labelledby="manifesto-title">
      <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="wt-label mb-3">( manifesto )</p>
          <h2
            id="manifesto-title"
            className="font-display text-3xl font-semibold tracking-tight text-white md:text-5xl"
          >
            Tools, not <span className="wt-strike">gatekeepers</span>.
          </h2>
        </div>
        <p className="max-w-sm font-mono text-xs leading-relaxed text-slate-500">
          // free software for a free ledger.
          <br />
          // built in the open.
        </p>
      </div>

      <div className="grid gap-px overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-3">
        {PRINCIPLES.map((p, i) => {
          const inner = (
            <>
              <Reticle />
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-primary-orange">[{String(i + 1).padStart(2, "0")}]</span>
                <span className="uppercase tracking-[0.14em] text-slate-500">{p.tag}</span>
              </div>
              <h3 className="mt-8 font-display text-xl font-semibold tracking-tight text-white">
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{p.body}</p>
              {(p.href || p.to) && (
                <span className="mt-4 inline-block font-mono text-[11px] text-primary-orange opacity-70 transition group-hover:opacity-100">
                  {p.href ? "→ view source" : "→ learn more"}
                </span>
              )}
            </>
          );
          const cls =
            "group relative block bg-primary-black/80 p-6 [--wt-in:12px] [--wt-r:0px] transition duration-300 hover:bg-banner-grey/60 md:p-7";
          if (p.href)
            return (
              <a key={p.tag} href={p.href} target="_blank" rel="noreferrer" className={cls}>
                {inner}
              </a>
            );
          if (p.to)
            return (
              <Link key={p.tag} to={p.to} className={cls}>
                {inner}
              </Link>
            );
          return (
            <div key={p.tag} className={cls}>
              {inner}
            </div>
          );
        })}
      </div>

      <figure className="mt-10 flex flex-col items-center text-center">
        <blockquote className="font-display text-2xl font-medium tracking-tight text-slate-200 md:text-3xl">
          “Cypherpunks write code.”
        </blockquote>
        <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-500">
          — Eric Hughes, A Cypherpunk’s Manifesto, 1993
        </figcaption>
      </figure>
    </section>
  );
}
