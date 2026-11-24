import {
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Delete,
  Get,
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
import { SessionService } from '../auth/session.service.js';
import { type AuthUser, clientIp, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { isPermission, PERMISSION_CATALOG } from '../common/permissions.js';
import { cleanText, idParam, parse } from '../common/validation.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const groupSchema = z.object({
  name: cleanText(100).pipe(z.string().min(2)),
  description: cleanText(255).optional().nullable(),
  memberIds: z.array(z.number().int().positive()).max(500).optional(),
  permissions: z.array(z.string().refine(isPermission, 'permissão desconhecida')).max(50).optional(),
});

/** Grupos de usuários: equipes e o que cada uma pode acessar (páginas e ações). */
@Controller('admin')
@RequirePermission('admin.users')
export class GroupsController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Catálogo de permissões para a tela de grupos. */
  @Get('permissions')
  catalog() {
    return PERMISSION_CATALOG;
  }

  @Get('groups')
  async list(@CurrentUser() user: AuthUser) {
    const groups = await this.db
      .selectFrom('user_groups')
      .select(['id', 'name', 'description'])
      .where('organization_id', '=', user.organizationId)
      .orderBy('name')
      .execute();
    const members = await this.db.selectFrom('user_group_members').selectAll().execute();
    const perms = await this.db.selectFrom('user_group_permissions').selectAll().execute();
    return groups.map((g) => ({
      ...g,
      memberIds: members.filter((m) => m.group_id === g.id).map((m) => m.user_id),
      permissions: perms.filter((p) => p.group_id === g.id).map((p) => p.permission),
    }));
  }

  @Post('groups')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: Request) {
    const data = parse(groupSchema, body);
    this.assertCanGrant(user, data.permissions ?? []);
    await this.assertUnique(user.organizationId, data.name);
    const id = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .insertInto('user_groups')
        .values({ organization_id: user.organizationId, name: data.name, description: data.description ?? null })
        .executeTakeFirstOrThrow();
      const groupId = Number(r.insertId);
      await this.setMembers(trx, groupId, data.memberIds);
      await this.setPermissions(trx, groupId, data.permissions);
      return groupId;
    });
    await this.refreshMembers(id);
    await this.audit.log({ action: 'admin.group.created', user, ip: clientIp(req), targetType: 'group', targetId: id, details: { permissions: data.permissions ?? [] } });
    return { id };
  }

  @Patch('groups/:id')
  async update(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const data = parse(groupSchema.partial(), body);
    await this.findOrFail(id, user.organizationId);
    // Não pode editar grupo com permissões que não tem, nem conceder novas além das suas.
    this.assertCanGrant(user, [...(await this.permissionsOf(id)), ...(data.permissions ?? [])]);
    if (data.name) await this.assertUnique(user.organizationId, data.name, id);
    const before = await this.memberIds(id);
    await this.db.transaction().execute(async (trx) => {
      if (data.name !== undefined || data.description !== undefined) {
        await trx
          .updateTable('user_groups')
          .set({
            ...(data.name !== undefined && { name: data.name }),
            ...(data.description !== undefined && { description: data.description ?? null }),
          })
          .where('id', '=', id)
          .execute();
      }
      await this.setMembers(trx, id, data.memberIds);
      await this.setPermissions(trx, id, data.permissions);
    });
    await this.refreshUsers([...new Set([...before, ...(await this.memberIds(id))])]);
    await this.audit.log({
      action: 'admin.group.updated',
      user,
      ip: clientIp(req),
      targetType: 'group',
      targetId: id,
      details: { fields: Object.keys(data), ...(data.permissions && { permissions: data.permissions }) },
    });
    return { ok: true };
  }

  @Delete('groups/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    await this.findOrFail(id, user.organizationId);
    this.assertCanGrant(user, await this.permissionsOf(id));
    const members = await this.memberIds(id);
    await this.db.deleteFrom('user_groups').where('id', '=', id).execute();
    await this.refreshUsers(members);
    await this.audit.log({ action: 'admin.group.deleted', user, ip: clientIp(req), targetType: 'group', targetId: id });
    return { ok: true };
  }

  private async setMembers(trx: Transaction<Database>, groupId: number, memberIds?: number[]) {
    if (!memberIds) return;
    await trx.deleteFrom('user_group_members').where('group_id', '=', groupId).execute();
    if (memberIds.length) {
      await trx.insertInto('user_group_members').values([...new Set(memberIds)].map((user_id) => ({ group_id: groupId, user_id }))).execute();
    }
  }

  private async setPermissions(trx: Transaction<Database>, groupId: number, permissions?: string[]) {
    if (!permissions) return;
    await trx.deleteFrom('user_group_permissions').where('group_id', '=', groupId).execute();
    if (permissions.length) {
      await trx.insertInto('user_group_permissions').values([...new Set(permissions)].map((permission) => ({ group_id: groupId, permission }))).execute();
    }
  }

  private async permissionsOf(groupId: number): Promise<string[]> {
    return (await this.db.selectFrom('user_group_permissions').select('permission').where('group_id', '=', groupId).execute()).map((r) => r.permission);
  }

  /** Quem não é Administrador só concede (ou mexe em grupos com) permissões que ele mesmo tem. */
  private assertCanGrant(user: AuthUser, permissions: string[]): void {
    if (user.role === 'admin') return;
    if (permissions.some((p) => !user.permissions.includes(p as never))) {
      throw new ForbiddenException('Você só pode conceder permissões que você também tem.');
    }
  }

  private async memberIds(groupId: number): Promise<number[]> {
    return (await this.db.selectFrom('user_group_members').select('user_id').where('group_id', '=', groupId).execute()).map((r) => r.user_id);
  }

  /** As permissões valem na hora para a API; o aviso faz os navegadores atualizarem menus e salas de tempo real. */
  private async refreshMembers(groupId: number) {
    await this.refreshUsers(await this.memberIds(groupId));
  }

  private async refreshUsers(userIds: number[]) {
    for (const uid of userIds) this.realtime.refreshSessions(await this.sessions.hashesForUser(uid));
  }

  private async findOrFail(id: number, organizationId: number) {
    const g = await this.db.selectFrom('user_groups').select('id').where('id', '=', id).where('organization_id', '=', organizationId).executeTakeFirst();
    if (!g) throw new NotFoundException('Grupo não encontrado.');
  }

  private async assertUnique(organizationId: number, name: string, exceptId?: number) {
    let q = this.db.selectFrom('user_groups').select('id').where('organization_id', '=', organizationId).where('name', '=', name);
    if (exceptId) q = q.where('id', '!=', exceptId);
    if (await q.executeTakeFirst()) throw new ConflictException('Já existe um grupo com esse nome.');
  }
}
