#!/bin/sh
# Lista as mensagens gravadas como "não suportadas" e o motivo (só tipo e nomes de campos, sem conteúdo).
# Uso: scripts/diagnose-messages.sh [--days 30] [--fix]
# Detecta automaticamente o compose de produção (docker-compose.prod.yml) quando ele está em uso.
set -eu
cd "$(dirname "$0")/.."
COMPOSE="docker compose"
if [ -f docker-compose.prod.yml ] && docker compose -f docker-compose.prod.yml ps -q backend 2>/dev/null | grep -q .; then
  COMPOSE="docker compose -f docker-compose.prod.yml"
fi
exec $COMPOSE exec -T backend node dist/cli/diagnose-messages.js "$@"
