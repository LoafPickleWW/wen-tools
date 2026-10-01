import { Link, useLocation } from "react-router-dom";
import { Meta } from "../components/Meta";
import { BrandBracket } from "../components/Wordmark";

/**
 * Unknown routes used to render the home page, which search engines treated
 * as endless duplicate copies of it. This page is marked noindex instead.
 */
export function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col items-center justify-center px-4 py-20 text-center text-white">
      <Meta title="Page not found" description="This page does not exist on wen.tools." noindex />
      <p className="wt-label">( 404 )</p>
      <p className="mt-6 flex items-center gap-[0.12em] whitespace-nowrap font-display text-[2.4rem] font-semibold tracking-[-0.04em] sm:text-6xl md:text-8xl">
        <BrandBracket className="wt-hero-bracket" strokeWidth={1.7} />
        <span>
          block <span className="wt-gradient-text">not found</span>
        </span>
        <BrandBracket flip className="wt-hero-bracket" strokeWidth={1.7} />
      </p>
      <div className="mt-8 w-full overflow-hidden rounded-xl border border-white/[0.08] bg-primary-black/60 text-left font-mono text-[13px] backdrop-blur">
        <div className="border-b border-white/[0.06] px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-slate-500">
          stderr
        </div>
        <div className="space-y-1 px-4 py-3 text-slate-400">
          <p>
            <span className="text-primary-orange">&gt;</span> open ~{pathname}
          </p>
          <p className="text-red-400/90">error: no such route on this chain</p>
          <p className="text-slate-500">hint: it may have moved into one of the suites</p>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link to="/" className="wt-btn wt-btn-primary h-11 px-5">
          Back to all tools
        </Link>
        <Link to="/encyclopedia" className="wt-btn wt-btn-ghost h-11 px-5">
          Browse the encyclopedia
        </Link>
      </div>
    </div>
  );
}
