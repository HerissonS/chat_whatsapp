import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCheck,
  Clock,
  Hourglass,
  Inbox,
  ListChecks,
  MailWarning,
  Maximize,
  MessageCircleQuestion,
  Minimize,
  Target,
  Timer,
  Headset,
} from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, cx, Spinner } from '../components/ui';
import { api, qs } from '../lib/api';
import { useInboxes } from '../lib/inboxes';
import { navigate } from '../lib/router';
import { getSocket } from '../lib/socket';
import { type ListFilters, loadListFilters, saveListFilters } from '../chat/data';

type Tone = 'ok' | 'warning' | 'danger';

interface Dashboard {
  days: number;
  settings: { targetMinutes: number | null; businessHours: 'all' | 'some' | 'none' };
  now: {
    waiting: number;
    longestWaitSec: number | null;
    waitingTone: Tone | null;
    awaitingMenu: number;
    inService: number;
    olderThan24h: number;
  };
  period: {
    opened: number;
    openedPrev: number;
    closed: number;
    closedPrev: number;
    avgResponseSec: number | null;
    responseTone: Tone | null;
    responsesMeasured: number;
    onTargetPct: number | null;
    avgDurationSec: number | null;
    emailFailures: number;
  };
  perDay: Array<{ date: string; opened: number; closed: number }>;
  byHour: number[];
  byClassification: Array<{ label: string; count: number }>;
  topContracts: Array<{ label: string; count: number }>;
  topEquipment: Array<{ label: string; count: number }>;
  byAgent: Array<{ name: string; inService: number; closed: number; avgResponseSec: number | null; avgDurationSec: number | null }>;
}

const PERIODS = [
  { d: 1, label: 'Hoje' },
  { d: 7, label: '7 dias' },
  { d: 30, label: '30 dias' },
];

/** Duração legível: 45 s, 3 min, 1 h 20 min. */
function dur(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

const nf = new Intl.NumberFormat('pt-BR');

const TONE_STYLE: Record<Tone, { icon: string; border: string; label: string }> = {
  ok: { icon: 'bg-success/15 text-success', border: 'border-l-success', label: 'Dentro da meta' },
  warning: { icon: 'bg-warning/15 text-warning', border: 'border-l-warning', label: 'Perto da meta' },
  danger: { icon: 'bg-danger/12 text-danger', border: 'border-l-danger', label: 'Acima da meta' },
};

/** Cartão de indicador: número em destaque, rótulo e contexto. Clicável quando leva a uma lista. */
function Stat({
  icon,
  label,
  value,
  hint,
  onClick,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: ReactNode;
  onClick?: () => void;
  tone?: Tone | null;
}) {
  const Tag = onClick ? 'button' : 'div';
  const t = tone ? TONE_STYLE[tone] : null;
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={t?.label}
      className={cx(
        'flex flex-col gap-2 rounded-app border border-border/50 bg-surface p-4 text-left shadow-sm transition-colors',
        t && `border-l-4 ${t.border}`,
        onClick && 'hover:border-primary/50 hover:bg-primary/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-full', t ? t.icon : 'bg-primary/10 text-primary')}>{icon}</span>
        {label}
      </div>
      <div className="text-3xl font-semibold tracking-tight text-text tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </Tag>
  );
}

/** Variação em relação ao período anterior equivalente. */
function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0) return <>{cur ? 'Sem registros no período anterior' : 'Igual ao período anterior'}</>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <>Igual ao período anterior ({nf.format(prev)})</>;
  return (
    <>
      <span className="font-medium text-text">
        {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%
      </span>{' '}
      vs. período anterior ({nf.format(prev)})
    </>
  );
}

interface BarItem {
  key: string;
  tick: string;
  showTick: boolean;
  values: number[];
  tooltip: ReactNode;
}

