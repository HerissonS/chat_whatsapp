import { Bell, Loader2, Plus, Search, Star, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar, Badge, cx, EmptyState, IconButton, Spinner } from '../components/ui';
import { listTime } from '../lib/format';
import { useInboxes } from '../lib/inboxes';
import { navigate } from '../lib/router';
import type { Conversation } from '../lib/types';
import { type Tab, useConversations, useCounts } from './data';

const TABS: Array<{ id: Tab; label: string; count?: 'mine' | 'unassigned' | 'menu' | 'all' }> = [
  { id: 'mine', label: 'Minhas', count: 'mine' },
  { id: 'unassigned', label: 'Não atribuídas', count: 'unassigned' },
  { id: 'menu', label: 'Aguardando menu', count: 'menu' },
  { id: 'all', label: 'Todas', count: 'all' },
  { id: 'groups', label: 'Grupos' },
  { id: 'closed', label: 'Encerradas' },
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

export function ConversationList({ currentId, onNew }: { currentId: number | null; onNew: () => void }) {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('atl-tab') as Tab | null) ?? 'all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const effectiveTab: Tab = dq ? 'everything' : tab;
  const { data: inboxes } = useInboxes();
  const activeInboxes = (inboxes ?? []).filter((i) => i.active);
  const multi = activeInboxes.length > 1;
  const [inbox, setInbox] = useState<number | null>(() => Number(sessionStorage.getItem('atl-inbox')) || null);
  const inboxFilter = multi && inbox && activeInboxes.some((i) => i.id === inbox) ? inbox : null;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useConversations(effectiveTab, dq, inboxFilter);
  const { data: counts } = useCounts(inboxFilter);
  const inboxName = (id: number) => (multi && !inboxFilter ? activeInboxes.find((i) => i.id === id)?.name : undefined);
  const search = useRef<HTMLInputElement>(null);
  const [notifPerm, setNotifPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));

  useEffect(() => {
    try {
      if (inbox) sessionStorage.setItem('atl-inbox', String(inbox));
      else sessionStorage.removeItem('atl-inbox');
    } catch {
      /* sem armazenamento */
    }
  }, [inbox]);

  useEffect(() => {
    try {
      sessionStorage.setItem('atl-tab', tab);
    } catch {
      /* sem armazenamento */
    }
  }, [tab]);

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
        {multi && (
          <select
            value={inboxFilter ?? ''}
            onChange={(e) => setInbox(Number(e.target.value) || null)}
            aria-label="Caixa de entrada"
            className="h-9 w-full rounded-app border border-border/60 bg-background px-3 text-sm text-text focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
          >
            <option value="">Todas as caixas de entrada</option>
            {activeInboxes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.waState !== 'open' ? ' (WhatsApp desconectado)' : ''}
              </option>
            ))}
          </select>
        )}
        <div className="relative">
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
        {!dq && (
          <div className="flex flex-wrap gap-1" role="tablist">
            {TABS.map((t) => {
              const n = t.count ? counts?.[t.count] : undefined;
              return (
                <button
                  key={t.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cx(
                    'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors',
                    tab === t.id ? 'bg-primary text-primary-contrast' : 'bg-text/5 text-muted hover:bg-text/10 hover:text-text',
                  )}
                >
                  {t.label}
                  {!!n && <span className={cx('rounded-full px-1.5 text-[10px]', tab === t.id ? 'bg-white/25' : 'bg-text/10')}>{n}</span>}
                </button>
              );
            })}
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
          <EmptyState title={dq ? 'Nenhuma conversa encontrada' : 'Nada por aqui'} description={dq ? 'Tente outro nome ou número.' : 'Quando chegarem mensagens, elas aparecem nesta lista.'} />
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
