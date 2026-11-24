import { useQuery, useQueryClient } from '@tanstack/react-query';
import { House, KeyRound, LogOut, MessagesSquare, Monitor, Moon, Settings, Sun, Type } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { type ThemePref, useBranding } from '../branding/BrandingProvider';
import { Modal } from '../components/Modal';
import { Avatar, cx } from '../components/ui';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { getSocket } from '../lib/socket';
import type { WhatsappStatus } from '../lib/types';
import { ChangePasswordForm } from '../pages/ChangePasswordPage';

const STATE_LABEL: Record<string, string> = {
  open: 'WhatsApp conectado',
  connecting: 'WhatsApp aguardando conexão',
  close: 'WhatsApp desconectado',
  refused: 'WhatsApp desconectado',
  not_configured: 'WhatsApp não configurado',
};

function NavItem({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex size-11 items-center justify-center rounded-app transition-colors',
        active ? 'bg-white/14 text-white' : 'text-sidebar-text/65 hover:bg-white/8 hover:text-white',
      )}
    >
      {active && <span className="absolute -left-2 h-6 w-1 rounded-full bg-white" />}
      {children}
    </button>
  );
}

export function AppShell({ section, children }: { section: 'home' | 'chat' | 'admin'; children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const { themePref, setThemePref, logoFor, userFontScale, setUserFontScale, branding } = useBranding();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [pwd, setPwd] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isAdmin = me?.permissions.some((p) => p.startsWith('admin.'));
  const canHome = can('dashboard.view');
  const canChat = can('chat.read');

  const { data: wa } = useQuery({ queryKey: ['whatsapp-status'], queryFn: () => api.get<WhatsappStatus[]>('whatsapp/status'), enabled: can('chat.read') });

  useEffect(() => {
    const s = getSocket();
    const on = () => void qc.invalidateQueries({ queryKey: ['whatsapp-status'] });
    // Permissões ou caixas de entrada do usuário mudaram: recarrega o acesso e reconecta o tempo real.
    const onRefresh = () => {
      void qc.invalidateQueries();
      s.disconnect();
      s.connect();
    };
    s.on('whatsapp:status', on);
    s.on('session:refresh', onRefresh);
    return () => {
      s.off('whatsapp:status', on);
      s.off('session:refresh', onRefresh);
    };
  }, [qc]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const down = (wa ?? []).filter((w) => w.state !== 'open' && w.state !== 'not_configured');
  const anyConnecting = down.some((w) => w.state === 'connecting');
  const state = !wa?.length ? 'not_configured' : down.length ? (anyConnecting ? 'connecting' : 'close') : 'open';
  const sidebarLogo = logoFor('dark');
  const nextTheme: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' };
  const ThemeIcon = themePref === 'light' ? Sun : themePref === 'dark' ? Moon : Monitor;

  return (
    <div className="flex h-full">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-2 bg-sidebar py-3" aria-label="Navegação principal">
        {sidebarLogo ? (
          <img src={sidebarLogo} alt="" className="mb-3 h-8 w-10 object-contain" />
        ) : (
          <div className="mb-3 flex size-10 items-center justify-center rounded-app bg-white/10 text-sm font-semibold text-white" title={branding?.systemName}>
            {(branding?.systemName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
          </div>
        )}
        {canHome && (
          <NavItem active={section === 'home'} label="Início" onClick={() => navigate('inicio')}>
            <House className="size-5" />
          </NavItem>
        )}
        {canChat && (
          <NavItem active={section === 'chat'} label="Atendimento" onClick={() => navigate('chat')}>
            <MessagesSquare className="size-5" />
          </NavItem>
        )}
        {isAdmin && (
          <NavItem active={section === 'admin'} label="Administração" onClick={() => navigate('admin')}>
            <Settings className="size-5" />
          </NavItem>
        )}
        <div className="flex-1" />
        <div
          className={cx('size-3 rounded-full ring-4', state === 'open' ? 'bg-success ring-success/25' : state === 'connecting' ? 'bg-warning ring-warning/25' : 'bg-danger ring-danger/25')}
          title={STATE_LABEL[state] ?? state}
          role="status"
          aria-label={STATE_LABEL[state] ?? state}
        />
        <NavItem active={false} label={`Tema: ${themePref === 'system' ? 'automático' : themePref === 'dark' ? 'escuro' : 'claro'}`} onClick={() => setThemePref(nextTheme[themePref])}>
          <ThemeIcon className="size-5" />
        </NavItem>
        <div ref={menuRef} className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Menu do usuário" aria-expanded={menu} className="rounded-full ring-2 ring-white/10 hover:ring-white/30">
            <Avatar name={me?.name ?? '?'} size={36} />
          </button>
          {menu && (
            <div className="absolute bottom-0 left-12 z-40 w-60 rounded-app border border-border/50 bg-surface p-1 text-sm shadow-xl">
              <div className="border-b border-border/40 px-3 py-2">
                <div className="font-medium text-text">{me?.name}</div>
                <div className="text-xs text-muted">
                  {me?.username} · {me?.roleLabel}
                </div>
              </div>
              <div className="border-b border-border/40 px-3 py-2">
                <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
                  <Type className="size-3.5" /> Tamanho do texto
                </div>
                <div className="flex gap-1" role="radiogroup" aria-label="Tamanho do texto">
                  {[
                    { v: null, l: 'Padrão' },
                    { v: 100, l: 'A' },
                    { v: 112, l: 'A+' },
                    { v: 125, l: 'A++' },
                  ].map((o) => (
                    <button
                      key={o.l}
                      type="button"
                      role="radio"
                      aria-checked={userFontScale === o.v}
                      onClick={() => setUserFontScale(o.v)}
                      className={cx('flex-1 rounded px-1.5 py-1 text-xs', userFontScale === o.v ? 'bg-primary text-primary-contrast' : 'bg-text/5 text-text hover:bg-text/10')}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-text/5" onClick={() => { setMenu(false); setPwd(true); }}>
                <KeyRound className="size-4" /> Trocar senha
              </button>
              <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-danger hover:bg-danger/10" onClick={() => void logout()}>
                <LogOut className="size-4" /> Sair
              </button>
            </div>
          )}
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {down.length > 0 && (
          <div className="bg-warning/15 px-4 py-1.5 text-center text-xs font-medium text-warning" role="status">
            {down.length === 1 && (wa?.length ?? 0) === 1
              ? (STATE_LABEL[down[0].state] ?? 'WhatsApp indisponível')
              : `WhatsApp sem conexão: ${down.map((w) => w.departmentName).join(', ')}`}{' '}
            · {can('admin.whatsapp') ? 'Acesse Administração > WhatsApp para reconectar.' : 'Avise um administrador.'}
          </div>
        )}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
      <Modal open={pwd} onClose={() => setPwd(false)} title="Trocar senha" size="sm">
        <ChangePasswordForm onDone={() => setPwd(false)} />
      </Modal>
    </div>
  );
}
