import { sql, type Kysely } from 'kysely';

/**
 * Modelo de dados principal do sistema.
 * Convenções: ids INT UNSIGNED, datas DATETIME(3) em UTC, booleanos TINYINT(1), utf8mb4.
 */
const TABLE_OPTS = sql`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const now = sql`CURRENT_TIMESTAMP(3)`;
const dt = sql`datetime(3)`;

export async function up(db: Kysely<unknown>): Promise<void> {
  const s = db.schema;

  await s
    .createTable('organizations')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('name', 'varchar(150)', (c) => c.notNull())
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('departments')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('organization_id', 'integer', (c) => c.unsigned().notNull().references('organizations.id'))
    .addColumn('name', 'varchar(150)', (c) => c.notNull())
    .addColumn('slug', 'varchar(60)', (c) => c.notNull().unique())
    .addColumn('evolution_instance', 'varchar(50)', (c) => c.unique())
    .addColumn('wa_state', 'varchar(20)', (c) => c.notNull().defaultTo('close'))
    .addColumn('wa_number', 'varchar(32)')
    .addColumn('wa_name', 'varchar(150)')
    .addColumn('wa_updated_at', dt)
    .addColumn('agent_name_prefix', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addColumn('menu_enabled', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addColumn('menu_max_invalid', 'integer', (c) => c.notNull().defaultTo(3))
    .addColumn('close_msg_individual', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addColumn('close_msg_group', sql`tinyint(1)`, (c) => c.notNull().defaultTo(0))
    .addColumn('catalog_source', 'varchar(20)', (c) => c.notNull().defaultTo('local'))
    .addColumn('active', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', dt, (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('users')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('organization_id', 'integer', (c) => c.unsigned().notNull().references('organizations.id'))
    .addColumn('username', 'varchar(60)', (c) => c.notNull().unique())
    .addColumn('name', 'varchar(150)', (c) => c.notNull())
    .addColumn('email', 'varchar(190)')
    .addColumn('password_hash', 'varchar(255)', (c) => c.notNull())
    .addColumn('role', 'varchar(20)', (c) => c.notNull())
    .addColumn('active', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addColumn('must_change_password', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addColumn('failed_logins', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('locked_until', dt)
    .addColumn('last_login_at', dt)
    .addColumn('last_login_ip', 'varchar(45)')
    .addColumn('password_changed_at', dt)
    .addColumn('preferences', 'text')
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', dt, (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('user_groups')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('organization_id', 'integer', (c) => c.unsigned().notNull().references('organizations.id'))
    .addColumn('name', 'varchar(100)', (c) => c.notNull())
    .addColumn('description', 'varchar(255)')
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('uq_user_groups_name', ['organization_id', 'name'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('user_group_members')
    .addColumn('group_id', 'integer', (c) => c.unsigned().notNull().references('user_groups.id').onDelete('cascade'))
    .addColumn('user_id', 'integer', (c) => c.unsigned().notNull().references('users.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('pk_user_group_members', ['group_id', 'user_id'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('user_departments')
    .addColumn('user_id', 'integer', (c) => c.unsigned().notNull().references('users.id').onDelete('cascade'))
    .addColumn('department_id', 'integer', (c) => c.unsigned().notNull().references('departments.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('pk_user_departments', ['user_id', 'department_id'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('contacts')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('department_id', 'integer', (c) => c.unsigned().notNull().references('departments.id'))
    .addColumn('jid', 'varchar(120)', (c) => c.notNull())
    .addColumn('phone', 'varchar(32)')
    .addColumn('push_name', 'varchar(150)')
    .addColumn('custom_name', 'varchar(150)')
    .addColumn('is_group', sql`tinyint(1)`, (c) => c.notNull().defaultTo(0))
    .addColumn('is_vip', sql`tinyint(1)`, (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', dt, (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
    .addUniqueConstraint('uq_contacts_jid', ['department_id', 'jid'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('conversations')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('department_id', 'integer', (c) => c.unsigned().notNull().references('departments.id'))
    .addColumn('contact_id', 'integer', (c) => c.unsigned().notNull().unique().references('contacts.id'))
    .addColumn('open_ticket_id', 'integer', (c) => c.unsigned())
    .addColumn('last_message_at', dt)
    .addColumn('last_message_preview', 'varchar(255)')
    .addColumn('last_message_from_me', sql`tinyint(1)`, (c) => c.notNull().defaultTo(0))
    .addColumn('unread_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', dt, (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
    .modifyEnd(TABLE_OPTS)
    .execute();
  await s.createIndex('ix_conversations_last').on('conversations').columns(['department_id', 'last_message_at']).execute();

  await s
    .createTable('classifications')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('department_id', 'integer', (c) => c.unsigned().notNull().references('departments.id'))
    .addColumn('menu_number', 'integer', (c) => c.notNull())
    .addColumn('menu_label', 'varchar(150)', (c) => c.notNull())
    .addColumn('subject_label', 'varchar(150)', (c) => c.notNull())
    .addColumn('is_default', sql`tinyint(1)`, (c) => c.notNull().defaultTo(0))
    .addColumn('active', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addUniqueConstraint('uq_classifications_number', ['department_id', 'menu_number'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('tickets')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('department_id', 'integer', (c) => c.unsigned().notNull().references('departments.id'))
    .addColumn('conversation_id', 'integer', (c) => c.unsigned().notNull().references('conversations.id'))
    .addColumn('status', 'varchar(20)', (c) => c.notNull())
    .addColumn('origin', 'varchar(20)', (c) => c.notNull())
    .addColumn('classification_id', 'integer', (c) => c.unsigned().references('classifications.id'))
    .addColumn('assignee_id', 'integer', (c) => c.unsigned().references('users.id'))
    .addColumn('menu_attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('opened_at', dt, (c) => c.notNull())
    .addColumn('closed_at', dt)
    .addColumn('closed_by', 'integer', (c) => c.unsigned().references('users.id'))
    .addColumn('contract', 'varchar(255)')
    .addColumn('equipment', 'varchar(100)')
    .addColumn('email_status', 'varchar(20)')
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', dt, (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
    .modifyEnd(TABLE_OPTS)
    .execute();
  await s.createIndex('ix_tickets_conv').on('tickets').columns(['conversation_id', 'status']).execute();
  await s.createIndex('ix_tickets_dept').on('tickets').columns(['department_id', 'status']).execute();
  await s.createIndex('ix_tickets_assignee').on('tickets').columns(['assignee_id', 'status']).execute();

  await s
    .createTable('ticket_events')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('ticket_id', 'integer', (c) => c.unsigned().notNull().references('tickets.id'))
    .addColumn('type', 'varchar(40)', (c) => c.notNull())
    .addColumn('user_id', 'integer', (c) => c.unsigned().references('users.id'))
    .addColumn('data', 'text')
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .modifyEnd(TABLE_OPTS)
    .execute();
  await s.createIndex('ix_ticket_events_ticket').on('ticket_events').column('ticket_id').execute();

  await s
    .createTable('media_files')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('department_id', 'integer', (c) => c.unsigned().references('departments.id'))
    .addColumn('storage_path', 'varchar(255)', (c) => c.notNull())
    .addColumn('mime', 'varchar(150)', (c) => c.notNull())
    .addColumn('size', 'bigint', (c) => c.notNull())
    .addColumn('sha256', sql`char(64)`, (c) => c.notNull())
    .addColumn('original_name', 'varchar(255)')
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('messages')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('department_id', 'integer', (c) => c.unsigned().notNull().references('departments.id'))
    .addColumn('conversation_id', 'integer', (c) => c.unsigned().notNull().references('conversations.id'))
    .addColumn('ticket_id', 'integer', (c) => c.unsigned().references('tickets.id'))
    .addColumn('wa_id', 'varchar(128)', (c) => c.notNull())
    .addColumn('remote_jid', 'varchar(120)', (c) => c.notNull())
    .addColumn('from_me', sql`tinyint(1)`, (c) => c.notNull())
    .addColumn('origin', 'varchar(10)', (c) => c.notNull())
    .addColumn('sender_jid', 'varchar(120)')
    .addColumn('sender_name', 'varchar(150)')
    .addColumn('user_id', 'integer', (c) => c.unsigned().references('users.id'))
    .addColumn('type', 'varchar(20)', (c) => c.notNull())
    .addColumn('body', sql`mediumtext`)
    .addColumn('media_id', 'integer', (c) => c.unsigned().references('media_files.id'))
    .addColumn('media_status', 'varchar(15)')
    .addColumn('media_mime', 'varchar(150)')
    .addColumn('media_name', 'varchar(255)')
    .addColumn('media_size', 'bigint')
    .addColumn('quoted_wa_id', 'varchar(128)')
    .addColumn('quoted_preview', 'varchar(255)')
    .addColumn('quoted_sender', 'varchar(150)')
    .addColumn('forwarded', sql`tinyint(1)`, (c) => c.notNull().defaultTo(0))
    .addColumn('status', 'varchar(15)', (c) => c.notNull().defaultTo('sent'))
    .addColumn('deleted', sql`tinyint(1)`, (c) => c.notNull().defaultTo(0))
    .addColumn('edited', sql`tinyint(1)`, (c) => c.notNull().defaultTo(0))
    .addColumn('wa_timestamp', dt, (c) => c.notNull())
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('uq_messages_wa', ['department_id', 'wa_id'])
    .modifyEnd(TABLE_OPTS)
    .execute();
  await s.createIndex('ix_messages_conv').on('messages').columns(['conversation_id', 'wa_timestamp']).execute();
  await s.createIndex('ix_messages_ticket').on('messages').columns(['ticket_id', 'wa_timestamp']).execute();

  await s
    .createTable('message_reactions')
    .addColumn('message_id', 'integer', (c) => c.unsigned().notNull().references('messages.id').onDelete('cascade'))
    .addColumn('reactor_jid', 'varchar(120)', (c) => c.notNull())
    .addColumn('reactor_name', 'varchar(150)')
    .addColumn('emoji', 'varchar(32)', (c) => c.notNull())
    .addColumn('from_me', sql`tinyint(1)`, (c) => c.notNull().defaultTo(0))
    .addColumn('user_id', 'integer', (c) => c.unsigned().references('users.id'))
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint('pk_message_reactions', ['message_id', 'reactor_jid'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('bot_templates')
    .addColumn('department_id', 'integer', (c) => c.unsigned().notNull().references('departments.id'))
    .addColumn('template_key', 'varchar(30)', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('pk_bot_templates', ['department_id', 'template_key'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('catalog_contracts')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('organization_id', 'integer', (c) => c.unsigned().notNull().references('organizations.id'))
    .addColumn('name', 'varchar(255)', (c) => c.notNull())
    .addColumn('active', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addUniqueConstraint('uq_catalog_contracts', ['organization_id', 'name'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('catalog_equipments')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('organization_id', 'integer', (c) => c.unsigned().notNull().references('organizations.id'))
    .addColumn('contract_name', 'varchar(255)', (c) => c.notNull())
    .addColumn('code', 'varchar(100)', (c) => c.notNull())
    .addColumn('equip_type', 'varchar(60)')
    .addColumn('active', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addUniqueConstraint('uq_catalog_equipments', ['organization_id', 'code'])
    .modifyEnd(TABLE_OPTS)
    .execute();
  await s.createIndex('ix_catalog_equipments_contract').on('catalog_equipments').columns(['organization_id', 'contract_name']).execute();

  await s
    .createTable('extra_contracts')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('organization_id', 'integer', (c) => c.unsigned().notNull().references('organizations.id'))
    .addColumn('name', 'varchar(255)', (c) => c.notNull())
    .addColumn('active', sql`tinyint(1)`, (c) => c.notNull().defaultTo(1))
    .addUniqueConstraint('uq_extra_contracts', ['organization_id', 'name'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('email_recipients')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('department_id', 'integer', (c) => c.unsigned().notNull().references('departments.id'))
    .addColumn('email', 'varchar(190)', (c) => c.notNull())
    .addUniqueConstraint('uq_email_recipients', ['department_id', 'email'])
    .modifyEnd(TABLE_OPTS)
    .execute();

  await s
    .createTable('email_outbox')
    .addColumn('id', 'integer', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('ticket_id', 'integer', (c) => c.unsigned().notNull().references('tickets.id'))
    .addColumn('recipients', 'text', (c) => c.notNull())
    .addColumn('subject', 'varchar(255)', (c) => c.notNull())
    .addColumn('status', 'varchar(15)', (c) => c.notNull())
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_error', 'varchar(500)')
    .addColumn('sent_at', dt)
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', dt, (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
    .modifyEnd(TABLE_OPTS)
    .execute();
  await s.createIndex('ix_email_outbox_ticket').on('email_outbox').column('ticket_id').execute();

  await s
    .createTable('webhook_events')
    .addColumn('id', 'bigint', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('instance', 'varchar(50)', (c) => c.notNull())
    .addColumn('event', 'varchar(50)', (c) => c.notNull())
    .addColumn('payload', sql`mediumtext`, (c) => c.notNull())
    .addColumn('status', 'varchar(15)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('error', 'varchar(500)')
    .addColumn('received_at', dt, (c) => c.notNull().defaultTo(now))
    .addColumn('processed_at', dt)
    .modifyEnd(TABLE_OPTS)
    .execute();
  await s.createIndex('ix_webhook_events_received').on('webhook_events').column('received_at').execute();

  await s
    .createTable('audit_logs')
    .addColumn('id', 'bigint', (c) => c.unsigned().autoIncrement().primaryKey())
    .addColumn('organization_id', 'integer', (c) => c.unsigned())
    .addColumn('user_id', 'integer', (c) => c.unsigned())
    .addColumn('username', 'varchar(60)')
    .addColumn('action', 'varchar(60)', (c) => c.notNull())
    .addColumn('target_type', 'varchar(40)')
    .addColumn('target_id', 'varchar(60)')
    .addColumn('ip', 'varchar(45)')
    .addColumn('details', 'text')
    .addColumn('created_at', dt, (c) => c.notNull().defaultTo(now))
    .modifyEnd(TABLE_OPTS)
    .execute();
  await s.createIndex('ix_audit_created').on('audit_logs').column('created_at').execute();
  await s.createIndex('ix_audit_user').on('audit_logs').columns(['user_id', 'created_at']).execute();
  await s.createIndex('ix_audit_action').on('audit_logs').columns(['action', 'created_at']).execute();

  // ---------------------------------------------------------------------------
  // Dados iniciais genéricos (organização, caixa de entrada, classificações, textos do bot e contrato extra).
  // Tudo é editável pela interface. Instalações existentes não são afetadas: migrations já aplicadas não rodam de novo.
  // ---------------------------------------------------------------------------
  await sql`INSERT INTO organizations (id, name) VALUES (1, 'Minha Empresa')`.execute(db);
  await sql`INSERT INTO departments (id, organization_id, name, slug) VALUES (1, 1, 'Atendimento', 'atendimento')`.execute(db);
  await sql`INSERT INTO classifications (department_id, menu_number, menu_label, subject_label, is_default) VALUES
    (1, 1, 'Equipamento - Solicitação de Suporte', 'Solicitação de Suporte', 0),
    (1, 2, 'Equipamento - Validação', 'Validação', 0),
    (1, 3, 'Outras dúvidas', 'Outras dúvidas', 1)`.execute(db);
  await sql`INSERT INTO bot_templates (department_id, template_key, body) VALUES
    (1, 'menu_header', 'Olá! Bem-vindo(a) ao nosso atendimento. Por favor, escolha uma das opções abaixo para direcionarmos seu atendimento:'),
    (1, 'menu_invalid', 'Opção inválida. Por favor, responda apenas com o número de uma das opções abaixo.'),
    (1, 'confirmation', 'Seu atendimento foi registrado, em breve um analista irá te responder.'),
    (1, 'closing', 'Informamos que seu chamado foi encerrado em nosso sistema.')`.execute(db);
  await sql`INSERT INTO extra_contracts (organization_id, name) VALUES (1, 'CHAMADO INTERNO')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [
    'audit_logs', 'webhook_events', 'email_outbox', 'email_recipients', 'extra_contracts', 'catalog_equipments',
    'catalog_contracts', 'bot_templates', 'message_reactions', 'messages', 'media_files', 'ticket_events', 'tickets',
    'classifications', 'conversations', 'contacts', 'user_departments', 'user_group_members', 'user_groups', 'users',
    'departments', 'organizations',
  ]) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
