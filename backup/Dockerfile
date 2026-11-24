# syntax=docker/dockerfile:1
# Central de Atendimento - backup diário do MariaDB (sistema) e do PostgreSQL (Evolution).
# Base: postgres alpine (traz o pg_dump na mesma versão do servidor) + cliente MariaDB.
FROM postgres:18.7-alpine@sha256:ff64c9e3bdf8e2120107d3559de8db314e8305f7e38c5105903c6295876738ff
# Correções de segurança do Alpine + cliente MariaDB. O gosu não é usado (o container roda com usuário fixo).
# Alpine remove versões antigas de pacotes ao publicar patches de segurança.
# hadolint ignore=DL3018
RUN apk upgrade --no-cache && apk add --no-cache mariadb-client tzdata && rm -f /usr/local/bin/gosu
COPY --chmod=0755 backup.sh /usr/local/bin/backup.sh
LABEL org.opencontainers.image.title="chat-whatsapp-backup" \
      org.opencontainers.image.description="Central de Atendimento WhatsApp - Backup diario do MariaDB e PostgreSQL" \
      org.opencontainers.image.licenses="MIT"
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["loop"]
