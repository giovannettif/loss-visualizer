/**
 * gl-launch — shared Playwright browser launch with hardware-GL args
 * (QA SCRUB-HITCH). Playwright's default headless launch silently runs WebGL
 * on SwiftShader software GL, which makes every full-scene render cost
 * 50-80ms of CPU rasterization (scrub-drag frame gap p50 83ms; on the same
 * box with hardware D3D11 GL: p50 16.7ms). Gates are state/geometry checks,
 * not screenshot-exact, so they launch with the hardware backend when one
 * exists and fall back to the default (software) otherwise.
 */
import { existsSync } from "node:fs";

/** Args that steer Chromium to hardware ANGLE on Windows/AMD boxes. */
export const GL_ARGS = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];

/**
 * Launches Chromium with the hardware-GL args, skipping them when a marker
 * file opts out (create tools/.swiftshader to force the software backend for
 * shader-exact comparisons).
 */
export async function launchGL(chromium, options = {}) {
  const useHwGl =
    !existsSync(new URL("./.swiftshader", import.meta.url)) &&
    process.env.LP_SOFT_GL !== "1";
  const args = useHwGl ? [...GL_ARGS, ...(options.args ?? [])] : options.args;
  return chromium.launch({ ...options, args });
}
