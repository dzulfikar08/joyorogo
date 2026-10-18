import { execFileSync } from "node:child_process";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { blogPlugin } from "./blog/plugin.ts";

/** Ties the saved query cache to this build (src/lib/cache-buster.ts): the commit, else the build time. */
function buildId(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return Date.now().toString(36);
  }
}

export default defineConfig({
  define: { "import.meta.env.VITE_BUILD_ID": JSON.stringify(process.env.VITE_BUILD_ID ?? buildId()) },
  server: {
    port: 3001,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    blogPlugin(),
  ],
});
