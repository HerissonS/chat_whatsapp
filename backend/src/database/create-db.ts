import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { AppConfig } from '../config/env.js';
import type { Database } from './schema.js';

/**
 * Cria a conexão com o MariaDB.
 * Datas são gravadas e lidas em UTC; a conversão para o fuso local é feita na apresentação.
 */
export function createDb(config: AppConfig): Kysely<Database> {
  const pool = createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    connectionLimit: config.DB_POOL_SIZE,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
    enableKeepAlive: true,
    connectTimeout: 10_000,
  });
  return new Kysely<Database>({ dialect: new MysqlDialect({ pool }) });
}
