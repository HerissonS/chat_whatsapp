import { readFile } from 'node:fs/promises';
import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { toBool } from '../common/validation.js';
import { MediaStorageService } from '../media/media-storage.service.js';
import type { MessageOrigin, MessageType } from '../database/schema.js';
import { REDIS } from '../redis/redis.module.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { EvolutionClient, EvolutionError, type SentMessage } from '../whatsapp/evolution.client.js';
import { ChatEventsService } from './chat-events.service.js';
import { ChatRepository, type MessageDto } from './chat.repository.js';

export interface SendContext {
  conversationId: number;
  /** Atendente que enviou; null para o bot. */
  user: { id: number; name: string } | null;
  /** Chamado já definido (bot e mensagem de encerramento). Se ausente, aplica as regras do chamado. */
  ticketId?: number | null;
  quotedMessageId?: number | null;
  forwarded?: boolean;
}

export interface OutgoingMedia {
  mediaId: number;
  path?: string;
  mime: string;
  fileName: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  size: number;
}

/** Chave que sinaliza "envio em andamento" para o processador do webhook não tratar a mensagem como vinda do celular. */
export const sendingKey = (departmentId: number, jid: string) => `sending:${departmentId}:${jid}`;

/**
 * Envio de mensagens pelo sistema (atendentes e bot).
 * 1. marca "envio em andamento" no Redis;
 * 2. envia pela Evolution;
 * 3. grava a mensagem (e aplica as regras do chamado) na mesma transação que trava a conversa;
 * 4. publica para os navegadores.
 */
@Injectable()
export class MessageSenderService {
  constructor(
    private readonly chat: ChatRepository,
    private readonly tickets: TicketsService,
    private readonly evolution: EvolutionClient,
    private readonly events: ChatEventsService,
    private readonly storage: MediaStorageService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('MessageSender');
  }

