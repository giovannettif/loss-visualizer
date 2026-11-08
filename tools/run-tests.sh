#!/usr/bin/env bash
# WP0 gate: run the vitest suite.
set -e
cd "$(dirname "$0")/.."
export PATH="$PWD/tools/node:$PATH"

# Guarantee node.exe resolves for npm's cmd-shims in any shell context
# (see ensure-node-shim.sh header for the diagnosed failure mode).
. "$(dirname "$0")/ensure-node-shim.sh"

npm test
