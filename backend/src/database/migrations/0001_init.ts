import { sql, type Kysely } from 'kysely';

/** Tabela de configurações gerais (chave/valor JSON). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('app_settings')
    .addColumn('setting_key', 'varchar(100)', (c) => c.primaryKey())
    .addColumn('setting_value', 'json', (c) => c.notNull())
    .addColumn('updated_at', sql`datetime(3)`, (c) =>
      c.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`),
    )
    .modifyEnd(sql`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('app_settings').execute();
}
