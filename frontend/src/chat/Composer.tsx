import { useQuery } from '@tanstack/react-query';
import { FileText, Paperclip, SendHorizontal, Sticker, X } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, cx, IconButton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { fileSize } from '../lib/format';
import type { Message } from '../lib/types';

export interface ComposerHandle {
  attach: (file: File) => void;
  focus: () => void;
}

/**
 * Caixa de mensagem: Enter envia, Shift+Enter quebra linha.
 * Anexos por botão, arrastar e soltar (na área do chat) ou colar imagem (Ctrl+V).
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    disabled?: boolean;
    disabledReason?: string;
    replyTo: Message | null;
    onCancelReply: () => void;
    onSendText: (text: string) => Promise<void>;
    onSendFile: (file: File, caption: string, asSticker: boolean) => Promise<void>;
    onSendSticker: (mediaId: number) => Promise<void>;
    maxMb: number;
  }
>(function Composer({ disabled, disabledReason, replyTo, onCancelReply, onSendText, onSendFile, onSendSticker, maxMb }, ref) {
  const [asSticker, setAsSticker] = useState(false);
  const [stickers, setStickers] = useState(false);
  const stickerBox = useRef<HTMLDivElement>(null);
  const recent = useQuery({
    queryKey: ['stickers-recent'],
    queryFn: () => api.get<Array<{ mediaId: number }>>('stickers/recent'),
    enabled: stickers,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!stickers) return;
    const onDoc = (e: MouseEvent) => !stickerBox.current?.contains(e.target as Node) && setStickers(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setStickers(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [stickers]);

  const sendSticker = async (mediaId: number) => {
    setStickers(false);
    setSending(true);
    setError('');
    try {
      await onSendSticker(mediaId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const attach = (f: File) => {
    setError('');
    if (f.size > maxMb * 1024 * 1024) return setError(`Arquivo maior que ${maxMb} MB.`);
    setFile(f);
  };

  useImperativeHandle(ref, () => ({ attach, focus: () => ta.current?.focus() }));

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (replyTo) ta.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const send = async () => {
    if (sending || disabled) return;
    const t = text.trim();
    if (!t && !file) return;
    setSending(true);
    setError('');
    try {
      if (file) {
        await onSendFile(file, asSticker ? '' : t, asSticker);
        setFile(null);
        setAsSticker(false);
        if (asSticker) return;
      } else {
        await onSendText(t);
      }
      setText('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
      ta.current?.focus();
    }
  };

  return (
    <div className="border-t border-border/40 bg-surface px-3 py-2 sm:px-4">
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-app border-l-4 border-primary bg-primary/5 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-primary">Respondendo {replyTo.fromMe ? 'a você' : (replyTo.senderName ?? '')}</div>
            <div className="truncate text-muted">{replyTo.body ?? replyTo.media?.name ?? `[${replyTo.type}]`}</div>
          </div>
          <IconButton label="Cancelar resposta" onClick={onCancelReply} className="size-7">
            <X className="size-4" />
          </IconButton>
        </div>
      )}
      {file && (
        <div className="mb-2 flex items-center gap-3 rounded-app border border-border/50 bg-background p-2">
          {preview ? <img src={preview} alt="" className="size-14 rounded object-cover" /> : <FileText className="size-10 text-primary" />}
          <div className="min-w-0 flex-1 text-sm">
            <div className="truncate font-medium text-text">{file.name}</div>
            <div className="text-xs text-muted">
              {fileSize(file.size)} · {asSticker ? 'vai como figurinha (sem legenda)' : 'a mensagem abaixo vai como legenda'}
            </div>
            {/^image\/(png|jpeg|webp|gif)$/.test(file.type) && (
              <label className="mt-1 inline-flex cursor-pointer items-center gap-2 text-xs text-text">
                <input type="checkbox" checked={asSticker} onChange={(e) => setAsSticker(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
                Enviar como figurinha
              </label>
            )}
          </div>
          <IconButton
            label="Remover anexo"
            onClick={() => {
              setFile(null);
              setAsSticker(false);
            }}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      )}
      {error && (
        <p role="alert" className="mb-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <IconButton label="Anexar arquivo" onClick={() => input.current?.click()} disabled={disabled}>
          <Paperclip className="size-5" />
        </IconButton>
        <div ref={stickerBox} className="relative">
          <IconButton label="Figurinhas" onClick={() => setStickers((v) => !v)} disabled={disabled} active={stickers} aria-expanded={stickers}>
            <Sticker className="size-5" />
          </IconButton>
          {stickers && (
            <div className="absolute bottom-12 left-0 z-30 w-80 rounded-app border border-border/50 bg-surface p-3 shadow-xl" role="dialog" aria-label="Figurinhas recentes">
              <div className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Figurinhas recentes</div>
              {recent.isLoading && (
                <div className="flex justify-center p-4">
                  <Spinner />
                </div>
              )}
              {!recent.isLoading && !recent.data?.length && (
                <p className="p-2 text-sm text-muted">Nenhuma figurinha ainda. As figurinhas recebidas aparecem aqui. Para criar uma, anexe uma imagem e marque "Enviar como figurinha".</p>
              )}
              <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto">
                {recent.data?.map((s) => (
                  <button
                    key={s.mediaId}
                    type="button"
                    onClick={() => void sendSticker(s.mediaId)}
                    className="flex aspect-square items-center justify-center rounded-app p-1 hover:bg-text/5"
                    aria-label="Enviar figurinha"
                  >
                    <img src={`api/media/${s.mediaId}`} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <input
          ref={input}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) attach(f);
            e.target.value = '';
          }}
        />
        <textarea
          ref={ta}
          rows={1}
          value={text}
          disabled={disabled}
          maxLength={4000}
          placeholder={disabled ? disabledReason : file ? (asSticker ? 'Figurinhas não têm legenda' : 'Legenda (opcional)') : 'Digite uma mensagem'}
          aria-label="Mensagem"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const f = Array.from(e.clipboardData.files)[0];
            if (f) {
              e.preventDefault();
              attach(f);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
            if (e.key === 'Escape' && replyTo) onCancelReply();
          }}
          className={cx(
            'max-h-44 min-h-10 flex-1 resize-none rounded-app border border-border/60 bg-background px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none disabled:opacity-60',
          )}
        />
        <Button onClick={() => void send()} loading={sending} disabled={disabled || (!text.trim() && !file)} aria-label="Enviar" className="size-10 px-0">
          {!sending && <SendHorizontal className="size-5" />}
        </Button>
      </div>
    </div>
  );
});
