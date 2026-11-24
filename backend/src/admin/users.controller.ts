import {
  ForbiddenException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { type AuthUser, clientIp, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { ROLE_LABELS } from '../common/permissions.js';
import { cleanText, idParam, parse, toBool } from '../common/validation.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,60}$/, 'use de 3 a 60 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado');

const baseUser = {
  name: cleanText(150).pipe(z.string().min(2)),
  email: z.union([z.email().max(190), z.literal(''), z.null()]).optional(),
  role: z.enum(['admin', 'operator']),
  departmentIds: z.array(z.number().int().positive()).max(50).default([]),
  groupIds: z.array(z.number().int().positive()).max(50).default([]),
};

const createSchema = z.object({ username, password: z.string().min(1).max(200), ...baseUser });
const updateSchema = z.object({ ...baseUser, active: z.boolean() }).partial();
const resetSchema = z.object({ password: z.string().min(1).max(200) });

/**
 * Regras contra escalada de privilégio para quem gerencia usuários sem ser Administrador:
 * não cria/edita Administradores, só atribui caixas de entrada que ele mesmo tem
 * e só coloca usuários em grupos cujas permissões ele também tem.
 */
@Controller()
export class UsersController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Lista resumida para atribuição de chamados (qualquer atendente). */
  @Get('users')
  @RequirePermission('chat.read')
  async assignable(@CurrentUser() user: AuthUser) {
    return this.db
      .selectFrom('users')
      .select(['id', 'name', 'username', 'role'])
      .where('organization_id', '=', user.organizationId)
      .where('active', '=', 1)
      .orderBy('name')
      .execute();
  }

  @Get('admin/users')
  @RequirePermission('admin.users')
  async list(@CurrentUser() user: AuthUser) {
    const users = await this.db
      .selectFrom('users')
      .select([
        'id', 'username', 'name', 'email', 'role', 'active', 'must_change_password', 'locked_until',
        'last_login_at', 'created_at',
      ])
      .where('organization_id', '=', user.organizationId)
      .orderBy('name')
      .execute();
    const deps = await this.db.selectFrom('user_departments').selectAll().execute();
    const groups = await this.db.selectFrom('user_group_members').selectAll().execute();
    const now = Date.now();
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email,
      role: u.role,
      roleLabel: ROLE_LABELS[u.role],
      active: toBool(u.active),
      mustChangePassword: toBool(u.must_change_password),
      locked: !!u.locked_until && u.locked_until.getTime() > now,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      departmentIds: deps.filter((d) => d.user_id === u.id).map((d) => d.department_id),
      groupIds: groups.filter((g) => g.user_id === u.id).map((g) => g.group_id),
    }));
  }

  @Post('admin/users')
  @RequirePermission('admin.users')
  async create(@CurrentUser() actor: AuthUser, @Body() body: unknown, @Req() req: Request) {
    const data = parse(createSchema, body);
    await this.assertCanGrant(actor, data.role, data.departmentIds, data.groupIds);
    this.passwords.assertStrong(data.password, data.username);
    const exists = await this.db.selectFrom('users').select('id').where('username', '=', data.username).executeTakeFirst();
    if (exists) throw new ConflictException('Já existe um usuário com esse login.');

    const hash = await this.passwords.hash(data.password);
    const id = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .insertInto('users')
        .values({
          organization_id: actor.organizationId,
          username: data.username,
          name: data.name,
          email: data.email || null,
          password_hash: hash,
          role: data.role,
          active: 1,
          must_change_password: 1,
        })
        .executeTakeFirstOrThrow();
      const userId = Number(r.insertId);
      await this.setMemberships(trx, userId, data.departmentIds, data.groupIds);
      return userId;
    });
    await this.audit.log({
      action: 'admin.user.created',
      user: actor,
      ip: clientIp(req),
      targetType: 'user',
      targetId: id,
      details: { username: data.username, role: data.role },
    });
    return { id };
  }

  @Patch('admin/users/:id')
  @RequirePermission('admin.users')
  async update(@CurrentUser() actor: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const data = parse(updateSchema, body);
    const target = await this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    if (!target || target.organization_id !== actor.organizationId) throw new NotFoundException('Usuário não encontrado.');
    this.assertCanManage(actor, target.role);
    await this.assertCanGrant(actor, data.role ?? target.role, data.departmentIds, data.groupIds);

    const demoting = data.role && data.role !== 'admin' && target.role === 'admin';
    const deactivating = data.active === false && toBool(target.active);
    if (id === actor.id && (demoting || deactivating)) {
      throw new BadRequestException('Você não pode remover o próprio acesso de administrador nem se desativar.');
    }
    if ((demoting || deactivating) && target.role === 'admin') await this.assertAnotherAdmin(id, actor.organizationId);

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.email !== undefined && { email: data.email || null }),
          ...(data.role !== undefined && { role: data.role }),
          ...(data.active !== undefined && { active: data.active ? 1 : 0 }),
        })
        .where('id', '=', id)
        .execute();
      if (data.departmentIds || data.groupIds) {
        await this.setMemberships(trx, id, data.departmentIds, data.groupIds);
      }
    });

    if (deactivating || (data.role !== undefined && data.role !== target.role)) {
      const revoked = await this.sessions.destroyAllForUser(id);
      this.realtime.disconnectSessions(revoked);
    } else if (data.departmentIds || data.groupIds) {
      // Caixas de entrada e grupos mudaram: os navegadores do usuário recarregam o acesso.
      this.realtime.refreshSessions(await this.sessions.hashesForUser(id));
    }
    await this.audit.log({
      action: deactivating ? 'admin.user.deactivated' : 'admin.user.updated',
      user: actor,
      ip: clientIp(req),
      targetType: 'user',
      targetId: id,
      details: { fields: Object.keys(data) },
    });
    return { ok: true };
  }

  @Post('admin/users/:id/reset-password')
  @HttpCode(200)
  @RequirePermission('admin.users')
  async resetPassword(@CurrentUser() actor: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const { password } = parse(resetSchema, body);
    const target = await this.db.selectFrom('users').select(['username', 'organization_id', 'role']).where('id', '=', id).executeTakeFirst();
    if (!target || target.organization_id !== actor.organizationId) throw new NotFoundException('Usuário não encontrado.');
    this.assertCanManage(actor, target.role);
    this.passwords.assertStrong(password, target.username);
    await this.db
      .updateTable('users')
      .set({
        password_hash: await this.passwords.hash(password),
        must_change_password: 1,
        failed_logins: 0,
        locked_until: null,
        password_changed_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    const revoked = await this.sessions.destroyAllForUser(id);
    this.realtime.disconnectSessions(revoked);
    await this.audit.log({ action: 'admin.user.password_reset', user: actor, ip: clientIp(req), targetType: 'user', targetId: id });
    return { ok: true };
  }

  @Post('admin/users/:id/unlock')
  @HttpCode(200)
  @RequirePermission('admin.users')
  async unlock(@CurrentUser() actor: AuthUser, @Param('id') idRaw: string, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    await this.db
      .updateTable('users')
      .set({ failed_logins: 0, locked_until: null })
      .where('id', '=', id)
      .where('organization_id', '=', actor.organizationId)
      .execute();
    await this.audit.log({ action: 'admin.user.unlocked', user: actor, ip: clientIp(req), targetType: 'user', targetId: id });
    return { ok: true };
  }

  private async setMemberships(
    trx: Transaction<Database>,
    userId: number,
    departmentIds?: number[],
    groupIds?: number[],
  ): Promise<void> {
    if (departmentIds) {
      await trx.deleteFrom('user_departments').where('user_id', '=', userId).execute();
      if (departmentIds.length) {
        await trx
          .insertInto('user_departments')
          .values([...new Set(departmentIds)].map((department_id) => ({ user_id: userId, department_id })))
          .execute();
      }
    }
    if (groupIds) {
      await trx.deleteFrom('user_group_members').where('user_id', '=', userId).execute();
      if (groupIds.length) {
        await trx
          .insertInto('user_group_members')
          .values([...new Set(groupIds)].map((group_id) => ({ user_id: userId, group_id })))
          .execute();
      }
    }
  }

  private assertCanManage(actor: AuthUser, targetRole: string): void {
    if (actor.role !== 'admin' && targetRole === 'admin') {
      throw new ForbiddenException('Somente um Administrador pode alterar outro Administrador.');
    }
  }

  private async assertCanGrant(actor: AuthUser, role: string, departmentIds?: number[], groupIds?: number[]): Promise<void> {
    if (actor.role === 'admin') return;
    if (role === 'admin') throw new ForbiddenException('Somente um Administrador pode criar Administradores.');
    if (departmentIds?.some((d) => !actor.departmentIds.includes(d))) {
      throw new ForbiddenException('Você só pode atribuir caixas de entrada às quais tem acesso.');
    }
    if (groupIds?.length) {
      const perms = await this.db.selectFrom('user_group_permissions').select('permission').where('group_id', 'in', groupIds).execute();
      if (perms.some((p) => !actor.permissions.includes(p.permission as never))) {
        throw new ForbiddenException('Você só pode colocar usuários em grupos com permissões que você também tem.');
      }
    }
  }

  private async assertAnotherAdmin(exceptId: number, organizationId: number): Promise<void> {
    const other = await this.db
      .selectFrom('users')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('role', '=', 'admin')
      .where('active', '=', 1)
      .where('id', '!=', exceptId)
      .executeTakeFirst();
    if (!other) throw new BadRequestException('É preciso manter pelo menos um administrador ativo.');
  }
}
