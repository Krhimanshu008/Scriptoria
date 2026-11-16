#!/bin/sh
set -e

# Ensure /app/data directory exists and has permissions
mkdir -p /app/data 2>/dev/null || true

# If scriptoria.db does not exist in the persistent volume yet, seed it from /app/prisma/scriptoria.db
if [ ! -f /app/data/scriptoria.db ]; then
  if [ -f /app/prisma/scriptoria.db ]; then
    echo "[scriptoria-web] Seeding /app/data/scriptoria.db from /app/prisma/scriptoria.db..."
    cp /app/prisma/scriptoria.db /app/data/scriptoria.db
    chmod 664 /app/data/scriptoria.db 2>/dev/null || true
  else
    echo "[scriptoria-web] Notice: /app/prisma/scriptoria.db not found. A fresh database will be created."
  fi
fi

# Preload WebSocket Reverse Proxy if ws-proxy.js exists
if [ -f /app/ws-proxy.js ]; then
  export NODE_OPTIONS="--require /app/ws-proxy.js ${NODE_OPTIONS:-}"
  echo "[scriptoria-web] Preloaded /app/ws-proxy.js into Node runtime."
fi

exec "$@"
