import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

/** Namespaces this app reads (`useTranslation`, `i18n.t("ns:…")`, and `common` for the shared date helpers). */
const FIT_NAMESPACES = [
  "common",
  "fitWeb",
  "fitWebOverview",
  "fitWebWorkouts",
  "fitWebSleep",
  "fitWebUpload",
  "fitWebConnect",
  "koneksi",
  "place",
] as const;

const I18N_SRC = fileURLToPath(new URL("../../packages/i18n/src", import.meta.url));
const RESOURCES_FILE = `${I18N_SRC}/resources.ts`;

/**
 * `@joyorogo/i18n` bundles every namespace of every JoyoRogo/JoyoFit screen (~850 KB of JSON, 600 KB of JS, in both
 * languages) because i18next initialises synchronously from `resources.ts`. This app uses a fraction, so its build
 * swaps that one module for a slim one: same exports, only the namespaces above, and from `feed` only the route-map
 * strings. Type-checking still sees the full module, so the key types are unchanged.
 */
function slimI18nResources(): Plugin {
  const imports = (lang: string) =>
    FIT_NAMESPACES.map(
      (ns) => `import ${lang}_${ns} from "${I18N_SRC}/locales/${lang}/${ns}.json";`,
    ).join("\n");
  const entries = (lang: string) =>
    FIT_NAMESPACES.map((ns) => `${ns}: ${lang}_${ns},`).join("\n  ");
  const feed = (lang: string) =>
    `import ${lang}_feed from "${I18N_SRC}/locales/${lang}/feed.json";\nconst ${lang}_feedMap = { analysis: { map: ${lang}_feed.analysis.map } };`;
  const source = `
${imports("id")}
${imports("en")}
${feed("id")}
${feed("en")}
const id = { ${entries("id")} feed: id_feedMap };
const en = { ${entries("en")} feed: en_feedMap };
export const resources = { id, en };
export const NAMESPACES = Object.keys(id);
export const DEFAULT_NAMESPACE = "common";
`;
  return {
    name: "fit-slim-i18n-resources",
    enforce: "pre",
    load(id) {
      if (id.split("?")[0] === RESOURCES_FILE) return source;
      return null;
    },
  };
}

export default defineConfig({
  server: {
    port: 3003,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    slimI18nResources(),
    tailwindcss(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
  ],
});
