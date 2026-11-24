import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { Button, Card, Input, Select } from '../components/ui';
import { api } from '../lib/api';
import { useInboxes } from '../lib/inboxes';

export function EmailAdmin() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: depts } = useInboxes();
  const [dep, setDep] = useState<number | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!dep && depts?.length) setDep(depts[0].id);
  }, [depts, dep]);
  const { data } = useQuery({ queryKey: ['admin-recipients', dep], queryFn: () => api.get<{ emails: string[] }>(`admin/departments/${dep}/email-recipients`), enabled: !!dep });
  useEffect(() => setEmails(data?.emails ?? []), [data]);

  const add = () => {
    const e = draft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return toast.error('E-mail inválido.');
    if (!emails.includes(e)) setEmails([...emails, e]);
    setDraft('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`admin/departments/${dep}/email-recipients`, { emails });
      toast.success('Destinatários salvos.');
      void qc.invalidateQueries({ queryKey: ['admin-recipients', dep] });
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ recipients: number }>(`admin/departments/${dep}/email-test`);
      toast.success(`E-mail de teste enviado para ${r.recipients} destinatário(s).`);
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(false);
    }
  };

  const dirty = JSON.stringify(emails) !== JSON.stringify(data?.emails ?? []);

  return (
    <Card
      title="E-mail de encerramento"
      description="Para quem vai o e-mail com o resumo e o PDF de cada atendimento encerrado. A conta de envio (Gmail) fica no arquivo .env do servidor."
      actions={
        depts && depts.length > 0 ? (
          <Select value={dep ?? ''} onChange={(e) => setDep(Number(e.target.value))} className="w-56">
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        ) : undefined
      }
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input type="email" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="nome@empresa.com.br" maxLength={190} />
        <Button type="submit" variant="secondary" icon={<Plus className="size-4" />} disabled={!draft}>
          Adicionar
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        {!emails.length && <p className="text-sm text-muted">Nenhum destinatário. Sem destinatários, o encerramento registra o chamado mas não envia e-mail.</p>}
        {emails.map((e) => (
          <span key={e} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-1 pr-1 pl-3 text-sm text-primary">
            {e}
            <button type="button" aria-label={`Remover ${e}`} onClick={() => setEmails(emails.filter((x) => x !== e))} className="rounded-full p-0.5 hover:bg-primary/20">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => void test()} loading={testing} disabled={dirty || !emails.length} icon={<Send className="size-4" />} title={dirty ? 'Salve antes de testar' : undefined}>
          Enviar e-mail de teste
        </Button>
        <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
          Salvar
        </Button>
      </div>
    </Card>
  );
}
