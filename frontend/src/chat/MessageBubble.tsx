import {
  Ban,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Copy,
  CornerUpLeft,
  Download,
  FileText,
  Forward,
  ImageOff,
  Loader2,
  MapPin,
  Pencil,
  Smartphone,
  SmilePlus,
  Trash2,
  TriangleAlert,
  User,
} from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { useLightbox } from '../components/Lightbox';
import { cx } from '../components/ui';
import { fileSize, time } from '../lib/format';
import type { Message } from '../lib/types';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, ```mono```) e links. Sem HTML: só nós React. */
export function WaText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const re = /(```[\s\S]+?```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s<]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('```')) nodes.push(<code key={k++} className="rounded bg-text/8 px-1 font-mono text-[0.92em]">{t.slice(3, -3)}</code>);
    else if (t.startsWith('*')) nodes.push(<strong key={k++}>{t.slice(1, -1)}</strong>);
    else if (t.startsWith('_')) nodes.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else if (t.startsWith('~')) nodes.push(<s key={k++}>{t.slice(1, -1)}</s>);
    else {
      const url = t.replace(/[.,)!?]+$/, '');
      nodes.push(
        <a key={k++} href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary underline">
          {url}
        </a>,
      );
      if (url.length < t.length) nodes.push(t.slice(url.length));
    }
    last = m.index + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes.map((n, i) => (typeof n === 'string' ? <Fragment key={`t${i}`}>{n}</Fragment> : n))}</>;
}

function MediaView({ m, sender }: { m: Message; sender: string | null }) {
  const openImage = useLightbox();
  const media = m.media!;
  const url = media.id ? `api/media/${media.id}` : '';
  if (media.status === 'pending') {
    return (
      <div className="flex items-center gap-2 rounded bg-text/5 px-3 py-2 text-xs text-muted">
        <Loader2 className="size-4 animate-spin" /> Baixando arquivo…
      </div>
    );
  }
  if (media.status === 'failed' || !media.id) {
    return (
      <div className="flex items-center gap-2 rounded bg-text/5 px-3 py-2 text-xs text-muted">
        <ImageOff className="size-4" /> Arquivo indisponível
      </div>
    );
  }
  const mime = media.mime ?? '';
  if ((m.type === 'image' || m.type === 'sticker') && mime.startsWith('image/')) {
    if (m.type === 'sticker') return <img src={url} alt="Figurinha" loading="lazy" className="max-h-36 w-auto" />;
    return (
      <button
        type="button"
        className="block w-full cursor-zoom-in"
        onClick={() => openImage({ src: url, title: sender ?? (m.fromMe ? 'Você' : 'Imagem'), subtitle: new Date(m.timestamp).toLocaleString('pt-BR'), downloadHref: `${url}?download=1` })}
        aria-label="Ampliar imagem"
      >
        <img src={url} alt={media.name ?? 'Imagem'} loading="lazy" className="max-h-80 w-full min-w-48 rounded object-cover" />
      </button>
    );
  }
  if (m.type === 'video' && mime.startsWith('video/')) {
    return <video src={url} controls preload="metadata" className="max-h-80 w-full rounded bg-black" />;
  }
  if (m.type === 'audio' && mime.startsWith('audio/')) {
    return <audio src={url} controls preload="metadata" className="w-72 max-w-full" />;
  }
  return (
    <a href={`${url}?download=1`} className="flex items-center gap-3 rounded bg-text/5 px-3 py-2.5 hover:bg-text/10" download>
      <FileText className="size-8 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{media.name ?? 'Arquivo'}</div>
        <div className="text-xs text-muted">{[mime.split('/')[1]?.toUpperCase(), fileSize(media.size)].filter(Boolean).join(' · ')}</div>
      </div>
      <Download className="size-4 shrink-0 text-muted" />
    </a>
  );
}

function StatusIcon({ status }: { status: Message['status'] }) {
  if (status === 'pending') return <Clock className="size-3.5" aria-label="Enviando" />;
  if (status === 'failed') return <TriangleAlert className="size-3.5 text-danger" aria-label="Falhou" />;
  if (status === 'sent') return <Check className="size-3.5" aria-label="Enviada" />;
  return <CheckCheck className={cx('size-3.5', status === 'read' && 'text-sky-500')} aria-label={status === 'read' ? 'Lida' : 'Entregue'} />;
}

