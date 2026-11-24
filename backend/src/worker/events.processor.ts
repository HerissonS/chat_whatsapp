import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { BotService } from '../bot/bot.service.js';
import { toBool } from '../common/validation.js';
import { ChatEventsService } from '../chat/chat-events.service.js';
import { ChatRepository } from '../chat/chat.repository.js';
import { sendingKey } from '../chat/message-sender.service.js';
import { Queues } from '../queue/queue.module.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { REDIS } from '../redis/redis.module.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { EvolutionClient } from '../whatsapp/evolution.client.js';
import {
  isGroupJid,
  isStatusUpgrade,
  mapStatus,
  parseProtocol,
  parseWaMessage,
  type ParsedMessage,
  previewOf,
} from '../whatsapp/message-parser.js';

type AnyObj = Record<string, any>;
type Dept = NonNullable<Awaited<ReturnType<ChatRepository['departmentByInstance']>>>;

/**
 * Processa os eventos do webhook da Evolution, um por vez e na ordem de chegada
 * (a fila "events" roda com concorrência 1 para manter a ordem das mensagens e do menu).
 * Cada evento é idempotente: reprocessar não duplica mensagens.
 */
@Injectable()
export class EventsProcessor {
  constructor(
    private readonly chat: ChatRepository,
    private readonly tickets: TicketsService,
    private readonly bot: BotService,
    private readonly events: ChatEventsService,
    private readonly realtime: RealtimeService,
    private readonly evolution: EvolutionClient,
    private readonly queues: Queues,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Events');
  }

  async process(eventId: string): Promise<void> {
    const row = await this.chat.db.selectFrom('webhook_events').selectAll().where('id', '=', eventId).executeTakeFirst();
    if (!row || row.status === 'done') return;
    const payload = JSON.parse(row.payload) as AnyObj;
    const dept = await this.chat.departmentByInstance(row.instance);
    try {
      if (!dept) {
        this.logger.warn({ instance: row.instance, event: row.event }, 'evento de instância sem caixa de entrada associada');
      } else if (!toBool(dept.active) && row.event !== 'connection.update') {
        this.logger.info({ department_id: dept.id, event: row.event }, 'evento ignorado: caixa de entrada inativa');
      } else {
        await this.dispatch(row.event, payload.data, dept);
      }
      await this.chat.db
        .updateTable('webhook_events')
        .set({ status: 'done', processed_at: new Date(), error: null })
        .where('id', '=', eventId)
        .execute();
    } catch (err) {
      await this.chat.db
        .updateTable('webhook_events')
        .set({ status: 'error', error: (err as Error).message.slice(0, 500) })
        .where('id', '=', eventId)
        .execute();
      throw err;
    }
  }

  private async dispatch(event: string, data: AnyObj, dept: Dept): Promise<void> {
    switch (event) {
      case 'messages.upsert':
      case 'send.message':
        return this.onMessage(data, dept);
      case 'messages.update':
        return this.onStatus(data, dept);
      case 'messages.delete':
        return this.onRevoke(String(data?.id ?? data?.keyId ?? ''), dept);
      case 'messages.edited': {
        const p = parseProtocol(data);
        if (p?.kind === 'revoke') return this.onRevoke(p.targetId, dept);
        if (p?.kind === 'edit') return this.onEdit(p.targetId, p.text, dept);
        return;
      }
      case 'connection.update':
        return this.onConnection(data, dept);
      case 'qrcode.updated':
        this.realtime.toAdmins('whatsapp:qrcode', {
          departmentId: dept.id,
          base64: data?.qrcode?.base64 ?? null,
          pairingCode: data?.qrcode?.pairingCode ?? null,
        });
        return;
      case 'contacts.upsert':
      case 'contacts.update':
        return this.onContacts(data, dept);
      case 'groups.upsert':
      case 'groups.update':
        return this.onGroups(data, dept);
      default:
        return;
    }
  }

  // ------------------------------------------------------------------ mensagens

