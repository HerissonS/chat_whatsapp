import { Bell, Loader2, Plus, Search, SlidersHorizontal, Star, Users, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Badge, cx, EmptyState, IconButton, Spinner } from '../components/ui';
import { listTime } from '../lib/format';
import { useInboxes } from '../lib/inboxes';
import { navigate } from '../lib/router';
import type { Conversation } from '../lib/types';
import { type ListFilters, loadListFilters, saveListFilters, useConversations, useCounts } from './data';

const STATUS: Array<{ id: ListFilters['status']; label: string }> = [
  { id: 'open', label: 'Abertas' },
  { id: 'closed', label: 'Encerradas' },
  { id: 'all', label: 'Todas' },
];

const QUEUES: Array<{ id: ListFilters['queue']; label: string; count: 'all' | 'mine' | 'waiting' | 'unassigned' | 'menu' }> = [
  { id: 'all', label: 'Todas as abertas', count: 'all' },
  { id: 'mine', label: 'Minhas', count: 'mine' },
  { id: 'waiting', label: 'Aguardando resposta', count: 'waiting' },
  { id: 'unassigned', label: 'Sem responsável', count: 'unassigned' },
  { id: 'menu', label: 'Aguardando menu', count: 'menu' },
];

const TYPES: Array<{ id: ListFilters['type']; label: string; chip?: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'contacts', label: 'Contatos', chip: 'Só contatos' },
  { id: 'groups', label: 'Grupos', chip: 'Só grupos' },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Item({ c, active, inboxName }: { c: Conversation; active: boolean; inboxName?: string }) {
  const t = c.ticket;
  const open = t && t.status !== 'closed';
  return (
    <button
      type="button"
      onClick={() => navigate(`chat/${c.id}`)}
      className={cx(
        'flex w-full items-start gap-3 border-b border-border/25 px-4 py-3 text-left transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-text/[0.035]',
      )}
      aria-current={active ? 'true' : undefined}
    >
      <Avatar name={c.contact.name} group={c.contact.isGroup} size={44} contact={c.contact} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {c.contact.isGroup && <Users className="size-3.5 shrink-0 text-muted" aria-label="Grupo" />}
          <span className={cx('truncate text-sm text-text', c.unreadCount ? 'font-semibold' : 'font-medium')}>{c.contact.name}</span>
          {c.contact.isVip && <Star className="size-3.5 shrink-0 fill-warning text-warning" aria-label="VIP" />}
          <span className={cx('ml-auto shrink-0 text-xs', c.unreadCount ? 'font-semibold text-primary' : 'text-muted')}>{listTime(c.lastMessageAt)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className={cx('min-w-0 flex-1 truncate text-sm', c.unreadCount ? 'text-text' : 'text-muted')}>
            {c.lastMessageFromMe && <span className="text-muted">Você: </span>}
            {c.lastMessagePreview ?? 'Nova conversa'}
          </p>
          {c.unreadCount > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-contrast">
              {c.unreadCount > 99 ? '99+' : c.unreadCount}
            </span>
          )}
        </div>
        {(open || inboxName) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {inboxName && <Badge>{inboxName}</Badge>}
            {open && (t.status === 'menu' ? <Badge tone="warning">Aguardando menu</Badge> : <Badge tone="primary">{t.classificationLabel ?? 'Aberto'}</Badge>)}
            {open && <span className="truncate text-xs text-muted">{t.assigneeName ?? 'Sem responsável'}</span>}
          </div>
        )}
      </div>
    </button>
  );
}

