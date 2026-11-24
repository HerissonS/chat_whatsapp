import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { parse } from '../common/validation.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';

const querySchema = z.object({
  username: z.string().trim().max(60).optional(),
  action: z.string().trim().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

/** Consulta da trilha de auditoria (somente administrador). */
@Controller('admin/audit')
@RequirePermission('admin.audit')
export class AuditController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = parse(querySchema, query);
    let base = this.db.selectFrom('audit_logs').where('organization_id', '=', user.organizationId);
    if (q.username) base = base.where('username', '=', q.username.toLowerCase());
    if (q.action) base = base.where('action', 'like', `${q.action.replace(/[%_\\]/g, '\\$&')}%`);
    if (q.from) base = base.where('created_at', '>=', q.from);
    if (q.to) base = base.where('created_at', '<=', q.to);

    const [{ total }] = await base.select((eb) => eb.fn.countAll<number>().as('total')).execute();
    const rows = await base
      .select(['id', 'username', 'action', 'target_type', 'target_id', 'ip', 'details', 'created_at'])
      .orderBy('id', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return {
      total: Number(total),
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({ ...r, details: r.details ? (JSON.parse(r.details) as unknown) : null })),
    };
  }
}
