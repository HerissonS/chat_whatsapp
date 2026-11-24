import { Migrator, type MigrationProvider } from 'kysely/migration';
import { pino, stdTimeFunctions } from 'pino';
import { loadConfig } from '../config/env.js';
import { createDb } from './create-db.js';
import { migrations } from './migrations/index.js';

/**
 * Aplica as migrations pendentes. Executado pelo entrypoint antes da API subir.
 * Usa lock do Kysely na tabela de controle, então é seguro com mais de uma réplica.
 */
const log = pino({
  base: { service: 'migrate' },
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
});

const provider: MigrationProvider = { getMigrations: async () => migrations };

async function main(): Promise<void> {
  const db = createDb(loadConfig());
  try {
    const migrator = new Migrator({
      db,
      provider,
      migrationTableName: 'schema_migrations',
      migrationLockTableName: 'schema_migrations_lock',
    });
    const { error, results } = await migrator.migrateToLatest();
    for (const r of results ?? []) {
      if (r.status === 'Success') log.info({ migration: r.migrationName }, 'migration aplicada');
      if (r.status === 'Error') log.error({ migration: r.migrationName }, 'migration falhou');
    }
    if (error) throw error;
    if (!results?.length) log.info('banco já está atualizado');
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'erro ao aplicar migrations');
  process.exit(1);
});
