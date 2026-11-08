#!/usr/bin/env bash
# WP0 gate: install dependencies (only when node_modules is missing).
set -e
cd "$(dirname "$0")/.."
export PATH="$PWD/tools/node:$PATH"

if [ -d node_modules ]; then
  echo "node_modules already present — skipping npm install."
else
  npm install
fi

# AFTER install: a fresh node_modules/.bin has no node.exe, and npm's
# cmd-shims would fall back to a bare-`node` PATH lookup that fails in
# non-MSYS shell contexts (see ensure-node-shim.sh header).
. "$(dirname "$0")/ensure-node-shim.sh"
