# syntax=docker/dockerfile:1
# Evolution API v2.3.7 (imagem oficial fixada por digest) com os pacotes do Alpine atualizados.
# Motivo: a imagem oficial traz pacotes do sistema com vulnerabilidades já corrigidas no Alpine.
# Nada da aplicação é alterado. Para atualizar a versão, troque a tag e rode scripts/update-digests.sh.
ARG EVOLUTION_IMAGE=evoapicloud/evolution-api:v2.3.7@sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339
FROM ${EVOLUTION_IMAGE}
RUN apk upgrade --no-cache
