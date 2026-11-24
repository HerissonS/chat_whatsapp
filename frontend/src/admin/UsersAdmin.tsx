import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LockOpen, Pencil, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Avatar, Badge, Button, Card, Field, IconButton, Input, Select, Spinner, SwitchRow } from '../components/ui';
import { api } from '../lib/api';
import { dateTime } from '../lib/format';
import { useInboxes } from '../lib/inboxes';
import { type AdminUser, useAdminUsers, useGroups } from './shared';

function UserForm({ user, onClose }: { user: AdminUser | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { data: depts } = useInboxes();
  const { data: groups } = useGroups();
  const isNew = user === 'new';
  const u = isNew ? null : user;
  const [form, setForm] = useState({ username: '', name: '', email: '', role: 'operator' as 'admin' | 'operator', password: '', active: true, departmentIds: [] as number[], groupIds: [] as number[] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm(
      u
        ? { username: u.username, name: u.name, email: u.email ?? '', role: u.role, password: '', active: u.active, departmentIds: u.departmentIds, groupIds: u.groupIds }
        : { username: '', name: '', email: '', role: 'operator', password: '', active: true, departmentIds: depts?.length === 1 ? [depts[0].id] : [], groupIds: [] },
    );
  }, [user, u, depts]);

  const toggle = (key: 'departmentIds' | 'groupIds', id: number) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { name: form.name, email: form.email || null, role: form.role, departmentIds: form.departmentIds, groupIds: form.groupIds };
      if (isNew) await api.post('admin/users', { ...payload, username: form.username, password: form.password });
      else await api.patch(`admin/users/${u!.id}`, { ...payload, active: form.active });
      toast.success(isNew ? 'Usuário criado. Ele trocará a senha no primeiro acesso.' : 'Usuário atualizado.');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      void qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={isNew ? 'Novo usuário' : `Editar ${u?.name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!form.name || (isNew && (!form.username || !form.password))}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Usuário (login)" required hint={isNew ? 'Letras minúsculas, números, ponto, hífen ou sublinhado.' : undefined}>
          <Input value={form.username} disabled={!isNew} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} maxLength={60} />
        </Field>
        <Field label="Nome completo" required hint="Aparece nas mensagens enviadas ao técnico.">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={150} />
        </Field>
        <Field label="E-mail">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={190} />
        </Field>
        <Field label="Perfil" required>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'operator' })} disabled={u?.id === me?.id}>
            <option value="operator">Usuário (acesso pelos grupos)</option>
            <option value="admin">Administrador (acesso total)</option>
          </Select>
        </Field>
        {isNew && (
          <Field label="Senha temporária" required hint="O usuário será obrigado a trocar no primeiro acesso.">
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        )}
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Caixas de entrada</legend>
          <div className="space-y-1.5">
            {depts?.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={form.departmentIds.includes(d.id)} onChange={() => toggle('departmentIds', d.id)} />
                {d.name}
              </label>
            ))}
          </div>
          {form.role === 'admin' && <p className="mt-1 text-xs text-muted">Administradores veem todas as caixas de entrada.</p>}
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Grupos</legend>
          {!groups?.length && <p className="text-xs text-muted">Nenhum grupo cadastrado.</p>}
          {form.role === 'operator' && !form.groupIds.length && (
            <p className="mb-1 text-xs text-warning">Sem grupo, o usuário entra mas não acessa nenhuma página.</p>
          )}
          {form.role === 'admin' && <p className="mb-1 text-xs text-muted">Administradores têm acesso total; os grupos servem só para organização.</p>}
          <div className="space-y-1.5">
            {groups?.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={form.groupIds.includes(g.id)} onChange={() => toggle('groupIds', g.id)} />
                {g.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {!isNew && u?.id !== me?.id && (
        <div className="mt-4 border-t border-border/40 pt-2">
          <SwitchRow label="Usuário ativo" description="Desativar encerra todas as sessões dele imediatamente." checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
        </div>
      )}
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [pwd, setPwd] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setPwd(''), [user]);
  const save = async () => {
    setSaving(true);
    try {
      await api.post(`admin/users/${user!.id}/reset-password`, { password: pwd });
      toast.success('Senha redefinida. O usuário trocará no próximo acesso.');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={!!user}
      onClose={onClose}
      size="sm"
      title={`Redefinir senha de ${user?.name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!pwd}>
            Redefinir
          </Button>
        </>
      }
    >
      <Field label="Senha temporária" hint="As sessões abertas desse usuário serão encerradas.">
        <Input type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function UsersAdmin() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useAdminUsers();
  const { data: depts } = useInboxes();
  const { data: groups } = useGroups();
  const deptName = (id: number) => depts?.find((d) => d.id === id)?.name ?? `#${id}`;
  const groupName = (id: number) => groups?.find((g) => g.id === id)?.name ?? `#${id}`;
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);

  const unlock = async (u: AdminUser) => {
    try {
      await api.post(`admin/users/${u.id}/unlock`);
      toast.success('Usuário desbloqueado.');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Card
      title="Usuários"
      description="Quem acessa o sistema. Administradores têm acesso total; os demais usuários acessam o que os grupos deles permitem."
      actions={
        <Button onClick={() => setEditing('new')} icon={<UserPlus className="size-4" />}>
          Novo usuário
        </Button>
      }
    >
      {isLoading && <Spinner />}
      <ul className="divide-y divide-border/40">
        {data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
            <Avatar name={u.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-text">{u.name}</span>
                <Badge tone={u.role === 'admin' ? 'primary' : 'neutral'}>{u.roleLabel}</Badge>
                {!u.active && <Badge tone="danger">Inativo</Badge>}
                {u.locked && <Badge tone="warning">Bloqueado</Badge>}
                {u.mustChangePassword && u.active && <Badge tone="warning">Troca de senha pendente</Badge>}
              </div>
              <div className="text-xs text-muted">
                {u.username}
                {u.email && ` · ${u.email}`} · Último acesso: {dateTime(u.lastLoginAt)}
              </div>
              <div className="text-xs text-muted">
                {u.role === 'admin' ? 'Todas as caixas' : u.departmentIds.map((id) => deptName(id)).join(', ') || 'Nenhuma caixa'}
                {' · '}
                {u.groupIds.map((id) => groupName(id)).join(', ') || 'Sem grupo'}
              </div>
            </div>
            <div className="flex gap-1">
              {u.locked && (
                <IconButton label="Desbloquear" onClick={() => void unlock(u)}>
                  <LockOpen className="size-4" />
                </IconButton>
              )}
              <IconButton label="Redefinir senha" onClick={() => setResetting(u)}>
                <KeyRound className="size-4" />
              </IconButton>
              <IconButton label="Editar" onClick={() => setEditing(u)}>
                <Pencil className="size-4" />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
      <UserForm user={editing} onClose={() => setEditing(null)} />
      <ResetPassword user={resetting} onClose={() => setResetting(null)} />
    </Card>
  );
}
