import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql, type Transaction } from 'kysely';
import { toBool } from '../common/validation.js';
import { type AvatarState, avatarState } from '../contacts/contacts.service.js';
import { DB } from '../database/database.module.js';
import type { Database, DepartmentsTable } from '../database/schema.js';
import { isGroupJid, phoneFromJid } from '../whatsapp/message-parser.js';

type Db = Kysely<Database> | Transaction<Database>;
export type DepartmentRow = { [K in keyof DepartmentsTable]: DepartmentsTable[K] extends { __select__: infer S } ? S : DepartmentsTable[K] };

export interface MessageDto {
  id: number;
  conversationId: number;
  ticketId: number | null;
  waId: string;
  fromMe: boolean;
  origin: string;
  senderName: string | null;
  senderJid: string | null;
  userId: number | null;
  userName: string | null;
  type: string;
  body: string | null;
  media: { id: number | null; status: string | null; mime: string | null; name: string | null; size: number | null } | null;
  quoted: { waId: string; preview: string | null; sender: string | null } | null;
  forwarded: boolean;
  status: string;
  deleted: boolean;
  edited: boolean;
  timestamp: Date;
  reactions: Array<{ emoji: string; reactorName: string | null; fromMe: boolean }>;
}

export interface ConversationDto {
  id: number;
  departmentId: number;
  contact: {
    id: number;
    name: string;
    pushName: string | null;
    customName: string | null;
    phone: string | null;
    jid: string;
    isGroup: boolean;
    isVip: boolean;
    avatar: AvatarState;
    avatarVersion: number;
  };
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
  ticket: {
    id: number;
    status: string;
    origin: string;
    classificationId: number | null;
    classificationLabel: string | null;
    assigneeId: number | null;
    assigneeName: string | null;
    openedAt: Date;
    closedAt: Date | null;
    emailStatus: string | null;
  } | null;
}

/** Telefone legível: +55 (94) 99999-0001 para números brasileiros, +DDI... para os demais. */
export function formatPhone(phone: string | null): string | null {
  if (!phone) return null;
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : `+${phone}`;
}

export function displayName(c: { custom_name: string | null; push_name: string | null; phone: string | null; jid: string }): string {
  return c.custom_name || c.push_name || formatPhone(c.phone) || (c.jid.endsWith('@g.us') ? 'Grupo sem nome' : c.jid.split('@')[0]);
}

/** Acesso às conversas, contatos e mensagens, compartilhado entre a API e o worker. */
@Injectable()
export class ChatRepository {
  constructor(@Inject(DB) readonly db: Kysely<Database>) {}

  async departmentByInstance(instance: string) {
    return this.db.selectFrom('departments').selectAll().where('evolution_instance', '=', instance).executeTakeFirst();
  }

