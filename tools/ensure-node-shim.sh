#!/usr/bin/env bash
# Sourced by tools/run-{install,tests,build}.sh AFTER they cd to the repo root.
#
# WHY THIS EXISTS (diagnosed 2026-10-27): npm's cmd-shims in node_modules/.bin
# (e.g. vitest.cmd lines 10-15) exec "%dp0%\node.exe" when a node.exe sits
# beside them, and otherwise fall back to BARE `node` — a PATH lookup done by
# cmd.exe. In invocation contexts where cmd.exe does not receive the repo's
# tools/node on PATH — concretely, running `bash tools/run-tests.sh` under
# WSL bash (C:\Windows\System32\bash.exe): the exported /mnt/c/... PATH is
# Linux-format, so Windows node.exe (launched via WSL interop by
# tools/node/npm) rebuilds the child PATH and the bare `node` lookup fails
# with:  '"node"' is not recognized as an internal or external command.
#
# FIX: place node.exe INSIDE node_modules/.bin so every shim takes its
# absolute-path branch — no PATH or PATHEXT lookup at all, in any context.
# Hardlink first (same NTFS volume, zero extra disk); fall back to a copy
# (WSL DrvFs does not support hardlinks).
#
# Idempotent and cheap: a single -e existence test once the link exists.

ensure_bin_node_exe() {
  if [ -d node_modules/.bin ] && [ ! -e node_modules/.bin/node.exe ]; then
    ln tools/node/node.exe node_modules/.bin/node.exe 2>/dev/null ||
      cp tools/node/node.exe node_modules/.bin/node.exe
  fi
}
ensure_bin_node_exe
