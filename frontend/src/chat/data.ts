import { type InfiniteData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, qs } from '../lib/api';
import { getSocket } from '../lib/socket';
import { playSound } from '../lib/sound';
import type { Classification, Conversation, Message, SimpleUser, TicketHistoryItem } from '../lib/types';

/** Filtros da lista de conversas. */
export interface ListFilters {
  /** Situação: abertas, encerradas ou todas. */
  status: 'open' | 'closed' | 'all';
  /** Fila dentro das abertas. */
  queue: 'all' | 'mine' | 'waiting' | 'unassigned' | 'menu';
  /** Contatos, grupos ou ambos. */
  type: 'all' | 'contacts' | 'groups';
  /** Caixa de entrada (null = todas). */
  inbox: number | null;
}

export const DEFAULT_FILTERS: ListFilters = { status: 'open', queue: 'all', type: 'all', inbox: null };
const FILTERS_KEY = 'atl-list';

export function loadListFilters(): ListFilters {
  try {
    const v = JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? 'null') as Partial<ListFilters> | null;
    return { ...DEFAULT_FILTERS, ...(v ?? {}) };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function saveListFilters(f: ListFilters) {
  try {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* sem armazenamento */
  }
}

interface ConvPage {
  items: Conversation[];
  hasMore: boolean;
}
interface MsgPage {
  items: Message[];
  hasMore: boolean;
}

const PAGE = 40;

/** Lista paginada. Com busca (q), o backend procura em todas as conversas, só respeitando a caixa. */
export function useConversations(f: ListFilters, q: string) {
  const params = { status: f.status, queue: f.status === 'open' ? f.queue : 'all', type: f.type, departmentId: f.inbox };
  return useInfiniteQuery({
    queryKey: ['conversations', q ? { departmentId: f.inbox } : params, q],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<ConvPage>(`conversations${qs({ ...params, q, offset: pageParam, limit: PAGE })}`),
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * PAGE : undefined),
    staleTime: 15_000,
  });
}

export function useCounts(departmentId: number | null, type: ListFilters['type']) {
  return useQuery({
    queryKey: ['conversation-counts', departmentId, type],
    queryFn: () => api.get<{ mine: number; waiting: number; unassigned: number; menu: number; all: number; unread: number }>(`conversations/counts${qs({ departmentId, type })}`),
    staleTime: 10_000,
  });
}

export function useConversation(id: number | null) {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<Conversation & { history: TicketHistoryItem[] }>(`conversations/${id}`),
    enabled: !!id,
  });
}

export function useMessages(conversationId: number | null) {
  return useInfiniteQuery({
    queryKey: ['messages', conversationId],
    initialPageParam: 0 as number,
    queryFn: ({ pageParam }) => api.get<MsgPage>(`conversations/${conversationId}/messages${qs({ beforeId: pageParam || undefined, limit: 50 })}`),
    getNextPageParam: (last) => (last.hasMore && last.items.length ? last.items[0].id : undefined),
    enabled: !!conversationId,
    staleTime: Infinity,
  });
}

export function flattenMessages(data: InfiniteData<MsgPage> | undefined): Message[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((p) => p.items);
}

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => api.get<SimpleUser[]>('users'), staleTime: 5 * 60_000 });
}

export function useClassifications(departmentId: number | undefined) {
  return useQuery({
    queryKey: ['classifications', departmentId],
    queryFn: () => api.get<Classification[]>(`classifications${qs({ departmentId })}`),
    enabled: !!departmentId,
    staleTime: 5 * 60_000,
  });
}

/** Insere ou atualiza uma mensagem no cache da conversa. */
export function upsertMessageCache(qc: ReturnType<typeof useQueryClient>, m: Message) {
  qc.setQueryData<InfiniteData<MsgPage>>(['messages', m.conversationId], (data) => {
    if (!data) return data;
    let found = false;
    const pages = data.pages.map((p) => ({
      ...p,
      items: p.items.map((x) => {
        if (x.id === m.id) {
          found = true;
          return m;
        }
        return x;
      }),
    }));
    if (!found && pages.length) {
      const first = pages[0];
      const items = [...first.items, m].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id - b.id);
      pages[0] = { ...first, items };
    }
    return { ...data, pages };
  });
}

/** Liga os eventos do WebSocket ao cache das consultas. */
export function useRealtime(currentConversationId: number | null) {
  const qc = useQueryClient();
  const current = useRef(currentConversationId);
  current.current = currentConversationId;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notified = useRef(new Set<number>());

  useEffect(() => {
    const s = getSocket();
    const refreshLists = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
        void qc.invalidateQueries({ queryKey: ['conversation-counts'] });
      }, 300);
    };
    const onMessage = (m: Message) => {
      upsertMessageCache(qc, m);
      const isNew = Date.now() - new Date(m.timestamp).getTime() < 60_000 && !m.fromMe && m.reactions.length === 0;
      if (isNew && !notified.current.has(m.id) && (document.hidden || current.current !== m.conversationId)) {
        notified.current.add(m.id);
        if (notified.current.size > 500) notified.current = new Set([...notified.current].slice(-200));
        void playSound();
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          const n = new Notification(m.senderName ?? 'Nova mensagem', { body: m.body?.slice(0, 120) ?? 'Arquivo recebido', tag: `conv-${m.conversationId}` });
          n.onclick = () => {
            window.focus();
            window.location.hash = `#/chat/${m.conversationId}`;
          };
        }
      }
    };
    const onConversation = (c: Conversation) => {
      qc.setQueryData<Conversation & { history: TicketHistoryItem[] }>(['conversation', c.id], (old) => (old ? { ...old, ...c } : old));
      if (c.ticket?.status === 'closed') void qc.invalidateQueries({ queryKey: ['conversation', c.id] });
      refreshLists();
    };
    const onReconnect = () => {
      void qc.invalidateQueries({ queryKey: ['messages'] });
      refreshLists();
    };
    s.on('message:upsert', onMessage);
    s.on('conversation:upsert', onConversation);
    s.io.on('reconnect', onReconnect);
    return () => {
      s.off('message:upsert', onMessage);
      s.off('conversation:upsert', onConversation);
      s.io.off('reconnect', onReconnect);
    };
  }, [qc]);
}
