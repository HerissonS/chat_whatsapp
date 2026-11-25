import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { fileTypeFromFile } from 'file-type';
import { sql } from 'kysely';
import { diskStorage } from 'multer';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, clientIp, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { cleanText, idParam, parse, toBool } from '../common/validation.js';
import { loadConfig } from '../config/env.js';
import { INLINE_MIME, MediaStorageService, sanitizeFileName } from '../media/media-storage.service.js';
import { EvolutionClient, EvolutionError } from '../whatsapp/evolution.client.js';
import { ChatEventsService } from './chat-events.service.js';
import { ChatRepository } from './chat.repository.js';
import { awaitingReplySql } from './waiting.js';
import { MessageSenderService, type OutgoingMedia } from './message-sender.service.js';

const cfg = loadConfig();
const TMP_DIR = `${cfg.MEDIA_DIR}/tmp`;
mkdirSync(TMP_DIR, { recursive: true });

const uploadInterceptor = FileInterceptor('file', {
  storage: diskStorage({ destination: TMP_DIR, filename: (_req, _file, cb) => cb(null, randomUUID()) }),
  limits: { fileSize: cfg.MEDIA_MAX_MB * 1024 * 1024, files: 1, fields: 5 },
});

/** Tipo de arquivo pela extensão, só para formatos que não têm assinatura binária (texto). */
const TEXT_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.log': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml',
};

const STICKER_SOURCE_MIME = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/gif']);

function mediaKind(mime: string): OutgoingMedia['kind'] {
  if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return 'image';
  if (['video/mp4', 'video/3gpp'].includes(mime)) return 'video';
  if (['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/x-m4a'].includes(mime)) return 'audio';
  return 'document';
}