  private async onMessage(raw: AnyObj, dept: Dept): Promise<void> {
    const msg = parseWaMessage(raw);
    if (!msg) return;
    if (msg.reaction) return this.onReaction(msg, dept);

    const existing = await this.chat.messageIdByWaId(dept.id, msg.waId);
    if (existing) return;

    if (msg.fromMe && (await this.waitForSystemSend(dept.id, msg))) return;

    const { conversationId, created } = await this.chat.ensureConversation(dept.id, msg.chatJid, isGroupJid(msg.chatJid) ? null : msg.pushName);
    if (created && isGroupJid(msg.chatJid)) await this.fillGroupName(dept, msg.chatJid);

    let action: Awaited<ReturnType<TicketsService['onIncoming']>>['action'] = null;
    let ticketId = 0;
    const messageId = await this.chat.db.transaction().execute(async (trx) => {
      if (msg.fromMe) {
        ticketId = await this.tickets.onOutgoing(trx, conversationId, null, msg.timestamp);
      } else {
        const r = await this.tickets.onIncoming(trx, conversationId, { type: msg.type, body: msg.body, at: msg.timestamp });
        ticketId = r.ticketId;
        action = r.action;
      }
      const r = await trx
        .insertInto('messages')
        .ignore()
        .values({
          department_id: dept.id,
          conversation_id: conversationId,
          ticket_id: ticketId,
          wa_id: msg.waId,
          remote_jid: msg.chatJid,
          from_me: msg.fromMe ? 1 : 0,
          origin: msg.fromMe ? 'phone' : 'contact',
          sender_jid: msg.participantJid,
          sender_name: msg.fromMe ? null : msg.pushName,
          type: msg.type,
          body: msg.body,
          media_status: msg.media ? 'pending' : null,
          media_mime: msg.media?.mime ?? null,
          media_name: msg.media?.name ?? null,
          media_size: msg.media?.size ?? null,
          quoted_wa_id: msg.quoted?.waId ?? null,
          quoted_preview: msg.quoted?.preview ?? null,
          quoted_sender: msg.quoted?.sender ?? null,
          forwarded: msg.forwarded ? 1 : 0,
          status: msg.fromMe ? 'sent' : 'delivered',
          deleted: 0,
          edited: 0,
          wa_timestamp: msg.timestamp,
        })
        .executeTakeFirst();
      if (!Number(r.numInsertedOrUpdatedRows ?? 0)) return null;
      const id = Number(r.insertId);
      await this.chat.touchConversation(trx, conversationId, {
        at: msg.timestamp,
        preview: previewOf(raw.message),
        fromMe: msg.fromMe,
        incrementUnread: !msg.fromMe,
      });
      return id;
    });
    if (!messageId) return;

    this.logger.info(
      { conversation_id: conversationId, message_id: messageId, ticket_id: ticketId, type: msg.type, from_me: msg.fromMe },
      msg.fromMe ? 'mensagem enviada pelo celular registrada' : 'mensagem recebida',
    );
    if (msg.media) {
      await this.queues.media.add('download', {
        messageId,
        instance: dept.evolution_instance!,
        raw: { key: raw.key, message: raw.message },
      });
    }
    await this.events.message(dept.id, messageId);
    await this.events.conversation(dept.id, conversationId);
    await this.bot.run(action, { departmentId: dept.id, conversationId, ticketId });
  }

  /**
   * Mensagem "fromMe" desconhecida: pode ser um envio do próprio sistema cuja resposta da Evolution
   * ainda não foi gravada. Se houver envio em andamento para o chat, espera até 10 s pela gravação.
   * Retorna true se a mensagem foi gravada pelo sistema nesse meio-tempo.
   */
  private async waitForSystemSend(departmentId: number, msg: ParsedMessage): Promise<boolean> {
    const key = sendingKey(departmentId, msg.chatJid);
    for (let i = 0; i < 40; i++) {
      const pending = Number((await this.redis.get(key)) ?? 0);
      if (await this.chat.messageIdByWaId(departmentId, msg.waId)) return true;
      if (pending <= 0) return false;
      await sleep(250);
    }
    return (await this.chat.messageIdByWaId(departmentId, msg.waId)) != null;
  }

  private async onReaction(msg: ParsedMessage, dept: Dept): Promise<void> {
    const targetId = await this.chat.messageIdByWaId(dept.id, msg.reaction!.targetId);
    if (!targetId) return;
    const reactor = msg.fromMe ? 'me' : (msg.participantJid ?? msg.chatJid);
    if (!msg.reaction!.emoji) {
      await this.chat.db
        .deleteFrom('message_reactions')
        .where('message_id', '=', targetId)
        .where('reactor_jid', '=', reactor)
        .execute();
    } else {
      await this.chat.db
        .insertInto('message_reactions')
        .values({
          message_id: targetId,
          reactor_jid: reactor,
          reactor_name: msg.fromMe ? 'Você' : msg.pushName,
          emoji: msg.reaction!.emoji.slice(0, 32),
          from_me: msg.fromMe ? 1 : 0,
        })
        .onDuplicateKeyUpdate({ emoji: msg.reaction!.emoji.slice(0, 32) })
        .execute();
    }
    await this.events.message(dept.id, targetId);
  }

