# syntax=docker/dockerfile:1
# Central de Atendimento - backend (API + worker). Mesma imagem, comando diferente.
# Imagem base fixada por versão e digest. Para atualizar: scripts/update-digests.sh
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY test ./test
# Os testes são etapa obrigatória: se falharem, a imagem não é gerada.
RUN npm run build && npm test && npm prune --omit=dev && npm cache clean --force

FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
# Remove gerenciadores de pacote da imagem final (menos superfície de ataque).
# Fonte com acentuação para o PDF do atendimento. Alpine remove versões antigas ao publicar patches.
# A pipeline passa a data do build: muda a cada dia e força o apk upgrade abaixo a rodar de novo,
# em vez de reaproveitar a camada em cache (que ficaria com pacotes desatualizados).
ARG APK_REFRESH=local
# hadolint ignore=DL3018
RUN apk upgrade --no-cache && apk add --no-cache font-dejavu \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir -p /data/media && chown node:node /data/media
WORKDIR /app
LABEL org.opencontainers.image.title="chat-whatsapp-backend" \
      org.opencontainers.image.description="Central de Atendimento WhatsApp - API REST, WebSocket, webhook e worker" \
      org.opencontainers.image.licenses="MIT"
# Arquivos da aplicação pertencem ao root e são só leitura para o usuário node.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY assets ./assets
COPY --chmod=0755 entrypoint.sh /usr/local/bin/entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["api"]
