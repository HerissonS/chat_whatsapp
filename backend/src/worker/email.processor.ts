import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ChatEventsService } from '../chat/chat-events.service.js';
import { ChatRepository } from '../chat/chat.repository.js';
import { MailService } from '../closure/mail.service.js';
import { TicketReportService } from '../closure/ticket-report.service.js';

/** Gera o PDF e envia o e-mail de encerramento. Reexecutado pela fila em caso de falha. */
@Injectable()
export class EmailProcessor {
  constructor(
    private readonly chat: ChatRepository,
    private readonly report: TicketReportService,
    private readonly mail: MailService,
    private readonly events: ChatEventsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('EmailOutbox');
  }

  async process(outboxId: number, isLastAttempt: boolean): Promise<void> {
    const ob = await this.chat.db.selectFrom('email_outbox').selectAll().where('id', '=', outboxId).executeTakeFirst();
    if (!ob || ob.status === 'sent') return;
    const recipients = JSON.parse(ob.recipients) as string[];
    await this.chat.db.updateTable('email_outbox').set({ attempts: ob.attempts + 1, status: 'sending' }).where('id', '=', ob.id).execute();
    try {
      const r = await this.report.load(ob.ticket_id);
      const pdf = await this.report.pdf(r);
      await this.mail.send({
        to: recipients,
        subject: ob.subject,
        text: this.report.emailText(r),
        html: await this.report.emailHtml(r),
        attachments: [{ filename: `atendimento_${r.ticketId}_${this.report.ymd(r.closedAt)}.pdf`, content: pdf, contentType: 'application/pdf' }],
      });
      await this.chat.db.updateTable('email_outbox').set({ status: 'sent', sent_at: new Date(), last_error: null }).where('id', '=', ob.id).execute();
      await this.chat.db.updateTable('tickets').set({ email_status: 'sent' }).where('id', '=', ob.ticket_id).execute();
      this.logger.info({ ticket_id: ob.ticket_id, outbox_id: ob.id }, 'e-mail de encerramento enviado');
      await this.events.conversation(r.departmentId, r.conversationId);
    } catch (err) {
      const message = (err as Error).message.slice(0, 480);
      const status = isLastAttempt ? 'failed' : 'retrying';
      await this.chat.db.updateTable('email_outbox').set({ status, last_error: message }).where('id', '=', ob.id).execute();
      await this.chat.db.updateTable('tickets').set({ email_status: status }).where('id', '=', ob.ticket_id).execute();
      this.logger.warn({ ticket_id: ob.ticket_id, outbox_id: ob.id, err: message, last_attempt: isLastAttempt }, 'falha no envio do e-mail');
      const t = await this.chat.db.selectFrom('tickets').select(['department_id', 'conversation_id']).where('id', '=', ob.ticket_id).executeTakeFirst();
      if (t) await this.events.conversation(t.department_id, t.conversation_id);
      throw err;
    }
  }
}
