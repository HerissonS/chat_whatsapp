import { KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import { Button, Field, Input } from '../components/ui';
import { api } from '../lib/api';

/** Troca de senha. Obrigatória no primeiro acesso; também acessível pelo menu do usuário. */
export function ChangePasswordForm({ onDone, mandatory }: { onDone?: () => void; mandatory?: boolean }) {
  const { me, reload } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const min = me?.passwordMinLength ?? 10;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) return setError('A confirmação não confere com a nova senha.');
    setLoading(true);
    try {
      await api.post('auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Senha alterada.');
      await reload();
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {mandatory && <p className="rounded-app bg-warning/12 px-3 py-2 text-sm text-warning">Por segurança, defina uma nova senha antes de continuar.</p>}
      <Field label="Senha atual">
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="Nova senha" hint={`Mínimo de ${min} caracteres, com letras e números, sem conter o usuário.`}>
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={min} />
      </Field>
      <Field label="Confirme a nova senha">
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      {error && (
        <p role="alert" className="rounded-app bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" loading={loading} disabled={!current || !next || !confirm} icon={<KeyRound className="size-4" />}>
        Salvar nova senha
      </Button>
    </form>
  );
}

export function ChangePasswordPage() {
  const { me, logout } = useAuth();
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-app border border-border/50 bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-text">Olá, {me?.name.split(' ')[0]}</h1>
        <p className="mb-6 text-sm text-muted">Troque sua senha temporária para acessar o sistema.</p>
        <ChangePasswordForm mandatory />
        <button type="button" onClick={() => void logout()} className="mt-6 text-sm text-muted underline hover:text-text">
          Sair
        </button>
      </div>
    </div>
  );
}
