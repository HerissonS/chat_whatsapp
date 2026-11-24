import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ALLOW_PENDING_PASSWORD,
  type AuthedRequest,
  IS_PUBLIC,
  REQUIRED_PERMISSION,
} from '../common/auth-user.js';
import type { Permission } from '../common/permissions.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';
import { UserLoaderService } from './user-loader.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Guarda global: toda rota exige login, exceto as marcadas com @Public().
 * - Valida a sessão (cookie HttpOnly) e se o usuário continua ativo.
 * - Exige o cabeçalho X-CSRF-Token em métodos que alteram dados.
 * - Bloqueia o uso do sistema enquanto a troca obrigatória de senha estiver pendente.
 * - Confere a permissão exigida pela rota (@RequirePermission).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly users: UserLoaderService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const sid = readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = sid ? await this.sessions.touch(sid) : null;
    if (!session) throw new UnauthorizedException('Sessão expirada. Entre novamente.');

    const user = await this.users.load(session.data.userId);
    if (!user) {
      await this.sessions.destroy(session.hash, session.data.userId);
      throw new UnauthorizedException('Usuário inativo.');
    }

    if (!SAFE_METHODS.has(req.method)) {
      const token = req.headers['x-csrf-token'];
      if (typeof token !== 'string' || !safeEqual(token, session.data.csrf)) {
        throw new ForbiddenException('Token de segurança inválido. Recarregue a página.');
      }
    }

    req.user = { ...user, sessionHash: session.hash, csrfToken: session.data.csrf };

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw new ForbiddenException({ message: 'Troque sua senha para continuar.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    const required = this.reflector.getAllAndOverride<Permission>(REQUIRED_PERMISSION, targets);
    if (required && !user.permissions.includes(required)) {
      throw new ForbiddenException('Você não tem permissão para esta ação.');
    }
    return true;
  }
}
