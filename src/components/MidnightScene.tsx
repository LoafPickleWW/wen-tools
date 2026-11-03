import { useEffect, useMemo } from "react";
import { useChain } from "../context/ChainContext";
import { isFullMoon, litMoonPath, moonPhase } from "../midnight/moon";
import "../midnight/theme.css";

/** Pine ridge: a jagged skyline of trees across a 1200-wide strip. */
function ridge(seed: number, base: number, minH: number, maxH: number): string {
  let x = 0;
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  let d = `M0 ${base}`;
  while (x < 1200) {
    const w = 16 + rand() * 22;
    const h = minH + rand() * (maxH - minH);
    d += ` L${x + w * 0.5} ${base - h} L${x + w} ${base}`;
    x += w * 0.78;
  }
  return `${d} L1200 ${base} Z`;
}

/**
 * Backdrop for the Midnight chain: tonight's real moon phase, stars, fog and
 * a pine treeline. It also flips the page-wide theme by
 * setting data-chain on <html>; see midnight/theme.css.
 */
export function MidnightScene() {
  const { activeChain } = useChain();
  const active = activeChain === "midnight";

  const phase = useMemo(() => moonPhase(), []);
  const full = isFullMoon(phase);
  const back = useMemo(() => ridge(7, 120, 40, 105), []);
  const front = useMemo(() => ridge(31, 120, 28, 78), []);

  useEffect(() => {
    const root = document.documentElement;
    if (!active) {
      delete root.dataset.chain;
      delete root.dataset.moon;
      return;
    }
    root.dataset.chain = "midnight";
    if (full) root.dataset.moon = "full";
    else delete root.dataset.moon;
    return () => {
      delete root.dataset.chain;
      delete root.dataset.moon;
    };
  }, [active, full]);

  useEffect(() => {
    if (!active) return;
    console.log("%c00:00  chain's quiet. PRs welcome.", "color:#a5b4fc;font-family:monospace");
  }, [active]);

  if (!active) return null;

  return (
    <div className="mn-scene" aria-hidden="true">
      <div className="mn-stars" />

      <svg className="mn-moon" viewBox="0 0 100 100">
        <defs>
          <radialGradient id="mn-moon-lit" cx="40%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="60%" stopColor="#dbe4ff" />
            <stop offset="100%" stopColor="#a5b4fc" />
          </radialGradient>
          <clipPath id="mn-moon-disc">
            <circle cx="50" cy="50" r="46" />
          </clipPath>
        </defs>
        <circle cx="50" cy="50" r="46" fill="#0b0d26" />
        <g clipPath="url(#mn-moon-disc)">
          <path d={litMoonPath(phase, 50, 50, 46)} fill={full ? "#fecaca" : "url(#mn-moon-lit)"} />
          <g fill="#6366f1" opacity="0.22">
            <circle cx="38" cy="34" r="7" />
            <circle cx="60" cy="52" r="9" />
            <circle cx="44" cy="68" r="5" />
            <circle cx="66" cy="30" r="4" />
          </g>
        </g>
        <circle cx="50" cy="50" r="46" fill="none" stroke="#c7d2fe" strokeOpacity="0.25" />
      </svg>

      <div className="mn-fog mn-fog-b" />
      <svg className="mn-forest mn-forest-back" viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path d={back} />
      </svg>

      <div className="mn-fog mn-fog-a" />
      <svg className="mn-forest mn-forest-front" viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path d={front} />
      </svg>
    </div>
  );
}
