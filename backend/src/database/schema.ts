import type { ColumnType, Generated } from 'kysely';

/**
 * Tipos das tabelas do banco `chat_whatsapp`.
 * Cada migration nova que cria ou altera tabelas deve atualizar este arquivo.
 * Booleanos são TINYINT(1): o driver devolve 0 ou 1.
 */
type Bool = ColumnType<number, number | undefined, number>;
type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;
type Id = Generated<number>;

export interface AppSettingsTable {
  setting_key: string;
  setting_value: ColumnType<unknown, string, string>;
  updated_at: Generated<Date>;
}

export interface OrganizationsTable {
  id: Id;
  name: string;
  created_at: CreatedAt;
}

export interface DepartmentsTable {
  id: Id;
  organization_id: number;
  name: string;
  slug: string;
  evolution_instance: string | null;
  wa_state: Generated<string>;
  wa_number: string | null;
  wa_name: string | null;
  wa_updated_at: Date | null;
  agent_name_prefix: Bool;
  menu_enabled: Bool;
  menu_max_invalid: Generated<number>;
  close_msg_individual: Bool;
  close_msg_group: Bool;
  catalog_source: Generated<string>;
  response_target_minutes: Generated<number>;
  business_hours: string | null;
  active: Bool;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export type Role = 'admin' | 'operator';

export interface UsersTable {
  id: Id;
  organization_id: number;
  username: string;
  name: string;
  email: string | null;
  password_hash: string;
  role: Role;
  active: Bool;
  must_change_password: Bool;
  failed_logins: Generated<number>;
  locked_until: Date | null;
  last_login_at: Date | null;
  last_login_ip: string | null;
  password_changed_at: Date | null;
  preferences: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface UserGroupsTable {
  id: Id;
  organization_id: number;
  name: string;
  description: string | null;
  created_at: CreatedAt;
}

export interface UserGroupMembersTable {
  group_id: number;
  user_id: number;
}

export interface UserGroupPermissionsTable {
  group_id: number;
  permission: string;
}

export interface UserDepartmentsTable {
  user_id: number;
  department_id: number;
}

export interface ContactsTable {
  id: Id;
  department_id: number;
  jid: string;
  phone: string | null;
  push_name: string | null;
  custom_name: string | null;
  is_group: Bool;
  is_vip: Bool;
  avatar_path: string | null;
  avatar_checked_at: Date | null;
  imported_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ConversationsTable {
  id: Id;
  department_id: number;
  contact_id: number;
  open_ticket_id: number | null;
  last_message_at: Date | null;
  last_message_preview: string | null;
  last_message_from_me: Bool;
  unread_count: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface ClassificationsTable {
  id: Id;
  department_id: number;
  menu_number: number;
  menu_label: string;
  subject_label: string;
  is_default: Bool;
  active: Bool;
}

export type TicketStatus = 'menu' | 'open' | 'closed';
export type TicketOrigin = 'inbound' | 'outbound' | 'group' | 'vip';

export interface TicketsTable {
  id: Id;
  department_id: number;
  conversation_id: number;
  status: TicketStatus;
  origin: TicketOrigin;
  classification_id: number | null;
  assignee_id: number | null;
  menu_attempts: Generated<number>;
  opened_at: Date;
  closed_at: Date | null;
  closed_by: number | null;
  contract: string | null;
  equipment: string | null;
  email_status: string | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface TicketEventsTable {
  id: Id;
  ticket_id: number;
  type: string;
  user_id: number | null;
  data: string | null;
  created_at: CreatedAt;
}

export interface MediaFilesTable {
  id: Id;
  department_id: number | null;
  storage_path: string;
  mime: string;
  size: number;
  sha256: string;
  original_name: string | null;
  created_at: CreatedAt;
}

export type MessageOrigin = 'contact' | 'agent' | 'phone' | 'bot';
export type MessageType =
  | 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'poll' | 'unknown';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MessagesTable {
  id: Id;
  department_id: number;
  conversation_id: number;
  ticket_id: number | null;
  wa_id: string;
  remote_jid: string;
  from_me: Bool;
  origin: MessageOrigin;
  sender_jid: string | null;
  sender_name: string | null;
  user_id: number | null;
  type: MessageType;
  body: string | null;
  media_id: number | null;
  media_status: string | null;
  media_mime: string | null;
  media_name: string | null;
  media_size: number | null;
  quoted_wa_id: string | null;
  quoted_preview: string | null;
  quoted_sender: string | null;
  forwarded: Bool;
  status: Generated<MessageStatus>;
  deleted: Bool;
  edited: Bool;
  wa_timestamp: Date;
  created_at: CreatedAt;
}

export interface MessageReactionsTable {
  message_id: number;
  reactor_jid: string;
  reactor_name: string | null;
  emoji: string;
  from_me: Bool;
  user_id: number | null;
  created_at: CreatedAt;
}

export interface BotTemplatesTable {
  department_id: number;
  template_key: string;
  body: string;
}

export interface CatalogContractsTable {
  id: Id;
  organization_id: number;
  name: string;
  active: Bool;
}

export interface CatalogEquipmentsTable {
  id: Id;
  organization_id: number;
  contract_name: string;
  code: string;
  equip_type: string | null;
  active: Bool;
}

export interface ExtraContractsTable {
  id: Id;
  organization_id: number;
  name: string;
  active: Bool;
}

export interface EmailRecipientsTable {
  id: Id;
  department_id: number;
  email: string;
}

export interface EmailOutboxTable {
  id: Id;
  ticket_id: number;
  recipients: string;
  subject: string;
  status: string;
  attempts: Generated<number>;
  last_error: string | null;
  sent_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface WebhookEventsTable {
  id: Generated<string>;
  instance: string;
  event: string;
  payload: string;
  status: Generated<string>;
  error: string | null;
  received_at: CreatedAt;
  processed_at: Date | null;
}

export interface AuditLogsTable {
  id: Generated<string>;
  organization_id: number | null;
  user_id: number | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  details: string | null;
  created_at: CreatedAt;
}

export interface Database {
  app_settings: AppSettingsTable;
  organizations: OrganizationsTable;
  departments: DepartmentsTable;
  users: UsersTable;
  user_groups: UserGroupsTable;
  user_group_members: UserGroupMembersTable;
  user_group_permissions: UserGroupPermissionsTable;
  user_departments: UserDepartmentsTable;
  contacts: ContactsTable;
  conversations: ConversationsTable;
  classifications: ClassificationsTable;
  tickets: TicketsTable;
  ticket_events: TicketEventsTable;
  media_files: MediaFilesTable;
  messages: MessagesTable;
  message_reactions: MessageReactionsTable;
  bot_templates: BotTemplatesTable;
  catalog_contracts: CatalogContractsTable;
  catalog_equipments: CatalogEquipmentsTable;
  extra_contracts: ExtraContractsTable;
  email_recipients: EmailRecipientsTable;
  email_outbox: EmailOutboxTable;
  webhook_events: WebhookEventsTable;
  audit_logs: AuditLogsTable;
}