  private async onStatus(data: AnyObj, dept: Dept): Promise<void> {
    const items = Array.isArray(data) ? data : [data];
    for (const u of items) {
      const waId = u?.keyId ?? u?.key?.id;
      const status = mapStatus(u?.status);
      if (!waId || !status) continue;
      const m = await this.chat.db
        .selectFrom('messages')
        .select(['id', 'status', 'from_me'])
        .where('department_id', '=', dept.id)
        .where('wa_id', '=', String(waId))
        .executeTakeFirst();
      if (!m || m.from_me !== 1 || !isStatusUpgrade(m.status, status)) continue;
      await this.chat.db.updateTable('messages').set({ status }).where('id', '=', m.id).execute();
      await this.events.message(dept.id, m.id);
    }
  }

  private async onRevoke(waId: string, dept: Dept): Promise<void> {
    if (!waId) return;
    const id = await this.chat.messageIdByWaId(dept.id, waId);
    if (!id) return;
    await this.chat.db.updateTable('messages').set({ deleted: 1 }).where('id', '=', id).execute();
    await this.events.message(dept.id, id);
  }

  private async onEdit(waId: string, text: string | null, dept: Dept): Promise<void> {
    const id = await this.chat.messageIdByWaId(dept.id, waId);
    if (!id || text == null) return;
    await this.chat.db.updateTable('messages').set({ body: text, edited: 1 }).where('id', '=', id).execute();
    await this.events.message(dept.id, id);
  }

  // ------------------------------------------------------------------ conexão e contatos

  private async onConnection(data: AnyObj, dept: Dept): Promise<void> {
    const state = String(data?.state ?? 'close');
    const wuid = typeof data?.wuid === 'string' ? data.wuid : null;
    const number = wuid ? (wuid.split('@')[0].split(':')[0] ?? null) : null;
    await this.chat.db
      .updateTable('departments')
      .set({
        wa_state: state.slice(0, 20),
        wa_updated_at: new Date(),
        ...(state === 'open' && number && { wa_number: number }),
        ...(state === 'open' && data?.profileName && { wa_name: String(data.profileName).slice(0, 150) }),
      })
      .where('id', '=', dept.id)
      .execute();
    this.logger.info({ department_id: dept.id, state, status_reason: data?.statusReason }, 'conexão do WhatsApp alterada');
    // Ao conectar, importa a agenda sincronizada (aguarda a sincronização inicial do celular).
    if (state === 'open' && dept.wa_state !== 'open') {
      await this.queues.maintenance.add('import-contacts', { departmentId: dept.id }, { delay: 60_000, jobId: `import-contacts-${dept.id}-${Date.now()}` });
    }
    this.realtime.toDepartment(dept.id, 'whatsapp:status', { departmentId: dept.id, state });
    this.realtime.toAdmins('whatsapp:status', { departmentId: dept.id, state });
  }

  private async onContacts(data: AnyObj, dept: Dept): Promise<void> {
    const items = (Array.isArray(data) ? data : [data]) as AnyObj[];
    for (const c of items) {
      let jid = String(c?.remoteJid ?? c?.id ?? '');
      if (jid.endsWith('@lid') && c?.remoteJidAlt) jid = String(c.remoteJidAlt);
      const name = typeof c?.pushName === 'string' ? c.pushName.trim().slice(0, 150) : '';
      if (!jid || !name || isGroupJid(jid)) continue;
      await this.chat.db
        .updateTable('contacts')
        .set({ push_name: name })
        .where('department_id', '=', dept.id)
        .where('jid', '=', jid)
        .execute();
    }
  }

  private async onGroups(data: AnyObj, dept: Dept): Promise<void> {
    const items = (Array.isArray(data) ? data : [data]) as AnyObj[];
    for (const g of items) {
      if (!g?.id || !g?.subject) continue;
      const r = await this.chat.db
        .updateTable('contacts')
        .set({ push_name: String(g.subject).slice(0, 150) })
        .where('department_id', '=', dept.id)
        .where('jid', '=', String(g.id))
        .executeTakeFirst();
      if (Number(r.numUpdatedRows) > 0) {
        const conv = await this.chat.db
          .selectFrom('conversations')
          .innerJoin('contacts', 'contacts.id', 'conversations.contact_id')
          .select('conversations.id')
          .where('contacts.department_id', '=', dept.id)
          .where('contacts.jid', '=', String(g.id))
          .executeTakeFirst();
        if (conv) await this.events.conversation(dept.id, conv.id);
      }
    }
  }

  private async fillGroupName(dept: Dept, jid: string): Promise<void> {
    try {
      const subject = await this.evolution.groupSubject(dept.evolution_instance!, jid);
      if (subject) {
        await this.chat.db
          .updateTable('contacts')
          .set({ push_name: subject.slice(0, 150) })
          .where('department_id', '=', dept.id)
          .where('jid', '=', jid)
          .execute();
      }
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'não foi possível obter o nome do grupo');
    }
  }
}
