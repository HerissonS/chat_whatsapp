#!/bin/sh
# Varredura de segurança da Central de Atendimento (executar antes de cada versão e periodicamente).
#   1. npm audit das dependências de produção (backend e frontend)
#   2. Trivy: vulnerabilidades HIGH/CRITICAL nas imagens do projeto e de terceiros
#   3. Gitleaks: segredos esquecidos no código e na documentação (ignora o .env)
# Ferramentas rodam em containers descartáveis, com imagens fixadas por digest.
# Uso: scripts/security-scan.sh   (código de saída 1 se algo for encontrado)
set -u
cd "$(dirname "$0")/.."

NODE_IMAGE="node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5"
TRIVY_IMAGE="aquasec/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb"
GITLEAKS_IMAGE="zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"
VERSION="$(grep -E '^APP_VERSION=' .env 2>/dev/null | cut -d= -f2)"
VERSION="${VERSION:-0.1.0}"
FAIL=0

echo "== 1/3 npm audit (dependências de produção)"
for d in backend frontend; do
  echo "-- $d"
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/$d:/app:ro" -w /app "$NODE_IMAGE" \
    npm audit --omit=dev --audit-level=high || FAIL=1
done

echo "== 2/3 Trivy (imagens)"
IMAGES="chat-whatsapp/backend:$VERSION chat-whatsapp/frontend:$VERSION chat-whatsapp/backup:$VERSION chat-whatsapp/evolution:2.3.7"
IMAGES="$IMAGES $(grep -hoE 'image: [^ ]+@sha256:[a-f0-9]{64}' docker-compose.yml | awk '{print $2}' | grep -v '^chat-whatsapp/')"
for img in $IMAGES; do
  echo "-- $img"
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock:ro -v trivy-cache:/root/.cache "$TRIVY_IMAGE" \
    image --quiet --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "$img" || FAIL=1
done

echo "== 3/3 Gitleaks (segredos no código e na documentação)"
docker run --rm -v "$PWD:/repo:ro" "$GITLEAKS_IMAGE" dir /repo --no-banner --redact \
  --config /repo/.gitleaks.toml || FAIL=1

if [ "$FAIL" -ne 0 ]; then
  echo "RESULTADO: há itens para corrigir (veja acima)."
  exit 1
fi
echo "RESULTADO: nenhuma vulnerabilidade alta/crítica corrigível e nenhum segredo encontrado."
