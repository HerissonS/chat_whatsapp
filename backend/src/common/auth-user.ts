import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../database/schema.js';
import type { Permission } from './permissions.js';

/** Usuário autenticado anexado à requisição pelo AuthGuard. */
export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  organizationId: number;
  departmentIds: number[];
  mustChangePassword: boolean;
  permissions: Permission[];
  sessionHash: string;
  csrfToken: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_PERMISSION = 'auth:permission';
export const ALLOW_PENDING_PASSWORD = 'auth:allow-pending-password';

/** Rota acessível sem login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Exige uma permissão específica. */
export const RequirePermission = (p: Permission) => SetMetadata(REQUIRED_PERMISSION, p);
/** Permite acesso mesmo quando o usuário ainda precisa trocar a senha. */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user!;
});

export function clientIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, '').slice(0, 45);
}
