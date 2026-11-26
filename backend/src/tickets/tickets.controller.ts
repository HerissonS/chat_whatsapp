import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { BotService } from '../bot/bot.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ChatEventsService } from '../chat/chat-events.service.js';
import { ChatRepository } from '../chat/chat.repository.js';
import { type AuthUser, clientIp, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { cleanText, idParam, parse, toBool } from '../common/validation.js';
import { TicketReportService } from '../closure/ticket-report.service.js';
import { Queues } from '../queue/queue.module.js';
import { TicketsService } from './tickets.service.js';

const closeSchema = z.object({
  contract: cleanText(255).pipe(z.string().min(1, 'informe o contrato')),
  equipment: cleanText(100).nullable().optional(),
  classificationId: z.number().int().positive(),
  /** Marcado no encerramento quando o e-mail desse chamado não deve ser enviado. */
  skipEmail: z.boolean().default(false),
});

@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly chat: ChatRepository,
    private readonly tickets: TicketsService,
    private readonly bot: BotService,
    private readonly catalog: CatalogService,
    private readonly report: TicketReportService,
    private readonly events: ChatEventsService,
    private readonly queues: Queues,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Tickets');
  }

  private async ticketOrFail(user: AuthUser, id: number) {
    const t = await this.chat.db
      .selectFrom('tickets as t')
      .innerJoin('conversations as cv', 'cv.id', 't.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .select(['t.id', 't.department_id', 't.conversation_id', 't.status', 't.assignee_id', 'ct.is_group', 'ct.is_vip'])
      .where('t.id', '=', id)
      .executeTakeFirst();
    if (!t || !user.departmentIds.includes(t.department_id)) throw new NotFoundException('Chamado não encontrado.');
    return t;
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('ticket.assign')
  async assign(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const t = await this.ticketOrFail(user, parse(idParam, idRaw));
    const { userId } = parse(z.object({ userId: z.number().int().positive().nullable() }), body);
    if (t.status === 'closed') throw new BadRequestException('Chamado já encerrado.');
    if (userId) {
      const u = await this.chat.db.selectFrom('users').select('id').where('id', '=', userId).where('active', '=', 1).where('organization_id', '=', user.organizationId).executeTakeFirst();
      if (!u) throw new BadRequestException('Usuário inválido.');
    }
    await this.tickets.assign(t.id, userId, user.id);
    await this.events.conversation(t.department_id, t.conversation_id);
    await this.audit.log({ action: 'ticket.assigned', user, ip: clientIp(req), targetType: 'ticket', targetId: t.id, details: { assigneeId: userId } });
    return { ok: true };
  }

  /** Encerramento: fecha o chamado, envia a mensagem de encerramento e enfileira o e-mail com o PDF. */
  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('ticket.close')
  async close(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const t = await this.ticketOrFail(user, parse(idParam, idRaw));
    const data = parse(closeSchema, body);
    const cls = await this.chat.db
      .selectFrom('classifications')
      .select('id')
      .where('id', '=', data.classificationId)
      .where('department_id', '=', t.department_id)
      .executeTakeFirst();
    if (!cls) throw new BadRequestException('Classificação inválida.');
    const contracts = await this.catalog.contracts(user.organizationId, t.department_id);
    if (!contracts.includes(data.contract)) throw new BadRequestException('Contrato não encontrado no catálogo.');
    if (data.equipment) {
      const eq = await this.catalog.equipments(user.organizationId, t.department_id, data.contract);
      if (!eq.some((e) => e.code === data.equipment)) throw new BadRequestException('Equipamento não pertence ao contrato escolhido.');
    }

    const closed = await this.tickets.close(t.id, {
      contract: data.contract,
      equipment: data.equipment || null,
      classificationId: data.classificationId,
      actorId: user.id,
    });
    if (!closed) throw new BadRequestException('Chamado já encerrado.');
    await this.audit.log({ action: 'ticket.closed', user, ip: clientIp(req), targetType: 'ticket', targetId: t.id, details: { contract: data.contract, equipment: data.equipment ?? null, skipEmail: data.skipEmail } });

    // Mensagem de encerramento ao contato (configurável por setor; padrão: só conversas individuais).
    // Contatos VIP não recebem a mensagem automática, assim como não recebem o menu.
    const dept = await this.chat.department(t.department_id);
    const sendClosing = toBool(t.is_vip) ? false : toBool(t.is_group) ? toBool(dept.close_msg_group) : toBool(dept.close_msg_individual);
    if (sendClosing) {
      try {
        await this.bot.sendClosing({ departmentId: t.department_id, conversationId: t.conversation_id, ticketId: t.id });
      } catch (err) {
        this.logger.warn({ ticket_id: t.id, err: (err as Error).message }, 'falha ao enviar a mensagem de encerramento');
      }
    }

    if (data.skipEmail) {
      // O e-mail pode ser enviado depois pelo painel do contato ("Enviar e-mail").
      await this.chat.db.updateTable('tickets').set({ email_status: 'skipped' }).where('id', '=', t.id).execute();
    } else {
      await this.enqueueEmail(t.id, t.department_id);
    }
    await this.events.conversation(t.department_id, t.conversation_id);
    return this.chat.conversationSummary(t.conversation_id);
  }

  private async enqueueEmail(ticketId: number, departmentId: number): Promise<void> {
    const recipients = (await this.chat.db.selectFrom('email_recipients').select('email').where('department_id', '=', departmentId).execute()).map((r) => r.email);
    const r = await this.report.load(ticketId);
    if (!recipients.length) {
      await this.chat.db.insertInto('email_outbox').values({ ticket_id: ticketId, recipients: '[]', subject: r.subject, status: 'failed', last_error: 'Nenhum destinatário configurado (Administração > E-mail).' }).execute();
      await this.chat.db.updateTable('tickets').set({ email_status: 'failed' }).where('id', '=', ticketId).execute();
      this.logger.warn({ ticket_id: ticketId }, 'chamado encerrado sem destinatários de e-mail configurados');
      return;
    }
    const ob = await this.chat.db
      .insertInto('email_outbox')
      .values({ ticket_id: ticketId, recipients: JSON.stringify(recipients), subject: r.subject, status: 'pending' })
      .executeTakeFirstOrThrow();
    await this.chat.db.updateTable('tickets').set({ email_status: 'pending' }).where('id', '=', ticketId).execute();
    await this.queues.email.add('send', { outboxId: Number(ob.insertId) });
  }

  @Post(':id/resend-email')
  @HttpCode(200)
  @RequirePermission('ticket.close')
  async resend(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Req() req: Request) {
    const t = await this.ticketOrFail(user, parse(idParam, idRaw));
    if (t.status !== 'closed') throw new BadRequestException('O chamado ainda não foi encerrado.');
    await this.enqueueEmail(t.id, t.department_id);
    await this.events.conversation(t.department_id, t.conversation_id);
    await this.audit.log({ action: 'ticket.email.resent', user, ip: clientIp(req), targetType: 'ticket', targetId: t.id });
    return { ok: true };
  }

  @Get(':id/pdf')
  @RequirePermission('chat.read')
  async pdf(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Res() res: Response) {
    const t = await this.ticketOrFail(user, parse(idParam, idRaw));
    const r = await this.report.load(t.id);
    const buf = await this.report.pdf(r);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="atendimento_${t.id}_${this.report.ymd(r.closedAt)}.pdf"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buf);
  }

  @Get(':id/subject-preview')
  @RequirePermission('ticket.close')
  async subjectPreview(@CurrentUser() user: AuthUser, @Param('id') idRaw: string) {
    const t = await this.ticketOrFail(user, parse(idParam, idRaw));
    const r = await this.report.load(t.id);
    return { date: this.report.ymd(new Date()), durationText: r.durationText };
  }
}