/** Painel de filtros (caixa de entrada e tipo), aberto pelo botão "Filtros". */
function FiltersPanel({
  filters,
  setFilters,
  inboxes,
  onClose,
}: {
  filters: ListFilters;
  setFilters: (f: ListFilters) => void;
  inboxes: Array<{ id: number; name: string; waState: string }>;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-filters-toggle]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={panel} role="dialog" aria-label="Filtros" className="absolute top-full right-0 z-30 mt-1 w-72 space-y-4 rounded-app border border-border/50 bg-surface p-4 shadow-xl">
      {inboxes.length > 1 && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted">Caixa de entrada</span>
          <select
            value={filters.inbox ?? ''}
            onChange={(e) => setFilters({ ...filters, inbox: Number(e.target.value) || null })}
            className="h-9 w-full rounded-app border border-border/60 bg-background px-3 text-sm text-text focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
          >
            <option value="">Todas as caixas de entrada</option>
            {inboxes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.waState !== 'open' ? ' (WhatsApp desconectado)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted">Tipo</span>
        <div className="flex rounded-app border border-border/50 bg-background p-0.5" role="radiogroup" aria-label="Tipo de conversa">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={filters.type === t.id}
              onClick={() => setFilters({ ...filters, type: t.id })}
              className={cx('flex-1 rounded px-2 py-1 text-xs font-medium', filters.type === t.id ? 'bg-primary text-primary-contrast' : 'text-muted hover:text-text')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-between gap-2">
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setFilters({ ...filters, inbox: null, type: 'all' })}>
          Limpar filtros
        </button>
        <button type="button" className="text-xs text-muted hover:text-text" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}

export function ConversationList({ currentId, onNew }: { currentId: number | null; onNew: () => void }) {
  const [filters, setFiltersState] = useState<ListFilters>(loadListFilters);
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState(false);
  const dq = useDebounced(q.trim(), 300);
  const { data: inboxes } = useInboxes();
  const activeInboxes = (inboxes ?? []).filter((i) => i.active);
  const multi = activeInboxes.length > 1;
  // Caixa guardada que deixou de existir (ou ficou inativa) é ignorada.
  const inboxFilter = multi && filters.inbox && activeInboxes.some((i) => i.id === filters.inbox) ? filters.inbox : null;
  const effective: ListFilters = { ...filters, inbox: inboxFilter };
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useConversations(effective, dq);
  const { data: counts } = useCounts(inboxFilter, filters.type);
  const inboxName = (id: number) => (multi && !inboxFilter ? activeInboxes.find((i) => i.id === id)?.name : undefined);
  const search = useRef<HTMLInputElement>(null);
  const [notifPerm, setNotifPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));

  const setFilters = (f: ListFilters) => {
    setFiltersState(f);
    saveListFilters(f);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const chips: Array<{ label: string; clear: () => void }> = [];
  if (inboxFilter) chips.push({ label: activeInboxes.find((i) => i.id === inboxFilter)?.name ?? 'Caixa', clear: () => setFilters({ ...filters, inbox: null }) });
  const typeChip = TYPES.find((t) => t.id === filters.type)?.chip;
  if (typeChip) chips.push({ label: typeChip, clear: () => setFilters({ ...filters, type: 'all' }) });
  const n = (k: (typeof QUEUES)[number]['count']) => counts?.[k] ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border/40 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-text">Atendimentos</h1>
          <div className="flex items-center gap-1">
            {notifPerm === 'default' && (
              <IconButton label="Ativar notificações do navegador" onClick={() => void Notification.requestPermission().then(setNotifPerm)}>
                <Bell className="size-4.5" />
              </IconButton>
            )}
            <IconButton label="Nova conversa" onClick={onNew} className="bg-primary text-primary-contrast hover:bg-primary-hover hover:text-primary-contrast">
              <Plus className="size-5" />
            </IconButton>
          </div>
        </div>
        <div className="relative flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar nome ou telefone (Ctrl+K)"
              aria-label="Buscar conversa"
              className="h-9 w-full rounded-app border border-border/60 bg-background pr-3 pl-9 text-sm text-text placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
            />
          </div>
          <button
            type="button"
            data-filters-toggle
            onClick={() => setPanel((p) => !p)}
            aria-expanded={panel}
            aria-label={chips.length ? `Filtros (${chips.length} ativo${chips.length > 1 ? 's' : ''})` : 'Filtros'}
            title="Filtros"
            className={cx(
              'relative flex size-9 shrink-0 items-center justify-center rounded-app border text-muted transition-colors hover:text-text',
              panel || chips.length ? 'border-primary/60 text-primary' : 'border-border/60',
            )}
          >
            <SlidersHorizontal className="size-4" />
            {chips.length > 0 && <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-surface" />}
          </button>
          {panel && <FiltersPanel filters={effective} setFilters={setFilters} inboxes={activeInboxes} onClose={() => setPanel(false)} />}
        </div>

        {dq ? (
          <p className="text-xs text-muted">
            Buscando em todas as conversas{inboxFilter ? ' desta caixa de entrada' : ''}.
          </p>
        ) : (
          <>
            <div className="flex rounded-app border border-border/50 bg-background p-0.5" role="tablist" aria-label="Situação">
              {STATUS.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  role="tab"
                  aria-selected={filters.status === st.id}
                  onClick={() => setFilters({ ...filters, status: st.id })}
                  className={cx(
                    'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium',
                    filters.status === st.id ? 'bg-primary text-primary-contrast' : 'text-muted hover:text-text',
                  )}
                >
                  {st.label}
                  {st.id === 'open' && n('all') > 0 && (
                    <span className={cx('rounded-full px-1.5 text-[10px]', filters.status === 'open' ? 'bg-white/25' : 'bg-text/10')}>{n('all')}</span>
                  )}
                </button>
              ))}
            </div>
            {filters.status === 'open' && (
              <select
                value={filters.queue}
                onChange={(e) => setFilters({ ...filters, queue: e.target.value as ListFilters['queue'] })}
                aria-label="Fila"
                className="h-9 w-full rounded-app border border-border/60 bg-background px-3 text-sm text-text focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
              >
                {QUEUES.map((qu) => (
                  <option key={qu.id} value={qu.id}>
                    {qu.label} ({n(qu.count)})
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={c.clear}
                aria-label={`Remover filtro ${c.label}`}
                className="flex items-center gap-1 rounded-full bg-primary/12 py-0.5 pr-1.5 pl-2.5 text-xs font-medium text-primary hover:bg-primary/20"
              >
                {c.label}
                <X className="size-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        )}
        {!isLoading && !items.length && (
          <EmptyState title={dq ? 'Nenhuma conversa encontrada' : 'Nada por aqui'} description={dq ? 'Tente outro nome ou número.' : 'Nenhuma conversa com esses filtros.'} />
        )}
        {items.map((c) => (
          <Item key={c.id} c={c} active={c.id === currentId} inboxName={inboxName(c.departmentId)} />
        ))}
        {hasNextPage && (
          <button type="button" onClick={() => void fetchNextPage()} className="flex w-full items-center justify-center gap-2 py-3 text-sm text-primary hover:underline">
            {isFetchingNextPage && <Loader2 className="size-4 animate-spin" />} Carregar mais
          </button>
        )}
      </div>
    </div>
  );
}
