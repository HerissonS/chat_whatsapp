#!/usr/bin/env bash
# Script interativo de implantacao da Central de Atendimento WhatsApp.
# Suporta:
#   - Producao com imagens assinadas no GHCR (docker-compose.prod.yml)
#   - Local / Desenvolvimento com build local (docker-compose.yml)
#
# Seguranca:
#   - Senhas e tokens sao gerados automaticamente com 256 bits via openssl (nunca exibidos na tela).
#   - Se o arquivo .env ja existir, preserva as senhas dos bancos/sessao para nao corromper volumes.
#   - O arquivo .env e gravado com permissao 600 e ./backups com permissao 700.
#   - Nunca executa `docker down` ou `docker compose down`.
#
# Uso:
#   scripts/deploy.sh              # modo interativo completo
#   scripts/deploy.sh --prod       # pre-seleciona docker-compose.prod.yml
#   scripts/deploy.sh --local      # pre-seleciona docker-compose.yml
#   scripts/deploy.sh --only-env   # apenas gera/atualiza o .env sem subir os containers
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_EXAMPLE="$ROOT/.env.example"
ENV_FILE="$ROOT/.env"

MODE=""
ONLY_ENV=0

while [ $# -gt 0 ]; do
  case "$1" in
    --prod) MODE="prod"; shift ;;
    --local) MODE="local"; shift ;;
    --only-env) ONLY_ENV=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Opcao desconhecida: $1" >&2
      exit 2
      ;;
  esac
done

command -v openssl >/dev/null 2>&1 || { echo "Erro: openssl nao encontrado." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Erro: docker nao encontrado." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Erro: Docker Compose v2 nao encontrado." >&2; exit 1; }
[ -f "$ENV_EXAMPLE" ] || { echo "Erro: $ENV_EXAMPLE nao encontrado." >&2; exit 1; }

# Le valor de uma chave em um arquivo .env (sem executar o arquivo)
get_env_val() {
  local file="$1"
  local key="$2"
  if [ ! -f "$file" ]; then
    return 0
  fi
  awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

# Atualiza ou adiciona uma chave no arquivo alvo de forma segura
set_env_val() {
  local file="$1"
  local key="$2"
  local val="$3"
  local tmp
  tmp="$(mktemp "${file}.XXXXXX")"
  awk -v k="$key" -v v="$val" '
    BEGIN { updated = 0 }
    index($0, k "=") == 1 {
      print k "=" v
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) print k "=" v
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

gen_secret() {
  openssl rand -hex 32
}

prompt_val() {
  local label="$1"
  local default_val="$2"
  local reply=""
  if [ -n "$default_val" ]; then
    printf "%s [%s]: " "$label" "$default_val" >&2
  else
    printf "%s: " "$label" >&2
  fi
  IFS= read -r reply || true
  if [ -z "$reply" ]; then
    printf '%s' "$default_val"
  else
    printf '%s' "$reply"
  fi
}

prompt_secret() {
  local label="$1"
  local has_existing="$2"
  local reply=""
  if [ "$has_existing" = "1" ]; then
    printf "%s [Enter para manter valor atual]: " "$label" >&2
  else
    printf "%s (digitacao oculta, Enter para vazio): " "$label" >&2
  fi
  stty -echo 2>/dev/null || true
  IFS= read -r reply || true
  stty echo 2>/dev/null || true
  printf "\n" >&2
  printf '%s' "$reply"
}

prompt_yes_no() {
  local label="$1"
  local default_yn="$2" # s ou n
  local reply=""
  local hint="s/N"
  [ "$default_yn" = "s" ] && hint="S/n"
  printf "%s [%s]: " "$label" "$hint" >&2
  IFS= read -r reply || true
  reply="$(printf '%s' "${reply:-$default_yn}" | tr '[:upper:]' '[:lower:]')"
  case "$reply" in
    s|sim|y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

echo "=================================================================="
echo "  Implantacao - Central de Atendimento WhatsApp"
echo "=================================================================="
echo ""

# 1. Escolha do modo (docker-compose.prod.yml vs docker-compose.yml)
if [ -z "$MODE" ]; then
  echo "Escolha o modo de implantacao:"
  echo "  1) Producao com imagens assinadas no GHCR (docker-compose.prod.yml)"
  echo "  2) Local / Desenvolvimento com build local (docker-compose.yml)"
  choice="$(prompt_val "Opcao (1 ou 2)" "1")"
  case "$choice" in
    1|prod|producao) MODE="prod" ;;
    2|local|dev) MODE="local" ;;
    *)
      echo "Opcao invalida: $choice" >&2
      exit 2
      ;;
  esac