  private async target(conversationId: number) {
    const row = await this.chat.db
      .selectFrom('conversations as cv')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .innerJoin('departments as d', 'd.id', 'cv.department_id')
      .select(['cv.id', 'cv.department_id', 'ct.jid', 'ct.is_group', 'd.evolution_instance', 'd.agent_name_prefix', 'd.wa_state'])
      .where('cv.id', '=', conversationId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Conversa não encontrada.');
    if (!row.evolution_instance) throw new ServiceUnavailableException('O WhatsApp desta caixa de entrada não está configurado.');
    if (row.wa_state !== 'open') {
      throw new ServiceUnavailableException('O WhatsApp está desconectado. Peça a um administrador para reconectar em Administração > WhatsApp.');
    }
    return row;
  }

  /** Confere se é possível enviar para a conversa (setor configurado e WhatsApp conectado). */
  async assertReady(conversationId: number): Promise<void> {
    await this.target(conversationId);
  }

  private prefix(user: SendContext['user'], enabled: number): string {
    return user && toBool(enabled) ? `*${user.name}:*\n` : '';
  }

  private async quoted(conversationId: number, messageId?: number | null) {
    if (!messageId) return null;
    const q = await this.chat.db
      .selectFrom('messages')
      .select(['wa_id', 'body', 'type', 'sender_name', 'from_me', 'media_name'])
      .where('id', '=', messageId)
      .where('conversation_id', '=', conversationId)
      .executeTakeFirst();
    if (!q) throw new BadRequestException('Mensagem citada não encontrada nesta conversa.');
    const preview = q.body || (q.media_name ? `[${q.type}] ${q.media_name}` : `[${q.type}]`);
    return { waId: q.wa_id, preview: preview.slice(0, 250), sender: toBool(q.from_me) ? 'Você' : q.sender_name };
  }

  async sendText(ctx: SendContext, text: string): Promise<MessageDto> {
    const t = await this.target(ctx.conversationId);
    const quoted = await this.quoted(ctx.conversationId, ctx.quotedMessageId);
    const outgoing = this.prefix(ctx.user, t.agent_name_prefix) + text;
    return this.withSendingMark(
      t.department_id,
      t.jid,
      () => this.evolution.sendText(t.evolution_instance!, t.jid, outgoing, quoted?.waId),
      (s) => this.record(t, ctx, s, { type: 'text', body: text, quoted }),
    );
  }

  async sendMedia(ctx: SendContext, media: OutgoingMedia, caption: string | null): Promise<MessageDto> {
    const t = await this.target(ctx.conversationId);
    const quoted = await this.quoted(ctx.conversationId, ctx.quotedMessageId);
    const prefix = this.prefix(ctx.user, t.agent_name_prefix);
    const fullCaption = media.kind === 'audio' ? undefined : `${prefix}${caption ?? ''}`.trim() || undefined;
    const buffer = media.path ? await readFile(media.path) : (await this.storage.read(media.mediaId)).buffer;
    return this.withSendingMark(
      t.department_id,
      t.jid,
      () =>
        this.evolution.sendMedia(t.evolution_instance!, {
          number: t.jid,
          mediatype: media.kind,
          mimetype: media.mime,
          base64: buffer.toString('base64'),
          fileName: media.fileName,
          caption: fullCaption,
          quotedId: quoted?.waId,
        }),
      (s) =>
        this.record(t, ctx, s, {
          type: media.kind,
          body: caption,
          quoted,
          media: { id: media.mediaId, mime: media.mime, name: media.fileName, size: media.size },
        }),
    );
  }

  /** Envia uma figurinha (sem legenda e sem o nome do atendente, que o WhatsApp não suporta em figurinhas). */
  async sendSticker(ctx: SendContext, media: { mediaId: number; mime: string; size: number; path?: string }): Promise<MessageDto> {
    const t = await this.target(ctx.conversationId);
    const quoted = await this.quoted(ctx.conversationId, ctx.quotedMessageId);
    const buffer = media.path ? await readFile(media.path) : (await this.storage.read(media.mediaId)).buffer;
    return this.withSendingMark(
      t.department_id,
      t.jid,
      () => this.evolution.sendSticker(t.evolution_instance!, t.jid, buffer.toString('base64'), media.mime !== 'image/webp', quoted?.waId),
      (s) =>
        this.record(t, ctx, s, {
          type: 'sticker',
          body: null,
          quoted,
          media: { id: media.mediaId, mime: media.mime, name: 'figurinha.webp', size: media.size },
        }),
    );
  }

  private async withSendingMark<T>(
    departmentId: number,
    jid: string,
    send: () => Promise<SentMessage>,
    after: (s: SentMessage) => Promise<T>,
  ): Promise<T> {
    const key = sendingKey(departmentId, jid);
    await this.redis.multi().incr(key).expire(key, 120).exec();
    try {
      let s: SentMessage;
      try {
        s = await send();
      } catch (err) {
        if (err instanceof EvolutionError) {
          throw new ServiceUnavailableException(`Falha ao enviar pelo WhatsApp: ${err.message}`);
        }
        throw err;
      }
      if (!s?.key?.id) throw new ServiceUnavailableException('O WhatsApp não confirmou o envio.');
      return await after(s);
    } finally {
      await this.redis.decr(key);
    }
  }

  private async record(
    t: { id: number; department_id: number; jid: string },
    ctx: SendContext,
    s: SentMessage,
    p: {
      type: MessageType;
      body: string | null;
      quoted: { waId: string; preview: string; sender: string | null } | null;
      media?: { id: number; mime: string; name: string; size: number };
    },
  ): Promise<MessageDto> {
    const origin: MessageOrigin = ctx.user ? 'agent' : 'bot';
    const ts = Number(s.messageTimestamp);
    const at = ts ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date();
    const messageId = await this.chat.db.transaction().execute(async (trx) => {
      let ticketId = ctx.ticketId ?? null;
      if (ctx.ticketId === undefined) {
        ticketId = ctx.user
          ? await this.tickets.onOutgoing(trx, t.id, ctx.user.id, at)
          : ((await this.chat.lockConversation(trx, t.id)).open_ticket_id ?? null);
      }
      const values = {
        department_id: t.department_id,
        conversation_id: t.id,
        ticket_id: ticketId,
        wa_id: s.key.id,
        remote_jid: t.jid,
        from_me: 1,
        origin,
        user_id: ctx.user?.id ?? null,
        sender_name: ctx.user?.name ?? (origin === 'bot' ? 'Bot' : null),
        type: p.type,
        body: p.body,
        media_id: p.media?.id ?? null,
        media_status: p.media ? 'ready' : null,
        media_mime: p.media?.mime ?? null,
        media_name: p.media?.name ?? null,
        media_size: p.media?.size ?? null,
        quoted_wa_id: p.quoted?.waId ?? null,
        quoted_preview: p.quoted?.preview ?? null,
        quoted_sender: p.quoted?.sender ?? null,
        forwarded: ctx.forwarded ? 1 : 0,
        status: 'sent' as const,
        deleted: 0,
        edited: 0,
        wa_timestamp: at,
      };
      // Se o webhook chegou antes e gravou como "celular", corrige a origem e o autor.
      await trx
        .insertInto('messages')
        .values(values)
        .onDuplicateKeyUpdate({
          origin,
          user_id: values.user_id,
          sender_name: values.sender_name,
          ticket_id: ticketId,
          body: p.body,
          media_id: values.media_id,
          media_status: values.media_status,
          forwarded: values.forwarded,
        })
        .execute();
      const row = await trx
        .selectFrom('messages')
        .select('id')
        .where('department_id', '=', t.department_id)
        .where('wa_id', '=', s.key.id)
        .executeTakeFirstOrThrow();
      const preview = p.body || (p.media ? `[${p.type}] ${p.media.name}` : '');
      await this.chat.touchConversation(trx, t.id, { at, preview, fromMe: true, incrementUnread: false });
      return row.id;
    });

    this.logger.info({ conversation_id: t.id, message_id: messageId, origin, type: p.type }, 'mensagem enviada');
    await this.events.message(t.department_id, messageId);
    await this.events.conversation(t.department_id, t.id);
    return (await this.chat.message(messageId))!;
  }
}
