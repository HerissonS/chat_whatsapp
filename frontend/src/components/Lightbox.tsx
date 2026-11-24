import { Download, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Item {
  src: string;
  title?: string;
  subtitle?: string;
  downloadHref?: string;
}

const Ctx = createContext<{ open: (item: Item) => void } | null>(null);

/**
 * Visualizador de imagem na própria página (fotos da conversa e fotos de perfil).
 * Fecha com o X, com Esc ou clicando fora da imagem.
 */
export function LightboxProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<Item | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setItem(null), []);

  useEffect(() => {
    if (!item) return;
    lastFocus.current = document.activeElement as HTMLElement;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Impede que o Esc também feche a conversa aberta.
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      lastFocus.current?.focus?.();
    };
  }, [item, close]);

  const value = useMemo(() => ({ open: setItem }), []);

  return (
    <Ctx.Provider value={value}>
      {children}
      {item &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={item.title ?? 'Imagem'}
            className="fixed inset-0 z-[70] flex flex-col bg-black/85"
            onMouseDown={(e) => e.target === e.currentTarget && close()}
          >
            <div className="flex items-center gap-3 px-4 py-3 text-white" onMouseDown={(e) => e.target === e.currentTarget && close()}>
              <div className="min-w-0 flex-1">
                {item.title && <div className="truncate text-sm font-medium">{item.title}</div>}
                {item.subtitle && <div className="truncate text-xs text-white/60">{item.subtitle}</div>}
              </div>
              {item.downloadHref && (
                <a href={item.downloadHref} download className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Baixar" title="Baixar">
                  <Download className="size-5" />
                </a>
              )}
              <button ref={closeBtn} type="button" onClick={close} className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Fechar (Esc)" title="Fechar (Esc)">
                <X className="size-6" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
              <img src={item.src} alt={item.title ?? ''} className="max-h-full max-w-full rounded object-contain shadow-2xl" />
            </div>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

export function useLightbox() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLightbox fora do LightboxProvider');
  return c.open;
}
