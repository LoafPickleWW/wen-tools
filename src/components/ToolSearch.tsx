import { useEffect, useRef } from "react";
import { MdClose } from "react-icons/md";

interface ToolSearchProps {
  query: string;
  setQuery: (query: string) => void;
}

export function ToolSearch({ query, setQuery }: ToolSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere on the page, Esc clears it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = /input|textarea|select/i.test(el.tagName) || el.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="group relative mx-auto w-full max-w-xl">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 blur-md transition duration-500 group-focus-within:opacity-100"
        style={{
          background:
            "linear-gradient(120deg, rgb(var(--brand) / 0.45), rgb(var(--brand-2) / 0.35))",
        }}
      />
      <div className="relative flex items-center rounded-2xl border border-white/10 bg-banner-grey/80 backdrop-blur-xl transition group-focus-within:border-primary-orange/50">
        <span aria-hidden="true" className="ml-4 shrink-0 font-mono text-sm text-slate-500 transition-colors group-focus-within:text-primary-orange">
          ~/tools $
        </span>
        <input
          ref={inputRef}
          type="text"
          aria-label="Search tools"
          className="h-12 w-full bg-transparent px-3 font-mono text-sm text-white placeholder-slate-600 caret-primary-orange outline-none"
          placeholder={"search — try “airdrop”"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              inputRef.current?.blur();
            }
          }}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="mr-3 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <MdClose />
          </button>
        ) : (
          <kbd className="mr-3 hidden shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 sm:block">
            /
          </kbd>
        )}
      </div>
    </div>
  );
}
