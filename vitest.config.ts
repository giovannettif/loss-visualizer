import { defineConfig } from "vitest/config";

/**
 * The unit suite lives in src/** (pure-math + scene-core tests). evidence/
 * holds ARCHIVED QA probe copies that reference sources by their old paths —
 * discovery must never pick them up. (Setting `exclude` replaces vitest's
 * defaults, so the standard ones are restated here.)
 */
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "evidence/**",
      "archive/**",
      "tools/**",
      "shots/**",
    ],
  },
});
