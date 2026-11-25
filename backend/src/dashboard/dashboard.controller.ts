import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import { awaitingReplySql } from '../chat/waiting.js';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { parse } from '../common/validation.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { type BusinessHours, businessMs, parseBusinessHours, slaTone } from './business-hours.js';

const querySchema = z.object({
  days: z.coerce.number().int().refine((d) => [1, 7, 30].includes(d)).default(7),
  departmentId: z.coerce.number().int().positive().optional(),
});

const DAY = 86_400_000;
const TONE_RANK = { ok: 0, warning: 1, danger: 2 } as const;
type Tone = keyof typeof TONE_RANK;

const avg = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length / 1000) : null);

/** Os N itens mais frequentes (ignorando vazios). */
function top(values: Array<string | null>, n: number) {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = v?.trim();
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n);
}

/**
 * Indicadores da tela de Início (gestão à vista).
 * - Só conversas com contatos: grupos e contatos VIP (conversas permanentes, que não são
 *   encerradas: gerência, outros setores, robôs de alerta) ficam fora de todos os números.
 * - Tempos (1ª resposta, espera, duração) contam só dentro do horário de funcionamento
 *   da caixa de entrada, descontando o almoço. Sem horário definido, contam o tempo corrido.
 * - 1ª resposta: do primeiro contato do técnico até a primeira mensagem de um atendente
 *   (pelo sistema ou pelo celular). O bot não conta.
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

  private hourOf(d: Date): number {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: this.config.APP_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(d));
  }

  @Get()
  @RequirePermission('dashboard.view')
  async get(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const { days, departmentId } = parse(querySchema, query);
    const tz = this.config.APP_TIMEZONE;
    const allowed = departmentId ? [departmentId].filter((d) => user.departmentIds.includes(d)) : user.departmentIds;
    const depts = allowed.length ? allowed : [0];
    const since = this.periodStart(days);
    const nowMs = Date.now();

    // Meta e horário de funcionamento de cada caixa.
    const deptRows = await this.db
      .selectFrom('departments')
      .select(['id', 'response_target_minutes', 'business_hours'])
      .where('id', 'in', depts)
      .execute();
    const cfg = new Map<number, { target: number; hours: BusinessHours | null }>(
      deptRows.map((d) => [d.id, { target: d.response_target_minutes, hours: parseBusinessHours(d.business_hours) }]),
    );
    const hoursOf = (deptId: number) => cfg.get(deptId)?.hours ?? null;
    const targetOf = (deptId: number) => cfg.get(deptId)?.target ?? 15;
    const work = (deptId: number, from: number, to: number) => businessMs(from, to, hoursOf(deptId), tz);
    const targets = [...new Set(deptRows.map((d) => d.response_target_minutes))];
    const withHours = deptRows.filter((d) => parseBusinessHours(d.business_hours)).length;

    // ---------------------------------------------------------------- agora
    const openNow = await this.db
      .selectFrom('tickets as t')
      .innerJoin('conversations as cv', 'cv.id', 't.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .select(['t.id', 't.department_id', 't.status', 't.assignee_id', 't.opened_at', awaitingReplySql.as('waiting')])
      .where('t.department_id', 'in', depts)
      .where('t.status', 'in', ['menu', 'open'])
      .where('ct.is_group', '=', 0)
      .where('ct.is_vip', '=', 0)
      .execute();

    // Início da espera: primeira mensagem do contato depois da última resposta de um atendente.
    const waitingIds = openNow.filter((t) => Number(t.waiting) === 1).map((t) => t.id);
    const waitStart = new Map<number, number>();
    if (waitingIds.length) {
      const rows = await this.db
        .selectFrom('messages as m')
        .select(['m.ticket_id', sql<Date>`MIN(m.wa_timestamp)`.as('start')])
        .where('m.ticket_id', 'in', waitingIds)
        .where('m.origin', '=', 'contact')
        .where(
          sql<boolean>`m.wa_timestamp > COALESCE((SELECT MAX(r.wa_timestamp) FROM messages r WHERE r.ticket_id = m.ticket_id AND r.origin IN ('agent', 'phone')), '1000-01-01')`,
        )
        .groupBy('m.ticket_id')
        .execute();
      for (const r of rows) waitStart.set(r.ticket_id!, new Date(r.start).getTime());
    }
    let longestWaitMs = 0;
    let waitingTone: Tone = 'ok';
    for (const t of openNow) {
      const start = waitStart.get(t.id);
      if (start == null) continue;
      const ms = work(t.department_id, start, nowMs);
      longestWaitMs = Math.max(longestWaitMs, ms);
      const tone = slaTone(ms, targetOf(t.department_id));
      if (TONE_RANK[tone] > TONE_RANK[waitingTone]) waitingTone = tone;
    }

    // ---------------------------------------------------------------- período
    const opened = await this.db
      .selectFrom('tickets as t')
      .innerJoin('conversations as cv', 'cv.id', 't.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .leftJoin('classifications as cl', 'cl.id', 't.classification_id')
      .select(['t.id', 't.department_id', 't.origin', 't.opened_at', 't.assignee_id', 'cl.subject_label'])
      .where('t.department_id', 'in', depts)
      .where('ct.is_group', '=', 0)
      .where('ct.is_vip', '=', 0)
      .where('t.opened_at', '>=', since)
      .execute();

    const closed = await this.db
      .selectFrom('tickets as t')
      .innerJoin('conversations as cv', 'cv.id', 't.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .select(['t.id', 't.department_id', 't.opened_at', 't.closed_at', 't.assignee_id', 't.email_status', 't.contract', 't.equipment'])
      .where('t.department_id', 'in', depts)
      .where('ct.is_group', '=', 0)
      .where('ct.is_vip', '=', 0)
      .where('t.status', '=', 'closed')
      .where('t.closed_at', '>=', since)
      .execute();

    // Período anterior equivalente (mesma duração decorrida), para comparação.
    const shift = days * DAY;
    const prevFrom = new Date(since.getTime() - shift);
    const prevTo = new Date(nowMs - shift);
    const prev = await this.db
      .selectFrom('tickets as t')
      .innerJoin('conversations as cv', 'cv.id', 't.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .select([
        sql<number>`SUM(t.opened_at >= ${prevFrom} AND t.opened_at < ${prevTo})`.as('opened'),
        sql<number>`SUM(t.status = 'closed' AND t.closed_at >= ${prevFrom} AND t.closed_at < ${prevTo})`.as('closed'),
      ])
      .where('t.department_id', 'in', depts)
      .where('ct.is_group', '=', 0)
      .where('ct.is_vip', '=', 0)
      .where((eb) => eb.or([eb('t.opened_at', '>=', prevFrom), eb('t.closed_at', '>=', prevFrom)]))
      .executeTakeFirst();

    // Tempo útil até a primeira resposta (chamados iniciados pelo contato).
    const respTickets = opened.filter((t) => t.origin === 'inbound' || t.origin === 'vip');
    const responses = new Map<number, number>();
    if (respTickets.length) {
      const ids = respTickets.map((t) => t.id);
      const firstIn = new Map<number, number>();
      const ins = await this.db
        .selectFrom('messages')
        .select(['ticket_id', sql<Date>`MIN(wa_timestamp)`.as('first')])
        .where('ticket_id', 'in', ids)
        .where('origin', '=', 'contact')
        .groupBy('ticket_id')
        .execute();
      for (const r of ins) firstIn.set(r.ticket_id!, new Date(r.first).getTime());
      const firstOut = new Map<number, number>();
      const outs = await this.db
        .selectFrom('messages')
        .select(['ticket_id', 'wa_timestamp'])
        .where('ticket_id', 'in', ids)
        .where('origin', 'in', ['agent', 'phone'])
        .orderBy('wa_timestamp')
        .execute();
      for (const o of outs) {
        const tid = o.ticket_id!;
        const start = firstIn.get(tid);
        const at = o.wa_timestamp.getTime();
        if (start != null && at >= start && !firstOut.has(tid)) firstOut.set(tid, at);
      }
      for (const t of respTickets) {
        const a = firstIn.get(t.id);
        const b = firstOut.get(t.id);
        if (a != null && b != null) responses.set(t.id, work(t.department_id, a, b));
      }
    }
    const deptOfOpened = new Map(opened.map((t) => [t.id, t.department_id]));
    const respValues = [...responses.values()];
    const onTarget = [...responses.entries()].filter(([id, ms]) => ms <= targetOf(deptOfOpened.get(id)!) * 60_000).length;
    const avgResponseSec = avg(respValues);
    const durations = new Map(closed.map((t) => [t.id, work(t.department_id, t.opened_at.getTime(), t.closed_at!.getTime())]));

    // Abertos e encerrados por dia (todos os dias do período, inclusive os zerados).
    const perDay: Array<{ date: string; opened: number; closed: number }> = [];
    for (let i = 0; i < days; i++) perDay.push({ date: this.dayKey(new Date(since.getTime() + i * DAY + 12 * 3600_000)), opened: 0, closed: 0 });
    const idx = new Map(perDay.map((p, i) => [p.date, i]));
    for (const t of opened) {
      const i = idx.get(this.dayKey(t.opened_at));
      if (i != null) perDay[i].opened++;
    }
    for (const t of closed) {
      const i = idx.get(this.dayKey(t.closed_at!));
      if (i != null) perDay[i].closed++;
    }

    const byHour = Array.from({ length: 24 }, () => 0);
    for (const t of opened) byHour[this.hourOf(t.opened_at)]++;

    // Por atendente: em atendimento agora, encerrados, 1ª resposta e duração médias.
    const agentIds = new Set<number>();
    for (const t of [...openNow, ...opened, ...closed]) if (t.assignee_id) agentIds.add(t.assignee_id);
    const names = new Map<number, string>();
    if (agentIds.size) {
      const rows = await this.db.selectFrom('users').select(['id', 'name']).where('id', 'in', [...agentIds]).execute();
      for (const u of rows) names.set(u.id, u.name);
    }
    type Agg = { id: number; inService: number; closed: number; resp: number[]; dur: number[] };
    const agents = new Map<number, Agg>();
    const agg = (id: number) => {
      let a = agents.get(id);
      if (!a) agents.set(id, (a = { id, inService: 0, closed: 0, resp: [], dur: [] }));
      return a;
    };
    for (const t of openNow) if (t.assignee_id && t.status === 'open') agg(t.assignee_id).inService++;
    for (const t of closed) {
      const a = agg(t.assignee_id ?? 0);
      a.closed++;
      a.dur.push(durations.get(t.id)!);
    }
    for (const t of opened) {
      const r = responses.get(t.id);
      if (r != null && t.assignee_id) agg(t.assignee_id).resp.push(r);
    }

    const byClass = new Map<string, number>();
    for (const t of opened) {
      const k = t.subject_label ?? 'Aguardando menu';
      byClass.set(k, (byClass.get(k) ?? 0) + 1);
    }

    const uniformTarget = targets.length === 1 ? targets[0] : null;
    return {
      days,
      since,
      settings: {
        /** Meta comum às caixas selecionadas; null quando as caixas têm metas diferentes. */
        targetMinutes: uniformTarget,
        /** Quantas das caixas selecionadas têm horário de funcionamento definido. */
        businessHours: withHours === 0 ? 'none' : withHours === deptRows.length ? 'all' : 'some',
      },
      now: {
        waiting: waitingIds.length,
        longestWaitSec: waitingIds.length ? Math.round(longestWaitMs / 1000) : null,
        waitingTone: waitingIds.length ? waitingTone : null,
        awaitingMenu: openNow.filter((t) => t.status === 'menu').length,
        inService: openNow.filter((t) => t.status === 'open').length,
        olderThan24h: openNow.filter((t) => nowMs - t.opened_at.getTime() > DAY).length,
      },
      period: {
        opened: opened.length,
        openedPrev: Number(prev?.opened ?? 0),
        closed: closed.length,
        closedPrev: Number(prev?.closed ?? 0),
        avgResponseSec,
        responseTone: avgResponseSec != null && uniformTarget ? slaTone(avgResponseSec * 1000, uniformTarget) : null,
        responsesMeasured: respValues.length,
        onTargetPct: respValues.length ? Math.round((onTarget / respValues.length) * 100) : null,
        avgDurationSec: avg([...durations.values()]),
        emailFailures: closed.filter((t) => t.email_status === 'failed').length,
      },
      perDay,
      byHour,
      byClassification: [...byClass.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      topContracts: top(closed.map((t) => t.contract), 5),
      topEquipment: top(closed.map((t) => t.equipment), 5),
      byAgent: [...agents.values()]
        .map((a) => ({
          name: a.id ? (names.get(a.id) ?? 'Usuário removido') : 'Sem responsável',
          inService: a.inService,
          closed: a.closed,
          avgResponseSec: avg(a.resp),
          avgDurationSec: avg(a.dur),
        }))
        .sort((a, b) => b.closed - a.closed || b.inService - a.inService || a.name.localeCompare(b.name)),
    };
  }
}
