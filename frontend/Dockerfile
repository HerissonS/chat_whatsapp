# syntax=docker/dockerfile:1
# Central de Atendimento - frontend: build do React servido pelo nginx sem root.
# Imagens base fixadas por versão e digest. Para atualizar: scripts/update-digests.sh
FROM --platform=$BUILDPLATFORM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e AS runtime
# Correções de segurança dos pacotes do Alpine publicadas depois da imagem base; curl não é usado.
USER root
# A pipeline passa a data do build: muda a cada dia e força o apk upgrade abaixo a rodar de novo,
# em vez de reaproveitar a camada em cache (que ficaria com pacotes desatualizados).
ARG APK_REFRESH=local
RUN apk upgrade --no-cache && apk del --no-cache curl
USER 101
LABEL org.opencontainers.image.title="chat-whatsapp-frontend" \
      org.opencontainers.image.description="Central de Atendimento WhatsApp - SPA React servido por Nginx sem root" \
      org.opencontainers.image.licenses="MIT"
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
