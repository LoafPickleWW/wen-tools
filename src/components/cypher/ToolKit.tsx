import { useEffect, useState, type ReactNode } from "react";
import { BrandBracket } from "../Wordmark";
import { Reticle } from "./Reticle";

/* ---------------------------------------------------------------------------
 * Shared building blocks for tool pages, so every suite speaks the same
 * design language: bracketed hero, segmented tabs, framed panel, callouts
 * and a terminal-style busy indicator.
 * ------------------------------------------------------------------------- */

/** Page header for a tool or suite. */
export function ToolHero({
  icon,
  tag,
  title,
  description,
  meta = [],
}: {
  icon?: ReactNode;
  /** Short mono label shown in brackets above the title, e.g. "distribution" */
  tag: string;
  title: string;
  description: ReactNode;
  /** Capability chips, e.g. ["ARC-59", "CSV", "NFD vaults"] */
  meta?: string[];
}) {
  return (
    <header className="animate-fade-in mb-10 mt-10 flex w-full flex-col items-center text-center">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-primary-orange/30 bg-primary-orange/10 text-base text-primary-orange">
            {icon}
          </span>
        )}
        <span className="wt-label">( {tag} )</span>
      </div>
      <h1 className="mt-5 flex items-center justify-center gap-[0.14em] text-4xl text-white md:text-6xl">
        <BrandBracket className="hidden h-[1.1em] w-auto shrink-0 opacity-90 sm:block" strokeWidth={2} />
        <span className="text-balance">{title}</span>
        <BrandBracket flip className="hidden h-[1.1em] w-auto shrink-0 opacity-90 sm:block" strokeWidth={2} />
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400 md:text-base">
        {description}
      </p>
      {meta.length > 0 && (
        <ul className="mt-5 flex flex-wrap justify-center gap-1.5">
          {meta.map((m) => (
            <li
              key={m}
              className="rounded-md border border-white/[0.08] bg-primary-black/40 px-2 py-0.5 font-mono text-[11px] text-slate-400"
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

export interface ToolTab<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

/** Segmented tab bar with numbered, mono-indexed tabs. */
export function ToolTabs<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: ToolTab<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`mx-auto mb-8 grid w-full grid-cols-2 gap-1 rounded-2xl sm:flex sm:flex-wrap border border-white/[0.07] bg-primary-black/50 p-1 backdrop-blur ${className}`}
    >
      {tabs.map((t, i) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`group relative flex min-w-0 flex-1 items-center sm:min-w-[8.5rem] justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition duration-200 md:text-sm ${
              on
                ? "bg-banner-grey text-white shadow-[inset_0_0_0_1px_rgb(var(--brand)/0.35)]"
                : "text-slate-400 hover:bg-white/[0.03] hover:text-white"
            }`}
          >
            <span
              className={`font-mono text-[10px] ${on ? "text-primary-orange" : "text-slate-600 group-hover:text-slate-400"}`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            {t.icon && <span className={`text-base ${on ? "text-primary-orange" : ""}`}>{t.icon}</span>}
            <span>{t.label}</span>
            {on && (
              <span className="absolute inset-x-6 -bottom-px h-px bg-gradient-to-r from-transparent via-primary-orange to-transparent" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Inline note in the terminal voice, replacing ad-hoc blue info boxes. */
export function Callout({
  label = "info",
  tone = "info",
  children,
}: {
  label?: string;
  tone?: "info" | "warn";
  children: ReactNode;
}) {
  const warn = tone === "warn";
  return (
    <div
      className={`w-full rounded-2xl border px-4 py-3 text-left text-sm leading-relaxed ${
        warn
          ? "border-amber-500/25 bg-amber-500/[0.05] text-amber-100/90"
          : "border-white/[0.08] bg-primary-black/40 text-slate-300"
      }`}
    >
      <span
        className={`mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] ${
          warn ? "text-amber-400" : "text-primary-orange"
        }`}
      >
        // {label}
      </span>
      {children}
    </div>
  );
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Terminal-style busy indicator: braille spinner plus elapsed time, so long
 * batches visibly stay alive. Drop-in replacement for the round spinner.
 */
export function TermSpinner() {
  const [frame, setFrame] = useState(0);
  const [start] = useState(() => Date.now());
  const [, setNow] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
      setNow(Date.now());
    }, 90);
    return () => clearInterval(t);
  }, []);

  const secs = Math.floor((Date.now() - start) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <span
      role="status"
      aria-label="Working"
      className="inline-flex items-center gap-2.5 rounded-lg border border-primary-orange/25 bg-primary-orange/[0.06] px-3 py-1.5 font-mono text-sm"
    >
      <span className="w-[1ch] text-base leading-none text-primary-orange" aria-hidden="true">
        {FRAMES[frame]}
      </span>
      <span className="tabular-nums text-slate-400">
        {mm}:{ss}
      </span>
    </span>
  );
}

/**
 * Choice card for "pick a path" screens. A real <button> (keyboard and
 * screen-reader friendly) with the theme-gradient icon treatment.
 */
export function PathCard({
  onClick,
  icon,
  title,
  description,
  cta,
  index,
}: {
  onClick: () => void;
  /** Monochrome icon asset; rendered as a mask filled with the theme gradient */
  icon: string;
  title: string;
  description: ReactNode;
  cta: string;
  index?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="button-link group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-banner-grey/50 p-6 text-left backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-primary-orange/30 hover:bg-banner-grey/80 md:p-7"
    >
      <Reticle />
      <div className="relative flex items-start justify-between">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-primary-orange/20 bg-primary-orange/10 transition duration-300 group-hover:scale-105 group-hover:border-primary-orange/40">
          <span
            aria-hidden="true"
            className="h-[55%] w-[55%]"
            style={{
              background: "linear-gradient(135deg, rgb(var(--brand)), rgb(var(--brand-2)))",
              WebkitMask: `url(${icon}) center / contain no-repeat`,
              mask: `url(${icon}) center / contain no-repeat`,
            }}
          />
        </span>
        {index !== undefined && (
          <span className="font-mono text-[11px] text-slate-600 transition group-hover:text-primary-orange">
            [{String(index + 1).padStart(2, "0")}]
          </span>
        )}
      </div>
      <h3 className="relative mt-5 font-display text-xl font-semibold tracking-tight text-white">
        {title}
      </h3>
      <p className="relative mt-2 flex-1 text-sm leading-relaxed text-slate-400">{description}</p>
      <span className="relative mt-6 border-t border-dashed border-white/[0.08] pt-3 font-mono text-[11px] text-primary-orange opacity-70 transition group-hover:opacity-100">
        {cta.replace(/\s*→\s*$/, "")} →
      </span>
    </button>
  );
}
