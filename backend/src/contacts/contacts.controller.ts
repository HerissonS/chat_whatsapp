import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Kysely } from 'kysely';
import { Inject } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { ChatEventsService } from '../chat/chat-events.service.js';
import { ChatRepository, displayName } from '../chat/chat.repository.js';
import { type AuthUser, clientIp, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { idParam, parse, toBool } from '../common/validation.js';
import { assertInboxAccess } from '../admin/inbox-access.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { EvolutionError } from '../whatsapp/evolution.client.js';
import { avatarState, ContactsService } from './contacts.service.js';

const searchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Agenda de contatos (importados do WhatsApp ou que já conversaram) e fotos de perfil. */
@Controller()
export class ContactsController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly contacts: ContactsService,
    private readonly chat: ChatRepository,
    private readonly events: ChatEventsService,
    private readonly audit: AuditService,
  ) {}

  @Get('contacts')
  @RequirePermission('chat.read')
  async search(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = parse(searchSchema, query);
    const depts = q.departmentId ? [q.departmentId].filter((d) => user.departmentIds.includes(d)) : user.departmentIds;
    if (!depts.length) return [];
    let b = this.db
      .selectFrom('contacts as ct')
      .leftJoin('conversations as cv', 'cv.contact_id', 'ct.id')
      .select([
        'ct.id', 'ct.department_id', 'ct.jid', 'ct.phone', 'ct.push_name', 'ct.custom_name', 'ct.is_group', 'ct.is_vip',
        'ct.avatar_path', 'ct.avatar_checked_at', 'cv.id as conversation_id', 'cv.last_message_at',
      ])
      .where('ct.department_id', 'in', depts);
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
      const digits = q.q.replace(/\D/g, '');
      b = b.where((eb) =>
        eb.or([eb('ct.custom_name', 'like', like), eb('ct.push_name', 'like', like), ...(digits.length >= 3 ? [eb('ct.phone', 'like', `%${digits}%`)] : [])]),
      );
    }
    const rows = await b
      .orderBy('cv.last_message_at', 'desc')
      .orderBy('ct.custom_name')
      .orderBy('ct.push_name')
      .limit(q.limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      departmentId: r.department_id,
      name: displayName(r),
      phone: r.phone,
      isGroup: toBool(r.is_group),
      isVip: toBool(r.is_vip),
      avatar: avatarState(r),
      avatarVersion: r.avatar_checked_at?.getTime() ?? 0,
      conversationId: r.conversation_id,
    }));
  }

  /** Abre (ou cria) a conversa com um contato da agenda. */
  @Post('contacts/:id/open')
  @HttpCode(200)
  @RequirePermission('chat.send')
  async open(@CurrentUser() user: AuthUser, @Param('id') idRaw: string) {
    const id = parse(idParam, idRaw);
    const c = await this.db.selectFrom('contacts').select(['id', 'department_id', 'jid']).where('id', '=', id).executeTakeFirst();
    if (!c || !user.departmentIds.includes(c.department_id)) throw new NotFoundException('Contato não encontrado.');
    const { conversationId } = await this.chat.ensureConversation(c.department_id, c.jid, null);
    await this.events.conversation(c.department_id, conversationId);
    return this.chat.conversationSummary(conversationId);
  }

  /** Foto de perfil (cópia local). 404 quando o contato não tem foto. */
  @Get('contacts/:id/avatar')
  @RequirePermission('chat.read')
  async avatar(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Res() res: Response) {
    const id = parse(idParam, idRaw);
    const c = await this.db.selectFrom('contacts').select(['department_id']).where('id', '=', id).executeTakeFirst();
    if (!c || !user.departmentIds.includes(c.department_id)) throw new NotFoundException();
    const file = await this.contacts.avatarFile(id);
    if (!file) {
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }

  /** Importa os contatos e grupos sincronizados pelo WhatsApp do setor. */
  @Post('admin/whatsapp/:departmentId/import-contacts')
  @HttpCode(200)
  @RequirePermission('admin.whatsapp')
  async importContacts(@CurrentUser() user: AuthUser, @Param('departmentId') idRaw: string, @Req() req: Request) {
    const departmentId = parse(idParam, idRaw);
    const d = await this.db.selectFrom('departments').select(['id', 'organization_id', 'wa_state']).where('id', '=', departmentId).executeTakeFirst();
    if (!d || d.organization_id !== user.organizationId) throw new NotFoundException('Caixa de entrada não encontrada.');
    assertInboxAccess(user, d.id);
    if (d.wa_state !== 'open') throw new ForbiddenException('Conecte o WhatsApp antes de importar os contatos.');
    try {
      const r = await this.contacts.importFromWhatsapp(departmentId);
      await this.audit.log({ action: 'admin.whatsapp.contacts_imported', user, ip: clientIp(req), targetType: 'department', targetId: departmentId, details: r });
      return r;
    } catch (err) {
      if (err instanceof EvolutionError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
  }
}