fi

if [ "$MODE" = "prod" ]; then
  COMPOSE_FILE="$ROOT/docker-compose.prod.yml"
else
  COMPOSE_FILE="$ROOT/docker-compose.yml"
fi
[ -f "$COMPOSE_FILE" ] || { echo "Erro: $COMPOSE_FILE nao encontrado." >&2; exit 1; }

echo ""
echo "Modo selecionado: $MODE ($(basename "$COMPOSE_FILE"))"
echo ""

# 2. Prepara base temporaria do .env (preservando .env existente se houver)
umask 077
TMP_ENV="$(mktemp "$ROOT/.env.deploy.XXXXXX")"
trap 'rm -f "$TMP_ENV"' EXIT

EXISTING_ENV=0
if [ -f "$ENV_FILE" ]; then
  EXISTING_ENV=1
  cp "$ENV_FILE" "$TMP_ENV"
  echo "Arquivo .env existente detectado: senhas e tokens ja configurados serao preservados."
else
  cp "$ENV_EXAMPLE" "$TMP_ENV"
  echo "Criando novo arquivo .env a partir de .env.example..."
fi

# 3. Gera automaticamente todos os segredos ausentes ou marcados com __GERAR__
GENERATED_SECRETS=0
for secret_key in \
  MARIADB_ROOT_PASSWORD \
  DB_PASSWORD \
  EVO_DB_PASSWORD \
  REDIS_PASSWORD \
  EVOLUTION_API_KEY \
  WEBHOOK_TOKEN \
  SESSION_SECRET; do
  cur="$(get_env_val "$TMP_ENV" "$secret_key")"
  if [ -z "$cur" ] || [ "$cur" = "__GERAR__" ]; then
    set_env_val "$TMP_ENV" "$secret_key" "$(gen_secret)"
    GENERATED_SECRETS=$((GENERATED_SECRETS + 1))
  fi
done

if [ "$GENERATED_SECRETS" -gt 0 ]; then
  echo "-> $GENERATED_SECRETS senha(s)/token(s) gerados automaticamente (256 bits aleatorios)."
fi

# UID/GID do host para permissao dos backups
cur_uid="$(get_env_val "$TMP_ENV" HOST_UID)"
cur_gid="$(get_env_val "$TMP_ENV" HOST_GID)"
set_env_val "$TMP_ENV" HOST_UID "${cur_uid:-$(id -u)}"
set_env_val "$TMP_ENV" HOST_GID "${cur_gid:-$(id -g)}"

echo ""
echo "--- 1/4 Configuracao de Rede e Publicacao ---"
cur_bind="$(get_env_val "$TMP_ENV" BIND_IP)"
cur_port="$(get_env_val "$TMP_ENV" HTTP_PORT)"
cur_tz="$(get_env_val "$TMP_ENV" TZ)"
cur_cookie="$(get_env_val "$TMP_ENV" COOKIE_SECURE)"
cur_proxy="$(get_env_val "$TMP_ENV" TRUST_PROXY)"

BIND_IP="$(prompt_val "IP de publicacao (127.0.0.1 para proxy reverso local ou IP do servidor)" "${cur_bind:-127.0.0.1}")"
HTTP_PORT="$(prompt_val "Porta HTTP publicada" "${cur_port:-8870}")"
TZ_VAL="$(prompt_val "Fuso horario (TZ)" "${cur_tz:-America/Sao_Paulo}")"

