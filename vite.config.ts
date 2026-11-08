import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/** Resolve repo-root-relative paths without relying on CJS __dirname. */
const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: at("./index.html"),
        debug: at("./debug.html"),
      },
    },
  },
});