export function MessageBubble({
  m,
  isGroup,
  onReply,
  onReact,
  onForward,
  onDelete,
  onCopy,
  onJumpTo,
  canDelete,
}: {
  m: Message;
  isGroup: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onForward: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onJumpTo: (waId: string) => void;
  canDelete: boolean;
}) {
  const [picker, setPicker] = useState(false);
  const mine = m.fromMe;
  const author =
    m.origin === 'agent'
      ? (m.userName ?? m.senderName)
      : m.origin === 'bot'
        ? 'Mensagem automática'
        : m.origin === 'phone'
          ? 'Enviada pelo celular'
          : isGroup
            ? (m.senderName ?? m.senderJid?.split('@')[0])
            : null;
  const AuthorIcon = m.origin === 'bot' ? Bot : m.origin === 'phone' ? Smartphone : m.origin === 'agent' ? User : null;
  const myReaction = m.reactions.find((r) => r.fromMe)?.emoji;
  const grouped = m.reactions.reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.emoji] ??= []).push(r.reactorName ?? '');
    return acc;
  }, {});

  return (
    <div id={`msg-${m.waId}`} className={cx('group flex px-4 py-0.5 sm:px-8', mine ? 'justify-end' : 'justify-start')}>
      <div className={cx('relative flex max-w-[min(78%,640px)] items-end gap-1', mine ? 'flex-row-reverse' : 'flex-row')}>
        <div
          className={cx(
            'relative min-w-24 rounded-[calc(var(--radius)+2px)] px-3 pt-2 pb-1.5 text-sm text-text shadow-sm',
            mine ? 'rounded-tr-sm bg-bubble-out' : 'rounded-tl-sm bg-bubble-in',
            m.reactions.length > 0 && 'mb-3',
          )}
        >
          {author && (
            <div className={cx('mb-0.5 flex items-center gap-1 text-xs font-semibold', mine ? 'text-primary' : 'text-primary/90')}>
              {AuthorIcon && <AuthorIcon className="size-3" />}
              {author}
            </div>
          )}
          {m.forwarded && !m.deleted && (
            <div className="mb-0.5 flex items-center gap-1 text-xs text-muted italic">
              <Forward className="size-3" /> Encaminhada
            </div>
          )}
          {m.quoted && !m.deleted && (
            <button
              type="button"
              onClick={() => onJumpTo(m.quoted!.waId)}
              className="mb-1.5 block w-full rounded border-l-4 border-primary bg-text/5 px-2 py-1 text-left text-xs hover:bg-text/10"
            >
              <div className="font-semibold text-primary">{m.quoted.sender ?? 'Mensagem'}</div>
              <div className="line-clamp-2 text-muted">{m.quoted.preview ?? ''}</div>
            </button>
          )}
          {m.deleted ? (
            <div className="flex items-center gap-1.5 text-muted italic">
              <Ban className="size-4" /> Mensagem apagada
            </div>
          ) : (
            <>
              {m.media && <div className="mb-1">{<MediaView m={m} sender={author ?? null} />}</div>}
              {m.type === 'location' && <MapPin className="mb-1 inline size-4 text-primary" />}
              {m.body && (
                <div className="break-words whitespace-pre-wrap">
                  <WaText text={m.body} />
                </div>
              )}
            </>
          )}
          <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted">
            {m.edited && !m.deleted && (
              <span className="flex items-center gap-0.5">
                <Pencil className="size-3" /> editada
              </span>
            )}
            <span>{time(m.timestamp)}</span>
            {mine && <StatusIcon status={m.status} />}
          </div>
          {m.reactions.length > 0 && (
            <div className={cx('absolute -bottom-3.5 flex gap-0.5', mine ? 'right-2' : 'left-2')}>
              {Object.entries(grouped).map(([emoji, who]) => (
                <span key={emoji} title={who.filter(Boolean).join(', ')} className="rounded-full border border-border/40 bg-surface px-1.5 py-0.5 text-xs shadow-sm">
                  {emoji}
                  {who.length > 1 && <span className="ml-0.5 text-muted">{who.length}</span>}
                </span>
              ))}
            </div>
          )}
        </div>

        {!m.deleted && (
          <div className="relative flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <ActionButton label="Responder" onClick={onReply}>
              <CornerUpLeft className="size-4" />
            </ActionButton>
            <ActionButton label="Reagir" onClick={() => setPicker((p) => !p)}>
              <SmilePlus className="size-4" />
            </ActionButton>
            <ActionButton label="Encaminhar" onClick={onForward}>
              <Forward className="size-4" />
            </ActionButton>
            {m.body && (
              <ActionButton label="Copiar texto" onClick={onCopy}>
                <Copy className="size-4" />
              </ActionButton>
            )}
            {mine && canDelete && (
              <ActionButton label="Apagar para todos" onClick={onDelete} danger>
                <Trash2 className="size-4" />
              </ActionButton>
            )}
            {picker && (
              <div className={cx('absolute bottom-9 z-20 flex gap-1 rounded-full border border-border/40 bg-surface px-2 py-1 shadow-lg', mine ? 'right-0' : 'left-0')} role="menu">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    role="menuitem"
                    aria-label={`Reagir com ${e}`}
                    onClick={() => {
                      setPicker(false);
                      onReact(myReaction === e ? '' : e);
                    }}
                    className={cx('rounded-full p-1 text-lg transition-transform hover:scale-125', myReaction === e && 'bg-primary/15')}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx('rounded-full p-1.5 text-muted hover:bg-text/8', danger ? 'hover:text-danger' : 'hover:text-text')}
    >
      {children}
    </button>
  );
}
