#!/bin/sh
# Backup da Central de Atendimento.
#   backup.sh loop  -> roda todo dia no horário BACKUP_TIME (padrão 02:30)
#   backup.sh once  -> roda uma vez e sai
# Os arquivos ficam em /backups (pasta ./backups do projeto), com permissão só para o dono.
set -eu
umask 077

DEST=/backups
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_TIME="${BACKUP_TIME:-02:30}"

log() { printf '{"level":"%s","service":"backup","time":"%s","msg":"%s"}\n' "$1" "$(date -Iseconds)" "$2"; }

run_backup() {
  ts="$(date +%Y%m%d-%H%M%S)"
  ok=1

  f="$DEST/mariadb_${DB_NAME}_${ts}.sql.gz"
  if MYSQL_PWD="$DB_PASSWORD" mariadb-dump --skip-ssl-verify-server-cert -h "$DB_HOST" -u "$DB_USER" \
       --single-transaction --quick --routines --triggers --events --hex-blob \
       --default-character-set=utf8mb4 "$DB_NAME" | gzip -9 > "$f.tmp"; then
    mv "$f.tmp" "$f"; log info "backup do MariaDB concluído: $(basename "$f")"
  else
    rm -f "$f.tmp"; ok=0; log error "falha no backup do MariaDB"
  fi

  f="$DEST/postgres_${EVO_DB_NAME}_${ts}.dump"
  if PGPASSWORD="$EVO_DB_PASSWORD" pg_dump -h "$EVO_DB_HOST" -U "$EVO_DB_USER" -d "$EVO_DB_NAME" -Fc -f "$f.tmp"; then
    mv "$f.tmp" "$f"; log info "backup do PostgreSQL concluído: $(basename "$f")"
  else
    rm -f "$f.tmp"; ok=0; log error "falha no backup do PostgreSQL"
  fi

  find "$DEST" -maxdepth 1 -type f \( -name 'mariadb_*' -o -name 'postgres_*' \) -mtime +"$RETENTION_DAYS" -delete
  [ "$ok" = 1 ]
}

seconds_until_next_run() {
  now="$(date +%s)"
  target="$(date -d "$(date +%Y-%m-%d) ${BACKUP_TIME}:00" +%s)"
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo $((target - now))
}

case "${1:-loop}" in
  once)
    run_backup
    ;;
  loop)
    log info "agendado diariamente às ${BACKUP_TIME} (retenção de ${RETENTION_DAYS} dias)"
    while true; do
      sleep "$(seconds_until_next_run)"
      run_backup || true
    done
    ;;
  *)
    echo "uso: backup.sh [loop|once]" >&2
    exit 2
    ;;
esac
