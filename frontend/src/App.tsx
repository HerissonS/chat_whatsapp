import { ShieldOff } from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import { AdminPage } from './admin/AdminPage';
import { ChatPage } from './chat/ChatPage';
import { Button, EmptyState, Spinner } from './components/ui';
import { AppShell } from './layout/AppShell';
import { useRoute } from './lib/router';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  const { me, loading, can, logout } = useAuth();
  const route = useRoute();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }
  if (!me) return <LoginPage />;
  if (me.mustChangePassword) return <ChangePasswordPage />;

  const [section, sub] = route;
  const canAdmin = me.permissions.some((p) => p.startsWith('admin.'));
  const canChat = can('chat.read');
  const canHome = can('dashboard.view');

  if (section === 'admin' && canAdmin) {
    return (
      <AppShell section="admin">
        <AdminPage section={sub} />
      </AppShell>
    );
  }
  if ((section === 'chat' && canChat) || (!canHome && canChat)) {
    const conversationId = section === 'chat' && sub && /^\d+$/.test(sub) ? Number(sub) : null;
    return (
      <AppShell section="chat">
        <ChatPage conversationId={conversationId} />
      </AppShell>
    );
  }
  if (canHome) {
    return (
      <AppShell section="home">
        <HomePage />
      </AppShell>
    );
  }
  if (canAdmin) {
    return (
      <AppShell section="admin">
        <AdminPage section={sub} />
      </AppShell>
    );
  }
  return (
    <EmptyState
      icon={<ShieldOff className="size-7" />}
      title="Seu usuário ainda não tem acesso"
      description="Peça a um administrador para incluir você em um grupo com as permissões necessárias."
      action={
        <Button variant="secondary" onClick={() => void logout()}>
          Sair
        </Button>
      }
    />
  );
}
