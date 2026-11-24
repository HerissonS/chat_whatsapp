import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql, type Transaction } from 'kysely';
import { ChatRepository } from '../chat/chat.repository.js';
import { toBool } from '../common/validation.js';
import { DB } from '../database/database.module.js';
import type { Database, TicketOrigin, TicketStatus } from '../database/schema.js';

type Trx = Transaction<Database>;

/** Número escolhido no menu ("2", "2 - ...", "2.", " 2 "). Retorna null se a resposta não começa com um número. */
export function parseMenuChoice(text: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2})(?:\s|[-.)]|$)/.exec(text ?? '');
  return m ? Number(m[1]) : null;
}

/** O que o bot deve responder depois de uma mensagem recebida. */
export type BotAction =
  | { kind: 'menu'; invalid: boolean }
  | { kind: 'confirmation' }
  | null;

/**
 * Regras do chamado (seção 7.3 do plano):
 * - contato individual sem chamado aberto → AGUARDANDO_MENU + menu (exceto VIP ou menu desligado);
 * - resposta válida → classifica e ABERTO; inválida → reenvia o menu, até o limite;
 * - grupos, VIP e conversas iniciadas por nós → ABERTO como classificação padrão, sem menu;
 * - atendente respondendo durante o menu → bot para, ABERTO como padrão;
 * - primeiro atendente que responde vira o responsável.
 * Todas as funções recebem a transação que já travou a conversa (SELECT ... FOR UPDATE).
 */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly chat: ChatRepository,
  ) {}

  async addEvent(db: Trx | Kysely<Database>, ticketId: number, type: string, userId: number | null, data?: Record<string, unknown>) {
    await db
      .insertInto('ticket_events')
      .values({ ticket_id: ticketId, type, user_id: userId, data: data ? JSON.stringify(data) : null })
      .execute();
  }

  private async create(
    trx: Trx,
    conv: { id: number; department_id: number },
    p: { status: TicketStatus; origin: TicketOrigin; classificationId: number | null; openedAt: Date; userId?: number | null },
  ): Promise<number> {
    const r = await trx
      .insertInto('tickets')
      .values({
        department_id: conv.department_id,
        conversation_id: conv.id,
        status: p.status,
        origin: p.origin,
        classification_id: p.classificationId,
        assignee_id: p.userId ?? null,
        opened_at: p.openedAt,
      })
      .executeTakeFirstOrThrow();
    const ticketId = Number(r.insertId);
    await trx.updateTable('conversations').set({ open_ticket_id: ticketId }).where('id', '=', conv.id).execute();
    await this.addEvent(trx, ticketId, 'created', p.userId ?? null, { status: p.status, origin: p.origin });
    if (p.userId) await this.addEvent(trx, ticketId, 'assigned', p.userId, { assigneeId: p.userId, auto: true });
    return ticketId;
  }

  /** Mensagem recebida do contato. Retorna o chamado e a ação do bot. */
  async onIncoming(
    trx: Trx,
    conversationId: number,
    msg: { type: string; body: string | null; at: Date },
  ): Promise<{ ticketId: number; action: BotAction }> {
    const conv = await this.chat.lockConversation(trx, conversationId);
    const dept = await trx.selectFrom('departments').selectAll().where('id', '=', conv.department_id).executeTakeFirstOrThrow();
    const defaultClass = await this.chat.defaultClassificationId(trx, conv.department_id);

    if (!conv.open_ticket_id) {
      if (toBool(conv.is_group)) {
        const id = await this.create(trx, conv, { status: 'open', origin: 'group', classificationId: defaultClass, openedAt: msg.at });
        return { ticketId: id, action: null };
      }
      if (toBool(conv.is_vip) || !toBool(dept.menu_enabled)) {
        const id = await this.create(trx, conv, {
          status: 'open',
          origin: toBool(conv.is_vip) ? 'vip' : 'inbound',
          classificationId: defaultClass,
          openedAt: msg.at,
        });
        return { ticketId: id, action: null };
      }
      const id = await this.create(trx, conv, { status: 'menu', origin: 'inbound', classificationId: null, openedAt: msg.at });
      return { ticketId: id, action: { kind: 'menu', invalid: false } };
    }

    const ticket = await trx.selectFrom('tickets').selectAll().where('id', '=', conv.open_ticket_id).forUpdate().executeTakeFirstOrThrow();
    if (ticket.status !== 'menu') return { ticketId: ticket.id, action: null };

    // Aguardando a escolha do menu: só respostas em texto contam como tentativa.
    if (msg.type !== 'text' || !msg.body) return { ticketId: ticket.id, action: null };
    const choice = parseMenuChoice(msg.body);
    if (choice != null) {
      const cls = await trx
        .selectFrom('classifications')
        .select(['id', 'subject_label'])
        .where('department_id', '=', conv.department_id)
        .where('menu_number', '=', choice)
        .where('active', '=', 1)
        .executeTakeFirst();
      if (cls) {
        await trx.updateTable('tickets').set({ status: 'open', classification_id: cls.id }).where('id', '=', ticket.id).execute();
        await this.addEvent(trx, ticket.id, 'classified', null, { classificationId: cls.id, by: 'menu' });
        return { ticketId: ticket.id, action: { kind: 'confirmation' } };
      }
    }

    const attempts = ticket.menu_attempts + 1;
    if (attempts >= dept.menu_max_invalid) {
      await trx
        .updateTable('tickets')
        .set({ status: 'open', classification_id: defaultClass, menu_attempts: attempts })
        .where('id', '=', ticket.id)
        .execute();
      await this.addEvent(trx, ticket.id, 'classified', null, { classificationId: defaultClass, by: 'menu_attempts_exceeded' });
      return { ticketId: ticket.id, action: { kind: 'confirmation' } };
    }
    await trx.updateTable('tickets').set({ menu_attempts: attempts }).where('id', '=', ticket.id).execute();
    return { ticketId: ticket.id, action: { kind: 'menu', invalid: true } };
  }

  /**
   * Mensagem enviada por nós (sistema ou celular). Cria o chamado se não houver
   * e encerra a etapa de menu. userId = null quando veio do celular.
   */
  async onOutgoing(trx: Trx, conversationId: number, userId: number | null, at: Date): Promise<number> {
    const conv = await this.chat.lockConversation(trx, conversationId);
    const defaultClass = await this.chat.defaultClassificationId(trx, conv.department_id);

    if (!conv.open_ticket_id) {
      return this.create(trx, conv, {
        status: 'open',
        origin: toBool(conv.is_group) ? 'group' : 'outbound',
        classificationId: defaultClass,
        openedAt: at,
        userId,
      });
    }

    const ticket = await trx.selectFrom('tickets').selectAll().where('id', '=', conv.open_ticket_id).forUpdate().executeTakeFirstOrThrow();
    if (ticket.status === 'menu') {
      await trx
        .updateTable('tickets')
        .set({ status: 'open', classification_id: ticket.classification_id ?? defaultClass })
        .where('id', '=', ticket.id)
        .execute();
      await this.addEvent(trx, ticket.id, 'classified', userId, { classificationId: defaultClass, by: 'agent_reply' });
    }
    if (userId && !ticket.assignee_id) {
      await trx.updateTable('tickets').set({ assignee_id: userId }).where('id', '=', ticket.id).execute();
      await this.addEvent(trx, ticket.id, 'assigned', userId, { assigneeId: userId, auto: true });
    }
    return ticket.id;
  }

  async assign(ticketId: number, assigneeId: number | null, actorId: number): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('tickets').set({ assignee_id: assigneeId }).where('id', '=', ticketId).where('status', '!=', 'closed').execute();
      await this.addEvent(trx, ticketId, assigneeId ? 'assigned' : 'unassigned', actorId, { assigneeId });
    });
  }

  /** Encerra o chamado. Retorna false se ele já estava encerrado. */
  async close(
    ticketId: number,
    p: { contract: string; equipment: string | null; classificationId: number; actorId: number },
  ): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const t = await trx.selectFrom('tickets').selectAll().where('id', '=', ticketId).forUpdate().executeTakeFirstOrThrow();
      if (t.status === 'closed') return false;
      await trx
        .updateTable('tickets')
        .set({
          status: 'closed',
          closed_at: new Date(),
          closed_by: p.actorId,
          contract: p.contract,
          equipment: p.equipment,
          classification_id: p.classificationId,
          assignee_id: t.assignee_id ?? p.actorId,
          email_status: 'pending',
        })
        .where('id', '=', ticketId)
        .execute();
      await trx
        .updateTable('conversations')
        .set({ open_ticket_id: null })
        .where('id', '=', t.conversation_id)
        .where('open_ticket_id', '=', ticketId)
        .execute();
      if (!t.assignee_id) await this.addEvent(trx, ticketId, 'assigned', p.actorId, { assigneeId: p.actorId, auto: true });
      if (p.classificationId !== t.classification_id) {
        await this.addEvent(trx, ticketId, 'classified', p.actorId, { classificationId: p.classificationId, by: 'close' });
      }
      await this.addEvent(trx, ticketId, 'closed', p.actorId, { contract: p.contract, equipment: p.equipment });
      return true;
    });
  }

  /** Primeira mensagem do chamado (para a duração do atendimento). */
  async firstMessageAt(ticketId: number): Promise<Date | null> {
    const r = await this.db
      .selectFrom('messages')
      .select(sql<Date>`MIN(wa_timestamp)`.as('first'))
      .where('ticket_id', '=', ticketId)
      .executeTakeFirst();
    return r?.first ?? null;
  }
}
