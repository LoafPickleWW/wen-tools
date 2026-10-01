// Local preview only: same as vite.config.ts but served over plain HTTP so the
// in-app browser accepts it (it rejects the self-signed basic-ssl cert).
import base from "../vite.config";
import type { PluginOption, UserConfig } from "vite";

const flat = (base.plugins ?? []).flat(Infinity as 1) as PluginOption[];

export default {
  ...base,
  plugins: flat.filter(
    (p) => !(p && typeof p === "object" && "name" in p && p.name === "vite:basic-ssl")
  ),
} satisfies UserConfig;
