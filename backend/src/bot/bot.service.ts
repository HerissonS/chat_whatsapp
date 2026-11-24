import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PinoLogger } from 'nestjs-pino';
import { MessageSenderService } from '../chat/message-sender.service.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import type { BotAction } from '../tickets/tickets.service.js';

/** Mensagens automáticas: menu, opção inválida, confirmação e encerramento. Textos editáveis por setor. */
@Injectable()
export class BotService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly sender: MessageSenderService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Bot');
  }

  private async template(departmentId: number, key: string): Promise<string> {
    const r = await this.db
      .selectFrom('bot_templates')
      .select('body')
      .where('department_id', '=', departmentId)
      .where('template_key', '=', key)
      .executeTakeFirst();
    return r?.body ?? '';
  }

  async menuText(departmentId: number, invalid: boolean): Promise<string> {
    const options = await this.db
      .selectFrom('classifications')
      .select(['menu_number', 'menu_label'])
      .where('department_id', '=', departmentId)
      .where('active', '=', 1)
      .orderBy('menu_number')
      .execute();
    const header = await this.template(departmentId, invalid ? 'menu_invalid' : 'menu_header');
    return [header, ...options.map((o) => `${o.menu_number} - ${o.menu_label}`)].join('\n\n');
  }

  async run(action: BotAction, p: { departmentId: number; conversationId: number; ticketId: number }): Promise<void> {
    if (!action) return;
    try {
      const text =
        action.kind === 'menu'
          ? await this.menuText(p.departmentId, action.invalid)
          : await this.template(p.departmentId, 'confirmation');
      if (!text.trim()) return;
      await this.sender.sendText({ conversationId: p.conversationId, user: null, ticketId: p.ticketId }, text);
    } catch (err) {
      // Falha do bot não pode travar a fila de eventos: registra e segue.
      this.logger.error({ err: (err as Error).message, conversation_id: p.conversationId, action: action.kind }, 'falha ao enviar mensagem do bot');
    }
  }

  async sendClosing(p: { departmentId: number; conversationId: number; ticketId: number }): Promise<void> {
    const text = await this.template(p.departmentId, 'closing');
    if (!text.trim()) return;
    await this.sender.sendText({ conversationId: p.conversationId, user: null, ticketId: p.ticketId }, text);
  }
}
