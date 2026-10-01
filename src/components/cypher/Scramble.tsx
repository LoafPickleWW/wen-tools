import { useEffect, useState } from "react";

const GLYPHS = "01ABCDEF#$%&*<>/\\=+?";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface ScrambleSegment {
  text: string;
  className?: string;
}

/**
 * "Decrypts" text on mount: characters resolve left to right out of random
 * glyphs. The real text is laid out invisibly underneath so nothing shifts,
 * and screen readers only ever get the final string.
 */
export function Scramble({
  segments,
  duration = 1100,
  className = "",
}: {
  segments: ScrambleSegment[];
  duration?: number;
  className?: string;
}) {
  const full = segments.map((s) => s.text).join("");
  const [revealed, setRevealed] = useState(() => (prefersReducedMotion() ? full.length : 0));
  const [, setTick] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setRevealed(Math.floor(p * full.length));
      setTick((t) => t + 1);
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [full, duration]);

  let offset = 0;
  const animated = segments.map((seg, i) => {
    const out = [...seg.text]
      .map((ch, j) => {
        const idx = offset + j;
        if (ch === " " || idx < revealed) return ch;
        return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      })
      .join("");
    offset += seg.text.length;
    return (
      <span key={i} className={seg.className}>
        {out}
      </span>
    );
  });

  const done = revealed >= full.length;

  return (
    <span className={`relative inline-block ${className}`} aria-label={full}>
      <span aria-hidden="true" className={done ? "" : "invisible"}>
        {segments.map((seg, i) => (
          <span key={i} className={seg.className}>
            {seg.text}
          </span>
        ))}
      </span>
      {!done && (
        <span aria-hidden="true" className="absolute inset-0 whitespace-nowrap">
          {animated}
        </span>
      )}
    </span>
  );
}
