import { Bot, FileClock, Inbox, Mail, Palette, QrCode, ScrollText, UserCog, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { cx } from '../components/ui';
import { navigate } from '../lib/router';
import { AuditAdmin } from './AuditAdmin';
import { BotAdmin } from './BotAdmin';
import { BrandingAdmin } from './BrandingAdmin';
import { CatalogAdmin } from './CatalogAdmin';
import { DepartmentsAdmin } from './DepartmentsAdmin';
import { EmailAdmin } from './EmailAdmin';
import { GroupsAdmin } from './GroupsAdmin';
import { UsersAdmin } from './UsersAdmin';
import { WhatsappAdmin } from './WhatsappAdmin';

const SECTIONS: Array<{ id: string; label: string; icon: ReactNode; perm: string; el: () => ReactNode }> = [
  { id: 'whatsapp', label: 'WhatsApp', icon: <QrCode className="size-4" />, perm: 'admin.whatsapp', el: () => <WhatsappAdmin /> },
  { id: 'usuarios', label: 'Usuários', icon: <UserCog className="size-4" />, perm: 'admin.users', el: () => <UsersAdmin /> },
  { id: 'grupos', label: 'Grupos', icon: <Users className="size-4" />, perm: 'admin.users', el: () => <GroupsAdmin /> },
  { id: 'caixas', label: 'Caixas de entrada', icon: <Inbox className="size-4" />, perm: 'admin.departments', el: () => <DepartmentsAdmin /> },
  { id: 'bot', label: 'Bot e menu', icon: <Bot className="size-4" />, perm: 'admin.bot', el: () => <BotAdmin /> },
  { id: 'email', label: 'E-mail', icon: <Mail className="size-4" />, perm: 'admin.email', el: () => <EmailAdmin /> },
  { id: 'contratos', label: 'Contratos', icon: <ScrollText className="size-4" />, perm: 'admin.catalog', el: () => <CatalogAdmin /> },
  { id: 'aparencia', label: 'Aparência', icon: <Palette className="size-4" />, perm: 'admin.branding', el: () => <BrandingAdmin /> },
  { id: 'auditoria', label: 'Auditoria', icon: <FileClock className="size-4" />, perm: 'admin.audit', el: () => <AuditAdmin /> },
];

export function AdminPage({ section }: { section?: string }) {
  const { can } = useAuth();
  const allowed = SECTIONS.filter((s) => can(s.perm));
  const current = allowed.find((s) => s.id === section) ?? allowed[0];
  return (
    <div className="flex h-full flex-col bg-background md:flex-row">
      <aside className="shrink-0 border-b border-border/40 bg-surface md:w-60 md:border-r md:border-b-0">
        <h1 className="hidden px-5 pt-5 pb-3 text-lg font-semibold text-text md:block">Administração</h1>
        <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible" aria-label="Seções da administração">
          {allowed.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate(`admin/${s.id}`)}
              aria-current={current?.id === s.id ? 'page' : undefined}
              className={cx(
                'flex shrink-0 items-center gap-2.5 rounded-app px-3 py-2 text-sm whitespace-nowrap transition-colors',
                current?.id === s.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted hover:bg-text/5 hover:text-text',
              )}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">{current?.el()}</div>
      </main>
    </div>
  );
}