const listSchema = z.object({
  tab: z.enum(['mine', 'waiting', 'unassigned', 'menu', 'all', 'groups', 'closed', 'everything']).default('all'),
  q: z.string().trim().max(100).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatRepository,
    private readonly sender: MessageSenderService,
    private readonly evolution: EvolutionClient,
    private readonly storage: MediaStorageService,
    private readonly events: ChatEventsService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Chat');
  }

  private async conversationOrFail(user: AuthUser, id: number) {
    const cv = await this.chat.db
      .selectFrom('conversations as cv')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .select(['cv.id', 'cv.department_id', 'cv.open_ticket_id', 'ct.jid', 'ct.is_group'])
      .where('cv.id', '=', id)
      .executeTakeFirst();
    if (!cv || !user.departmentIds.includes(cv.department_id)) throw new NotFoundException('Conversa não encontrada.');
    return cv;
  }

  private async messageOrFail(user: AuthUser, id: number) {
    const m = await this.chat.db
      .selectFrom('messages as m')
      .innerJoin('conversations as cv', 'cv.id', 'm.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .innerJoin('departments as d', 'd.id', 'm.department_id')
      .select([
        'm.id', 'm.department_id', 'm.conversation_id', 'm.wa_id', 'm.from_me', 'm.type', 'm.body', 'm.media_id', 'm.media_status',
        'm.media_mime', 'm.media_name', 'm.media_size', 'm.sender_jid', 'm.deleted', 'ct.jid', 'ct.is_group', 'd.evolution_instance',
      ])
      .where('m.id', '=', id)
      .executeTakeFirst();
    if (!m || !user.departmentIds.includes(m.department_id)) throw new NotFoundException('Mensagem não encontrada.');
    return m;
  }

  // ---------------------------------------------------------------- conversas

  @Get('conversations')
  @RequirePermission('chat.read')
  async list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = parse(listSchema, query);
    const depts = q.departmentId ? [q.departmentId].filter((d) => user.departmentIds.includes(d)) : user.departmentIds;
    if (!depts.length) return { items: [], hasMore: false };
    let b = this.chat.listConversationsQuery().where('cv.department_id', 'in', depts);
    switch (q.tab) {
      case 'mine':
        b = b.where('cv.open_ticket_id', 'is not', null).where('t.assignee_id', '=', user.id);
        break;
      case 'waiting':
        b = b.where('cv.open_ticket_id', 'is not', null).where(awaitingReplySql);
        break;
      case 'unassigned':
        b = b.where('cv.open_ticket_id', 'is not', null).where('t.status', '=', 'open').where('t.assignee_id', 'is', null);
        break;
      case 'menu':
        b = b.where('cv.open_ticket_id', 'is not', null).where('t.status', '=', 'menu');
        break;
      case 'all':
        b = b.where((eb) => eb.or([eb('cv.open_ticket_id', 'is not', null), eb('cv.last_message_at', 'is', null)]));
        break;
      case 'groups':
        b = b.where('ct.is_group', '=', 1);
        break;
      case 'closed':
        b = b.where('cv.open_ticket_id', 'is', null).where('t.status', '=', 'closed');
        break;
      case 'everything':
        break;
    }
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
      const digits = q.q.replace(/\D/g, '');
      b = b.where((eb) =>
        eb.or([
          eb('ct.custom_name', 'like', like),
          eb('ct.push_name', 'like', like),
          ...(digits.length >= 3 ? [eb('ct.phone', 'like', `%${digits}%`)] : []),
        ]),
      );
    }
    const rows = await b
      .orderBy(sql`COALESCE(cv.last_message_at, cv.created_at)`, 'desc')
      .limit(q.limit + 1)
      .offset(q.offset)
      .execute();
    return { items: rows.slice(0, q.limit).map((r) => this.chat.toConversationDto(r)), hasMore: rows.length > q.limit };
  }

  @Get('conversations/counts')
  @RequirePermission('chat.read')
  async counts(@CurrentUser() user: AuthUser, @Query('departmentId') dep?: string) {
    const depts = dep ? [Number(dep)].filter((d) => user.departmentIds.includes(d)) : user.departmentIds;
    if (!depts.length) return { mine: 0, waiting: 0, unassigned: 0, menu: 0, all: 0, unread: 0 };
    const r = await this.chat.db
      .selectFrom('conversations as cv')
      .innerJoin('tickets as t', 't.id', 'cv.open_ticket_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .select([
        sql<number>`SUM(t.assignee_id = ${user.id})`.as('mine'),
        sql<number>`SUM(${awaitingReplySql})`.as('waiting'),
        sql<number>`SUM(t.status = 'open' AND t.assignee_id IS NULL)`.as('unassigned'),
        sql<number>`SUM(t.status = 'menu')`.as('menu'),
        sql<number>`COUNT(*)`.as('all'),
        sql<number>`SUM(cv.unread_count > 0)`.as('unread'),
      ])
      .where('cv.department_id', 'in', depts)
      .executeTakeFirst();
    return {
      mine: Number(r?.mine ?? 0),
      waiting: Number(r?.waiting ?? 0),
      unassigned: Number(r?.unassigned ?? 0),
      menu: Number(r?.menu ?? 0),
      all: Number(r?.all ?? 0),
      unread: Number(r?.unread ?? 0),
    };
  }

  @Get('conversations/:id')
  @RequirePermission('chat.read')
  async detail(@CurrentUser() user: AuthUser, @Param('id') idRaw: string) {
    const cv = await this.conversationOrFail(user, parse(idParam, idRaw));
    const summary = await this.chat.conversationSummary(cv.id);
    const history = await this.chat.db
      .selectFrom('tickets as t')
      .leftJoin('classifications as cl', 'cl.id', 't.classification_id')
      .leftJoin('users as u', 'u.id', 't.assignee_id')
      .select([
        't.id', 't.status', 't.opened_at', 't.closed_at', 't.contract', 't.equipment', 't.email_status',
        'cl.subject_label as classification', 'u.name as assignee',
      ])
      .where('t.conversation_id', '=', cv.id)
      .orderBy('t.id', 'desc')
      .limit(50)
      .execute();
    return { ...summary, history };
  }

  @Get('conversations/:id/messages')
  @RequirePermission('chat.read')
  async messages(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Query('beforeId') before?: string, @Query('limit') limit?: string) {
    const cv = await this.conversationOrFail(user, parse(idParam, idRaw));
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const items = await this.chat.messages({
      conversationId: cv.id,
      beforeId: before ? parse(idParam, before) : undefined,
      limit: lim + 1,
    });
    const hasMore = items.length > lim;
    return { items: hasMore ? items.slice(1) : items, hasMore };
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  @RequirePermission('chat.read')
  async read(@CurrentUser() user: AuthUser, @Param('id') idRaw: string) {
    const cv = await this.conversationOrFail(user, parse(idParam, idRaw));
    const unread = await this.chat.db
      .selectFrom('messages')
      .select(['wa_id', 'remote_jid', 'sender_jid'])
      .where('conversation_id', '=', cv.id)
      .where('from_me', '=', 0)
      .orderBy('id', 'desc')
      .limit(20)
      .execute();
    await this.chat.db.updateTable('conversations').set({ unread_count: 0 }).where('id', '=', cv.id).execute();
    await this.events.conversation(cv.department_id, cv.id);
    // Confirmação de leitura no WhatsApp: melhor esforço, não bloqueia a interface.
    const dept = await this.chat.department(cv.department_id);
    if (dept.evolution_instance && unread.length) {
      this.evolution
        .markRead(dept.evolution_instance, unread.map((u) => ({ id: u.wa_id, remoteJid: u.remote_jid, fromMe: false })))
        .catch((err: unknown) => this.logger.debug({ err: (err as Error).message }, 'falha ao marcar como lida'));
    }
    return { ok: true };
  }

  /** Nova conversa: valida no WhatsApp se o número existe. */
  @Post('conversations')
  @RequirePermission('chat.send')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parse(
      z.object({
        phone: z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().regex(/^\d{10,15}$/, 'informe DDI + DDD + número')),
        departmentId: z.number().int().positive().optional(),
      }),
      body,
    );
    const departmentId = data.departmentId ?? user.departmentIds[0];
    if (!departmentId || !user.departmentIds.includes(departmentId)) throw new ForbiddenException('Caixa de entrada não permitida.');
    const dept = await this.chat.department(departmentId);
    if (!dept.evolution_instance || dept.wa_state !== 'open') throw new ServiceUnavailableException(`O WhatsApp da caixa "${dept.name}" não está conectado.`);
    let check: Awaited<ReturnType<EvolutionClient['checkNumber']>>;
    try {
      check = await this.evolution.checkNumber(dept.evolution_instance, data.phone);
    } catch (err) {
      if (err instanceof EvolutionError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
    if (!check?.exists || !check.jid) throw new BadRequestException('Este número não tem WhatsApp.');
    let jid = check.jid;
    if (jid.endsWith('@lid')) jid = `${data.phone}@s.whatsapp.net`;
    const { conversationId } = await this.chat.ensureConversation(departmentId, jid, null);
    await this.events.conversation(departmentId, conversationId);
    return this.chat.conversationSummary(conversationId);
  }

  // ---------------------------------------------------------------- envio

  @Post('conversations/:id/messages')
  @RequirePermission('chat.send')
  async sendText(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown) {
    const cv = await this.conversationOrFail(user, parse(idParam, idRaw));
    const data = parse(
      z.object({ text: cleanText(4000).pipe(z.string().min(1, 'mensagem vazia')), quotedMessageId: z.number().int().positive().optional() }),
      body,
    );
    return this.sender.sendText({ conversationId: cv.id, user: { id: user.id, name: user.name }, quotedMessageId: data.quotedMessageId }, data.text);
  }

  @Post('conversations/:id/media')
  @RequirePermission('chat.send')
  @UseInterceptors(uploadInterceptor)
  async sendMedia(
    @CurrentUser() user: AuthUser,
    @Param('id') idRaw: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
  ) {
    try {
      const cv = await this.conversationOrFail(user, parse(idParam, idRaw));
      if (!file?.path || !file.size) throw new BadRequestException('Selecione um arquivo.');
      await this.sender.assertReady(cv.id);
      const caption = body.caption ? parse(cleanText(1000), body.caption) : null;
      const asSticker = body.asSticker === '1' || body.asSticker === 'true';
      const quotedMessageId = body.quotedMessageId ? parse(idParam, body.quotedMessageId) : undefined;
      const originalName = sanitizeFileName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
      const sniffed = await fileTypeFromFile(file.path);
      const mime = sniffed?.mime ?? TEXT_MIME[extname(originalName).toLowerCase()] ?? 'application/octet-stream';
      const kind = mediaKind(mime);
      if (asSticker && !STICKER_SOURCE_MIME.has(mime)) throw new BadRequestException('Para figurinha, envie uma imagem PNG, JPG, GIF ou WebP.');
      if (asSticker && file.size > 2 * 1024 * 1024) throw new BadRequestException('A imagem da figurinha deve ter no máximo 2 MB.');
      const mediaId = await this.storage.saveTempFile({ departmentId: cv.department_id, tempPath: file.path, mime, originalName });
      const stored = await this.chat.db.selectFrom('media_files').select('storage_path').where('id', '=', mediaId).executeTakeFirstOrThrow();
      if (asSticker) {
        return await this.sender.sendSticker(
          { conversationId: cv.id, user: { id: user.id, name: user.name }, quotedMessageId },
          { mediaId, mime, size: file.size, path: this.storage.resolve(stored.storage_path) },
        );
      }
      return await this.sender.sendMedia(
        { conversationId: cv.id, user: { id: user.id, name: user.name }, quotedMessageId },
        { mediaId, path: this.storage.resolve(stored.storage_path), mime, fileName: originalName, kind, size: file.size },
        caption,
      );
    } finally {
      await this.storage.removeTemp(file?.path);
    }
  }

  /** Figurinhas usadas recentemente nas caixas de entrada do usuário (recebidas ou enviadas), sem repetição. */
  @Get('stickers/recent')
  @RequirePermission('chat.send')
  async recentStickers(@CurrentUser() user: AuthUser) {
    if (!user.departmentIds.length) return [];
    const rows = await this.chat.db
      .selectFrom('messages as m')
      .innerJoin('media_files as f', 'f.id', 'm.media_id')
      .select([(eb) => eb.fn.max('m.media_id').as('mediaId'), 'f.sha256'])
      .where('m.type', '=', 'sticker')
      .where('m.media_status', '=', 'ready')
      .where('m.deleted', '=', 0)
      .where('m.department_id', 'in', user.departmentIds)
      .groupBy('f.sha256')
      .orderBy((eb) => eb.fn.max('m.id'), 'desc')
      .limit(40)
      .execute();
    return rows.map((r) => ({ mediaId: Number(r.mediaId) }));
  }

  /** Envia uma figurinha já armazenada (escolhida nas recentes). */
  @Post('conversations/:id/sticker')
  @RequirePermission('chat.send')
  async sendStoredSticker(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown) {
    const cv = await this.conversationOrFail(user, parse(idParam, idRaw));
    const data = parse(z.object({ mediaId: z.number().int().positive(), quotedMessageId: z.number().int().positive().optional() }), body);
    const f = await this.chat.db.selectFrom('media_files').selectAll().where('id', '=', data.mediaId).executeTakeFirst();
    if (!f || f.department_id == null || !user.departmentIds.includes(f.department_id) || !STICKER_SOURCE_MIME.has(f.mime)) {
      throw new BadRequestException('Figurinha não encontrada.');
    }
    return this.sender.sendSticker(
      { conversationId: cv.id, user: { id: user.id, name: user.name }, quotedMessageId: data.quotedMessageId },
      { mediaId: f.id, mime: f.mime, size: Number(f.size) },
    );
  }

  @Post('messages/:id/reaction')
  @HttpCode(200)
  @RequirePermission('chat.send')
  async react(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown) {
    const m = await this.messageOrFail(user, parse(idParam, idRaw));
    const { emoji } = parse(z.object({ emoji: z.string().max(16) }), body);
    if (!m.evolution_instance) throw new ServiceUnavailableException('WhatsApp não configurado.');
    try {
      await this.evolution.sendReaction(
        m.evolution_instance,
        {
          id: m.wa_id,
          remoteJid: m.jid,
          fromMe: toBool(m.from_me),
          ...(toBool(m.is_group) && !toBool(m.from_me) && m.sender_jid ? { participant: m.sender_jid } : {}),
        },
        emoji,
      );
    } catch (err) {
      if (err instanceof EvolutionError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
    if (emoji) {
      await this.chat.db
        .insertInto('message_reactions')
        .values({ message_id: m.id, reactor_jid: 'me', reactor_name: 'Você', emoji, from_me: 1, user_id: user.id })
        .onDuplicateKeyUpdate({ emoji, user_id: user.id })
        .execute();
    } else {
      await this.chat.db.deleteFrom('message_reactions').where('message_id', '=', m.id).where('reactor_jid', '=', 'me').execute();
    }
    await this.events.message(m.department_id, m.id);
    return { ok: true };
  }

  @Post('messages/:id/forward')
  @HttpCode(200)
  @RequirePermission('chat.send')
  async forward(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown) {
    const m = await this.messageOrFail(user, parse(idParam, idRaw));
    const { conversationIds } = parse(z.object({ conversationIds: z.array(z.number().int().positive()).min(1).max(10) }), body);
    if (toBool(m.deleted)) throw new BadRequestException('Mensagem apagada não pode ser encaminhada.');
    const results: Array<{ conversationId: number; ok: boolean; error?: string }> = [];
    for (const cid of [...new Set(conversationIds)]) {
      try {
        await this.conversationOrFail(user, cid);
        const ctx = { conversationId: cid, user: { id: user.id, name: user.name }, forwarded: true };
        if (m.type === 'sticker' && m.media_id && m.media_status === 'ready') {
          await this.sender.sendSticker(ctx, { mediaId: m.media_id, mime: m.media_mime ?? 'image/webp', size: Number(m.media_size ?? 0) });
        } else if (m.media_id && m.media_status === 'ready') {
          await this.sender.sendMedia(
            ctx,
            { mediaId: m.media_id, mime: m.media_mime!, fileName: m.media_name ?? 'arquivo', kind: mediaKind(m.media_mime!), size: Number(m.media_size ?? 0) },
            m.body,
          );
        } else if (m.body) {
          await this.sender.sendText(ctx, m.body);
        } else {
          throw new BadRequestException('Conteúdo indisponível para encaminhar.');
        }
        results.push({ conversationId: cid, ok: true });
      } catch (err) {
        results.push({ conversationId: cid, ok: false, error: (err as Error).message });
      }
    }
    return { results };
  }

  @Delete('messages/:id')
  @RequirePermission('chat.delete')
  async remove(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Req() req: Request) {
    const m = await this.messageOrFail(user, parse(idParam, idRaw));
    if (!toBool(m.from_me)) throw new ForbiddenException('Só é possível apagar mensagens enviadas pelo suporte.');
    if (!m.evolution_instance) throw new ServiceUnavailableException('WhatsApp não configurado.');
    try {
      await this.evolution.deleteForEveryone(m.evolution_instance, { id: m.wa_id, remoteJid: m.jid, fromMe: true });
    } catch (err) {
      if (err instanceof EvolutionError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
    await this.chat.db.updateTable('messages').set({ deleted: 1 }).where('id', '=', m.id).execute();
    await this.events.message(m.department_id, m.id);
    await this.audit.log({ action: 'chat.message.deleted', user, ip: clientIp(req), targetType: 'message', targetId: m.id });
    return { ok: true };
  }

  // ---------------------------------------------------------------- contatos e mídia

  @Patch('contacts/:id')
  @RequirePermission('contact.edit')
  async updateContact(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const data = parse(z.object({ customName: cleanText(150).nullable().optional(), isVip: z.boolean().optional() }), body);
    const c = await this.chat.db.selectFrom('contacts').select(['id', 'department_id', 'is_vip']).where('id', '=', id).executeTakeFirst();
    if (!c || !user.departmentIds.includes(c.department_id)) throw new NotFoundException('Contato não encontrado.');
    await this.chat.db
      .updateTable('contacts')
      .set({
        ...(data.customName !== undefined && { custom_name: data.customName || null }),
        ...(data.isVip !== undefined && { is_vip: data.isVip ? 1 : 0 }),
      })
      .where('id', '=', id)
      .execute();
    if (data.isVip !== undefined && data.isVip !== toBool(c.is_vip)) {
      await this.audit.log({ action: data.isVip ? 'contact.vip.enabled' : 'contact.vip.disabled', user, ip: clientIp(req), targetType: 'contact', targetId: id });
    }
    const conv = await this.chat.db.selectFrom('conversations').select('id').where('contact_id', '=', id).executeTakeFirst();
    if (conv) await this.events.conversation(c.department_id, conv.id);
    return { ok: true };
  }

  @Get('classifications')
  @RequirePermission('chat.read')
  async classifications(@CurrentUser() user: AuthUser, @Query('departmentId') dep: string) {
    const departmentId = parse(idParam, dep);
    if (!user.departmentIds.includes(departmentId)) throw new ForbiddenException('Caixa de entrada não permitida.');
    const rows = await this.chat.db
      .selectFrom('classifications')
      .select(['id', 'menu_number', 'subject_label', 'menu_label', 'is_default'])
      .where('department_id', '=', departmentId)
      .where('active', '=', 1)
      .orderBy('menu_number')
      .execute();
    return rows.map((r) => ({ id: r.id, number: r.menu_number, label: r.subject_label, menuLabel: r.menu_label, isDefault: toBool(r.is_default) }));
  }

  /** Arquivo de uma mensagem. Só exibe dentro da página tipos seguros; o resto é sempre download. */
  @Get('media/:id')
  @RequirePermission('chat.read')
  async media(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Query('download') download: string | undefined, @Res() res: Response) {
    const id = parse(idParam, idRaw);
    const f = await this.chat.db.selectFrom('media_files').selectAll().where('id', '=', id).executeTakeFirst();
    if (!f || f.department_id == null || !user.departmentIds.includes(f.department_id)) throw new NotFoundException('Arquivo não encontrado.');
    const inline = INLINE_MIME.has(f.mime) && download !== '1';
    const name = sanitizeFileName(f.original_name, `arquivo-${f.id}`);
    res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=86400');
    // Caminho gerado internamente por UUID no banco e confinado a MEDIA_DIR por storage.resolve().
    // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile
    res.sendFile(this.storage.resolve(f.storage_path), { acceptRanges: true, headers: {} }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
}
