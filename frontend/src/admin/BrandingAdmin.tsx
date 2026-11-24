import { ImageUp, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useBranding } from '../branding/BrandingProvider';
import { ConfirmDialog, Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, cx, Field, Input, Select } from '../components/ui';
import { api } from '../lib/api';
import type { Branding } from '../lib/types';

type Editable = Pick<Branding, 'systemName' | 'colors' | 'dark' | 'modal' | 'font' | 'fontScale'>;

const COLOR_FIELDS: Array<[string, string]> = [
  ['primary', 'Cor principal (botões, destaques)'],
  ['primaryHover', 'Principal ao passar o mouse'],
  ['primaryContrast', 'Texto sobre a cor principal'],
  ['sidebar', 'Barra lateral'],
  ['sidebarText', 'Texto da barra lateral'],
  ['background', 'Fundo da aplicação'],
  ['surface', 'Cartões, painéis e modais'],
  ['text', 'Texto'],
  ['muted', 'Texto secundário'],
  ['border', 'Bordas'],
  ['bubbleIn', 'Mensagem recebida'],
  ['bubbleOut', 'Mensagem enviada'],
  ['success', 'Sucesso'],
  ['warning', 'Atenção'],
  ['danger', 'Erro'],
];

const LOGO_SLOTS: Array<['light' | 'dark' | 'favicon' | 'pdf', string, string]> = [
  ['light', 'Logo para fundo claro', 'Tela de login e tema claro'],
  ['dark', 'Logo para fundo escuro', 'Barra lateral e tema escuro'],
  ['favicon', 'Ícone (favicon)', 'Aba do navegador'],
  ['pdf', 'Logo do PDF', 'Cabeçalho do histórico enviado por e-mail'],
];

