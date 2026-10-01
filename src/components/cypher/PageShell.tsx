import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { BlockTicker } from "./LedgerStrip";

/**
 * Wraps every route. Sub pages get the terminal-style breadcrumb bar and
 * the `wt-page` scope, which normalizes their headings, labels and form
 * controls into the shared design language (see index.css).
 */
export function PageShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return <>{children}</>;

  return (
    <div className="wt-page flex flex-1 flex-col">
      <div className="border-b border-white/[0.05] bg-primary-black/40 backdrop-blur">
        <div className="mx-auto flex h-10 w-full max-w-7xl items-center gap-3 px-4 font-mono text-[11px] text-slate-500">
          <Link
            to="/"
            className="group flex items-center gap-1.5 transition hover:text-white"
            aria-label="Back to all tools"
          >
            <span className="transition group-hover:-translate-x-0.5">←</span>
            <span className="hidden sm:inline">all tools</span>
          </Link>
          <span className="h-3 w-px bg-white/10" />
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
            <Link to="/" className="shrink-0 transition hover:text-white">
              ~/wen.tools
            </Link>
            {segments.map((seg, i) => {
              const last = i === segments.length - 1;
              return (
                <span key={i} className="flex min-w-0 items-center gap-1.5">
                  <span className="text-slate-700">/</span>
                  <span
                    className={`truncate ${last ? "text-primary-orange" : ""}`}
                    aria-current={last ? "page" : undefined}
                  >
                    {decodeURIComponent(seg)}
                  </span>
                </span>
              );
            })}
          </nav>
          <span className="ml-auto">
            <BlockTicker />
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}