default_https="n"
[ "$cur_cookie" = "true" ] && default_https="s"
if prompt_yes_no "O sistema sera acessado via HTTPS (atras de proxy reverso com TLS)?" "$default_https"; then
  COOKIE_SECURE="true"
  TRUST_PROXY="$(prompt_val "TRUST_PROXY (proxies confiaveis)" "${cur_proxy:-loopback, 172.16.0.0/12}")"
else
  COOKIE_SECURE="false"
  TRUST_PROXY="${cur_proxy:-loopback, 172.16.0.0/12}"
fi

set_env_val "$TMP_ENV" BIND_IP "$BIND_IP"
set_env_val "$TMP_ENV" HTTP_PORT "$HTTP_PORT"
set_env_val "$TMP_ENV" TZ "$TZ_VAL"
set_env_val "$TMP_ENV" COOKIE_SECURE "$COOKIE_SECURE"
set_env_val "$TMP_ENV" TRUST_PROXY "$TRUST_PROXY"

# 4. Imagens GHCR (somente no modo producao)
BACKEND_IMAGE=""
FRONTEND_IMAGE=""
BACKUP_IMAGE=""
if [ "$MODE" = "prod" ]; then
  echo ""
  echo "--- 2/4 Imagens Assinadas no GHCR (docker-compose.prod.yml) ---"
  echo "Informe a referencia completa de cada imagem gerada pela pipeline na branch main"
  echo "(formato recomendado: ghcr.io/<owner>/<repo>-<servico>:sha-<commit>@sha256:<digest>)."

  cur_back="$(get_env_val "$TMP_ENV" BACKEND_IMAGE)"
  cur_front="$(get_env_val "$TMP_ENV" FRONTEND_IMAGE)"
  cur_bkp="$(get_env_val "$TMP_ENV" BACKUP_IMAGE)"

  while [ -z "$BACKEND_IMAGE" ]; do
    BACKEND_IMAGE="$(prompt_val "BACKEND_IMAGE" "$cur_back")"
    [ -z "$BACKEND_IMAGE" ] && echo "BACKEND_IMAGE e obrigatorio no modo producao." >&2
  done
  while [ -z "$FRONTEND_IMAGE" ]; do
    FRONTEND_IMAGE="$(prompt_val "FRONTEND_IMAGE" "$cur_front")"
    [ -z "$FRONTEND_IMAGE" ] && echo "FRONTEND_IMAGE e obrigatorio no modo producao." >&2
  done
  while [ -z "$BACKUP_IMAGE" ]; do
    BACKUP_IMAGE="$(prompt_val "BACKUP_IMAGE" "$cur_bkp")"
    [ -z "$BACKUP_IMAGE" ] && echo "BACKUP_IMAGE e obrigatorio no modo producao." >&2
  done

  set_env_val "$TMP_ENV" BACKEND_IMAGE "$BACKEND_IMAGE"
  set_env_val "$TMP_ENV" FRONTEND_IMAGE "$FRONTEND_IMAGE"
  set_env_val "$TMP_ENV" BACKUP_IMAGE "$BACKUP_IMAGE"
else
  echo ""
  echo "--- 2/4 Versao Local ---"
  cur_ver="$(get_env_val "$TMP_ENV" APP_VERSION)"
  APP_VERSION="$(prompt_val "Tag local das imagens (APP_VERSION)" "${cur_ver:-0.1.0}")"
  set_env_val "$TMP_ENV" APP_VERSION "$APP_VERSION"
fi