  async department(id: number) {
    return this.db.selectFrom('departments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  /** Garante contato e conversa para o chat. Seguro contra concorrência (chaves únicas). */
  async ensureConversation(
    departmentId: number,
    jid: string,
    pushName?: string | null,
  ): Promise<{ conversationId: number; contactId: number; created: boolean }> {
    const isGroup = isGroupJid(jid);
    await this.db
      .insertInto('contacts')
      .values({
        department_id: departmentId,
        jid,
        phone: phoneFromJid(jid),
        push_name: pushName ?? null,
        is_group: isGroup ? 1 : 0,
      })
      .onDuplicateKeyUpdate(
        pushName && !isGroup ? { push_name: pushName } : { jid: sql`jid` as unknown as string },
      )
      .execute();
    const contact = await this.db
      .selectFrom('contacts')
      .select('id')
      .where('department_id', '=', departmentId)
      .where('jid', '=', jid)
      .executeTakeFirstOrThrow();
    const r = await this.db
      .insertInto('conversations')
      .ignore()
      .values({ department_id: departmentId, contact_id: contact.id })
      .executeTakeFirst();
    const conv = await this.db
      .selectFrom('conversations')
      .select('id')
      .where('contact_id', '=', contact.id)
      .executeTakeFirstOrThrow();
    return { conversationId: conv.id, contactId: contact.id, created: Number(r.numInsertedOrUpdatedRows ?? 0) > 0 };
  }

  /** Trava a conversa até o fim da transação (serializa a criação de chamados). */
  async lockConversation(trx: Transaction<Database>, conversationId: number) {
    return trx
      .selectFrom('conversations')
      .innerJoin('contacts', 'contacts.id', 'conversations.contact_id')
      .select([
        'conversations.id', 'conversations.department_id', 'conversations.open_ticket_id', 'contacts.is_group',
        'contacts.is_vip', 'contacts.jid',
      ])
      .where('conversations.id', '=', conversationId)
      .forUpdate()
      .executeTakeFirstOrThrow();
  }

  async touchConversation(
    db: Db,
    conversationId: number,
    p: { at: Date; preview: string; fromMe: boolean; incrementUnread: boolean },
  ): Promise<void> {
    await db
      .updateTable('conversations')
      .set({
        last_message_at: sql<Date>`GREATEST(COALESCE(last_message_at, ${p.at}), ${p.at})`,
        last_message_preview: p.preview.slice(0, 250),
        last_message_from_me: p.fromMe ? 1 : 0,
        unread_count: p.incrementUnread ? sql<number>`unread_count + 1` : p.fromMe ? 0 : sql<number>`unread_count`,
      })
      .where('id', '=', conversationId)
      .execute();
  }

  private conversationQuery(db: Db) {
    return db
      .selectFrom('conversations as cv')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .leftJoin('tickets as t', (j) =>
        j.on((eb) =>
          eb(
            't.id',
            '=',
            eb.fn.coalesce(
              'cv.open_ticket_id',
              eb.selectFrom('tickets as t2').select((e2) => e2.fn.max('t2.id').as('m')).whereRef('t2.conversation_id', '=', 'cv.id'),
            ),
          ),
        ),
      )
      .leftJoin('classifications as cl', 'cl.id', 't.classification_id')
      .leftJoin('users as u', 'u.id', 't.assignee_id')
      .select([
        'cv.id', 'cv.department_id', 'cv.last_message_at', 'cv.last_message_preview', 'cv.last_message_from_me',
        'cv.unread_count', 'ct.id as contact_id', 'ct.jid', 'ct.phone', 'ct.push_name', 'ct.custom_name', 'ct.is_group',
        'ct.is_vip', 'ct.avatar_path', 'ct.avatar_checked_at', 't.id as ticket_id', 't.status as ticket_status', 't.origin as ticket_origin',
        't.classification_id', 'cl.subject_label as classification_label', 't.assignee_id', 'u.name as assignee_name',
        't.opened_at', 't.closed_at', 't.email_status',
      ]);
  }

  listConversationsQuery(db: Db = this.db) {
    return this.conversationQuery(db);
  }

  async conversationSummary(id: number, db: Db = this.db): Promise<ConversationDto | null> {
    const r = await this.conversationQuery(db).where('cv.id', '=', id).executeTakeFirst();
    return r ? this.toConversationDto(r) : null;
  }

  toConversationDto(r: Awaited<ReturnType<ReturnType<ChatRepository['conversationQuery']>['executeTakeFirstOrThrow']>>): ConversationDto {
    return {
      id: r.id,
      departmentId: r.department_id,
      contact: {
        id: r.contact_id,
        name: displayName(r),
        pushName: r.push_name,
        customName: r.custom_name,
        phone: r.phone,
        jid: r.jid,
        isGroup: toBool(r.is_group),
        isVip: toBool(r.is_vip),
        avatar: avatarState(r),
        avatarVersion: r.avatar_checked_at?.getTime() ?? 0,
      },
      lastMessageAt: r.last_message_at,
      lastMessagePreview: r.last_message_preview,
      lastMessageFromMe: toBool(r.last_message_from_me),
      unreadCount: r.unread_count,
      ticket: r.ticket_id
        ? {
            id: r.ticket_id,
            status: r.ticket_status!,
            origin: r.ticket_origin!,
            classificationId: r.classification_id,
            classificationLabel: r.classification_label,
            assigneeId: r.assignee_id,
            assigneeName: r.assignee_name,
            openedAt: r.opened_at!,
            closedAt: r.closed_at,
            emailStatus: r.email_status,
          }
        : null,
    };
  }

  /** Mensagens no formato da interface, com reações e nome do atendente. */
  async messages(where: { ids?: number[]; conversationId?: number; ticketId?: number; beforeId?: number; limit?: number }): Promise<MessageDto[]> {
    let q = this.db
      .selectFrom('messages as m')
      .leftJoin('users as u', 'u.id', 'm.user_id')
      .selectAll('m')
      .select('u.name as user_name');
    if (where.ids) q = q.where('m.id', 'in', where.ids.length ? where.ids : [0]);
    if (where.conversationId) q = q.where('m.conversation_id', '=', where.conversationId);
    if (where.ticketId) q = q.where('m.ticket_id', '=', where.ticketId);
    if (where.beforeId) q = q.where('m.id', '<', where.beforeId);
    q = q.orderBy('m.wa_timestamp', 'desc').orderBy('m.id', 'desc');
    if (where.limit) q = q.limit(where.limit);
    const rows = (await q.execute()).reverse();
    const ids = rows.map((r) => r.id);
    const reactions = ids.length
      ? await this.db.selectFrom('message_reactions').selectAll().where('message_id', 'in', ids).orderBy('created_at').execute()
      : [];
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      ticketId: r.ticket_id,
      waId: r.wa_id,
      fromMe: toBool(r.from_me),
      origin: r.origin,
      senderName: r.sender_name,
      senderJid: r.sender_jid,
      userId: r.user_id,
      userName: r.user_name,
      type: r.type,
      body: toBool(r.deleted) ? null : r.body,
      media:
        r.media_status && !toBool(r.deleted)
          ? { id: r.media_id, status: r.media_status, mime: r.media_mime, name: r.media_name, size: r.media_size != null ? Number(r.media_size) : null }
          : null,
      quoted: r.quoted_wa_id ? { waId: r.quoted_wa_id, preview: r.quoted_preview, sender: r.quoted_sender } : null,
      forwarded: toBool(r.forwarded),
      status: r.status,
      deleted: toBool(r.deleted),
      edited: toBool(r.edited),
      timestamp: r.wa_timestamp,
      reactions: reactions
        .filter((x) => x.message_id === r.id)
        .map((x) => ({ emoji: x.emoji, reactorName: x.reactor_name, fromMe: toBool(x.from_me) })),
    }));
  }

  async message(id: number): Promise<MessageDto | null> {
    return (await this.messages({ ids: [id] }))[0] ?? null;
  }

  async messageIdByWaId(departmentId: number, waId: string): Promise<number | null> {
    const r = await this.db
      .selectFrom('messages')
      .select('id')
      .where('department_id', '=', departmentId)
      .where('wa_id', '=', waId)
      .executeTakeFirst();
    return r?.id ?? null;
  }

  async defaultClassificationId(db: Db, departmentId: number): Promise<number | null> {
    const r = await db
      .selectFrom('classifications')
      .select('id')
      .where('department_id', '=', departmentId)
      .where('is_default', '=', 1)
      .where('active', '=', 1)
      .executeTakeFirst();
    return r?.id ?? null;
  }
}
