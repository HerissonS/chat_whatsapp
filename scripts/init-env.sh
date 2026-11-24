#!/bin/sh
# Cria o arquivo .env a partir do .env.example, gerando todos os segredos.
# - Não sobrescreve um .env existente (use --force para recriar; os dados dos bancos
#   já criados deixariam de abrir com as senhas novas, então só use em instalação nova).
# - Nenhum segredo é exibido na tela.
# Uso: scripts/init-env.sh [--bind-ip IP] [--port PORTA] [--force]
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="$ROOT/.env.example"
TARGET="$ROOT/.env"
BIND_IP=""
PORT=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --bind-ip) BIND_IP="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
done

if [ -f "$TARGET" ] && [ "$FORCE" -ne 1 ]; then
  echo "O arquivo .env já existe. Nada foi alterado."
  echo "Para recriar em uma instalação NOVA, use --force."
  exit 0
fi

command -v openssl >/dev/null 2>&1 || { echo "openssl não encontrado." >&2; exit 1; }

umask 077
TMP="$(mktemp "$ROOT/.env.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

# Segredos em hexadecimal: fortes e sem caracteres que quebrem URLs de conexão.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *=__GERAR__)
      printf '%s=%s\n' "${line%%=*}" "$(openssl rand -hex 32)" >> "$TMP" ;;
    HOST_UID=*) printf 'HOST_UID=%s\n' "$(id -u)" >> "$TMP" ;;
    HOST_GID=*) printf 'HOST_GID=%s\n' "$(id -g)" >> "$TMP" ;;
    BIND_IP=*) [ -n "$BIND_IP" ] && printf 'BIND_IP=%s\n' "$BIND_IP" >> "$TMP" || printf '%s\n' "$line" >> "$TMP" ;;
    HTTP_PORT=*) [ -n "$PORT" ] && printf 'HTTP_PORT=%s\n' "$PORT" >> "$TMP" || printf '%s\n' "$line" >> "$TMP" ;;
    *) printf '%s\n' "$line" >> "$TMP" ;;
  esac
done < "$EXAMPLE"

mv "$TMP" "$TARGET"
trap - EXIT
chmod 600 "$TARGET"
mkdir -p "$ROOT/backups" && chmod 700 "$ROOT/backups"

echo "Arquivo .env criado com segredos gerados (permissão 600)."
echo "Próximo passo: preencha SMTP_USER e SMTP_PASSWORD (senha de app do Gmail) no .env."