# 5. E-mail SMTP (opcional)
echo ""
echo "--- 3/4 E-mail de Encerramento (SMTP - opcional) ---"
cur_smtp_user="$(get_env_val "$TMP_ENV" SMTP_USER)"
default_smtp="n"
[ -n "$cur_smtp_user" ] && default_smtp="s"
if prompt_yes_no "Deseja configurar o envio de e-mail (SMTP) agora?" "$default_smtp"; then
  cur_smtp_host="$(get_env_val "$TMP_ENV" SMTP_HOST)"
  cur_smtp_port="$(get_env_val "$TMP_ENV" SMTP_PORT)"
  cur_smtp_pass="$(get_env_val "$TMP_ENV" SMTP_PASSWORD)"
  cur_smtp_from="$(get_env_val "$TMP_ENV" SMTP_FROM_NAME)"

  SMTP_HOST="$(prompt_val "SMTP_HOST" "${cur_smtp_host:-smtp.gmail.com}")"
  SMTP_PORT="$(prompt_val "SMTP_PORT" "${cur_smtp_port:-465}")"
  SMTP_USER="$(prompt_val "SMTP_USER (e-mail remetente)" "$cur_smtp_user")"
  has_pass="0"
  [ -n "$cur_smtp_pass" ] && has_pass="1"
  new_smtp_pass="$(prompt_secret "SMTP_PASSWORD (senha de app)" "$has_pass")"
  SMTP_PASSWORD="${new_smtp_pass:-$cur_smtp_pass}"
  SMTP_FROM_NAME="$(prompt_val "SMTP_FROM_NAME (opcional)" "$cur_smtp_from")"

  set_env_val "$TMP_ENV" SMTP_HOST "$SMTP_HOST"
  set_env_val "$TMP_ENV" SMTP_PORT "$SMTP_PORT"
  set_env_val "$TMP_ENV" SMTP_USER "$SMTP_USER"
  set_env_val "$TMP_ENV" SMTP_PASSWORD "$SMTP_PASSWORD"
  set_env_val "$TMP_ENV" SMTP_FROM_NAME "$SMTP_FROM_NAME"
fi

# 6. Backup e catalogo externo (opcionais)
echo ""
echo "--- 4/4 Backup Diario e Catalogo Externo (opcional) ---"
cur_bkp_time="$(get_env_val "$TMP_ENV" BACKUP_TIME)"
cur_bkp_ret="$(get_env_val "$TMP_ENV" BACKUP_RETENTION_DAYS)"
BACKUP_TIME="$(prompt_val "Horario do backup diario (HH:MM)" "${cur_bkp_time:-02:30}")"
BACKUP_RETENTION_DAYS="$(prompt_val "Retencao dos backups (dias)" "${cur_bkp_ret:-14}")"
set_env_val "$TMP_ENV" BACKUP_TIME "$BACKUP_TIME"
set_env_val "$TMP_ENV" BACKUP_RETENTION_DAYS "$BACKUP_RETENTION_DAYS"

cur_cat_host="$(get_env_val "$TMP_ENV" CATALOG_DB_HOST)"
default_cat="n"
[ -n "$cur_cat_host" ] && default_cat="s"
if prompt_yes_no "Deseja configurar banco externo de catalogo de contratos?" "$default_cat"; then
  cur_cat_port="$(get_env_val "$TMP_ENV" CATALOG_DB_PORT)"
  cur_cat_name="$(get_env_val "$TMP_ENV" CATALOG_DB_NAME)"
  cur_cat_user="$(get_env_val "$TMP_ENV" CATALOG_DB_USER)"
  cur_cat_pass="$(get_env_val "$TMP_ENV" CATALOG_DB_PASSWORD)"

  CATALOG_DB_HOST="$(prompt_val "CATALOG_DB_HOST" "$cur_cat_host")"
  CATALOG_DB_PORT="$(prompt_val "CATALOG_DB_PORT" "${cur_cat_port:-3306}")"
  CATALOG_DB_NAME="$(prompt_val "CATALOG_DB_NAME" "$cur_cat_name")"
  CATALOG_DB_USER="$(prompt_val "CATALOG_DB_USER (somente leitura)" "$cur_cat_user")"
  has_cat_pass="0"
  [ -n "$cur_cat_pass" ] && has_cat_pass="1"
  new_cat_pass="$(prompt_secret "CATALOG_DB_PASSWORD" "$has_cat_pass")"
  CATALOG_DB_PASSWORD="${new_cat_pass:-$cur_cat_pass}"

  set_env_val "$TMP_ENV" CATALOG_DB_HOST "$CATALOG_DB_HOST"
  set_env_val "$TMP_ENV" CATALOG_DB_PORT "$CATALOG_DB_PORT"
  set_env_val "$TMP_ENV" CATALOG_DB_NAME "$CATALOG_DB_NAME"
  set_env_val "$TMP_ENV" CATALOG_DB_USER "$CATALOG_DB_USER"
  set_env_val "$TMP_ENV" CATALOG_DB_PASSWORD "$CATALOG_DB_PASSWORD"
