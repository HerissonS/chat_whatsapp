#!/bin/sh
# Atualiza os digests (@sha256) das imagens fixadas no docker-compose.yml e nos Dockerfiles.
# A TAG (versão) não muda: o script só busca o digest atual da mesma tag (ex.: correções de
# segurança publicadas na mesma versão). Para mudar de versão, edite a tag e rode o script.
#
# Uso:
#   scripts/update-digests.sh          -> mostra o que mudaria e aplica
#   scripts/update-digests.sh --check  -> só mostra (sai com código 1 se houver atualização)
# Depois de aplicar: docker compose build && docker compose up -d
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

FILES="$ROOT/docker-compose.yml $ROOT/backend/Dockerfile $ROOT/frontend/Dockerfile $ROOT/backup/Dockerfile $ROOT/evolution/Dockerfile $ROOT/scripts/security-scan.sh"
REFS="$(grep -hoE '[a-z0-9./_-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}' $FILES | sort -u)"
CHANGES=0

for ref in $REFS; do
  image_tag="${ref%@*}"
  current="${ref#*@}"
  latest="$(docker buildx imagetools inspect "$image_tag" 2>/dev/null | awk '/^Digest:/ {print $2; exit}')"
  if [ -z "$latest" ]; then
    echo "AVISO  $image_tag: não foi possível consultar o registro"
    continue
  fi
  if [ "$latest" = "$current" ]; then
    echo "OK     $image_tag"
  else
    CHANGES=$((CHANGES + 1))
    echo "NOVO   $image_tag"
    echo "       de   $current"
    echo "       para $latest"
    if [ "$CHECK" -eq 0 ]; then
      for f in $FILES; do
        sed -i "s|${image_tag}@${current}|${image_tag}@${latest}|g" "$f"
      done
    fi
  fi
done

if [ "$CHANGES" -eq 0 ]; then
  echo "Todas as imagens estão com o digest mais recente da tag."
elif [ "$CHECK" -eq 1 ]; then
  echo "$CHANGES imagem(ns) com digest novo. Rode sem --check para aplicar."
  exit 1
else
  echo "$CHANGES imagem(ns) atualizada(s). Agora: docker compose build && docker compose up -d"
fi
