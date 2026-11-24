import { Eye, EyeOff, LogIn } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useBranding } from '../branding/BrandingProvider';
import { Button, Field, Input } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const { branding, theme, logoFor } = useBranding();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-full">
      <aside className="relative hidden w-[42%] flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-text lg:flex">
        {logoFor('dark') ? (
          <img src={logoFor('dark')!} alt="" className="h-16 w-auto self-start" />
        ) : (
          <div className="text-2xl font-semibold">{branding?.systemName}</div>
        )}
        <div className="relative z-10 max-w-md">
          <h1 className="text-3xl leading-tight font-semibold">Atendimento pelo WhatsApp, organizado em chamados.</h1>
          <p className="mt-3 text-sidebar-text/70">Converse com seus contatos, classifique os atendimentos e envie o encerramento por e-mail com o histórico completo.</p>
        </div>
        <p className="text-xs text-sidebar-text/50">{branding?.systemName}</p>
        <div className="pointer-events-none absolute -right-32 -bottom-32 size-[28rem] rounded-full border-[48px] border-white/5" />
        <div className="pointer-events-none absolute -right-10 -bottom-10 size-[16rem] rounded-full border-[32px] border-white/5" />
      </aside>
      <main className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" noValidate>
          <div className="space-y-4">
            {logoFor(theme) && <img src={logoFor(theme)!} alt="Logo" className="h-14 w-auto lg:hidden" />}
            <div>
              <h2 className="text-2xl font-semibold text-text">Entrar</h2>
              <p className="text-sm text-muted">Use seu usuário e senha{branding?.systemName ? ` do ${branding.systemName}` : ''}.</p>
            </div>
          </div>
          <Field label="Usuário">
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={60} />
          </Field>
          <Field label="Senha">
            <div className="relative">
              <Input
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-text"
                aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          {error && (
            <p role="alert" className="rounded-app bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={loading} disabled={!username || !password} icon={<LogIn className="size-4" />}>
            Entrar
          </Button>
        </form>
      </main>
    </div>
  );
}
