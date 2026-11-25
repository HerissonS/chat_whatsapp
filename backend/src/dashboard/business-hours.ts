import { z } from 'zod';

/**
 * Horário de funcionamento de uma caixa de entrada.
 * Os tempos dos indicadores (1ª resposta, espera, duração) contam só dentro desse horário,
 * descontando o almoço. Sem horário definido (null), conta o tempo corrido (24 h).
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM.');

export const daySchema = z
  .object({
    open: hhmm,
    close: hhmm,
    lunchStart: hhmm.nullable(),
    lunchEnd: hhmm.nullable(),
  })
  .superRefine((d, ctx) => {
    const m = toMin;
    if (m(d.close) <= m(d.open)) ctx.addIssue({ code: 'custom', message: 'O fechamento deve ser depois da abertura.' });
    if ((d.lunchStart == null) !== (d.lunchEnd == null)) {
      ctx.addIssue({ code: 'custom', message: 'Informe início e fim do almoço, ou deixe os dois vazios.' });
    } else if (d.lunchStart && d.lunchEnd) {
      if (m(d.lunchEnd) <= m(d.lunchStart) || m(d.lunchStart) <= m(d.open) || m(d.lunchEnd) >= m(d.close)) {
        ctx.addIssue({ code: 'custom', message: 'O almoço deve ficar dentro do expediente.' });
      }
    }
  });

/** Índice 0 = domingo … 6 = sábado. null = dia sem expediente. */
export const businessHoursSchema = z.object({ days: z.array(daySchema.nullable()).length(7) });

export type BusinessDay = z.infer<typeof daySchema>;
export type BusinessHours = z.infer<typeof businessHoursSchema>;

function toMin(s: string): number {
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}

/** Lê o JSON gravado no banco; valor inválido ou vazio vira null (24 h). */
export function parseBusinessHours(raw: string | null | undefined): BusinessHours | null {
  if (!raw) return null;
  try {
    const r = businessHoursSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Intervalos de trabalho de um dia, em minutos desde 00:00. */
function workIntervals(d: BusinessDay): Array<[number, number]> {
  const open = toMin(d.open);
  const close = toMin(d.close);
  if (d.lunchStart && d.lunchEnd) return [[open, toMin(d.lunchStart)], [toMin(d.lunchEnd), close]];
  return [[open, close]];
}

/** Diferença (ms) entre a hora local no fuso e o UTC, no instante dado. */
function tzOffsetMs(instant: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Instante UTC de uma data/hora local (dia contado em UTC a partir de 1970, minutos do dia). */
function localToInstant(dayUtc: number, minutes: number, tz: string): number {
  const guess = dayUtc + minutes * 60_000;
  const first = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(first, tz);
}

/** Meia-noite (como UTC) do dia local em que o instante cai. */
function localDayStart(instant: number, tz: string): number {
  const local = instant + tzOffsetMs(instant, tz);
  return Math.floor(local / 86_400_000) * 86_400_000;
}

/**
 * Tempo útil (ms) entre dois instantes: só o que cai dentro do horário de funcionamento.
 * Sem horário definido, devolve o tempo corrido.
 */
export function businessMs(startMs: number, endMs: number, hours: BusinessHours | null, tz: string): number {
  if (endMs <= startMs) return 0;
  if (!hours) return endMs - startMs;
  let total = 0;
  // Limite de segurança: no máximo ~2 anos de dias percorridos.
  const lastDay = localDayStart(endMs, tz);
  for (let day = localDayStart(startMs, tz), n = 0; day <= lastDay && n < 800; day += 86_400_000, n++) {
    const d = hours.days[new Date(day).getUTCDay()];
    if (!d) continue;
    for (const [a, b] of workIntervals(d)) {
      const from = Math.max(startMs, localToInstant(day, a, tz));
      const to = Math.min(endMs, localToInstant(day, b, tz));
      if (to > from) total += to - from;
    }
  }
  return total;
}

/** Faixa do semáforo: verde abaixo de 2/3 da meta, amarelo até a meta, vermelho acima. */
export function slaTone(ms: number, targetMinutes: number): 'ok' | 'warning' | 'danger' {
  const target = targetMinutes * 60_000;
  if (ms > target) return 'danger';
  if (ms >= (target * 2) / 3) return 'warning';
  return 'ok';
}
