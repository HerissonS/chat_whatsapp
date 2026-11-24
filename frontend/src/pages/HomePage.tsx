import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellDot, Clock, Inbox, ListChecks, MailWarning, MessagesSquare, Timer, UserRound, UserX, Users, Zap } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Card, cx, Spinner } from '../components/ui';
import { api, qs } from '../lib/api';
import { useInboxes } from '../lib/inboxes';
import { navigate } from '../lib/router';
import { getSocket } from '../lib/socket';

interface Dashboard {
  days: number;
  now: { openIndividual: number; openGroups: number; awaitingMenu: number; unassigned: number; mine: number; unreadConversations: number };
  period: {
    opened: number;
    openedGroups: number;
    closed: number;
    avgResponseSec: number | null;
    responsesMeasured: number;
    fastResponsePct: number | null;
    fastResponseMinutes: number;
    awaitingFirstResponse: number;
    avgDurationSec: number | null;
    messagesReceived: number;
    messagesSent: number;
    emailFailures: number;
  };
  perDay: Array<{ date: string; opened: number; closed: number }>;
  byClassification: Array<{ label: string; count: number }>;
  byAgent: Array<{ name: string; closed: number; avgResponseSec: number | null }>;
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

/** Cartão de indicador: número em destaque, rótulo e contexto. Clicável quando leva a uma lista. */
function Stat({ icon, label, value, hint, onClick, tone }: { icon: ReactNode; label: string; value: string; hint?: string; onClick?: () => void; tone?: 'warning' }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        'flex flex-col gap-2 rounded-app border border-border/50 bg-surface p-4 text-left shadow-sm transition-colors',
        onClick && 'hover:border-primary/50 hover:bg-primary/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className={cx('flex size-8 items-center justify-center rounded-full', tone === 'warning' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary')}>{icon}</span>
        {label}
      </div>
      <div className="text-3xl font-semibold tracking-tight text-text tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </Tag>
  );
}

