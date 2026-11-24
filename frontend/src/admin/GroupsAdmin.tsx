import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog, Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, Field, IconButton, Input } from '../components/ui';
import { api } from '../lib/api';
import { type Group, useAdminUsers, useGroups, usePermissionCatalog } from './shared';

export function GroupsAdmin() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: groups } = useGroups();
  const { data: users } = useAdminUsers();
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const [removing, setRemoving] = useState<Group | null>(null);
  const [form, setForm] = useState({ name: '', description: '', memberIds: [] as number[], permissions: [] as string[] });
  const { data: catalog } = usePermissionCatalog();
  const pages = [...new Set((catalog ?? []).map((p) => p.page))];
  const togglePerm = (key: string) =>
    setForm((f) => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((x) => x !== key) : [...f.permissions, key] }));
  const togglePage = (page: string, on: boolean) => {
    const keys = (catalog ?? []).filter((p) => p.page === page).map((p) => p.key);
    setForm((f) => ({ ...f, permissions: on ? [...new Set([...f.permissions, ...keys])] : f.permissions.filter((k) => !keys.includes(k)) }));
  };
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing === 'new') setForm({ name: '', description: '', memberIds: [], permissions: ['dashboard.view', 'chat.read', 'chat.send'] });
    else if (editing) setForm({ name: editing.name, description: editing.description ?? '', memberIds: editing.memberIds, permissions: editing.permissions });
  }, [editing]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { name: form.name, description: form.description || null, memberIds: form.memberIds, permissions: form.permissions };
      if (editing === 'new') await api.post('admin/groups', body);
      else await api.patch(`admin/groups/${(editing as Group).id}`, body);
      toast.success('Grupo salvo.');
      void qc.invalidateQueries({ queryKey: ['admin-groups'] });
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      setEditing(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.del(`admin/groups/${removing!.id}`);
      toast.success('Grupo removido.');
      void qc.invalidateQueries({ queryKey: ['admin-groups'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setRemoving(null);
    }
  };

  const name = (id: number) => users?.find((u) => u.id === id)?.name ?? `#${id}`;

  return (
    <Card
      title="Grupos de usuários"
      description="Cada grupo define quais páginas e ações seus membros podem acessar. Um usuário pode estar em vários grupos (as permissões somam). Administradores sempre têm acesso total."
      actions={
        <Button onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>
          Novo grupo
        </Button>
      }
    >
      {!groups?.length && <EmptyState title="Nenhum grupo" description="Crie grupos para organizar os atendentes." />}
      <ul className="divide-y divide-border/40">
        {groups?.map((g) => (
          <li key={g.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-text">{g.name}</div>
              <div className="truncate text-xs text-muted">{g.memberIds.length ? g.memberIds.map(name).join(', ') : 'Sem membros'}</div>
              <div className="truncate text-xs text-muted">
                {g.permissions.length
                  ? `Acesso: ${[...new Set((catalog ?? []).filter((p) => g.permissions.includes(p.key)).map((p) => p.page))].join(', ')} (${g.permissions.length} permissões)`
                  : 'Sem permissões'}
              </div>
            </div>
            <IconButton label="Editar" onClick={() => setEditing(g)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Remover" onClick={() => setRemoving(g)}>
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Novo grupo' : 'Editar grupo'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={form.name.trim().length < 2}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} />
          </Field>
          <Field label="Descrição">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={255} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">Permissões</legend>
            <div className="space-y-3">
              {pages.map((page) => {
                const items = (catalog ?? []).filter((p) => p.page === page);
                const all = items.every((p) => form.permissions.includes(p.key));
                return (
                  <div key={page} className="rounded-app border border-border/40 p-3">
                    <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
                      <input type="checkbox" checked={all} onChange={(e) => togglePage(page, e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
                      {page}
                    </label>
                    <div className="grid gap-1.5 pl-6 sm:grid-cols-2">
                      {items.map((p) => (
                        <label key={p.key} className="flex items-start gap-2 text-sm text-text">
                          <input type="checkbox" checked={form.permissions.includes(p.key)} onChange={() => togglePerm(p.key)} className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]" />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">Membros</legend>
            <div className="grid max-h-60 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {users?.filter((u) => u.active).map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={form.memberIds.includes(u.id)}
                    onChange={() =>
                      setForm((f) => ({ ...f, memberIds: f.memberIds.includes(u.id) ? f.memberIds.filter((x) => x !== u.id) : [...f.memberIds, u.id] }))
                    }
                  />
                  {u.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Modal>
      <ConfirmDialog open={!!removing} title="Remover grupo?" message={`O grupo "${removing?.name}" será removido. Os usuários não são afetados.`} confirmLabel="Remover" danger onConfirm={() => void remove()} onClose={() => setRemoving(null)} />
    </Card>
  );
}
