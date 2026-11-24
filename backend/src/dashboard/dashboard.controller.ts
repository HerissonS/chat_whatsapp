import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { parse } from '../common/validation.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';

const querySchema = z.object({
  days: z.coerce.number().int().refine((d) => [1, 7, 30].includes(d)).default(7),
  departmentId: z.coerce.number().int().positive().optional(),
});

/** Resposta considerada "rápida" para o indicador de agilidade. */
const FAST_RESPONSE_MIN = 15;

/**
 * Indicadores da tela de Início.
 * Tempo de resposta: do primeiro contato do técnico até a primeira mensagem de um atendente
 * (pelo sistema ou pelo celular), só em conversas individuais iniciadas pelo contato. O bot não conta.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Início do período no fuso configurado: hoje 00:00 (1 dia) ou N-1 dias antes de hoje 00:00. */
  private periodStart(days: number): Date {
    const tz = this.config.APP_TIMEZONE;
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const offsetMs = local.getTime() - now.getTime();
    const startLocal = new Date(local);
    startLocal.setHours(0, 0, 0, 0);
    startLocal.setDate(startLocal.getDate() - (days - 1));
    return new Date(startLocal.getTime() - offsetMs);
  }

  private dayKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.config.APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  @Get()
  @RequirePermission('dashboard.view')
  async get(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const { days, departmentId } = parse(querySchema, query);
    const allowed = departmentId ? [departmentId].filter((d) => user.departmentIds.includes(d)) : user.departmentIds;
    const depts = allowed.length ? allowed : [0];
    const since = this.periodStart(days);

    // ---------------------------------------------------------------- agora
    const now = await this.db
      .selectFrom('tickets as t')
      .innerJoin('conversations as cv', 'cv.id', 't.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .select([
        sql<number>`SUM(ct.is_group = 0)`.as('open_individual'),
        sql<number>`SUM(ct.is_group = 1)`.as('open_groups'),
        sql<number>`SUM(t.status = 'menu')`.as('awaiting_menu'),
        sql<number>`SUM(t.status = 'open' AND t.assignee_id IS NULL)`.as('unassigned'),
        sql<number>`SUM(t.assignee_id = ${user.id})`.as('mine'),
      ])
      .where('t.department_id', 'in', depts)
      .where('t.status', 'in', ['menu', 'open'])
      .executeTakeFirst();
    const unread = await this.db
      .selectFrom('conversations')
      .select(sql<number>`COUNT(*)`.as('n'))
      .where('department_id', 'in', depts)
      .where('unread_count', '>', 0)
      .executeTakeFirst();

    // ---------------------------------------------------------------- período
    const opened = await this.db
      .selectFrom('tickets as t')
      .innerJoin('conversations as cv', 'cv.id', 't.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .leftJoin('classifications as cl', 'cl.id', 't.classification_id')
      .select(['t.id', 't.origin', 't.status', 't.opened_at', 't.assignee_id', 'ct.is_group', 'cl.subject_label'])
      .where('t.department_id', 'in', depts)
      .where('t.opened_at', '>=', since)
      .execute();

    const closed = await this.db
      .selectFrom('tickets as t')
      .innerJoin('conversations as cv', 'cv.id', 't.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .leftJoin('users as u', 'u.id', 't.assignee_id')
      .select(['t.id', 't.opened_at', 't.closed_at', 't.assignee_id', 't.email_status', 'ct.is_group', 'u.name as agent'])
      .where('t.department_id', 'in', depts)
      .where('t.status', '=', 'closed')
      .where('t.closed_at', '>=', since)
      .execute();

    // Tempo até a primeira resposta (individuais iniciados pelo contato).
    const respTickets = opened.filter((t) => t.is_group === 0 && (t.origin === 'inbound' || t.origin === 'vip')).map((t) => t.id);
    const firstIn = new Map<number, number>();
    const responses = new Map<number, number>();
    if (respTickets.length) {
      const ins = await this.db
        .selectFrom('messages')
        .select(['ticket_id', sql<Date>`MIN(wa_timestamp)`.as('first')])
        .where('ticket_id', 'in', respTickets)
        .where('origin', '=', 'contact')
        .groupBy('ticket_id')
        .execute();
      for (const r of ins) firstIn.set(r.ticket_id!, new Date(r.first).getTime());
      const outs = await this.db
        .selectFrom('messages')
        .select(['ticket_id', 'wa_timestamp'])
        .where('ticket_id', 'in', respTickets)
        .where('origin', 'in', ['agent', 'phone'])
        .orderBy('wa_timestamp')
        .execute();
      for (const o of outs) {
        const tid = o.ticket_id!;
        const start = firstIn.get(tid);
        if (start == null || responses.has(tid)) continue;
        const t = o.wa_timestamp.getTime();
        if (t >= start) responses.set(tid, t - start);
      }
    }
    const respValues = [...responses.values()];
    const avgResponseSec = respValues.length ? Math.round(respValues.reduce((a, b) => a + b, 0) / respValues.length / 1000) : null;
    const fastPct = respValues.length ? Math.round((respValues.filter((v) => v <= FAST_RESPONSE_MIN * 60_000).length / respValues.length) * 100) : null;
    const openIds = new Set(opened.filter((t) => t.status !== 'closed').map((t) => t.id));
    const awaitingFirstResponse = respTickets.filter((id) => openIds.has(id) && firstIn.has(id) && !responses.has(id)).length;

    // Duração dos atendimentos encerrados (individuais).
    const closedInd = closed.filter((t) => t.is_group === 0 && t.closed_at);
    const avgDurationSec = closedInd.length
      ? Math.round(closedInd.reduce((a, t) => a + (t.closed_at!.getTime() - t.opened_at.getTime()), 0) / closedInd.length / 1000)
      : null;

    const msgs = await this.db
      .selectFrom('messages')
      .select([sql<number>`SUM(from_me = 0)`.as('received'), sql<number>`SUM(from_me = 1 AND origin <> 'bot')`.as('sent')])
      .where('department_id', 'in', depts)
      .where('wa_timestamp', '>=', since)
      .executeTakeFirst();

    // Chamados abertos por dia (todos os dias do período, inclusive os zerados).
    const perDay: Array<{ date: string; opened: number; closed: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 86_400_000 + 12 * 3600_000);
      perDay.push({ date: this.dayKey(d), opened: 0, closed: 0 });
    }
    const idx = new Map(perDay.map((p, i) => [p.date, i]));
    for (const t of opened) {
      const i = idx.get(this.dayKey(t.opened_at));
      if (i != null) perDay[i].opened++;
    }
    for (const t of closed) {
      const i = idx.get(this.dayKey(t.closed_at!));
      if (i != null) perDay[i].closed++;
    }

    const byClass = new Map<string, number>();
    for (const t of opened) {
      const k = t.subject_label ?? 'Aguardando menu';
      byClass.set(k, (byClass.get(k) ?? 0) + 1);
    }

    // Por atendente: encerrados no período e tempo médio de primeira resposta dos chamados dele.
    const agents = new Map<string, { name: string; closed: number; respSum: number; respN: number }>();
    for (const t of closed) {
      const name = t.agent ?? 'Sem responsável';
      const a = agents.get(name) ?? { name, closed: 0, respSum: 0, respN: 0 };
      a.closed++;
      agents.set(name, a);
    }
    const userNames = new Map(
      (await this.db.selectFrom('users').select(['id', 'name']).where('organization_id', '=', user.organizationId).execute()).map((u) => [u.id, u.name]),
    );
    for (const t of opened) {
      const r = responses.get(t.id);
      if (r == null || !t.assignee_id) continue;
      const name = userNames.get(t.assignee_id) ?? 'Sem responsável';
      const a = agents.get(name) ?? { name, closed: 0, respSum: 0, respN: 0 };
      a.respSum += r;
      a.respN++;
      agents.set(name, a);
    }

    return {
      days,
      since,
      now: {
        openIndividual: Number(now?.open_individual ?? 0),
        openGroups: Number(now?.open_groups ?? 0),
        awaitingMenu: Number(now?.awaiting_menu ?? 0),
        unassigned: Number(now?.unassigned ?? 0),
        mine: Number(now?.mine ?? 0),
        unreadConversations: Number(unread?.n ?? 0),
      },
      period: {
        opened: opened.filter((t) => t.is_group === 0).length,
        openedGroups: opened.filter((t) => t.is_group === 1).length,
        closed: closed.length,
        avgResponseSec,
        responsesMeasured: respValues.length,
        fastResponsePct: fastPct,
        fastResponseMinutes: FAST_RESPONSE_MIN,
        awaitingFirstResponse,
        avgDurationSec,
        messagesReceived: Number(msgs?.received ?? 0),
        messagesSent: Number(msgs?.sent ?? 0),
        emailFailures: closed.filter((t) => t.email_status === 'failed').length,
      },
      perDay,
      byClassification: [...byClass.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      byAgent: [...agents.values()]
        .map((a) => ({ name: a.name, closed: a.closed, avgResponseSec: a.respN ? Math.round(a.respSum / a.respN / 1000) : null }))
        .sort((a, b) => b.closed - a.closed),
    };
  }
}
