#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
export PATH="$PWD/tools/node:$PATH"
exec node "$1"