/** Contraste WCAG entre duas cores #RRGGBB. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const CHECKS: Array<[string, string, string]> = [
  ['primaryContrast', 'primary', 'Texto dos botões'],
  ['text', 'background', 'Texto sobre o fundo'],
  ['text', 'surface', 'Texto nos painéis'],
  ['sidebarText', 'sidebar', 'Texto da barra lateral'],
  ['text', 'bubbleOut', 'Texto da mensagem enviada'],
];

function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-app border border-border/40 px-2 py-1.5">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="size-8 cursor-pointer rounded border-0 bg-transparent" aria-label={label} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-text">{label}</div>
        <input
          value={value}
          onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value.toUpperCase())}
          className="w-24 bg-transparent font-mono text-xs text-muted focus:outline-none"
          aria-label={`${label} (hexadecimal)`}
        />
      </div>
    </label>
  );
}

export function BrandingAdmin() {
  const toast = useToast();
  const { branding, refresh, preview } = useBranding();
  const [form, setForm] = useState<Editable | null>(null);
  const [mode, setMode] = useState<'colors' | 'dark'>('colors');
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [demo, setDemo] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (branding && !form) setForm({ systemName: branding.systemName, colors: branding.colors, dark: branding.dark, modal: branding.modal, font: branding.font, fontScale: branding.fontScale ?? 112 });
  }, [branding, form]);

  // Pré-visualização ao vivo enquanto edita; ao sair da tela volta ao que está salvo.
  useEffect(() => {
    if (form) preview(form);
  }, [form, preview]);
  useEffect(() => () => preview(null), [preview]);

  if (!form || !branding) return null;
  const palette = form[mode];
  const valid = (v: string) => /^#[0-9A-F]{6}$/i.test(v);
  const allValid = Object.values(form.colors).every(valid) && Object.values(form.dark).every(valid);
  const warnings = (['colors', 'dark'] as const).flatMap((m) =>
    CHECKS.filter(([a, b]) => valid(form[m][a]) && valid(form[m][b]) && contrast(form[m][a], form[m][b]) < 4.5).map(([, , label]) => `${m === 'dark' ? 'Tema escuro' : 'Tema claro'}: ${label}`),
  );

  const save = async () => {
    setSaving(true);
    try {
      await api.put('admin/branding', form);
      refresh();
      toast.success('Aparência salva para todos os usuários.');
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    try {
      const b = await api.post<Branding>('admin/branding/reset');
      setForm({ systemName: b.systemName, colors: b.colors, dark: b.dark, modal: b.modal, font: b.font, fontScale: b.fontScale ?? 112 });
      refresh();
      toast.success('Aparência padrão restaurada.');
    } catch (err) {
      toast.error(err);
    } finally {
      setResetOpen(false);
    }
  };

  const upload = async (slot: string, f: File) => {
    const fd = new FormData();
    fd.append('file', f);
    try {
      await api.upload(`admin/branding/logo/${slot}`, fd);
      refresh();
      toast.success('Logo atualizado.');
    } catch (err) {
      toast.error(err);
    }
  };

  const removeLogo = async (slot: string) => {
    try {
      await api.del(`admin/branding/logo/${slot}`);
      refresh();
      toast.success('Logo padrão restaurado.');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text">Aparência</h2>
          <p className="text-sm text-muted">Cores, modais e logos do sistema. As alterações aparecem ao vivo nesta tela e valem para todos depois de salvar.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setResetOpen(true)} icon={<RotateCcw className="size-4" />}>
            Restaurar padrão
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!allValid || form.systemName.trim().length < 2}>
            Salvar
          </Button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="flex gap-2 rounded-app border border-warning/40 bg-warning/10 p-3 text-sm text-warning" role="status">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            Contraste baixo (difícil de ler): {warnings.join('; ')}.
          </div>
        </div>
      )}

      <Card title="Identidade">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do sistema" hint="Aparece na aba do navegador e no login.">
            <Input value={form.systemName} onChange={(e) => setForm({ ...form, systemName: e.target.value })} maxLength={60} />
          </Field>
          <Field label="Fonte" hint="Fontes instaladas nos computadores (não baixa de servidores externos).">
            <Select value={form.font} onChange={(e) => setForm({ ...form, font: e.target.value as Editable['font'] })}>
              <option value="system">Padrão do sistema</option>
              <option value="arial">Arial</option>
              <option value="verdana">Verdana</option>
              <option value="trebuchet">Trebuchet MS</option>
              <option value="georgia">Georgia</option>
            </Select>
          </Field>
          <Field label={`Tamanho do texto: ${form.fontScale}%`} hint="Padrão para todos. Cada usuário pode ajustar o seu no menu do avatar.">
            <input type="range" min={90} max={140} step={2} value={form.fontScale} onChange={(e) => setForm({ ...form, fontScale: Number(e.target.value) })} className="w-full accent-[var(--color-primary)]" />
          </Field>
        </div>
      </Card>

      <Card
        title="Cores"
        actions={
          <div className="flex rounded-app border border-border/50 p-0.5">
            {(['colors', 'dark'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={cx('rounded px-3 py-1 text-sm', mode === m ? 'bg-primary text-primary-contrast' : 'text-muted')}>
                {m === 'colors' ? 'Tema claro' : 'Tema escuro'}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {COLOR_FIELDS.map(([key, label]) => (
            <ColorInput key={key} label={label} value={palette[key]} onChange={(v) => setForm({ ...form, [mode]: { ...palette, [key]: v } })} />
          ))}
        </div>
      </Card>

      <Card title="Modais e componentes" actions={<Button variant="secondary" size="sm" onClick={() => setDemo(true)}>Ver modal de exemplo</Button>}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Arredondamento: ${form.modal.radius}px`}>
            <input type="range" min={0} max={24} value={form.modal.radius} onChange={(e) => setForm({ ...form, modal: { ...form.modal, radius: Number(e.target.value) } })} className="w-full accent-[var(--color-primary)]" />
          </Field>
          <Field label={`Escurecimento do fundo: ${Math.round(form.modal.overlayOpacity * 100)}%`}>
            <input type="range" min={0.2} max={0.9} step={0.05} value={form.modal.overlayOpacity} onChange={(e) => setForm({ ...form, modal: { ...form.modal, overlayOpacity: Number(e.target.value) } })} className="w-full accent-[var(--color-primary)]" />
          </Field>
          <Field label="Sombra">
            <Select value={form.modal.shadow} onChange={(e) => setForm({ ...form, modal: { ...form.modal, shadow: e.target.value as Editable['modal']['shadow'] } })}>
              <option value="none">Nenhuma</option>
              <option value="sm">Suave</option>
              <option value="md">Média</option>
              <option value="lg">Forte</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card title="Logos" description="PNG, JPG ou WebP de até 2 MB. Prefira imagens com fundo transparente.">
        <div className="grid gap-4 sm:grid-cols-2">
          {LOGO_SLOTS.map(([slot, label, hint]) => {
            const l = branding.logos[slot];
            return (
              <div key={slot} className="flex items-center gap-4 rounded-app border border-border/40 p-3">
                <div className={cx('flex h-16 w-24 shrink-0 items-center justify-center rounded p-1', slot === 'dark' ? 'bg-sidebar' : 'bg-white')}>
                  {l.url ? (
                    <img src={l.url} alt={label} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className={cx('text-center text-[11px]', slot === 'dark' ? 'text-white/70' : 'text-muted')}>Sem logo</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-text">
                    {label} {l.custom ? <Badge tone="primary">Enviado</Badge> : <Badge>{l.url ? 'Padrão' : 'Nenhum'}</Badge>}
                  </div>
                  <div className="text-xs text-muted">{hint}</div>
                  <div className="mt-2 flex gap-2">
                    <input
                      ref={(el) => {
                        fileRefs.current[slot] = el;
                      }}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload(slot, f);
                        e.target.value = '';
                      }}
                    />
                    <Button size="sm" variant="secondary" icon={<ImageUp className="size-4" />} onClick={() => fileRefs.current[slot]?.click()}>
                      Trocar
                    </Button>
                    {l.custom && (
                      <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void removeLogo(slot)}>
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Modal
        open={demo}
        onClose={() => setDemo(false)}
        title="Modal de exemplo"
        description="Assim ficam os modais com as configurações atuais."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDemo(false)}>
              Cancelar
            </Button>
            <Button onClick={() => setDemo(false)}>Confirmar</Button>
          </>
        }
      >
        <Field label="Campo de exemplo">
          <Input placeholder="Digite algo" />
        </Field>
      </Modal>
      <ConfirmDialog
        open={resetOpen}
        title="Restaurar a aparência padrão?"
        message="Cores, modais, fonte, tamanho do texto, nome e logos voltam ao padrão neutro do sistema. Os logos enviados serão removidos."
        confirmLabel="Restaurar"
        danger
        onConfirm={() => void reset()}
        onClose={() => setResetOpen(false)}
      />
    </>
  );
}
