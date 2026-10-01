import { IoLockClosed, IoCheckmark } from "react-icons/io5";
import { usePQTheme } from "../../context/PQThemeContext";
import { CLASSIC_THEME, THEME_TIERS, type ThemeTierInfo } from "../../types/pqTheme";

const OPTIONS: ThemeTierInfo[] = [CLASSIC_THEME, ...THEME_TIERS];

/** Grid of theme tiles: Classic plus the Quantum tiers unlocked by PQSIG activity. */
export function ThemeSwatches() {
  const { quantumTheme, setQuantumTheme, unlockedThemes } = usePQTheme();

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {OPTIONS.map((t) => {
        const unlocked = t.id === "classic" || unlockedThemes.includes(t.id);
        const selected = quantumTheme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            disabled={!unlocked}
            onClick={() => setQuantumTheme(t.id)}
            aria-pressed={selected}
            title={unlocked ? t.title : `Unlocks at ${t.badge}`}
            className={`group relative flex flex-col items-center gap-1.5 rounded-xl border px-1.5 pb-2 pt-2.5 text-center transition ${
              selected
                ? "border-white/25 bg-white/[0.06]"
                : unlocked
                ? "border-white/[0.06] hover:border-white/15 hover:bg-white/[0.03]"
                : "cursor-not-allowed border-white/[0.04] opacity-45"
            }`}
          >
            <span
              className="relative grid h-8 w-8 place-items-center rounded-full transition group-hover:scale-105"
              style={{
                background: `conic-gradient(from 210deg, ${t.color}, ${t.color2}, ${t.color})`,
                boxShadow: selected ? `0 0 16px -2px ${t.color}` : undefined,
              }}
            >
              {selected && <IoCheckmark className="text-sm text-slate-950" />}
              {!unlocked && <IoLockClosed className="text-[11px] text-slate-950/70" />}
            </span>
            <span className="w-full truncate text-[10px] font-semibold leading-tight text-slate-200">
              {t.name}
            </span>
            <span className="text-[9px] font-medium uppercase tracking-wider text-slate-500">
              {t.badge}
            </span>
          </button>
        );
      })}
    </div>
  );
}
