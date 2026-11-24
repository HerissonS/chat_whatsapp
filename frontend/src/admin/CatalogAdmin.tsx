import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, cx, IconButton, Input, Switch } from '../components/ui';
import { api, qs } from '../lib/api';

interface Extra {
  id: number;
  name: string;
  active: boolean;
}
interface Contract {
  id: number;
  name: string;
  active: boolean;
  equipments: number;
}
interface Equipment {
  id: number;
  contractName: string;
  code: string;
  equipType: string | null;
  active: boolean;
}

export function CatalogAdmin() {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const extras = useQuery({ queryKey: ['admin-extras'], queryFn: () => api.get<Extra[]>('admin/extra-contracts') });
  const contracts = useQuery({ queryKey: ['admin-contracts'], queryFn: () => api.get<Contract[]>('admin/catalog/contracts') });
  const [selected, setSelected] = useState<string | null>(null);
  const equipments = useQuery({
    queryKey: ['admin-equipments', selected],
    queryFn: () => api.get<Equipment[]>(`admin/catalog/equipments${qs({ contract: selected })}`),
    enabled: !!selected,
  });
  const [extraName, setExtraName] = useState('');
  const [contractName, setContractName] = useState('');
  const [equip, setEquip] = useState({ code: '', type: '' });
  const [removeContract, setRemoveContract] = useState<Contract | null>(null);
  const [importing, setImporting] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string, keys: string[][]) => {
    try {
      await fn();
      toast.success(ok);
      keys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      void qc.invalidateQueries({ queryKey: ['catalog-contracts'] });
      void qc.invalidateQueries({ queryKey: ['catalog-equipments'] });
    } catch (err) {
      toast.error(err);
    }
  };

  const importCsv = async (f: File) => {
    setImporting(true);
    const form = new FormData();
    form.append('file', f);
    try {
      const r = await api.upload<{ imported: number; errors: string[] }>('admin/catalog/import', form);
      toast.success(`${r.imported} equipamento(s) importado(s).${r.errors.length ? ` ${r.errors.length} linha(s) ignorada(s).` : ''}`);
      if (r.errors.length) toast.error(r.errors.slice(0, 3).join(' | '));
      void qc.invalidateQueries({ queryKey: ['admin-contracts'] });
      void qc.invalidateQueries({ queryKey: ['admin-equipments'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Card title="Contratos extras" description="Aparecem sempre na lista do encerramento, mesmo sem existir no catálogo (ex.: CHAMADO INTERNO).">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.post('admin/extra-contracts', { name: extraName }), 'Contrato extra adicionado.', [['admin-extras']]).then(() => setExtraName(''));
          }}
        >
          <Input value={extraName} onChange={(e) => setExtraName(e.target.value)} placeholder="Nome do contrato" maxLength={255} />
          <Button type="submit" variant="secondary" disabled={!extraName.trim()} icon={<Plus className="size-4" />}>
            Adicionar
          </Button>
        </form>
        <ul className="mt-3 divide-y divide-border/40">
          {extras.data?.map((x) => (
            <li key={x.id} className="flex items-center gap-3 py-2">
              <span className={cx('flex-1 text-sm', !x.active && 'text-muted line-through')}>{x.name}</span>
              <Switch checked={x.active} label="Ativo" onChange={(v) => void run(() => api.patch(`admin/extra-contracts/${x.id}`, { active: v }), 'Atualizado.', [['admin-extras']])} />
              <IconButton label="Remover" onClick={() => void run(() => api.del(`admin/extra-contracts/${x.id}`), 'Removido.', [['admin-extras']])}>
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Catálogo de contratos e equipamentos"
        description="Usado quando a caixa de entrada está com a fonte “Cadastro próprio”. Importe um CSV com as colunas contrato;codigo;tipo."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importCsv(f);
                e.target.value = '';
              }}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={importing} icon={<FileUp className="size-4" />}>
              Importar CSV
            </Button>
          </>
        }
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <form
              className="mb-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => api.post('admin/catalog/contracts', { name: contractName }), 'Contrato criado.', [['admin-contracts']]).then(() => setContractName(''));
              }}
            >
              <Input value={contractName} onChange={(e) => setContractName(e.target.value)} placeholder="Novo contrato" maxLength={255} />
              <Button type="submit" variant="secondary" disabled={!contractName.trim()} aria-label="Adicionar contrato">
                <Plus className="size-4" />
              </Button>
            </form>
            <ul className="max-h-96 divide-y divide-border/40 overflow-y-auto rounded-app border border-border/40">
              {!contracts.data?.length && <li className="p-3 text-sm text-muted">Nenhum contrato cadastrado.</li>}
              {contracts.data?.map((c) => (
                <li key={c.id} className={cx('flex items-center gap-2 px-3 py-2', selected === c.name && 'bg-primary/10')}>
                  <button type="button" className="flex-1 text-left text-sm" onClick={() => setSelected(c.name)}>
                    <span className={cx('font-medium', !c.active && 'text-muted line-through')}>{c.name}</span>
                    <Badge className="ml-2">{c.equipments}</Badge>
                  </button>
                  <Switch checked={c.active} label="Ativo" onChange={(v) => void run(() => api.patch(`admin/catalog/contracts/${c.id}`, { active: v }), 'Atualizado.', [['admin-contracts']])} />
                  <IconButton label="Remover contrato" onClick={() => setRemoveContract(c)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </div>
          <div>
            {!selected && <p className="text-sm text-muted">Selecione um contrato para ver e editar os equipamentos.</p>}
            {selected && (
              <>
                <h3 className="mb-2 text-sm font-semibold text-text">Equipamentos de {selected}</h3>
                <form
                  className="mb-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => api.post('admin/catalog/equipments', { contractName: selected, code: equip.code, equipType: equip.type || null }), 'Equipamento adicionado.', [['admin-equipments', selected], ['admin-contracts']]).then(() =>
                      setEquip({ code: '', type: '' }),
                    );
                  }}
                >
                  <Input value={equip.code} onChange={(e) => setEquip({ ...equip, code: e.target.value })} placeholder="Código (ex.: AT249)" maxLength={100} />
                  <Input value={equip.type} onChange={(e) => setEquip({ ...equip, type: e.target.value })} placeholder="Tipo (opcional)" maxLength={60} />
                  <Button type="submit" variant="secondary" disabled={!equip.code.trim()} aria-label="Adicionar equipamento">
                    <Plus className="size-4" />
                  </Button>
                </form>
                <ul className="max-h-80 divide-y divide-border/40 overflow-y-auto rounded-app border border-border/40">
                  {!equipments.data?.length && <li className="p-3 text-sm text-muted">Nenhum equipamento.</li>}
                  {equipments.data?.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className={cx('flex-1 font-mono', !e.active && 'text-muted line-through')}>{e.code}</span>
                      <span className="text-xs text-muted">{e.equipType}</span>
                      <Switch checked={e.active} label="Ativo" onChange={(v) => void run(() => api.patch(`admin/catalog/equipments/${e.id}`, { active: v }), 'Atualizado.', [['admin-equipments', selected]])} />
                      <IconButton label="Remover" onClick={() => void run(() => api.del(`admin/catalog/equipments/${e.id}`), 'Removido.', [['admin-equipments', selected], ['admin-contracts']])}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </Card>
      <ConfirmDialog
        open={!!removeContract}
        title="Remover contrato?"
        message={`O contrato "${removeContract?.name}" e seus ${removeContract?.equipments ?? 0} equipamento(s) serão removidos do catálogo. Chamados já encerrados não mudam.`}
        confirmLabel="Remover"
        danger
        onConfirm={() =>
          void run(() => api.del(`admin/catalog/contracts/${removeContract!.id}`), 'Contrato removido.', [['admin-contracts']]).then(() => {
            if (selected === removeContract?.name) setSelected(null);
            setRemoveContract(null);
          })
        }
        onClose={() => setRemoveContract(null)}
      />
    </>
  );
}
