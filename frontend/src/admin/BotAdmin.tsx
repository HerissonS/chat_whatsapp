import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { Button, Card, Field, IconButton, Input, Select, Switch, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { WaText } from '../chat/MessageBubble';
import { useInboxes } from '../lib/inboxes';

interface Cls {
  id?: number;
  menuNumber: number;
  menuLabel: string;
  subjectLabel: string;
  isDefault: boolean;
  active: boolean;
}
interface BotConfig {
  templates: Record<'menu_header' | 'menu_invalid' | 'confirmation' | 'closing', string>;
  classifications: Cls[];
}

const TEMPLATE_LABELS: Array<[keyof BotConfig['templates'], string, string]> = [
  ['menu_header', 'Mensagem do menu', 'Enviada no primeiro contato, seguida das opções.'],
  ['menu_invalid', 'Resposta inválida', 'Enviada quando a resposta não é uma opção, seguida das opções.'],
  ['confirmation', 'Confirmação', 'Enviada depois que o técnico escolhe a opção.'],
  ['closing', 'Encerramento', 'Enviada ao contato quando o atendimento é encerrado.'],
];

export function BotAdmin() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: depts } = useInboxes();
  const [dep, setDep] = useState<number | null>(null);
  const [cfg, setCfg] = useState<BotConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dep && depts?.length) setDep(depts[0].id);
  }, [depts, dep]);

  const { data } = useQuery({ queryKey: ['admin-bot', dep], queryFn: () => api.get<BotConfig>(`admin/departments/${dep}/bot`), enabled: !!dep });
  useEffect(() => setCfg(data ?? null), [data]);

  const setCls = (i: number, patch: Partial<Cls>) =>
    setCfg((c) => c && { ...c, classifications: c.classifications.map((x, j) => (j === i ? { ...x, ...patch } : patch.isDefault ? { ...x, isDefault: false } : x)) });

  const save = async () => {
    if (!cfg || !dep) return;
    setSaving(true);
    try {
      await api.put(`admin/departments/${dep}/bot`, cfg);
      toast.success('Bot e menu salvos.');
      void qc.invalidateQueries({ queryKey: ['admin-bot', dep] });
      void qc.invalidateQueries({ queryKey: ['classifications'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const menuPreview = cfg
    ? [cfg.templates.menu_header, ...cfg.classifications.filter((c) => c.active).sort((a, b) => a.menuNumber - b.menuNumber).map((c) => `${c.menuNumber} - ${c.menuLabel}`)].join('\n\n')
    : '';

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text">Bot e menu</h2>
          <p className="text-sm text-muted">Textos automáticos e opções de classificação dos chamados. Cada caixa de entrada tem o seu menu.</p>
        </div>
        {depts && depts.length > 0 && (
          <Select value={dep ?? ''} onChange={(e) => setDep(Number(e.target.value))} className="w-60" aria-label="Caixa de entrada">
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {cfg && (
        <>
          <Card title="Opções do menu" description="Número que o técnico responde, texto no menu e texto que vai no assunto do e-mail. A opção padrão é usada para VIP, grupos e conversas iniciadas por vocês.">
            <div className="space-y-2">
              <div className="hidden grid-cols-[70px_1fr_1fr_70px_60px_40px] gap-2 px-1 text-xs font-medium text-muted md:grid">
                <span>Nº</span>
                <span>Texto no menu</span>
                <span>Texto no assunto</span>
                <span>Padrão</span>
                <span>Ativa</span>
                <span />
              </div>
              {cfg.classifications.map((c, i) => (
                <div key={c.id ?? `n${i}`} className="grid grid-cols-2 items-center gap-2 rounded-app border border-border/40 p-2 md:grid-cols-[70px_1fr_1fr_70px_60px_40px] md:border-0 md:p-1">
                  <Input type="number" min={1} max={99} value={c.menuNumber} onChange={(e) => setCls(i, { menuNumber: Number(e.target.value) })} aria-label="Número" />
                  <Input value={c.menuLabel} onChange={(e) => setCls(i, { menuLabel: e.target.value })} aria-label="Texto no menu" maxLength={150} />
                  <Input value={c.subjectLabel} onChange={(e) => setCls(i, { subjectLabel: e.target.value })} aria-label="Texto no assunto" maxLength={150} />
                  <label className="flex items-center justify-center">
                    <input type="radio" name="default-cls" checked={c.isDefault} onChange={() => setCls(i, { isDefault: true })} className="size-4 accent-[var(--color-primary)]" aria-label="Padrão" />
                  </label>
                  <Switch checked={c.active} onChange={(v) => setCls(i, { active: v })} label="Ativa" />
                  <IconButton label="Remover opção" onClick={() => setCfg({ ...cfg, classifications: cfg.classifications.filter((_, j) => j !== i) })}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus className="size-4" />}
                onClick={() =>
                  setCfg({
                    ...cfg,
                    classifications: [...cfg.classifications, { menuNumber: Math.max(0, ...cfg.classifications.map((c) => c.menuNumber)) + 1, menuLabel: '', subjectLabel: '', isDefault: false, active: true }],
                  })
                }
              >
                Adicionar opção
              </Button>
            </div>
          </Card>
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Card title="Textos automáticos">
              <div className="space-y-4">
                {TEMPLATE_LABELS.map(([key, label, hint]) => (
                  <Field key={key} label={label} hint={hint}>
                    <Textarea rows={3} value={cfg.templates[key]} onChange={(e) => setCfg({ ...cfg, templates: { ...cfg.templates, [key]: e.target.value } })} maxLength={2000} />
                  </Field>
                ))}
              </div>
            </Card>
            <Card title="Pré-visualização do menu">
              <div className="chat-bg rounded-app p-3">
                <div className="rounded-[calc(var(--radius)+2px)] rounded-tl-sm bg-bubble-in px-3 py-2 text-sm whitespace-pre-wrap text-text shadow-sm">
                  <WaText text={menuPreview} />
                </div>
              </div>
            </Card>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={saving}>
              Salvar alterações
            </Button>
          </div>
        </>
      )}
    </>
  );
}
