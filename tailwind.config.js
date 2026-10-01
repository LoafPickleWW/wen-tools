/** @type {import('tailwindcss').Config} */

// Colors resolve to CSS variables defined per theme in src/index.css, so
// switching `data-quantum-theme` on <html> re-skins every utility below
// (opacity modifiers included, e.g. bg-orange-500/20).
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const scale = (name) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => [
      s,
      v(`${name}-${s}`),
    ])
  );

export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      spacing: {
        108: "27rem",
      },
      colors: {
        // Theme-aware accent palettes
        orange: scale("orange"),
        amber: scale("amber"),
        yellow: scale("yellow"),

        // Semantic tokens
        brand: v("brand"),
        "brand-2": v("brand-2"),

        "orange-1000": "#C254414B",
        "red-1000": "#801F19",
        "special-red": "#7a0909",
        "primary-orange": v("brand"),
        "primary-blue": "#6EC1E4",
        "primary-yellow": v("brand-2"),
        "primary-red": "#BB000E",
        "secondary-orange": v("brand"),
        "secondary-yellow": v("brand-soft"),
        "primary-black": v("bg"),
        "primary-gray": "#D0D0D1",
        "secondary-gray": v("surface-2"),
        "secondary-black": "#000a02",
        "banner-grey": v("surface"),
        "text-white": "#f9fafb",
        "asset-detail-bg": v("surface-3"),
      },
      fontSize: {
        xxs: "0.6rem",
      },
    },
    fontFamily: {
      sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      display: ["Space Grotesk", "Inter", "sans-serif"],
      mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      roboto: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
    },
  },
  plugins: [],
};
