import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from './ui';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

/** Seleção com busca (usada para contrato e equipamento no encerramento). */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  emptyText = 'Nada encontrado',
  disabled,
  clearable,
  loading,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
  emptyText?: string;
  disabled?: boolean;
  clearable?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? options.filter((o) => o.label.toLowerCase().includes(t) || o.hint?.toLowerCase().includes(t)) : options).slice(0, 300);
  }, [q, options]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => setActive(0), [q, open]);

  const selected = options.find((o) => o.value === value);
  const pick = (o: ComboOption) => {
    onChange(o.value);
    setOpen(false);
    setQ('');
  };

  return (
    <div ref={box} className="relative">
      <div
        className={cx(
          'flex h-10 w-full items-center gap-2 rounded-app border border-border/70 bg-surface px-3 text-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
          disabled && 'opacity-60',
        )}
      >
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-text placeholder:text-muted/70 focus:outline-none"
          placeholder={selected ? selected.label : placeholder}
          value={open ? q : (selected?.label ?? '')}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && open && filtered[active]) {
              e.preventDefault();
              pick(filtered[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {clearable && value && !disabled && (
          <button type="button" aria-label="Limpar" className="text-muted hover:text-text" onClick={() => onChange(null)}>
            <X className="size-4" />
          </button>
        )}
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
      </div>
      {open && !disabled && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-app border border-border/60 bg-surface py-1 shadow-lg">
          {loading && <li className="px-3 py-2 text-sm text-muted">Carregando…</li>}
          {!loading && !filtered.length && <li className="px-3 py-2 text-sm text-muted">{emptyText}</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', i === active ? 'bg-primary/10' : '', o.value === value && 'font-medium')}
            >
              <Check className={cx('size-4 text-primary', o.value === value ? 'opacity-100' : 'opacity-0')} />
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
