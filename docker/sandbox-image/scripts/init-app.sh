#!/usr/bin/env bash
set -e

APP_DIR="/app"
STARTER_DIR="/opt/nuxt-starter"

echo "[init-app] Starting sandbox container..."

# If no package.json exists, bootstrap from nuxt-starter
if [ ! -f "${APP_DIR}/package.json" ]; then
  echo "[init-app] No app found, bootstrapping from nuxt-starter template..."
  cp -r "${STARTER_DIR}/." "${APP_DIR}/"
fi

echo "[init-app] Starting agent-worker on port 4001..."
node /usr/local/lib/agent-worker/dist/worker.js &
WORKER_PID=$!

echo "[init-app] Starting Nuxt dev server on port 3000..."
cd "${APP_DIR}" && pnpm exec nuxi dev --port 3000 --host 0.0.0.0 &
NUXT_PID=$!

# Exit (and let Docker restart the container) if either process dies
wait -n $WORKER_PID $NUXT_PID
echo "[init-app] A process exited, stopping container..."
kill $WORKER_PID $NUXT_PID 2>/dev/null || true
