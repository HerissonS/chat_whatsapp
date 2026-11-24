import type { Role } from '../database/schema.js';

/**
 * Catálogo de permissões (páginas e ações). Usado pelo backend para autorizar e pela tela de Grupos.
 * - Perfil "admin" (Administrador): todas as permissões, sempre (evita ficar sem acesso ao sistema).
 * - Perfil "operator" (Usuário): soma das permissões dos grupos do usuário.
 */
export const PERMISSION_CATALOG = [
  { key: 'dashboard.view', page: 'Início', label: 'Ver a tela de Início (indicadores)' },
  { key: 'chat.read', page: 'Atendimento', label: 'Ver conversas e mensagens' },
  { key: 'chat.send', page: 'Atendimento', label: 'Enviar mensagens, arquivos, reações e iniciar conversas' },
  { key: 'chat.delete', page: 'Atendimento', label: 'Apagar mensagens enviadas pelo suporte' },
  { key: 'ticket.assign', page: 'Atendimento', label: 'Atribuir chamados' },
  { key: 'ticket.close', page: 'Atendimento', label: 'Encerrar chamados e reenviar e-mail' },
  { key: 'contact.edit', page: 'Atendimento', label: 'Editar nome do contato e marcar VIP' },
  { key: 'admin.whatsapp', page: 'Administração', label: 'WhatsApp (conectar, desconectar, importar contatos)' },
  { key: 'admin.users', page: 'Administração', label: 'Usuários e grupos' },
  { key: 'admin.departments', page: 'Administração', label: 'Caixas de entrada' },
  { key: 'admin.bot', page: 'Administração', label: 'Bot e menu' },
  { key: 'admin.email', page: 'Administração', label: 'E-mail de encerramento' },
  { key: 'admin.catalog', page: 'Administração', label: 'Contratos e equipamentos' },
  { key: 'admin.branding', page: 'Administração', label: 'Aparência' },
  { key: 'admin.audit', page: 'Administração', label: 'Auditoria' },
] as const;

export type Permission = (typeof PERMISSION_CATALOG)[number]['key'];
export const PERMISSIONS: readonly Permission[] = PERMISSION_CATALOG.map((p) => p.key);

/** Permissões que um grupo novo "Atendentes" recebe por padrão. */
export const DEFAULT_AGENT_PERMISSIONS: readonly Permission[] = [
  'dashboard.view', 'chat.read', 'chat.send', 'chat.delete', 'ticket.assign', 'ticket.close', 'contact.edit',
];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  operator: 'Usuário',
};

export function isPermission(v: string): v is Permission {
  return (PERMISSIONS as readonly string[]).includes(v);
}

/** Permissões efetivas: administrador tem todas; usuário tem a soma das dos seus grupos. */
export function effectivePermissions(role: Role, groupPermissions: string[]): Permission[] {
  if (role === 'admin') return [...PERMISSIONS];
  return [...new Set(groupPermissions.filter(isPermission))];
}
