import { sql, type Kysely } from 'kysely';

/**
 * Permissões por grupo de usuários (páginas e ações).
 * Cria o grupo "Atendentes" com as permissões de atendimento e coloca nele os usuários
 * que hoje são Operadores, para ninguém perder acesso na atualização.
 */
const AGENT = ['dashboard.view', 'chat.read', 'chat.send', 'chat.delete', 'ticket.assign', 'ticket.close', 'contact.edit'];

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('user_group_permissions')
    .addColumn('group_id', 'integer', (c) => c.unsigned().notNull().references('user_groups.id').onDelete('cascade'))
    .addColumn('permission', 'varchar(60)', (c) => c.notNull())
    .addPrimaryKeyConstraint('pk_user_group_permissions', ['group_id', 'permission'])
    .modifyEnd(sql`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    .execute();

  const orgs = await sql<{ id: number }>`SELECT id FROM organizations`.execute(db);
  for (const org of orgs.rows) {
    await sql`INSERT IGNORE INTO user_groups (organization_id, name, description) VALUES (${org.id}, 'Atendentes', 'Atendimento das conversas e chamados')`.execute(db);
    const g = await sql<{ id: number }>`SELECT id FROM user_groups WHERE organization_id = ${org.id} AND name = 'Atendentes'`.execute(db);
    const groupId = g.rows[0].id;
    for (const p of AGENT) {
      await sql`INSERT IGNORE INTO user_group_permissions (group_id, permission) VALUES (${groupId}, ${p})`.execute(db);
    }
    await sql`INSERT IGNORE INTO user_group_members (group_id, user_id)
      SELECT ${groupId}, id FROM users WHERE organization_id = ${org.id} AND role = 'operator'`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_group_permissions').execute();
}
