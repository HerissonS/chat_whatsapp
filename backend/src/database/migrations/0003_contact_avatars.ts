import { sql, type Kysely } from 'kysely';

/** Foto de perfil do WhatsApp: cópia local (o navegador não acessa os servidores do WhatsApp). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('contacts')
    .addColumn('avatar_path', 'varchar(255)')
    .addColumn('avatar_checked_at', sql`datetime(3)`)
    .addColumn('imported_at', sql`datetime(3)`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('contacts').dropColumn('avatar_path').dropColumn('avatar_checked_at').dropColumn('imported_at').execute();
}
