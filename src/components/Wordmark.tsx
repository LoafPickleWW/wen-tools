import { useId } from "react";

/** One of the brand's gradient brackets. `flip` draws the closing ")". */
export function BrandBracket({
  flip = false,
  className = "h-[1.45em] w-auto shrink-0",
  strokeWidth = 2.6,
}: {
  flip?: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  const id = useId();
  return (
    <svg
      viewBox="0 0 12 32"
      aria-hidden="true"
      className={className}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(var(--brand))" />
          <stop offset="1" stopColor="rgb(var(--brand-2))" />
        </linearGradient>
      </defs>
      <path
        d="M11 2.5C5.5 3.5 2.5 9 2.5 16S5.5 28.5 11 29.5"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}

/**
 * The wen.tools mark: gradient brackets around the name. Drawn in markup
 * (rather than the PNG logo) so the brackets follow the active theme.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-[0.15em] font-display font-semibold leading-none tracking-tight text-white ${className}`}
    >
      <BrandBracket />
      <span className="wt-wordmark-text inline-block">
        w<span className="hidden sm:inline">en</span>
        <span className="text-primary-orange">.</span>
        t<span className="hidden sm:inline">ools</span>
      </span>
      <BrandBracket flip />
    </span>
  );
}
