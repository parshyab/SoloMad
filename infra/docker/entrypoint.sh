#!/bin/sh
set -eu
if [ -n "${RUNTIME_SECRET_JSON:-}" ]; then
  export RUNTIME_SECRET_JSON
fi
case "${SOLOMAD_SERVICE}" in
  api) exec node /app/infra/docker/start-with-runtime.mjs apps/api/dist/main.js ;;
  realtime) exec node /app/infra/docker/start-with-runtime.mjs apps/realtime/dist/main.js ;;
  *) echo "unknown SOLOMAD_SERVICE=${SOLOMAD_SERVICE}" >&2; exit 2 ;;
esac
