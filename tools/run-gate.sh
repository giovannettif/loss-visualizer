#!/usr/bin/env bash
# Browser-gate runner: bash tools/run-gate.sh tools/<gate>.mjs
#
# SELF-SUFFICIENT: owns port 4173 for the duration of the gate — kills stale
# listeners (a zombie preview serving an old dist poisons gate results),
# starts a fresh `vite preview` from the current dist, runs the gate, then
# stops the server. Node is invoked by explicit portable-node path (see
# ensure-node-shim.sh for the WSL/PATH diagnosis — bare `node` is unresolvable
# in world.run / WSL-bash contexts).
set -e
cd "$(dirname "$0")/.."
. tools/ensure-node-shim.sh
NODE="$PWD/tools/node/node.exe"

GATE="$1"
if [ -z "$GATE" ]; then
  echo "usage: run-gate.sh tools/<gate>.mjs"
  exit 2
fi

# 1. The gates exercise the production build — build it if missing.
if [ ! -f dist/index.html ]; then
  echo "[run-gate] dist/index.html missing — building"
  npm run build
fi

# 2. Free :4173 from stale listeners (old previews poison gate results).
for pid in $(netstat -ano | grep -E "TCP.*:4173[^0-9]" | awk '{print $NF}' | sort -u); do
  echo "[run-gate] killing stale listener on :4173 (pid $pid)"
  taskkill //F //PID "$pid" >/dev/null 2>&1 || true
done

# 3. Start a fresh preview from the current dist.
"$NODE" node_modules/vite/bin/vite.js preview --port 4173 --strictPort &
SERVER_PID=$!
for _ in $(seq 1 60); do
  if "$NODE" -e "fetch('http://127.0.0.1:4173/').then(r=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

# 4. Run the gate.
set +e
"$NODE" "$GATE"
CODE=$?

# 5. Stop our preview server.
kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null
exit $CODE
