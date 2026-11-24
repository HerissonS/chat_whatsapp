import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { effectivePermissions, type Permission } from '../common/permissions.js';
import { toBool } from '../common/validation.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';

export interface LoadedUser {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'operator';
  organizationId: number;
  departmentIds: number[];
  mustChangePassword: boolean;
  active: boolean;
  permissions: Permission[];
}

/** Carrega o usuário ativo e os setores que ele pode ver (administrador vê todos). */
@Injectable()
export class UserLoaderService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async load(userId: number): Promise<LoadedUser | null> {
    const u = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'name', 'role', 'organization_id', 'must_change_password', 'active'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!u || !toBool(u.active)) return null;

    let departmentIds: number[];
    if (u.role === 'admin') {
      const rows = await this.db
        .selectFrom('departments')
        .select('id')
        .where('organization_id', '=', u.organization_id)
        .where('active', '=', 1)
        .execute();
      departmentIds = rows.map((r) => r.id);
    } else {
      const rows = await this.db
        .selectFrom('user_departments')
        .innerJoin('departments', 'departments.id', 'user_departments.department_id')
        .select('departments.id')
        .where('user_departments.user_id', '=', u.id)
        .where('departments.active', '=', 1)
        .execute();
      departmentIds = rows.map((r) => r.id);
    }

    const groupPerms =
      u.role === 'admin'
        ? []
        : (
            await this.db
              .selectFrom('user_group_members as m')
              .innerJoin('user_group_permissions as p', 'p.group_id', 'm.group_id')
              .select('p.permission')
              .where('m.user_id', '=', u.id)
              .execute()
          ).map((r) => r.permission);

    return {
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      organizationId: u.organization_id,
      departmentIds,
      mustChangePassword: toBool(u.must_change_password),
      active: true,
      permissions: effectivePermissions(u.role, groupPerms),
    };
  }
}
