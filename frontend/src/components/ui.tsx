import { Loader2, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { initials } from '../lib/format';

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-contrast hover:bg-primary-hover shadow-sm',
  secondary: 'bg-surface text-text border border-border/70 hover:bg-background',
  ghost: 'text-text hover:bg-text/5',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-app font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-app text-muted transition-colors hover:bg-text/5 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40',
        active && 'bg-primary/10 text-primary',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const fieldBase =
  'w-full rounded-app border border-border/70 bg-surface px-3 text-sm text-text placeholder:text-muted/70 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldBase, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(fieldBase, 'py-2', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-text">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {error ? <span className="block text-xs text-danger">{error}</span> : hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-border',
      )}
    >
      <span className={cx('inline-block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
    </button>
  );
}

export function SwitchRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium text-text">{label}</div>
        {description && <div className="text-xs text-muted">{description}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
const TONES: Record<Tone, string> = {
  neutral: 'bg-text/8 text-muted',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/12 text-danger',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-muted', className)} aria-label="Carregando" />;
}

/** Foto de perfil do contato (cópia local servida pela API) ou iniciais quando não houver. */
export function Avatar({
  name,
  group,
  size = 40,
  contact,
  onOpen,
}: {
  name: string;
  group?: boolean;
  size?: number;
  contact?: { id: number; avatar: 'yes' | 'no' | 'unknown'; avatarVersion: number };
  /** Chamado com a URL da foto ao clicar (abre o visualizador). Só quando há foto. */
  onOpen?: (src: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [contact?.id, contact?.avatarVersion]);
  if (contact && contact.avatar !== 'no' && !failed) {
    const src = `api/contacts/${contact.id}/avatar?v=${contact.avatarVersion}`;
    if (onOpen) {
      return (
        <button type="button" onClick={() => onOpen(src)} className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label={`Ver foto de ${name}`} title="Ver foto">
          <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="rounded-full bg-text/5 object-cover" style={{ width: size, height: size }} />
        </button>
      );
    }
    return (
      <img
        src={`api/contacts/${contact.id}/avatar?v=${contact.avatarVersion}`}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full bg-text/5 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={cx('flex shrink-0 items-center justify-center rounded-full font-semibold', group ? 'bg-muted/20 text-muted' : 'bg-primary/15 text-primary')}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {/\p{L}/u.test(name) ? initials(name) : <User style={{ width: size * 0.45, height: size * 0.45 }} />}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {icon && <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</div>}
      <div className="text-base font-semibold text-text">{title}</div>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function Card({ title, description, actions, children, className }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-app border border-border/50 bg-surface shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
