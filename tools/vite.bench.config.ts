// Scratch build config for the §5 rebuild bench (SEC5-S2-REBUILD-COST-JANK).
// Builds ONLY bench-s2.html into dist-bench/ — the production dist/ and
// vite.config.ts inputs are untouched. Not part of any gate.
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: at("../"),
  build: {
    outDir: "dist-bench",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { bench: at("../bench-s2.html") },
    },
  },
});
