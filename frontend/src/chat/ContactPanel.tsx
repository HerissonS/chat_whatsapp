import { useQueryClient } from '@tanstack/react-query';
import { Check, FileDown, Mail, Pencil, RotateCw, Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useLightbox } from '../components/Lightbox';
import { useToast } from '../components/Toast';
import { Avatar, Badge, cx, IconButton, Input, Switch } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, phoneLabel } from '../lib/format';
import type { Conversation, TicketHistoryItem } from '../lib/types';

const EMAIL: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  sent: { label: 'E-mail enviado', tone: 'success' },
  pending: { label: 'E-mail na fila', tone: 'warning' },
  sending: { label: 'Enviando e-mail', tone: 'warning' },
  retrying: { label: 'E-mail: nova tentativa', tone: 'warning' },
  failed: { label: 'E-mail falhou', tone: 'danger' },
  skipped: { label: 'E-mail não enviado (opção do encerramento)', tone: 'neutral' },
};

export function ContactPanel({ conversation, history }: { conversation: Conversation; history: TicketHistoryItem[] }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const openImage = useLightbox();
  const c = conversation.contact;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.customName ?? '');

  useEffect(() => {
    setEditing(false);
    setName(c.customName ?? '');
  }, [c.id, c.customName]);

  const save = async (patch: { customName?: string | null; isVip?: boolean }) => {
    try {
      await api.patch(`contacts/${c.id}`, patch);
      void qc.invalidateQueries({ queryKey: ['conversation', conversation.id] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      if (patch.isVip !== undefined) toast.success(patch.isVip ? 'Contato marcado como VIP: não recebe o menu nem a mensagem de encerramento.' : 'Contato não é mais VIP.');
    } catch (err) {
      toast.error(err);
    }
  };

  const resend = async (ticketId: number) => {
    try {
      await api.post(`tickets/${ticketId}/resend-email`);
      toast.success('E-mail reenviado para a fila.');
      void qc.invalidateQueries({ queryKey: ['conversation', conversation.id] });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col items-center gap-2 border-b border-border/40 px-5 py-6 text-center">
        <Avatar name={c.name} group={c.isGroup} size={72} contact={c} onOpen={(src) => openImage({ src, title: c.name, subtitle: 'Foto do perfil' })} />
        {editing ? (
          <form
            className="flex w-full items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ customName: name.trim() || null }).then(() => setEditing(false));
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={c.pushName ?? 'Nome'} autoFocus maxLength={150} />
            <IconButton label="Salvar nome" type="submit">
              <Check className="size-4" />
            </IconButton>
            <IconButton label="Cancelar" onClick={() => setEditing(false)}>
              <X className="size-4" />
            </IconButton>
          </form>
        ) : (
          <div className="flex items-center gap-1">
            <h2 className="text-lg font-semibold text-text">{c.name}</h2>
            {can('contact.edit') && (
              <IconButton label="Editar nome" onClick={() => setEditing(true)} className="size-7">
                <Pencil className="size-3.5" />
              </IconButton>
            )}
          </div>
        )}
        <div className="text-sm text-muted">{c.isGroup ? 'Grupo do WhatsApp' : phoneLabel(c.phone)}</div>
        {c.pushName && c.customName && <div className="text-xs text-muted">Nome no WhatsApp: {c.pushName}</div>}
      </div>

      {!c.isGroup && (
        <div className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-4">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-text">
              <Star className={cx('size-4', c.isVip ? 'fill-warning text-warning' : 'text-muted')} /> Contato VIP
            </div>
            <div className="text-xs text-muted">Não recebe o menu nem a mensagem de encerramento, e fica fora dos indicadores do Início.</div>
          </div>
          <Switch checked={c.isVip} onChange={(v) => void save({ isVip: v })} label="Contato VIP" disabled={!can('contact.edit')} />
        </div>
      )}

      <div className="px-5 py-4">
        <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Chamados</h3>
        {!history.length && <p className="text-sm text-muted">Nenhum chamado ainda.</p>}
        <ul className="space-y-2">
          {history.map((t) => {
            const email = t.email_status ? EMAIL[t.email_status] : null;
            return (
              <li key={t.id} className="rounded-app border border-border/40 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">#{t.id}</span>
                  <Badge tone={t.status === 'closed' ? 'neutral' : t.status === 'menu' ? 'warning' : 'primary'}>
                    {t.status === 'closed' ? 'Encerrado' : t.status === 'menu' ? 'Aguardando menu' : 'Aberto'}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted">{t.classification ?? 'Sem classificação'}</div>
                <div className="text-xs text-muted">
                  {dateTime(t.opened_at)}
                  {t.closed_at && ` → ${dateTime(t.closed_at)}`}
                </div>
                {t.contract && (
                  <div className="mt-1 text-xs text-text">
                    {t.contract}
                    {t.equipment && ` · ${t.equipment}`}
                  </div>
                )}
                {t.assignee && <div className="text-xs text-muted">Responsável: {t.assignee}</div>}
                {t.status === 'closed' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a href={`api/tickets/${t.id}/pdf`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" download>
                      <FileDown className="size-3.5" /> PDF
                    </a>
                    {email && (
                      <Badge tone={email.tone}>
                        <Mail className="size-3" /> {email.label}
                      </Badge>
                    )}
                    {(t.email_status === 'failed' || t.email_status === 'retrying' || t.email_status === 'skipped') && can('ticket.close') && (
                      <button type="button" onClick={() => void resend(t.id)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <RotateCw className="size-3" /> {t.email_status === 'skipped' ? 'Enviar e-mail' : 'Reenviar'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
