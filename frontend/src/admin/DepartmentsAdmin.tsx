import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Field, IconButton, Input, Select, SwitchRow } from '../components/ui';
import { api } from '../lib/api';
import { type Department, useDepartments } from './shared';

export function DepartmentsAdmin() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useDepartments();
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState<Department | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(editing), [editing]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await api.patch(`admin/departments/${form.id}`, {
        name: form.name,
        agentNamePrefix: form.agentNamePrefix,
        menuEnabled: form.menuEnabled,
        menuMaxInvalid: form.menuMaxInvalid,
        closeMsgIndividual: form.closeMsgIndividual,
        closeMsgGroup: form.closeMsgGroup,
        catalogSource: form.catalogSource,
        active: form.active,
      });
      toast.success('Caixa de entrada atualizada.');
      void qc.invalidateQueries({ queryKey: ['admin-departments'] });
      setEditing(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    setSaving(true);
    try {
      await api.post('admin/departments', { name: newName });
      toast.success('Caixa de entrada criada. Conecte o WhatsApp dela em Administração > WhatsApp.');
      void qc.invalidateQueries({ queryKey: ['admin-departments'] });
      setCreating(false);
      setNewName('');
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Caixas de entrada"
      description="Cada caixa de entrada tem o seu próprio número de WhatsApp, menu do bot, textos e destinatários de e-mail (ex.: Suporte, Compras). Os usuários veem só as caixas em que estão."
      actions={
        <Button onClick={() => setCreating(true)} icon={<Plus className="size-4" />}>
          Nova caixa de entrada
        </Button>
      }
    >
      <ul className="divide-y divide-border/40">
        {data?.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text">{d.name}</span>
                {!d.active && <Badge tone="danger">Inativo</Badge>}
              </div>
              <div className="text-xs text-muted">
                WhatsApp: {d.waState === 'open' ? `conectado${d.waNumber ? ` (+${d.waNumber})` : ''}` : 'não conectado'} · Instância: {d.evolutionInstance ?? 'não definida'} · Catálogo: {d.catalogSource === 'local' ? 'cadastro próprio' : 'banco externo'}
              </div>
            </div>
            <IconButton label="Editar" onClick={() => setEditing(d)}>
              <Pencil className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>

      <Modal
        open={!!form}
        onClose={() => setEditing(null)}
        title="Configurar caixa de entrada"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label="Nome da caixa de entrada" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={150} />
            </Field>
            <div className="divide-y divide-border/40 rounded-app border border-border/40 px-4">
              <SwitchRow label="Nome do atendente nas mensagens" description="O técnico recebe *Nome:* antes do texto." checked={form.agentNamePrefix} onChange={(v) => setForm({ ...form, agentNamePrefix: v })} />
              <SwitchRow label="Menu automático" description="Envia o menu de classificação no primeiro contato (exceto VIP e grupos)." checked={form.menuEnabled} onChange={(v) => setForm({ ...form, menuEnabled: v })} />
              <SwitchRow label="Mensagem de encerramento (conversas individuais)" checked={form.closeMsgIndividual} onChange={(v) => setForm({ ...form, closeMsgIndividual: v })} />
              <SwitchRow label="Mensagem de encerramento (grupos)" checked={form.closeMsgGroup} onChange={(v) => setForm({ ...form, closeMsgGroup: v })} />
              <SwitchRow label="Caixa de entrada ativa" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tentativas inválidas no menu" hint="Depois disso, o chamado abre como a opção padrão.">
                <Input type="number" min={1} max={10} value={form.menuMaxInvalid} onChange={(e) => setForm({ ...form, menuMaxInvalid: Number(e.target.value) })} />
              </Field>
              <Field label="Fonte de contratos e equipamentos" hint="Banco externo exige CATALOG_DB_* no .env.">
                <Select value={form.catalogSource} onChange={(e) => setForm({ ...form, catalogSource: e.target.value as Department['catalogSource'] })}>
                  <option value="local">Cadastro próprio (Contratos)</option>
                  <option value="external_mariadb">Banco externo (MariaDB)</option>
                </Select>
              </Field>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nova caixa de entrada"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void create()} loading={saving} disabled={newName.trim().length < 2}>
              Criar
            </Button>
          </>
        }
      >
        <Field label="Nome" hint="A caixa nasce com uma instância própria do WhatsApp e textos do bot genéricos. Depois, conecte o número em Administração > WhatsApp e ajuste o menu em Bot e menu.">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={150} />
        </Field>
      </Modal>
    </Card>
  );
}
