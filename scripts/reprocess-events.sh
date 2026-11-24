#!/bin/sh
# Reprocessa eventos do WhatsApp que falharam ou ficaram pendentes (padrão: últimas 24 horas).
# Uso: scripts/reprocess-events.sh [--hours 48]
set -eu
cd "$(dirname "$0")/.."
exec docker compose exec -T backend node dist/cli/reprocess-events.js "$@"
