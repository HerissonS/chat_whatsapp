import { Controller, Get, Inject } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { type AuthUser, CurrentUser } from '../common/auth-user.js';
import { toBool } from '../common/validation.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';

/** Caixas de entrada que o usuário pode ver (seletores das telas). Administrador vê todas, inclusive inativas. */
@Controller('inboxes')
export class InboxesController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    let q = this.db
      .selectFrom('departments')
      .select(['id', 'name', 'wa_state', 'wa_number', 'evolution_instance', 'active'])
      .where('organization_id', '=', user.organizationId);
    if (user.role !== 'admin') q = q.where('id', 'in', user.departmentIds.length ? user.departmentIds : [0]);
    const rows = await q.orderBy('name').execute();
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      waState: d.wa_state,
      waNumber: d.wa_number,
      evolutionInstance: d.evolution_instance,
      active: toBool(d.active),
    }));
  }
}
