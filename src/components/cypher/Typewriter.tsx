import { useEffect, useState } from "react";

/** Cycles through shell-style commands, typing and deleting each one. */
export function Typewriter({ lines, className = "" }: { lines: string[]; className?: string }) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [lineIdx, setLineIdx] = useState(0);
  const [len, setLen] = useState(reduced ? lines[0].length : 0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const line = lines[lineIdx];
    let delay = deleting ? 28 : 55 + Math.random() * 60;
    if (!deleting && len === line.length) delay = 1800;
    if (deleting && len === 0) delay = 350;

    const t = setTimeout(() => {
      if (!deleting && len === line.length) setDeleting(true);
      else if (deleting && len === 0) {
        setDeleting(false);
        setLineIdx((i) => (i + 1) % lines.length);
      } else setLen((l) => l + (deleting ? -1 : 1));
    }, delay);
    return () => clearTimeout(t);
  }, [len, deleting, lineIdx, lines, reduced]);

  return (
    <span className={className}>
      {lines[lineIdx].slice(0, len)}
      <span className="wt-caret" aria-hidden="true" />
    </span>
  );
}