/** Barras verticais de uma série (chamados abertos por dia), com dica ao passar o mouse e tabela acessível. */
function DailyBars({ data }: { data: Dashboard['perDay'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.opened));
  const ticks = [max, Math.round(max / 2), 0].filter((v, i, a) => a.indexOf(v) === i);
  const label = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const every = data.length > 10 ? 5 : 1;
  return (
    <div>
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
          <div className="absolute inset-x-0 top-0 bottom-6 flex items-end gap-[2px]" role="img" aria-label="Chamados abertos por dia">
            {data.map((d, i) => (
              <div
                key={d.date}
                className="relative flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className={cx('w-full max-w-10 rounded-t-[4px] transition-opacity', hover != null && hover !== i ? 'opacity-50' : '')}
                  style={{ height: `${(d.opened / max) * 100}%`, minHeight: d.opened ? 2 : 0, background: 'var(--color-primary)' }}
                />
                {hover === i && (
                  <div className="absolute bottom-full z-10 mb-1 rounded-app border border-border/50 bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-text shadow-lg">
                    <div className="font-medium">{label(d.date)}</div>
                    <div>{d.opened} aberto(s) · {d.closed} encerrado(s)</div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex gap-[2px] text-[11px] text-muted" aria-hidden>
            {data.map((d, i) => (
              <span key={d.date} className="flex-1 text-center">
                {i % every === 0 || i === data.length - 1 ? label(d.date) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
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

/** Barras horizontais de uma série (chamados por classificação) com o valor ao lado. */
function ClassBars({ data }: { data: Dashboard['byClassification'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (!data.length) return <p className="text-sm text-muted">Nenhum chamado no período.</p>;
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${d.count}`}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate text-text">{d.label}</span>
            <span className="font-medium text-text tabular-nums">{d.count}</span>
          </div>
          <div className="h-2 rounded-full bg-text/5">
            <div className="h-2 rounded-full" style={{ width: `${(d.count / max) * 100}%`, background: 'var(--color-primary)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
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

  const goTab = (tab: string) => {
    try {
      sessionStorage.setItem('atl-tab', tab);
    } catch {
      /* sem armazenamento */
    }
    navigate('chat');
  };

  const p = data?.period;
  const n = data?.now;
  const periodLabel = days === 1 ? 'hoje' : `nos últimos ${days} dias`;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-text">Olá, {me?.name.split(' ')[0]}</h1>
            <p className="text-sm text-muted">Resumo do atendimento {periodLabel}.</p>
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
          </div>
        </div>

        {isLoading && (
          <div className="flex justify-center p-10">
            <Spinner className="size-8" />
          </div>
        )}

        {n && p && data && (
          <>
            <section>
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Agora</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat icon={<MessagesSquare className="size-4" />} label="Em aberto" value={nf.format(n.openIndividual)} hint="Conversas individuais" onClick={() => goTab('all')} />
                <Stat icon={<Users className="size-4" />} label="Grupos em aberto" value={nf.format(n.openGroups)} onClick={() => goTab('groups')} />
                <Stat icon={<ListChecks className="size-4" />} label="Aguardando menu" value={nf.format(n.awaitingMenu)} onClick={() => goTab('menu')} />
                <Stat icon={<UserX className="size-4" />} label="Sem responsável" value={nf.format(n.unassigned)} onClick={() => goTab('unassigned')} tone={n.unassigned ? 'warning' : undefined} />
                <Stat icon={<UserRound className="size-4" />} label="Minhas" value={nf.format(n.mine)} onClick={() => goTab('mine')} />
                <Stat icon={<BellDot className="size-4" />} label="Não lidas" value={nf.format(n.unreadConversations)} hint="Conversas com mensagens novas" onClick={() => goTab('all')} />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">No período</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat
                  icon={<Clock className="size-4" />}
                  label="Tempo médio de 1ª resposta"
                  value={dur(p.avgResponseSec)}
                  hint={p.responsesMeasured ? `Sem grupos · ${p.responsesMeasured} atendimento(s) medido(s)` : 'Sem grupos · ainda sem respostas no período'}
                />
                <Stat
                  icon={<Zap className="size-4" />}
                  label={`Respondidos em até ${p.fastResponseMinutes} min`}
                  value={p.fastResponsePct == null ? '—' : `${p.fastResponsePct}%`}
                  hint="Do primeiro contato até a resposta de um atendente"
                />
                <Stat icon={<Timer className="size-4" />} label="Duração média" value={dur(p.avgDurationSec)} hint="Da abertura ao encerramento (sem grupos)" />
                <Stat
                  icon={<AlertTriangle className="size-4" />}
                  label="Aguardando 1ª resposta"
                  value={nf.format(p.awaitingFirstResponse)}
                  hint="Chamados abertos sem resposta de atendente"
                  tone={p.awaitingFirstResponse ? 'warning' : undefined}
                />
                <Stat icon={<Inbox className="size-4" />} label="Chamados abertos" value={nf.format(p.opened)} hint={`+ ${nf.format(p.openedGroups)} de grupos`} />
                <Stat icon={<ListChecks className="size-4" />} label="Encerrados" value={nf.format(p.closed)} />
                <Stat
                  icon={<MessagesSquare className="size-4" />}
                  label="Mensagens"
                  value={nf.format(p.messagesReceived + p.messagesSent)}
                  hint={`${nf.format(p.messagesReceived)} recebidas · ${nf.format(p.messagesSent)} enviadas`}
                />
                <Stat
                  icon={<MailWarning className="size-4" />}
                  label="E-mails com falha"
                  value={nf.format(p.emailFailures)}
                  hint={p.emailFailures ? 'Reenvie pelo painel do contato' : 'Todos os encerramentos enviados'}
                  tone={p.emailFailures ? 'warning' : undefined}
                />
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              {days > 1 ? (
                <Card title="Chamados abertos por dia" description="Conversas individuais e grupos. Passe o mouse para ver os encerrados.">
                  <DailyBars data={data.perDay} />
                </Card>
              ) : (
                <Card title="Hoje">
                  <p className="text-sm text-muted">
                    {p.opened + p.openedGroups} chamado(s) aberto(s) e {p.closed} encerrado(s) até agora. Escolha 7 ou 30 dias para ver a evolução.
                  </p>
                </Card>
              )}
              <Card title="Por classificação" description="Chamados abertos no período.">
                <ClassBars data={data.byClassification} />
              </Card>
            </div>

            <Card title="Por atendente" description="Encerramentos no período e tempo médio de primeira resposta dos chamados de cada um.">
              {!data.byAgent.length ? (
                <p className="text-sm text-muted">Nenhum atendimento no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-muted">
                      <tr className="border-b border-border/40">
                        <th className="py-2 pr-3 font-medium">Atendente</th>
                        <th className="py-2 pr-3 text-right font-medium">Encerrados</th>
                        <th className="py-2 text-right font-medium">1ª resposta (média)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byAgent.map((a) => (
                        <tr key={a.name} className="border-b border-border/25 tabular-nums">
                          <td className="py-2 pr-3 text-text">{a.name}</td>
                          <td className="py-2 pr-3 text-right">{nf.format(a.closed)}</td>
                          <td className="py-2 text-right">{dur(a.avgResponseSec)}</td>
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
