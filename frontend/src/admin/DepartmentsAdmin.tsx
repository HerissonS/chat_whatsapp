import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog, Modal } from '../components/Modal';
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
  const [toggling, setToggling] = useState<Department | null>(null);
  const [removing, setRemoving] = useState<Department | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(editing), [editing]);

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['admin-departments'] });
    void qc.invalidateQueries({ queryKey: ['inboxes'] });
    void qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
    void qc.invalidateQueries({ queryKey: ['admin-users'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };

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
      invalidateAll();
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
      invalidateAll();
      setCreating(false);
      setNewName('');
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (d: Department, active: boolean) => {
    setSaving(true);
    try {
      await api.patch(`admin/departments/${d.id}`, { active });
      toast.success(active ? 'Caixa de entrada reativada.' : 'Caixa de entrada inativada.');
      invalidateAll();
      setToggling(null);
      setRemoving(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setSaving(true);
    try {
      await api.del(`admin/departments/${removing.id}`);
      toast.success('Caixa de entrada removida.');
      invalidateAll();
      setRemoving(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const onlyOne = (data?.length ?? 0) <= 1;

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
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text">{d.name}</span>
                {d.active ? <Badge tone="success">Ativa</Badge> : <Badge tone="danger">Inativa</Badge>}
              </div>
              <div className="text-xs text-muted">
                WhatsApp: {d.waState === 'open' ? `conectado${d.waNumber ? ` (+${d.waNumber})` : ''}` : 'não conectado'} · Instância: {d.evolutionInstance ?? 'não definida'} · Catálogo: {d.catalogSource === 'local' ? 'cadastro próprio' : 'banco externo'}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {d.active ? (
                <IconButton label="Inativar caixa de entrada" onClick={() => setToggling(d)}>
                  <PowerOff className="size-4" />
                </IconButton>
              ) : (
                <IconButton label="Reativar caixa de entrada" onClick={() => void setActive(d, true)} disabled={saving}>
                  <Power className="size-4" />
                </IconButton>
              )}
              <IconButton label="Editar" onClick={() => setEditing(d)}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton
                label={onlyOne ? 'Não é possível remover a única caixa de entrada' : 'Remover'}
                disabled={onlyOne}
                onClick={() => setRemoving(d)}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
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
              <SwitchRow
                label="Caixa de entrada ativa"
                description="Ao inativar, novas mensagens não são processadas e a caixa fica oculta no atendimento."
                checked={form.active}
                onChange={(v) => setForm({ ...form, active: v })}
              />
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

      <ConfirmDialog
        open={!!toggling}
        title="Inativar caixa de entrada?"
        message={`A caixa "${toggling?.name}" ficará oculta no atendimento e novas mensagens recebidas serão ignoradas até que ela seja reativada. O histórico de conversas e chamados é preservado.`}
        confirmLabel="Inativar"
        danger
        loading={saving}
        onConfirm={() => toggling && void setActive(toggling, false)}
        onClose={() => setToggling(null)}
      />

      {removing && removing.canDelete ? (
        <ConfirmDialog
          open
          title="Remover caixa de entrada?"
          message={`A caixa "${removing.name}", seus textos do bot, destinatários de e-mail e a instância "${removing.evolutionInstance ?? ''}" na Evolution serão removidos permanentemente.`}
          confirmLabel="Remover"
          danger
          loading={saving}
          onConfirm={() => void remove()}
          onClose={() => setRemoving(null)}
        />
      ) : (
        <Modal
          open={!!removing}
          onClose={() => setRemoving(null)}
          title="Não é possível remover"
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Fechar
              </Button>
              {removing?.active && (
                <Button variant="danger" loading={saving} onClick={() => removing && void setActive(removing, false)}>
                  Inativar caixa
                </Button>
              )}
            </>
          }
        >
          <p className="text-sm text-muted">
            A caixa <strong className="text-text">{removing?.name}</strong> já possui{' '}
            <strong className="text-text">{removing?.conversationsCount ?? 0}</strong> conversa(s) e{' '}
            <strong className="text-text">{removing?.ticketsCount ?? 0}</strong> chamado(s) registrados, portanto não pode ser excluída para preservar o histórico.
            {removing?.active
              ? ' Você pode inativá-la para parar o atendimento e ocultá-la das telas.'
              : ' Ela já está inativa.'}
          </p>
        </Modal>
      )}
    </Card>
  );
}
