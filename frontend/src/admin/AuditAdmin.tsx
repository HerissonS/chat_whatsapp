import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Input, Spinner } from '../components/ui';
import { api, qs } from '../lib/api';
import { dateTime } from '../lib/format';

interface AuditItem {
  id: string;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  details: unknown;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Entrou no sistema',
  'auth.logout': 'Saiu do sistema',
  'auth.login.failed': 'Falha de login',
  'auth.login.blocked': 'Login bloqueado',
  'auth.login.rate_limited': 'Excesso de tentativas (IP)',
  'auth.user.locked': 'Usuário bloqueado por tentativas',
  'auth.password.changed': 'Trocou a senha',
  'auth.password.change_failed': 'Falha ao trocar a senha',
  'admin.user.created': 'Criou usuário',
  'admin.user.updated': 'Alterou usuário',
  'admin.user.deactivated': 'Desativou usuário',
  'admin.user.password_reset': 'Redefiniu senha',
  'admin.user.unlocked': 'Desbloqueou usuário',
  'ticket.closed': 'Encerrou chamado',
  'ticket.assigned': 'Atribuiu chamado',
  'ticket.email.resent': 'Reenviou e-mail',
  'contact.vip.enabled': 'Marcou contato como VIP',
  'contact.vip.disabled': 'Removeu VIP do contato',
  'chat.message.deleted': 'Apagou mensagem',
  'admin.whatsapp.connect_requested': 'Solicitou conexão do WhatsApp',
  'admin.whatsapp.logout': 'Desconectou o WhatsApp',
  'admin.whatsapp.restart': 'Reiniciou o WhatsApp',
  'admin.branding.updated': 'Alterou a aparência',
  'admin.bot.updated': 'Alterou bot e menu',
  'admin.department.created': 'Criou caixa de entrada',
  'admin.department.updated': 'Alterou caixa de entrada',
  'admin.department.deleted': 'Removeu caixa de entrada',
};

export function AuditAdmin() {
  const [username, setUsername] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ username: '', action: '', from: '', to: '' });
  const { data, isLoading } = useQuery({
    queryKey: ['audit', filters, page],
    queryFn: () =>
      api.get<{ total: number; page: number; pageSize: number; items: AuditItem[] }>(
        `admin/audit${qs({ ...filters, from: filters.from ? new Date(filters.from).toISOString() : undefined, to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined, page, pageSize: 50 })}`,
      ),
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card title="Auditoria" description="Registro de acessos e ações sensíveis. Não contém senhas nem conteúdo de mensagens.">
      <form
        className="mb-4 grid gap-2 sm:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters({ username, action, from, to });
        }}
      >
        <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Usuário" />
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Ação (ex.: auth, ticket)" />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>
      {isLoading && <Spinner />}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-border/40">
              <th className="py-2 pr-3 font-medium">Data</th>
              <th className="py-2 pr-3 font-medium">Usuário</th>
              <th className="py-2 pr-3 font-medium">Ação</th>
              <th className="py-2 pr-3 font-medium">Alvo</th>
              <th className="py-2 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((i) => (
              <tr key={i.id} className="border-b border-border/25 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-muted">{dateTime(i.created_at)}</td>
                <td className="py-2 pr-3">{i.username ?? '-'}</td>
                <td className="py-2 pr-3">
                  <div>{ACTION_LABELS[i.action] ?? i.action}</div>
                  {i.details != null && <div className="max-w-md truncate font-mono text-xs text-muted">{JSON.stringify(i.details)}</div>}
                </td>
                <td className="py-2 pr-3 text-muted">{i.target_type ? `${i.target_type} ${i.target_id ?? ''}` : '-'}</td>
                <td className="py-2 font-mono text-xs text-muted">{i.ip ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-muted">
        <span>{data?.total ?? 0} registro(s)</span>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <span>
            {page} / {pages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
