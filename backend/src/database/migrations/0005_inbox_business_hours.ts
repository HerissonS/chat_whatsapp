import type { Kysely } from 'kysely';

/**
 * Indicadores por caixa de entrada:
 * - meta de 1ª resposta (minutos úteis), padrão 15;
 * - horário de funcionamento (JSON, com almoço). Vazio = tempo corrido (24 h).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('departments')
    .addColumn('response_target_minutes', 'smallint', (c) => c.unsigned().notNull().defaultTo(15))
    .execute();
  await db.schema.alterTable('departments').addColumn('business_hours', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('departments').dropColumn('business_hours').execute();
  await db.schema.alterTable('departments').dropColumn('response_target_minutes').execute();
}
