import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageSquarePlus, Search, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Combobox } from '../components/Combobox';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Avatar, Badge, Button, cx, Field, Input, Select, Spinner } from '../components/ui';
import { api, qs } from '../lib/api';
import { phoneLabel, subjectPreview } from '../lib/format';
import { useInboxes } from '../lib/inboxes';
import { navigate } from '../lib/router';
import type { ContactEntry, Conversation, Message } from '../lib/types';
import { DEFAULT_FILTERS, useClassifications, useConversations } from './data';

/** Modal "Confirme as seguintes informações" do encerramento. */
export function CloseTicketModal({ open, onClose, conversation }: { open: boolean; onClose: () => void; conversation: Conversation }) {
  const toast = useToast();
  const qc = useQueryClient();
  const ticket = conversation.ticket!;
  const dep = conversation.departmentId;
  const [contract, setContract] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [classificationId, setClassificationId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: classes } = useClassifications(dep);

  const contracts = useQuery({
    queryKey: ['catalog-contracts', dep],
    queryFn: () => api.get<string[]>(`catalog/contracts${qs({ departmentId: dep })}`),
    enabled: open,
    staleTime: 60_000,
  });
  const equipments = useQuery({
    queryKey: ['catalog-equipments', dep, contract],
    queryFn: () => api.get<Array<{ code: string; type: string | null }>>(`catalog/equipments${qs({ departmentId: dep, contract })}`),
    enabled: open && !!contract,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (open) {
      setContract(null);
      setEquipment(null);
      setClassificationId(ticket.classificationId ?? classes?.find((c) => c.isDefault)?.id ?? null);
    }
  }, [open, ticket.classificationId, classes]);

  const cls = classes?.find((c) => c.id === classificationId);
  const subject = subjectPreview(contract ?? '', equipment, cls?.label ?? '');

  const submit = async () => {
    if (!contract || !classificationId) return;
    setSaving(true);
    try {
      await api.post(`tickets/${ticket.id}/close`, { contract, equipment, classificationId });
      toast.success('Atendimento encerrado. O e-mail será enviado em instantes.');
      void qc.invalidateQueries({ queryKey: ['conversation', conversation.id] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation-counts'] });
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Confirme as seguintes informações"
      description={`Encerramento do atendimento com ${conversation.contact.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={saving} disabled={!contract || !classificationId} icon={<CheckCircle2 className="size-4" />}>
            Confirmar encerramento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Contrato" required error={contracts.isError ? (contracts.error as Error).message : undefined}>
          <Combobox
            options={(contracts.data ?? []).map((c) => ({ value: c, label: c }))}
            value={contract}
            loading={contracts.isLoading}
            onChange={(v) => {
              setContract(v);
              setEquipment(null);
            }}
            placeholder="Pesquise o contrato"
          />
        </Field>
        <Field label="Equipamento" hint="Opcional. Mostra apenas os equipamentos do contrato escolhido; pesquise pelo código.">
          <Combobox
            options={(equipments.data ?? []).map((e) => ({ value: e.code, label: e.code, hint: e.type ?? undefined }))}
            value={equipment}
            onChange={setEquipment}
            loading={equipments.isLoading && !!contract}
            disabled={!contract}
            clearable
            placeholder={contract ? 'Pesquise pelo código (ex.: AT249)' : 'Escolha o contrato primeiro'}
            emptyText="Nenhum equipamento para este contrato"
          />
        </Field>
        <Field label="Classificação" required>
          <Select value={classificationId ?? ''} onChange={(e) => setClassificationId(Number(e.target.value) || null)}>
            {classes?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="rounded-app border border-border/50 bg-background p-3">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Assunto do e-mail</div>
          <div className="mt-1 font-mono text-sm break-all text-text">{subject}</div>
          <div className="mt-2 text-xs text-muted">O e-mail leva o histórico deste atendimento em PDF anexo.</div>
        </div>
      </div>
    </Modal>
  );
}

export function ForwardModal({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  const { data } = useConversations({ ...DEFAULT_FILTERS, status: 'all' }, q.trim());
  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);

  useEffect(() => {
    if (message) {
      setSelected([]);
      setQ('');
    }
  }, [message]);

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 10 ? s : [...s, id]));

  const send = async () => {
    if (!message) return;
    setSending(true);
    try {
      const r = await api.post<{ results: Array<{ ok: boolean; error?: string }> }>(`messages/${message.id}/forward`, { conversationIds: selected });
      const fails = r.results.filter((x) => !x.ok);
      if (fails.length) toast.error(`Falha em ${fails.length} conversa(s): ${fails[0].error}`);
      else toast.success('Mensagem encaminhada.');
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={!!message}
      onClose={onClose}
      title="Encaminhar mensagem"
      description="Escolha até 10 conversas."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void send()} loading={sending} disabled={!selected.length} icon={<Send className="size-4" />}>
            Encaminhar{selected.length ? ` (${selected.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversa" className="pl-9" />
      </div>
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        {items.map((c) => (
          <li key={c.id}>
            <label className={cx('flex cursor-pointer items-center gap-3 rounded-app px-2 py-2 hover:bg-text/5', selected.includes(c.id) && 'bg-primary/10')}>
              <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="size-4 accent-[var(--color-primary)]" />
              <Avatar name={c.contact.name} group={c.contact.isGroup} size={32} contact={c.contact} />
              <span className="truncate text-sm text-text">{c.contact.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function NewConversationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState<number | 'phone' | null>(null);
  const [error, setError] = useState('');
  const { data: inboxes } = useInboxes();
  const usable = (inboxes ?? []).filter((i) => i.active && i.evolutionInstance);
  const multi = usable.length > 1;
  const [inbox, setInbox] = useState<number | null>(null);
  const chosenInbox = inbox ?? usable.find((i) => i.waState === 'open')?.id ?? usable[0]?.id ?? null;
  const inboxName = (id: number) => usable.find((i) => i.id === id)?.name;

  useEffect(() => {
    if (open) {
      setQ('');
      setDebounced('');
      setError('');
    }
  }, [open]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const contacts = useQuery({
    queryKey: ['contacts-search', debounced, multi ? chosenInbox : null],
    queryFn: () => api.get<ContactEntry[]>(`contacts${qs({ q: debounced, limit: 50, departmentId: multi ? chosenInbox : undefined })}`),
    enabled: open,
    staleTime: 30_000,
  });

  const digits = q.replace(/\D/g, '');
  const looksLikePhone = digits.length >= 10 && digits.length === q.replace(/[\s()+-]/g, '').length;

  const go = (c: Conversation) => {
    onClose();
    navigate(`chat/${c.id}`);
  };

  const openContact = async (c: ContactEntry) => {
    if (c.conversationId) return go({ id: c.conversationId } as Conversation);
    setLoading(c.id);
    setError('');
    try {
      go(await api.post<Conversation>(`contacts/${c.id}/open`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const openPhone = async () => {
    setLoading('phone');
    setError('');
    try {
      const c = await api.post<Conversation>('conversations', { phone: digits, ...(chosenInbox && { departmentId: chosenInbox }) });
      go(c);
      toast.success(`Conversa com ${c.contact.name} pronta.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Nova conversa" description="Pesquise na agenda do WhatsApp ou digite um número com DDI e DDD.">
      {multi && (
        <Field label="Caixa de entrada (por qual WhatsApp a conversa sai)">
          <Select value={chosenInbox ?? ''} onChange={(e) => setInbox(Number(e.target.value))} className="mb-3">
            {usable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.waState !== 'open' ? ' (desconectado)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome ou número (ex.: 55 94 99999-9999)"
          className="pl-9"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && looksLikePhone) void openPhone();
          }}
        />
      </div>
      {error && (
        <p role="alert" className="mb-3 rounded-app bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {looksLikePhone && (
        <button
          type="button"
          onClick={() => void openPhone()}
          className="mb-2 flex w-full items-center gap-3 rounded-app border border-primary/40 bg-primary/5 px-3 py-2.5 text-left text-sm hover:bg-primary/10"
        >
          <MessageSquarePlus className="size-5 text-primary" />
          <span className="flex-1">
            Conversar com <strong>+{digits}</strong>
          </span>
          {loading === 'phone' && <Spinner className="size-4" />}
        </button>
      )}
      <ul className="max-h-96 space-y-0.5 overflow-y-auto">
        {contacts.isLoading && (
          <li className="flex justify-center p-4">
            <Spinner />
          </li>
        )}
        {!contacts.isLoading && !contacts.data?.length && !looksLikePhone && (
          <li className="p-4 text-center text-sm text-muted">
            Nenhum contato encontrado. {q ? 'Digite o número completo para iniciar a conversa.' : 'Importe a agenda em Administração > WhatsApp.'}
          </li>
        )}
        {contacts.data?.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => void openContact(c)} className="flex w-full items-center gap-3 rounded-app px-2 py-2 text-left hover:bg-text/5">
              <Avatar name={c.name} group={c.isGroup} size={36} contact={c} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text">{c.name}</div>
                <div className="truncate text-xs text-muted">
                  {c.isGroup ? 'Grupo' : phoneLabel(c.phone)}
                  {multi && inboxName(c.departmentId) ? ` · ${inboxName(c.departmentId)}` : ''}
                </div>
              </div>
              {c.conversationId && <Badge>Já conversou</Badge>}
              {loading === c.id && <Spinner className="size-4" />}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
