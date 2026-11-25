import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AllowPendingPassword, type AuthUser, clientIp, CurrentUser, Public } from '../common/auth-user.js';
import { ROLE_LABELS } from '../common/permissions.js';
import { parse } from '../common/validation.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { REDIS } from '../redis/redis.module.js';
import { PasswordService } from './password.service.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(60),
  password: z.string().min(1).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

/** Limite por IP: no máximo 20 tentativas de login a cada 15 minutos. */
const IP_WINDOW_SECONDS = 900;
const IP_MAX_ATTEMPTS = 20;

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { username, password } = parse(loginSchema, body);
    const ip = clientIp(req);
    const generic = new UnauthorizedException('Usuário ou senha inválidos.');

    const ipKey = `login:ip:${ip}`;
    const attempts = await this.redis.incr(ipKey);
    if (attempts === 1) await this.redis.expire(ipKey, IP_WINDOW_SECONDS);
    if (attempts > IP_MAX_ATTEMPTS) {
      await this.audit.log({ action: 'auth.login.rate_limited', username, ip });
      throw new ForbiddenException('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    }

    const user = await this.db.selectFrom('users').selectAll().where('username', '=', username).executeTakeFirst();
    const valid = await this.passwords.verify(user?.password_hash ?? null, password);

    if (!user || user.active !== 1) {
      await this.audit.log({ action: 'auth.login.failed', username, ip, details: { reason: user ? 'inativo' : 'inexistente' } });
      throw generic;
    }
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      await this.audit.log({ action: 'auth.login.blocked', username, ip, targetType: 'user', targetId: user.id });
      throw new ForbiddenException('Usuário temporariamente bloqueado por excesso de tentativas. Tente mais tarde.');
    }
    if (!valid) {
      const failures = user.failed_logins + 1;
      const lock = failures >= this.config.LOGIN_MAX_FAILURES;
      await this.db
        .updateTable('users')
        .set({
          failed_logins: lock ? 0 : failures,
          locked_until: lock ? new Date(Date.now() + this.config.LOGIN_LOCK_MINUTES * 60_000) : user.locked_until,
        })
        .where('id', '=', user.id)
        .execute();
      await this.audit.log({
        action: lock ? 'auth.user.locked' : 'auth.login.failed',
        username,
        ip,
        targetType: 'user',
        targetId: user.id,
        details: { reason: 'senha', failures },
      });
      throw generic;
    }

    await this.db
      .updateTable('users')
      .set({ failed_logins: 0, locked_until: null, last_login_at: new Date(), last_login_ip: ip })
      .where('id', '=', user.id)
      .execute();
    await this.redis.del(ipKey);

    const session = await this.sessions.create(user.id, ip);
    this.setCookie(res, session.sid);
    await this.audit.log({
      action: 'auth.login',
      user: { id: user.id, username: user.username, organizationId: user.organization_id },
      ip,
    });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  @AllowPendingPassword()
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.destroy(user.sessionHash, user.id);
    this.realtime.disconnectSessions([user.sessionHash]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    await this.audit.log({ action: 'auth.logout', user, ip: clientIp(req) });
    return { ok: true };
  }

  @Get('me')
  @AllowPendingPassword()
  async me(@CurrentUser() user: AuthUser) {
    const row = await this.db
      .selectFrom('users')
      .select(['email', 'preferences'])
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    let preferences: Record<string, unknown> = {};
    try {
      preferences = row.preferences ? (JSON.parse(row.preferences) as Record<string, unknown>) : {};
    } catch {
      preferences = {};
    }
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: row.email,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role],
      permissions: user.permissions,
      departmentIds: user.departmentIds,
      mustChangePassword: user.mustChangePassword,
      csrfToken: user.csrfToken,
      preferences,
      passwordMinLength: this.config.PASSWORD_MIN_LENGTH,
      mediaMaxMb: this.config.MEDIA_MAX_MB,
    };
  }

  @Post('preferences')
  @HttpCode(200)
  async preferences(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const prefs = parse(
      z.object({
        theme: z.enum(['light', 'dark', 'system']).optional(),
        sound: z.boolean().optional(),
        desktopNotifications: z.boolean().optional(),
        notificationSound: z.enum(['classic', 'pop', 'double', 'chime', 'marimba', 'drop', 'soft', 'custom', 'none']).optional(),
        soundVolume: z.number().int().min(0).max(100).optional(),
      }),
      body,
    );
    // Mescla com as preferências já salvas (só altera o que veio na requisição).
    const row = await this.db.selectFrom('users').select('preferences').where('id', '=', user.id).executeTakeFirstOrThrow();
    let saved: Record<string, unknown> = {};
    try {
      saved = row.preferences ? (JSON.parse(row.preferences) as Record<string, unknown>) : {};
    } catch {
      saved = {};
    }
    await this.db
      .updateTable('users')
      .set({ preferences: JSON.stringify({ ...saved, ...prefs }) })
      .where('id', '=', user.id)
      .execute();
    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(200)
  @AllowPendingPassword()
  async changePassword(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: Request) {
    const { currentPassword, newPassword } = parse(changePasswordSchema, body);
    const row = await this.db
      .selectFrom('users')
      .select('password_hash')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    if (!(await this.passwords.verify(row.password_hash, currentPassword))) {
      await this.audit.log({ action: 'auth.password.change_failed', user, ip: clientIp(req) });
      throw new UnauthorizedException('Senha atual incorreta.');
    }
    if (currentPassword === newPassword) throw new UnauthorizedException('A nova senha deve ser diferente da atual.');
    this.passwords.assertStrong(newPassword, user.username);

    await this.db
      .updateTable('users')
      .set({
        password_hash: await this.passwords.hash(newPassword),
        must_change_password: 0,
        password_changed_at: new Date(),
      })
      .where('id', '=', user.id)
      .execute();
    // Mantém a sessão atual e encerra as demais.
    const revoked = await this.sessions.destroyAllForUser(user.id, user.sessionHash);
    this.realtime.disconnectSessions(revoked);
    await this.audit.log({ action: 'auth.password.changed', user, ip: clientIp(req), details: { otherSessionsRevoked: revoked.length } });
    return { ok: true };
  }

  private setCookie(res: Response, sid: string): void {
    res.cookie(SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/',
      maxAge: this.config.SESSION_MAX_HOURS * 3600_000,
    });
  }
}
