import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, CheckCircle2, ChevronDown, PanelRightClose, PanelRightOpen, Star, Upload, UserCheck, Users, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useLightbox } from '../components/Lightbox';
import { ConfirmDialog } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Avatar, Badge, Button, cx, IconButton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useInboxes } from '../lib/inboxes';
import { dayKey, dayLabel, phoneLabel } from '../lib/format';
import { navigate } from '../lib/router';
import type { Conversation, Message } from '../lib/types';
import { Composer, type ComposerHandle } from './Composer';
import { flattenMessages, upsertMessageCache, useMessages, useUsers } from './data';
import { MessageBubble } from './MessageBubble';
import { CloseTicketModal, ForwardModal } from './modals';

function AssigneeMenu({ conversation }: { conversation: Conversation }) {
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: users } = useUsers();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = conversation.ticket!;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const assign = async (userId: number | null) => {
    setOpen(false);
    try {
      await api.post(`tickets/${t.id}/assign`, { userId });
      void qc.invalidateQueries({ queryKey: ['conversation', conversation.id] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation-counts'] });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-app border border-border/60 px-2.5 text-sm text-text hover:bg-text/5"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <UserCheck className="size-4 text-muted" />
        <span className="hidden max-w-36 truncate md:inline">{t.assigneeName ?? 'Sem responsável'}</span>
        <ChevronDown className="size-4 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-app border border-border/50 bg-surface p-1 shadow-xl" role="listbox">
          {t.assigneeId !== me?.id && (
            <button type="button" onClick={() => void assign(me!.id)} className="w-full rounded px-3 py-2 text-left text-sm font-medium text-primary hover:bg-primary/10">
              Atribuir a mim
            </button>
          )}
          {t.assigneeId && (
            <button type="button" onClick={() => void assign(null)} className="w-full rounded px-3 py-2 text-left text-sm text-muted hover:bg-text/5">
              Remover responsável
            </button>
          )}
          <div className="my-1 border-t border-border/40" />
          {users?.map((u) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={u.id === t.assigneeId}
              onClick={() => void assign(u.id)}
              className={cx('flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-text/5', u.id === t.assigneeId && 'bg-primary/10 font-medium')}
            >
              <Avatar name={u.name} size={24} />
              <span className="truncate">{u.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatView({ conversation, panelOpen, onTogglePanel }: { conversation: Conversation; panelOpen: boolean; onTogglePanel: () => void }) {
  const { me, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const openImage = useLightbox();
  const { data: inboxes } = useInboxes();
  const inboxLabel = (inboxes ?? []).filter((i) => i.active).length > 1 ? inboxes?.find((i) => i.id === conversation.departmentId)?.name : undefined;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useMessages(conversation.id);
  const messages = flattenMessages(data);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [forward, setForward] = useState<Message | null>(null);
  const [toDelete, setToDelete] = useState<Message | null>(null);
  const [closing, setClosing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const prevHeight = useRef(0);
  const lastCount = useRef(0);
  const ticket = conversation.ticket;
  const ticketOpen = !!ticket && ticket.status !== 'closed';

  // Esc fecha a conversa (quando não há modal aberto nem resposta em andamento).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]') || replyTo) return;
      navigate('chat');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [replyTo]);

  // Ao trocar de conversa: limpa estado e marca como lida.
  useEffect(() => {
    setReplyTo(null);
    lastCount.current = 0;
    void api.post(`conversations/${conversation.id}/read`).then(() => void qc.invalidateQueries({ queryKey: ['conversation-counts'] }));
  }, [conversation.id, qc]);

  // Marca como lida quando chegam mensagens com a conversa aberta e a aba visível.
  useEffect(() => {
    if (conversation.unreadCount > 0 && !document.hidden) void api.post(`conversations/${conversation.id}/read`);
  }, [conversation.unreadCount, conversation.id]);

  // Rolagem: mantém no fim para mensagens novas; preserva a posição ao carregar mensagens antigas.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current && isFetchingNextPage === false && messages.length > lastCount.current && el.scrollTop < 50) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
    } else if (atBottom || lastCount.current === 0) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeight.current = 0;
    lastCount.current = messages.length;
  }, [messages.length, isFetchingNextPage, atBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    if (el.scrollTop < 120 && hasNextPage && !isFetchingNextPage) {
      prevHeight.current = el.scrollHeight;
      void fetchNextPage();
    }
  };

  const jumpTo = useCallback((waId: string) => {
    const el = document.getElementById(`msg-${waId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary/40', 'rounded-lg');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary/40', 'rounded-lg'), 1500);
    }
  }, []);

  const sendText = async (text: string) => {
    const m = await api.post<Message>(`conversations/${conversation.id}/messages`, { text, quotedMessageId: replyTo?.id });
    upsertMessageCache(qc, m);
    setReplyTo(null);
    setAtBottom(true);
  };

  const sendSticker = async (mediaId: number) => {
    const m = await api.post<Message>(`conversations/${conversation.id}/sticker`, { mediaId, quotedMessageId: replyTo?.id });
    upsertMessageCache(qc, m);
    setReplyTo(null);
    setAtBottom(true);
  };

  const sendFile = async (file: File, caption: string, asSticker: boolean) => {
    const form = new FormData();
    form.append('file', file);
    if (caption) form.append('caption', caption);
    if (asSticker) form.append('asSticker', '1');
    if (replyTo) form.append('quotedMessageId', String(replyTo.id));
    const m = await api.upload<Message>(`conversations/${conversation.id}/media`, form);
    upsertMessageCache(qc, m);
    setReplyTo(null);
    setAtBottom(true);
  };

  const react = async (m: Message, emoji: string) => {
    try {
      await api.post(`messages/${m.id}/reaction`, { emoji });
    } catch (err) {
      toast.error(err);
    }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    try {
      await api.del(`messages/${toDelete.id}`);
      toast.success('Mensagem apagada para todos.');
    } catch (err) {
      toast.error(err);
    } finally {
      setToDelete(null);
    }
  };

  const c = conversation.contact;
  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) composer.current?.attach(f);
      }}
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/40 bg-surface px-3 sm:px-4">
        <IconButton label="Voltar" onClick={() => navigate('chat')} className="lg:hidden">
          <ArrowLeft className="size-5" />
        </IconButton>
        <Avatar name={c.name} group={c.isGroup} size={40} contact={c} onOpen={(src) => openImage({ src, title: c.name, subtitle: 'Foto do perfil' })} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {c.isGroup && <Users className="size-4 text-muted" />}
            <h2 className="truncate font-semibold text-text">{c.name}</h2>
            {c.isVip && <Star className="size-4 shrink-0 fill-warning text-warning" aria-label="VIP" />}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="truncate">{c.isGroup ? 'Grupo' : phoneLabel(c.phone)}</span>
            {inboxLabel && <Badge>{inboxLabel}</Badge>}
            {ticket && ticketOpen && (
              <Badge tone={ticket.status === 'menu' ? 'warning' : 'primary'}>
                #{ticket.id} · {ticket.status === 'menu' ? 'Aguardando menu' : (ticket.classificationLabel ?? 'Aberto')}
              </Badge>
            )}
            {ticket && !ticketOpen && <Badge>Encerrado</Badge>}
          </div>
        </div>
        {ticketOpen && can('ticket.assign') && <AssigneeMenu conversation={conversation} />}
        {ticketOpen && can('ticket.close') && (
          <Button onClick={() => setClosing(true)} icon={<CheckCircle2 className="size-4" />} className="hidden sm:inline-flex">
            Encerrar
          </Button>
        )}
        <IconButton label={panelOpen ? 'Ocultar detalhes' : 'Mostrar detalhes'} onClick={onTogglePanel} className="hidden xl:inline-flex">
          {panelOpen ? <PanelRightClose className="size-5" /> : <PanelRightOpen className="size-5" />}
        </IconButton>
        <IconButton label="Fechar conversa (Esc)" onClick={() => navigate('chat')} className="hidden lg:inline-flex">
          <X className="size-5" />
        </IconButton>
      </header>

      <div ref={scroller} onScroll={onScroll} className="chat-bg relative flex-1 overflow-y-auto py-3" aria-live="polite">
        {isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <Spinner />
          </div>
        )}
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
        {!isLoading && !messages.length && <p className="p-8 text-center text-sm text-muted">Nenhuma mensagem ainda. Envie a primeira abaixo.</p>}
        {messages.map((m, i) => {
          const showDay = i === 0 || dayKey(messages[i - 1].timestamp) !== dayKey(m.timestamp);
          const newTicket = m.ticketId && i > 0 && messages[i - 1].ticketId && messages[i - 1].ticketId !== m.ticketId;
          return (
            <Fragment key={m.id}>
              {showDay && (
                <div className="sticky top-1 z-10 my-2 flex justify-center">
                  <span className="rounded-full bg-surface/95 px-3 py-1 text-xs font-medium text-muted shadow-sm">{dayLabel(m.timestamp)}</span>
                </div>
              )}
              {newTicket && (
                <div className="my-3 flex items-center gap-3 px-8 text-xs text-muted">
                  <span className="h-px flex-1 bg-border/60" /> Chamado #{m.ticketId} <span className="h-px flex-1 bg-border/60" />
                </div>
              )}
              <MessageBubble
                m={m}
                isGroup={c.isGroup}
                canDelete={can('chat.delete')}
                onReply={() => {
                  setReplyTo(m);
                  composer.current?.focus();
                }}
                onReact={(e) => void react(m, e)}
                onForward={() => setForward(m)}
                onDelete={() => setToDelete(m)}
                onCopy={() => void navigator.clipboard?.writeText(m.body ?? '').then(() => toast.info('Texto copiado.'))}
                onJumpTo={jumpTo}
              />
            </Fragment>
          );
        })}
      </div>

      {!atBottom && (
        <button
          type="button"
          onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
          className="absolute right-6 bottom-24 z-10 flex size-10 items-center justify-center rounded-full border border-border/50 bg-surface text-muted shadow-lg hover:text-text"
          aria-label="Ir para o fim"
        >
          <ArrowDown className="size-5" />
        </button>
      )}

      {ticketOpen && can('ticket.close') && (
        <div className="border-t border-border/40 bg-surface px-3 pt-2 sm:hidden">
          <Button onClick={() => setClosing(true)} className="w-full" icon={<CheckCircle2 className="size-4" />}>
            Encerrar atendimento
          </Button>
        </div>
      )}

      <Composer
        ref={composer}
        disabled={!can('chat.send')}
        disabledReason="Sem permissão para enviar"
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSendText={sendText}
        onSendFile={sendFile}
        onSendSticker={sendSticker}
        maxMb={me?.mediaMaxMb ?? 100}
      />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-4 border-dashed border-primary/60 bg-primary/10">
          <div className="flex items-center gap-2 rounded-app bg-surface px-4 py-3 font-medium text-primary shadow-lg">
            <Upload className="size-5" /> Solte o arquivo para anexar
          </div>
        </div>
      )}

      {ticket && ticketOpen && <CloseTicketModal open={closing} onClose={() => setClosing(false)} conversation={conversation} />}
      <ForwardModal message={forward} onClose={() => setForward(null)} />
      <ConfirmDialog
        open={!!toDelete}
        title="Apagar mensagem para todos?"
        message="A mensagem será apagada no WhatsApp do contato. Esta ação não pode ser desfeita."
        confirmLabel="Apagar"
        danger
        onConfirm={() => void doDelete()}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}