/** Barras verticais (uma ou mais séries lado a lado), com dica ao passar o mouse. */
function VBars({ items, colors, label }: { items: BarItem[]; colors: string[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.flatMap((d) => d.values));
  const ticks = [max, Math.round(max / 2), 0].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className="relative flex h-48 gap-3">
      <div className="flex flex-col justify-between pb-6 text-right text-xs text-muted tabular-nums" aria-hidden>
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between" aria-hidden>
          {ticks.map((t) => (
            <div key={t} className="border-t border-border/30" />
          ))}
        </div>
        <div className="absolute inset-x-0 top-0 bottom-6 flex items-end gap-[3px]" role="img" aria-label={label}>
          {items.map((d, i) => (
            <div
              key={d.key}
              className={cx('relative flex h-full flex-1 items-end justify-center gap-px transition-opacity', hover != null && hover !== i && 'opacity-50')}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {d.values.map((v, s) => (
                <div
                  key={s}
                  className="w-full max-w-6 rounded-t-[3px]"
                  style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0, background: colors[s] }}
                />
              ))}
              {hover === i && (
                <div className="absolute bottom-full z-10 mb-1 rounded-app border border-border/50 bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-text shadow-lg">
                  {d.tooltip}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex gap-[3px] text-[11px] text-muted" aria-hidden>
          {items.map((d) => (
            <span key={d.key} className="flex-1 text-center whitespace-nowrap">
              {d.showTick ? d.tick : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const OPENED_COLOR = 'var(--color-primary)';
const CLOSED_COLOR = 'color-mix(in srgb, var(--color-primary) 40%, transparent)';

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
      {items.map(([name, color]) => (
        <span key={name} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: color }} />
          {name}
        </span>
      ))}
    </div>
  );
}

function DailyChart({ data }: { data: Dashboard['perDay'] }) {
  const label = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const every = data.length > 10 ? 5 : 1;
  return (
    <div>
      <Legend items={[['Abertos', OPENED_COLOR], ['Encerrados', CLOSED_COLOR]]} />
      <VBars
        label="Chamados abertos e encerrados por dia"
        colors={[OPENED_COLOR, CLOSED_COLOR]}
        items={data.map((d, i) => ({
          key: d.date,
          tick: label(d.date),
          showTick: i % every === 0 || i === data.length - 1,
          values: [d.opened, d.closed],
          tooltip: (
            <>
              <div className="font-medium">{label(d.date)}</div>
              <div>
                {d.opened} aberto(s) · {d.closed} encerrado(s)
              </div>
            </>
          ),
        }))}
      />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted hover:text-text">Ver como tabela</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 font-medium">Dia</th>
              <th className="py-1 font-medium">Abertos</th>
              <th className="py-1 font-medium">Encerrados</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date} className="border-t border-border/25 tabular-nums">
                <td className="py-1">{label(d.date)}</td>
                <td className="py-1">{d.opened}</td>
                <td className="py-1">{d.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function HourChart({ data }: { data: number[] }) {
  if (!data.some(Boolean)) return <p className="text-sm text-muted">Nenhum chamado no período.</p>;
  return (
    <VBars
      label="Chamados abertos por hora do dia"
      colors={[OPENED_COLOR]}
      items={data.map((n, h) => ({
        key: String(h),
        tick: `${h}h`,
        showTick: h % 3 === 0,
        values: [n],
        tooltip: (
          <>
            <div className="font-medium">
              {String(h).padStart(2, '0')}:00 – {String(h).padStart(2, '0')}:59
            </div>
            <div>{n} chamado(s)</div>
          </>
        ),
      }))}
    />
  );
}

/** Barras horizontais com o valor ao lado (classificação, contratos, equipamentos). */
function HBars({ data, empty }: { data: Array<{ label: string; count: number }>; empty: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (!data.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${d.count}`}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate text-text">{d.label}</span>
            <span className="font-medium text-text tabular-nums">{d.count}</span>
          </div>
          <div className="h-2 rounded-full bg-text/5">
            <div className="h-2 rounded-full" style={{ width: `${(d.count / max) * 100}%`, background: OPENED_COLOR }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Tela cheia para deixar o painel em uma TV ou monitor da equipe. */
function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [ref]);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.().catch(() => undefined);
  };
  return { on, toggle, supported: typeof document !== 'undefined' && !!document.fullscreenEnabled };
}

export function HomePage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [days, setDays] = useState(() => Number(sessionStorage.getItem('atl-dash-days')) || 7);
  const { data: inboxes } = useInboxes();
  const activeInboxes = (inboxes ?? []).filter((i) => i.active);
  const [inbox, setInbox] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', days, inbox],
    queryFn: () => api.get<Dashboard>(`dashboard${qs({ days, departmentId: inbox })}`),
    refetchInterval: 60_000,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const fs = useFullscreen(root);

  useEffect(() => {
    try {
      sessionStorage.setItem('atl-dash-days', String(days));
    } catch {
      /* sem armazenamento */
    }
  }, [days]);

  // Atualiza quando algo muda nas conversas (com intervalo, para não sobrecarregar).
  useEffect(() => {
    const s = getSocket();
    const on = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      }, 5000);
    };
    s.on('conversation:upsert', on);
    return () => {
      s.off('conversation:upsert', on);
    };
  }, [qc]);

  /** Abre o Atendimento com os filtros correspondentes ao cartão clicado. */
  const goTab = (queue: ListFilters['queue']) => {
    if (document.fullscreenElement) void document.exitFullscreen();
    saveListFilters({ ...loadListFilters(), status: 'open', queue, type: 'contacts', inbox });
    navigate('chat');
  };

  const p = data?.period;
  const n = data?.now;
  const s = data?.settings;
  const periodLabel = days === 1 ? 'hoje' : `nos últimos ${days} dias`;
  const inboxName = inbox ? activeInboxes.find((i) => i.id === inbox)?.name : null;
  const targetLabel = s?.targetMinutes ? `meta de ${s.targetMinutes} min` : 'meta de cada caixa';
  const timeBasis =
    s?.businessHours === 'all'
      ? 'Tempos em horário de funcionamento.'
      : s?.businessHours === 'some'
        ? 'Tempos em horário de funcionamento (tempo corrido nas caixas sem horário definido).'
        : 'Tempos corridos: defina o horário de funcionamento em Administração > Caixas de entrada.';

  return (
    <div ref={root} className="h-full overflow-y-auto bg-background" style={fs.on ? { zoom: 1.15 } : undefined}>
      <div className={cx('mx-auto space-y-6 p-4 sm:p-6', fs.on ? 'max-w-none' : 'max-w-6xl')}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-text">{fs.on ? `Atendimento${inboxName ? ` · ${inboxName}` : ''}` : `Olá, ${me?.name.split(' ')[0]}`}</h1>
            <p className="text-sm text-muted">
              Conversas com contatos {periodLabel} (grupos e contatos VIP não entram nos indicadores). {timeBasis}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeInboxes.length > 1 && (
              <select
                value={inbox ?? ''}
                onChange={(e) => setInbox(Number(e.target.value) || null)}
                aria-label="Caixa de entrada"
                className="h-10 rounded-app border border-border/50 bg-surface px-3 text-sm text-text focus:border-primary focus:outline-none"
              >
                <option value="">Todas as caixas de entrada</option>
                {activeInboxes.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
            <div className="flex rounded-app border border-border/50 bg-surface p-0.5" role="radiogroup" aria-label="Período">
              {PERIODS.map((o) => (
                <button
                  key={o.d}
                  type="button"
                  role="radio"
                  aria-checked={days === o.d}
                  onClick={() => setDays(o.d)}
                  className={cx('rounded px-3 py-1.5 text-sm', days === o.d ? 'bg-primary text-primary-contrast' : 'text-muted hover:text-text')}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {fs.supported && (
              <Button variant="secondary" onClick={fs.toggle} icon={fs.on ? <Minimize className="size-4" /> : <Maximize className="size-4" />}>
                {fs.on ? 'Sair da tela cheia' : 'Tela cheia'}
              </Button>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="flex justify-center p-10">
            <Spinner className="size-8" />
          </div>
        )}

        {n && p && data && (
          <>
            {p.emailFailures > 0 && (
              <div role="alert" className="flex items-start gap-3 rounded-app border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text">
                <MailWarning className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  <strong>{nf.format(p.emailFailures)}</strong> e-mail(s) de encerramento {periodLabel} não foram enviados. Reenvie pelo painel do contato, em
                  Chamados anteriores.
                </span>
              </div>
            )}

            <section>
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Agora</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat
                  icon={<MessageCircleQuestion className="size-4" />}
                  label="Aguardando resposta"
                  value={nf.format(n.waiting)}
                  hint={n.waiting ? `Maior espera: ${dur(n.longestWaitSec)} (${targetLabel})` : 'Nenhum contato esperando'}
                  tone={n.waitingTone}
                  onClick={() => goTab('waiting')}
                />
                <Stat icon={<ListChecks className="size-4" />} label="Aguardando menu" value={nf.format(n.awaitingMenu)} hint="Ainda não escolheram a opção" onClick={() => goTab('menu')} />
                <Stat icon={<Headset className="size-4" />} label="Em atendimento" value={nf.format(n.inService)} hint="Chamados abertos com contatos" onClick={() => goTab('all')} />
                <Stat
                  icon={<Hourglass className="size-4" />}
                  label="Abertos há mais de 24 h"
                  value={nf.format(n.olderThan24h)}
                  hint="Chamados que precisam de atenção"
                  tone={n.olderThan24h ? 'danger' : null}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">No período</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <Stat icon={<Inbox className="size-4" />} label="Chamados abertos" value={nf.format(p.opened)} hint={<Delta cur={p.opened} prev={p.openedPrev} />} />
                <Stat icon={<CheckCheck className="size-4" />} label="Encerrados" value={nf.format(p.closed)} hint={<Delta cur={p.closed} prev={p.closedPrev} />} />
                <Stat
                  icon={<Clock className="size-4" />}
                  label="1ª resposta (média)"
                  value={dur(p.avgResponseSec)}
                  hint={p.responsesMeasured ? `${p.responsesMeasured} atendimento(s) medido(s) · ${targetLabel}` : 'Ainda sem respostas no período'}
                  tone={p.responseTone}
                />
                <Stat
                  icon={<Target className="size-4" />}
                  label="Respondidos na meta"
                  value={p.onTargetPct == null ? '—' : `${p.onTargetPct}%`}
                  hint={`1ª resposta dentro da ${targetLabel}`}
                />
                <Stat icon={<Timer className="size-4" />} label="Duração média" value={dur(p.avgDurationSec)} hint="Da abertura ao encerramento" />
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              {days > 1 ? (
                <Card title="Abertos e encerrados por dia" description="Se os encerrados ficam abaixo dos abertos, a fila está crescendo.">
                  <DailyChart data={data.perDay} />
                </Card>
              ) : (
                <Card title="Chamados por hora" description="Abertos hoje, por hora de chegada.">
                  <HourChart data={data.byHour} />
                </Card>
              )}
              <Card title="Por classificação" description="Chamados abertos no período.">
                <HBars data={data.byClassification} empty="Nenhum chamado no período." />
              </Card>
            </div>

            <div className={cx('grid gap-6', days > 1 ? 'lg:grid-cols-[2fr_1fr_1fr]' : 'md:grid-cols-2')}>
              {days > 1 && (
                <Card title="Chamados por hora do dia" description="Horários de maior procura no período, para planejar a escala.">
                  <HourChart data={data.byHour} />
                </Card>
              )}
              <Card title="Contratos com mais chamados" description="Encerrados no período.">
                <HBars data={data.topContracts} empty="Nenhum encerramento no período." />
              </Card>
              <Card title="Equipamentos com mais chamados" description="Encerrados no período.">
                <HBars data={data.topEquipment} empty="Nenhum equipamento informado no período." />
              </Card>
            </div>

            <Card title="Por atendente" description="Chamados em atendimento agora, encerramentos no período e tempos médios dos chamados de cada um.">
              {!data.byAgent.length ? (
                <p className="text-sm text-muted">Nenhum atendimento no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-muted">
                      <tr className="border-b border-border/40">
                        <th className="py-2 pr-3 font-medium">Atendente</th>
                        <th className="py-2 pr-3 text-right font-medium">Em atendimento</th>
                        <th className="py-2 pr-3 text-right font-medium">Encerrados</th>
                        <th className="py-2 pr-3 text-right font-medium">1ª resposta (média)</th>
                        <th className="py-2 text-right font-medium">Duração (média)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byAgent.map((a) => (
                        <tr key={a.name} className="border-b border-border/25 tabular-nums">
                          <td className="py-2 pr-3 text-text">{a.name}</td>
                          <td className="py-2 pr-3 text-right">{nf.format(a.inService)}</td>
                          <td className="py-2 pr-3 text-right">{nf.format(a.closed)}</td>
                          <td className="py-2 pr-3 text-right">{dur(a.avgResponseSec)}</td>
                          <td className="py-2 text-right">{dur(a.avgDurationSec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
