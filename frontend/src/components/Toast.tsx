import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { cx } from './ui';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}

const Ctx = createContext<{ show: (kind: Kind, text: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (kind: Kind, text: string) => {
      const id = Date.now() + Math.random();
      setItems((l) => [...l.slice(-3), { id, kind, text }]);
      setTimeout(() => remove(id), kind === 'error' ? 7000 : 4000);
    },
    [remove],
  );
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex items-start gap-3 rounded-app border bg-surface p-3 text-sm text-text shadow-lg',
              t.kind === 'success' && 'border-success/40',
              t.kind === 'error' && 'border-danger/40',
              t.kind === 'info' && 'border-primary/30',
            )}
            role={t.kind === 'error' ? 'alert' : 'status'}
          >
            {t.kind === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
            {t.kind === 'error' && <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />}
            {t.kind === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-primary" />}
            <span className="flex-1">{t.text}</span>
            <button type="button" aria-label="Fechar aviso" onClick={() => remove(t.id)} className="text-muted hover:text-text">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast fora do ToastProvider');
  return {
    success: (t: string) => c.show('success', t),
    error: (t: string | unknown) => c.show('error', typeof t === 'string' ? t : t instanceof Error ? t.message : 'Ocorreu um erro.'),
    info: (t: string) => c.show('info', t),
  };
}
