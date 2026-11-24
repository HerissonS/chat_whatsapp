import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';

/**
 * Administrador acessa qualquer caixa de entrada da organização (inclusive inativas).
 * Demais usuários só as caixas em que estão.
 */
export function assertInboxAccess(user: AuthUser, departmentId: number): void {
  if (user.role === 'admin') return;
  if (!user.departmentIds.includes(departmentId)) throw new ForbiddenException('Você não tem acesso a esta caixa de entrada.');
}