fi

# Grava .env de forma atomica com permissao 600 e garante ./backups com 700
mv "$TMP_ENV" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE"
mkdir -p "$ROOT/backups" && chmod 700 "$ROOT/backups"

echo ""
echo "=================================================================="
echo "  Resumo da Configuracao (nenhum segredo exibido)"
echo "=================================================================="
echo "  Arquivo Compose : $(basename "$COMPOSE_FILE")"
echo "  Arquivo .env    : $ENV_FILE (permissao 600)"
echo "  Acesso          : http://${BIND_IP}:${HTTP_PORT} (COOKIE_SECURE=${COOKIE_SECURE})"
echo "  Segredos/Tokens : configurados automaticamente (256 bits)"
if [ "$MODE" = "prod" ]; then
  echo "  BACKEND_IMAGE   : $BACKEND_IMAGE"
  echo "  FRONTEND_IMAGE  : $FRONTEND_IMAGE"
  echo "  BACKUP_IMAGE    : $BACKUP_IMAGE"
fi
echo "=================================================================="
echo ""

# Valida sintaxe do compose escolhido com o .env gerado
echo "Validando configuracao do Docker Compose..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
echo "Validacao do Docker Compose concluida com sucesso."

if [ "$ONLY_ENV" -eq 1 ]; then
  echo ""
  echo "Opcao --only-env ativa. Nenhum container foi iniciado."
  exit 0
fi

# Verificacao opcional de assinatura Cosign no modo producao
if [ "$MODE" = "prod" ] && command -v cosign >/dev/null 2>&1; then
  if prompt_yes_no "Cosign detectado. Deseja verificar a assinatura digital das 3 imagens antes do pull?" "s"; then
    GH_REPO_FULL="$(prompt_val "Repositorio GitHub (formato owner/repo)" "")"
    if [ -n "$GH_REPO_FULL" ]; then
      ID_REGEX="^https://github\.com/${GH_REPO_FULL}/\.github/workflows/devsecops-pipeline\.yml@refs/heads/main$"
      for img in "$BACKEND_IMAGE" "$FRONTEND_IMAGE" "$BACKUP_IMAGE"; do
        echo "Verificando assinatura Cosign: $img"
        cosign verify \
          --certificate-oidc-issuer="https://token.actions.githubusercontent.com" \
          --certificate-identity-regexp="$ID_REGEX" \
          "$img" >/dev/null
        echo "  OK: assinatura valida."
      done
    else
      echo "Repositorio nao informado; pulando verificacao Cosign."
    fi
  fi
fi

echo ""
if ! prompt_yes_no "Deseja subir/atualizar os containers agora?" "s"; then
  echo "Execucao cancelada pelo usuario. O arquivo .env foi salvo com seguranca."
  exit 0
fi

cd "$ROOT"
if [ "$MODE" = "prod" ]; then
  echo "Baixando imagens assinadas do GHCR e imagens oficiais..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
  echo "Subindo stack de producao..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
else
  echo "Construindo e subindo stack local..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build
fi

echo ""
echo "Status dos servicos:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
echo ""
if [ "$EXISTING_ENV" -eq 0 ]; then
  echo "Primeira instalacao? Crie o primeiro administrador com:"
  echo "  scripts/create-admin.sh"
fi
