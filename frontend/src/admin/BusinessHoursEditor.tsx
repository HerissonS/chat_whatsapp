import { Copy } from 'lucide-react';
import { Button, cx, Input, Switch, SwitchRow } from '../components/ui';
import type { BusinessDay, BusinessHours } from './shared';

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
/** Ordem de exibição: segunda a domingo. */
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY: BusinessDay = { open: '08:00', close: '18:00', lunchStart: '12:00', lunchEnd: '13:00' };

/** Sugestão ao ligar: segunda a sexta, 08:00–18:00, almoço 12:00–13:00. */
export function defaultBusinessHours(): BusinessHours {
  return { days: [null, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, WEEKDAY, null].map((d) => (d ? { ...d } : null)) };
}

const min = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const valid = (s: string | null) => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Mesmo critério do backend; devolve a mensagem do primeiro problema do dia. */
export function dayError(d: BusinessDay): string | null {
  if (!valid(d.open) || !valid(d.close)) return 'Informe abertura e fechamento.';
  if (min(d.close) <= min(d.open)) return 'O fechamento deve ser depois da abertura.';
  const hasStart = !!d.lunchStart;
  const hasEnd = !!d.lunchEnd;
  if (hasStart !== hasEnd) return 'Informe início e fim do almoço, ou deixe os dois vazios.';
  if (hasStart && hasEnd) {
    if (!valid(d.lunchStart) || !valid(d.lunchEnd)) return 'Horário de almoço inválido.';
    const a = min(d.lunchStart!);
    const b = min(d.lunchEnd!);
    if (b <= a || a <= min(d.open) || b >= min(d.close)) return 'O almoço deve ficar dentro do expediente.';
  }
  return null;
}

export function businessHoursError(h: BusinessHours | null): string | null {
  if (!h) return null;
  if (!h.days.some(Boolean)) return 'Marque ao menos um dia de funcionamento.';
  for (const i of ORDER) {
    const d = h.days[i];
    const e = d && dayError(d);
    if (e) return `${DAY_NAMES[i]}: ${e}`;
  }
  return null;
}

function TimeInput({ value, onChange, label }: { value: string | null; onChange: (v: string | null) => void; label: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <Input type="time" step={60} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className="h-9 px-2" />
    </label>
  );
}

/** Horário de funcionamento por dia da semana, com almoço. null = tempo corrido (24 h). */
export function BusinessHoursEditor({ value, onChange }: { value: BusinessHours | null; onChange: (v: BusinessHours | null) => void }) {
  const setDay = (i: number, d: BusinessDay | null) => value && onChange({ days: value.days.map((x, j) => (j === i ? d : x)) });
  const copyMonday = () => {
    const mon = value?.days[1];
    if (!value || !mon) return;
    onChange({ days: value.days.map((x, j) => (j >= 2 && j <= 5 ? { ...mon } : x)) });
  };

  return (
    <div className="rounded-app border border-border/40 px-4">
      <SwitchRow
        label="Horário de funcionamento"
        description="Os tempos dos indicadores do Início (1ª resposta, espera e duração) contam só dentro deste horário, descontando o almoço. Desligado: tempo corrido (24 h)."
        checked={!!value}
        onChange={(on) => onChange(on ? defaultBusinessHours() : null)}
      />
      {value && (
        <div className="space-y-2 border-t border-border/40 py-3">
          {ORDER.map((i) => {
            const d = value.days[i];
            const err = d && dayError(d);
            return (
              <div key={i} className={cx('rounded-app p-2', err && 'bg-danger/5')}>
                <div className="flex items-center gap-3">
                  <Switch checked={!!d} onChange={(on) => setDay(i, on ? { ...(value.days[1] ?? WEEKDAY) } : null)} label={`${DAY_NAMES[i]} aberto`} />
                  <span className="w-20 text-sm font-medium text-text">{DAY_NAMES[i]}</span>
                  {!d && <span className="text-xs text-muted">Fechado</span>}
                  {i === 1 && d && (
                    <Button variant="secondary" size="sm" className="ml-auto" icon={<Copy className="size-3.5" />} onClick={copyMonday}>
                      Copiar para terça a sexta
                    </Button>
                  )}
                </div>
                {d && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <TimeInput label="Abre" value={d.open} onChange={(v) => setDay(i, { ...d, open: v ?? '' })} />
                    <TimeInput label="Fecha" value={d.close} onChange={(v) => setDay(i, { ...d, close: v ?? '' })} />
                    <TimeInput label="Almoço de (opcional)" value={d.lunchStart} onChange={(v) => setDay(i, { ...d, lunchStart: v })} />
                    <TimeInput label="Almoço até" value={d.lunchEnd} onChange={(v) => setDay(i, { ...d, lunchEnd: v })} />
                  </div>
                )}
                {err && <p className="mt-1 text-xs text-danger">{err}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
