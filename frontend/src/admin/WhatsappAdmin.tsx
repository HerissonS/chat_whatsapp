import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Contact, LogOut, Plus, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { phoneLabel } from '../lib/format';
import { getSocket } from '../lib/socket';
import { type Inbox, useInboxes } from '../lib/inboxes';
import { navigate } from '../lib/router';

const STATES: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  open: { label: 'Conectado', tone: 'success' },
  connecting: { label: 'Aguardando leitura do QR Code', tone: 'warning' },
  close: { label: 'Desconectado', tone: 'danger' },
  refused: { label: 'Recusado / expirado', tone: 'danger' },
  not_created: { label: 'Ainda não conectado', tone: 'neutral' },
};

function DepartmentConnection({ d }: { d: Inbox }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState<'connect' | 'pair' | 'logout' | 'restart' | 'import' | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const state = useQuery({
    queryKey: ['wa-state', d.id],
    queryFn: () => api.get<{ state: string; number: string | null; profileName: string | null; instance: string }>(`admin/whatsapp/${d.id}/state`),
    refetchInterval: (q) => (q.state.data?.state === 'open' ? 30_000 : 4000),
  });

  const refetchRef = useRef(state.refetch);
  refetchRef.current = state.refetch;

  useEffect(() => {
    const s = getSocket();
    const onQr = (p: { departmentId: number; base64: string | null; pairingCode: string | null }) => {
      if (p.departmentId !== d.id) return;
      if (p.base64) setQr(p.base64);
      if (p.pairingCode) setPairing(p.pairingCode);
    };
    const onStatus = (p: { departmentId: number; state: string }) => {
      if (p.departmentId !== d.id) return;
      void refetchRef.current();
      if (p.state === 'open') {
        setQr(null);
        setPairing(null);
        toast.success('WhatsApp conectado.');
        void qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
      }
    };
    s.on('whatsapp:qrcode', onQr);
    s.on('whatsapp:status', onStatus);
    return () => {
      s.off('whatsapp:qrcode', onQr);
      s.off('whatsapp:status', onStatus);
    };
  }, [d.id]);

  const connect = async (withNumber: boolean) => {
    setBusy(withNumber ? 'pair' : 'connect');
    try {
      const r = await api.post<{ state: string; base64: string | null; pairingCode: string | null }>(`admin/whatsapp/${d.id}/connect`, withNumber ? { number } : {});
      if (r.state === 'open') toast.info('Este WhatsApp já está conectado.');
      setQr(withNumber ? null : r.base64);
      setPairing(r.pairingCode);
      void state.refetch();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const importContacts = async () => {
    setBusy('import');
    try {
      const r = await api.post<{ contacts: number; groups: number }>(`admin/whatsapp/${d.id}/import-contacts`);
      toast.success(`${r.contacts} contato(s) e ${r.groups} grupo(s) importados da agenda do WhatsApp.`);
      void qc.invalidateQueries({ queryKey: ['contacts-search'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const action = async (kind: 'logout' | 'restart') => {
    setBusy(kind);
    try {
      await api.post(`admin/whatsapp/${d.id}/${kind}`);
      toast.success(kind === 'logout' ? 'WhatsApp desconectado.' : 'Conexão reiniciada.');
      setQr(null);
      setPairing(null);
      void state.refetch();
      void qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
      setConfirmLogout(false);
    }
  };

  const s = state.data?.state ?? 'not_created';
  const info = STATES[s] ?? { label: s, tone: 'neutral' as const };
  const connected = s === 'open';

  return (
    <Card
      title={d.name}
      description={`Instância: ${d.evolutionInstance ?? '—'}`}
      actions={state.isLoading ? <Spinner /> : <Badge tone={info.tone}>{info.label}</Badge>}
    >
      {connected ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-success/12 text-success">
            <CheckCircle2 className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-text">{state.data?.profileName ?? 'WhatsApp conectado'}</div>
            <div className="text-sm text-muted">{phoneLabel(state.data?.number ?? null)}</div>
          </div>
          <Button variant="secondary" onClick={() => void importContacts()} loading={busy === 'import'} icon={<Contact className="size-4" />} title="Traz os contatos e grupos sincronizados do celular. Também é feito automaticamente ao conectar.">
            Importar contatos
          </Button>
          <Button variant="secondary" onClick={() => void action('restart')} loading={busy === 'restart'} icon={<RefreshCw className="size-4" />}>
            Reiniciar
          </Button>
          <Button variant="danger" onClick={() => setConfirmLogout(true)} icon={<LogOut className="size-4" />}>
            Desconectar
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Clique em <strong className="text-text">Gerar QR Code</strong>.</li>
              <li>No celular do suporte, abra o WhatsApp &gt; Dispositivos conectados &gt; Conectar dispositivo.</li>
              <li>Aponte a câmera para o QR Code. Ele se renova sozinho até a leitura.</li>
            </ol>
            <Button onClick={() => void connect(false)} loading={busy === 'connect'} icon={<QrCode className="size-4" />}>
              Gerar QR Code
            </Button>
            <div className="border-t border-border/40 pt-4">
              <Field label="Ou conecte por código de pareamento" hint="Número com DDI e DDD, só dígitos. No celular: Conectar dispositivo > Conectar com número de telefone.">
                <div className="flex gap-2">
                  <Input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} placeholder="5594999999999" maxLength={15} />
                  <Button variant="secondary" onClick={() => void connect(true)} loading={busy === 'pair'} disabled={number.length < 10} icon={<Smartphone className="size-4" />}>
                    Gerar código
                  </Button>
                </div>
              </Field>
              {pairing && (
                <div className="mt-3 rounded-app bg-primary/8 p-3 text-center">
                  <div className="text-xs text-muted">Código de pareamento</div>
                  <div className="font-mono text-2xl font-semibold tracking-[0.3em] text-primary">{pairing}</div>
                </div>
              )}
            </div>
          </div>
          <div className="flex size-64 items-center justify-center self-start rounded-app border border-border/50 bg-white p-2">
            {qr ? <img src={qr} alt="QR Code para conectar o WhatsApp" className="size-full" /> : <QrCode className="size-16 text-muted/40" />}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmLogout}
        title="Desconectar o WhatsApp?"
        message="As mensagens deixarão de chegar até que o QR Code seja lido novamente."
        confirmLabel="Desconectar"
        danger
        loading={busy === 'logout'}
        onConfirm={() => void action('logout')}
        onClose={() => setConfirmLogout(false)}
      />
    </Card>
  );
}

export function WhatsappAdmin() {
  const { data } = useInboxes();
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold text-text">Conexão do WhatsApp</h2>
        <p className="text-sm text-muted">Cada caixa de entrada conecta o seu próprio número. Para outro número (ex.: Compras), crie uma caixa em Administração &gt; Caixas de entrada. A Evolution API não é exposta fora do servidor: tudo passa por aqui.</p>
      </div>
      {data?.filter((d) => d.evolutionInstance && d.active).map((d) => <DepartmentConnection key={d.id} d={d} />)}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => navigate('admin/caixas')} icon={<Plus className="size-4" />}>
          Nova caixa de entrada
        </Button>
      </div>
    </>
  );
}
