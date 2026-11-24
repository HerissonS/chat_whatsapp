#!/bin/sh
# Carrega contratos e equipamentos FICTÍCIOS no catálogo local (somente para testes).
set -eu
cd "$(dirname "$0")/.."
exec docker compose exec -T backend node dist/cli/seed-demo.js
