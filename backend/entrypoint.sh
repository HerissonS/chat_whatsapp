#!/bin/sh
# Ponto de entrada do container backend.
#   api     -> aplica migrations pendentes e sobe a API
#   worker  -> sobe o worker de filas
#   migrate -> só aplica as migrations
set -eu
case "${1:-api}" in
  api)
    node dist/database/migrate.js
    exec node dist/main.js
    ;;
  worker)
    exec node dist/worker.js
    ;;
  migrate)
    exec node dist/database/migrate.js
    ;;
  *)
    exec "$@"
    ;;
esac
