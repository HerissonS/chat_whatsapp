#!/bin/sh
# Cria ou redefine um usuário Administrador da Central de Atendimento.
# Detecta automaticamente docker-compose.prod.yml ou docker-compose.yml.
#
# Interativo (recomendado):
#   scripts/create-admin.sh
#
# Automatizado (senha pela entrada padrão, nunca como argumento):
#   printf '%s\n' "$SENHA" | scripts/create-admin.sh --username joao.silva --name "João Silva" --password-stdin
set -eu
cd "$(dirname "$0")/.."

COMPOSE_FILE=""
for candidate in docker-compose.prod.yml docker-compose.yml; do
  if [ -f "$candidate" ] && docker compose -f "$candidate" ps --status running --services 2>/dev/null | grep -qx backend; then
    COMPOSE_FILE="$candidate"
    break
  fi
done

if [ -z "$COMPOSE_FILE" ]; then
  echo "O serviço backend não está rodando. Suba o sistema com: scripts/deploy.sh (ou docker compose up -d)" >&2
  exit 1
fi

# Endereço de acesso, só para a mensagem final.
BIND_IP="$(grep -E '^BIND_IP=' .env 2>/dev/null | cut -d= -f2)"
HTTP_PORT="$(grep -E '^HTTP_PORT=' .env 2>/dev/null | cut -d= -f2)"
URL="http://${BIND_IP:-127.0.0.1}:${HTTP_PORT:-8870}"

if [ -t 0 ] && [ -t 1 ]; then
  # Terminal interativo: aloca TTY no container (senha oculta, perguntas visíveis).
  exec docker compose -f "$COMPOSE_FILE" exec -e PUBLIC_URL="$URL" backend node dist/cli/create-admin.js "$@"
else
  exec docker compose -f "$COMPOSE_FILE" exec -T -e PUBLIC_URL="$URL" backend node dist/cli/create-admin.js "$@"
fi
