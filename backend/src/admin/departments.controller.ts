import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Kysely, sql } from 'kysely';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, clientIp, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { cleanText, idParam, parse, toBool } from '../common/validation.js';
import { assertInboxAccess } from './inbox-access.js';
import { businessHoursSchema, parseBusinessHours } from '../dashboard/business-hours.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { EvolutionClient } from '../whatsapp/evolution.client.js';

export const BOT_TEMPLATE_KEYS = ['menu_header', 'menu_invalid', 'confirmation', 'closing'] as const;

const deptSchema = z.object({
  name: cleanText(150).pipe(z.string().min(2)),
  agentNamePrefix: z.boolean(),
  menuEnabled: z.boolean(),
  menuMaxInvalid: z.number().int().min(1).max(10),
  closeMsgIndividual: z.boolean(),
  closeMsgGroup: z.boolean(),
  catalogSource: z.enum(['local', 'external_mariadb']),
  active: z.boolean(),
  /** Meta de 1ª resposta, em minutos úteis. */
  responseTargetMinutes: z.number().int().min(1).max(1440),
  /** Horário de funcionamento; null = tempo corrido (24 h). */
  businessHours: businessHoursSchema.nullable(),
});

const botSchema = z.object({
  templates: z.object({
    menu_header: cleanText(2000).pipe(z.string().min(1)),
    menu_invalid: cleanText(2000).pipe(z.string().min(1)),
    confirmation: cleanText(2000).pipe(z.string().min(1)),
    closing: cleanText(2000).pipe(z.string().min(1)),
  }),
  classifications: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        menuNumber: z.number().int().min(1).max(99),
        menuLabel: cleanText(150).pipe(z.string().min(1)),
        subjectLabel: cleanText(150).pipe(z.string().min(1)),
        isDefault: z.boolean(),
        active: z.boolean(),
      }),
    )
    .min(1)
    .max(20),
});

const recipientsSchema = z.object({ emails: z.array(z.email().max(190)).max(30) });

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

@Controller('admin/departments')
@RequirePermission('admin.departments')
export class DepartmentsController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly evolution: EvolutionClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Departments');
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    let q = this.db.selectFrom('departments').selectAll().where('organization_id', '=', user.organizationId);
    if (user.role !== 'admin') q = q.where('id', 'in', user.departmentIds.length ? user.departmentIds : [0]);
    const rows = await q.orderBy('name').execute();
    const ids = rows.map((r) => r.id);
    const convCounts = new Map<number, number>();
    const ticketCounts = new Map<number, number>();
    if (ids.length) {
      const [cRows, tRows] = await Promise.all([
        this.db
          .selectFrom('conversations')
          .select(['department_id', sql<number>`COUNT(*)`.as('c')])
          .where('department_id', 'in', ids)
          .groupBy('department_id')
          .execute(),
        this.db
          .selectFrom('tickets')
          .select(['department_id', sql<number>`COUNT(*)`.as('c')])
          .where('department_id', 'in', ids)
          .groupBy('department_id')
          .execute(),
      ]);
      for (const r of cRows) convCounts.set(r.department_id, Number(r.c));
      for (const r of tRows) ticketCounts.set(r.department_id, Number(r.c));
    }
    return rows.map((d) => {
      const conversationsCount = convCounts.get(d.id) ?? 0;
      const ticketsCount = ticketCounts.get(d.id) ?? 0;
      return {
        id: d.id,
        name: d.name,
        slug: d.slug,
        evolutionInstance: d.evolution_instance,
        waState: d.wa_state,
        waNumber: d.wa_number,
        agentNamePrefix: toBool(d.agent_name_prefix),
        menuEnabled: toBool(d.menu_enabled),
        menuMaxInvalid: d.menu_max_invalid,
        closeMsgIndividual: toBool(d.close_msg_individual),
        closeMsgGroup: toBool(d.close_msg_group),
        catalogSource: d.catalog_source,
        responseTargetMinutes: d.response_target_minutes,
        businessHours: parseBusinessHours(d.business_hours),
        active: toBool(d.active),
        conversationsCount,
        ticketsCount,
        canDelete: conversationsCount === 0 && ticketsCount === 0,
      };
    });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: Request) {
    const data = parse(deptSchema.pick({ name: true }), body);
    const slug = slugify(data.name) || `caixa-${Date.now()}`;
    if (await this.db.selectFrom('departments').select('id').where('slug', '=', slug).executeTakeFirst()) {
      throw new ConflictException('Já existe uma caixa de entrada com esse nome.');
    }
    // Cada caixa de entrada tem a sua própria instância (número de WhatsApp) na Evolution.
    let instance = `cx-${slug}`.slice(0, 50);
    if (await this.db.selectFrom('departments').select('id').where('evolution_instance', '=', instance).executeTakeFirst()) {
      instance = `cx-${slug.slice(0, 38)}-${Date.now().toString(36)}`;
    }
    const id = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .insertInto('departments')
        .values({ organization_id: user.organizationId, name: data.name, slug, evolution_instance: instance })
        .executeTakeFirstOrThrow();
      const deptId = Number(r.insertId);
      // Textos e opções iniciais genéricos, com o nome da caixa. Tudo é editável em "Bot e menu".
      const templates: Record<string, string> = {
        menu_header: `Olá! Bem-vindo(a) ao atendimento ${data.name}. Por favor, escolha uma das opções abaixo:`,
        menu_invalid: 'Opção inválida. Por favor, responda apenas com o número de uma das opções abaixo.',
        confirmation: 'Seu atendimento foi registrado, em breve um atendente irá te responder.',
        closing: 'Informamos que seu atendimento foi encerrado.',
      };
      await trx
        .insertInto('bot_templates')
        .values(Object.entries(templates).map(([template_key, body]) => ({ department_id: deptId, template_key, body })))
        .execute();
      await trx
        .insertInto('classifications')
        .values({ department_id: deptId, menu_number: 1, menu_label: 'Atendimento geral', subject_label: 'Atendimento geral', is_default: 1 })
        .execute();
      // Quem cria (sem ser Administrador) passa a ter acesso à nova caixa.
      if (user.role !== 'admin') await trx.insertInto('user_departments').values({ user_id: user.id, department_id: deptId }).execute();
      return deptId;
    });
    await this.audit.log({ action: 'admin.department.created', user, ip: clientIp(req), targetType: 'department', targetId: id, details: { name: data.name } });
    return { id };
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const data = parse(deptSchema.partial(), body);
    await this.findOrFail(id, user);
    const b = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);
    await this.db
      .updateTable('departments')
      .set({
        name: data.name,
        agent_name_prefix: b(data.agentNamePrefix),
        menu_enabled: b(data.menuEnabled),
        menu_max_invalid: data.menuMaxInvalid,
        close_msg_individual: b(data.closeMsgIndividual),
        close_msg_group: b(data.closeMsgGroup),
        catalog_source: data.catalogSource,
        response_target_minutes: data.responseTargetMinutes,
        business_hours: data.businessHours === undefined ? undefined : data.businessHours ? JSON.stringify(data.businessHours) : null,
        active: b(data.active),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.log({
      action: 'admin.department.updated',
      user,
      ip: clientIp(req),
      targetType: 'department',
      targetId: id,
      details: data,
    });
    return { ok: true };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const dept = await this.findOrFail(id, user);

    const totalRow = await this.db
      .selectFrom('departments')
      .select(sql<number>`COUNT(*)`.as('c'))
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirstOrThrow();
    if (Number(totalRow.c) <= 1) {
      throw new BadRequestException('Não é possível remover a única caixa de entrada do sistema.');
    }

    const [conv, ticket, msg, media] = await Promise.all([
      this.db.selectFrom('conversations').select('id').where('department_id', '=', id).limit(1).executeTakeFirst(),
      this.db.selectFrom('tickets').select('id').where('department_id', '=', id).limit(1).executeTakeFirst(),
      this.db.selectFrom('messages').select('id').where('department_id', '=', id).limit(1).executeTakeFirst(),
      this.db.selectFrom('media_files').select('id').where('department_id', '=', id).limit(1).executeTakeFirst(),
    ]);
    if (conv || ticket || msg || media) {
      throw new ConflictException(
        'Esta caixa de entrada já possui conversas ou chamados registrados e não pode ser removida para preservar o histórico. Use a opção "Inativar".',
      );
    }

    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('contacts').where('department_id', '=', id).execute();
      await trx.deleteFrom('bot_templates').where('department_id', '=', id).execute();
      await trx.deleteFrom('classifications').where('department_id', '=', id).execute();
      await trx.deleteFrom('email_recipients').where('department_id', '=', id).execute();
      await trx.deleteFrom('user_departments').where('department_id', '=', id).execute();
      await trx.deleteFrom('departments').where('id', '=', id).execute();
    });

    if (dept.evolution_instance) {
      try {
        if (dept.wa_state === 'open') {
          await this.evolution.logout(dept.evolution_instance).catch(() => undefined);
        }
        await this.evolution.deleteInstance(dept.evolution_instance);
      } catch (err) {
        this.logger.warn(
          { department_id: id, instance: dept.evolution_instance, err: (err as Error).message },
          'caixa removida, mas não foi possível remover a instância na Evolution',
        );
      }
    }

    await this.audit.log({
      action: 'admin.department.deleted',
      user,
      ip: clientIp(req),
      targetType: 'department',
      targetId: id,
      details: { name: dept.name, evolutionInstance: dept.evolution_instance },
    });
    return { ok: true };
  }

  @Get(':id/bot')
  @RequirePermission('admin.bot')
  async getBot(@CurrentUser() user: AuthUser, @Param('id') idRaw: string) {
    const id = parse(idParam, idRaw);
    await this.findOrFail(id, user);
    const templates = await this.db.selectFrom('bot_templates').selectAll().where('department_id', '=', id).execute();
    const classifications = await this.db
      .selectFrom('classifications')
      .selectAll()
      .where('department_id', '=', id)
      .orderBy('menu_number')
      .execute();
    return {
      templates: Object.fromEntries(templates.map((t) => [t.template_key, t.body])),
      classifications: classifications.map((c) => ({
        id: c.id,
        menuNumber: c.menu_number,
        menuLabel: c.menu_label,
        subjectLabel: c.subject_label,
        isDefault: toBool(c.is_default),
        active: toBool(c.active),
      })),
    };
  }

  @Put(':id/bot')
  @RequirePermission('admin.bot')
  async saveBot(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const data = parse(botSchema, body);
    await this.findOrFail(id, user);

    const numbers = data.classifications.map((c) => c.menuNumber);
    if (new Set(numbers).size !== numbers.length) throw new BadRequestException('Há opções com o mesmo número.');
    const defaults = data.classifications.filter((c) => c.isDefault);
    if (defaults.length !== 1 || !defaults[0].active) {
      throw new BadRequestException('Marque exatamente uma opção ativa como padrão (usada quando não há escolha no menu).');
    }

    await this.db.transaction().execute(async (trx) => {
      for (const key of BOT_TEMPLATE_KEYS) {
        await trx
          .insertInto('bot_templates')
          .values({ department_id: id, template_key: key, body: data.templates[key] })
          .onDuplicateKeyUpdate({ body: data.templates[key] })
          .execute();
      }
      const existing = await trx.selectFrom('classifications').select('id').where('department_id', '=', id).execute();
      const keep = new Set(data.classifications.filter((c) => c.id).map((c) => c.id));
      // Opções removidas são desativadas (não apagadas), pois chamados antigos as referenciam.
      for (const e of existing) {
        if (!keep.has(e.id)) {
          await trx.updateTable('classifications').set({ active: 0, is_default: 0, menu_number: 1000 + e.id }).where('id', '=', e.id).execute();
        }
      }
      // Libera os números antes de reatribuir, evitando conflito na chave única.
      for (const c of data.classifications.filter((c) => c.id)) {
        await trx.updateTable('classifications').set({ menu_number: 2000 + c.id! }).where('id', '=', c.id!).where('department_id', '=', id).execute();
      }
      for (const c of data.classifications) {
        const values = {
          menu_number: c.menuNumber,
          menu_label: c.menuLabel,
          subject_label: c.subjectLabel,
          is_default: c.isDefault ? 1 : 0,
          active: c.active ? 1 : 0,
        };
        if (c.id) {
          await trx.updateTable('classifications').set(values).where('id', '=', c.id).where('department_id', '=', id).execute();
        } else {
          await trx.insertInto('classifications').values({ department_id: id, ...values }).execute();
        }
      }
    });
    await this.audit.log({ action: 'admin.bot.updated', user, ip: clientIp(req), targetType: 'department', targetId: id });
    return { ok: true };
  }

  @Get(':id/email-recipients')
  @RequirePermission('admin.email')
  async getRecipients(@CurrentUser() user: AuthUser, @Param('id') idRaw: string) {
    const id = parse(idParam, idRaw);
    await this.findOrFail(id, user);
    const rows = await this.db.selectFrom('email_recipients').select('email').where('department_id', '=', id).orderBy('email').execute();
    return { emails: rows.map((r) => r.email) };
  }

  @Put(':id/email-recipients')
  @RequirePermission('admin.email')
  async saveRecipients(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const { emails } = parse(recipientsSchema, body);
    await this.findOrFail(id, user);
    const unique = [...new Set(emails.map((e) => e.toLowerCase()))];
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('email_recipients').where('department_id', '=', id).execute();
      if (unique.length) {
        await trx.insertInto('email_recipients').values(unique.map((email) => ({ department_id: id, email }))).execute();
      }
    });
    await this.audit.log({
      action: 'admin.email.recipients_updated',
      user,
      ip: clientIp(req),
      targetType: 'department',
      targetId: id,
      details: { count: unique.length },
    });
    return { ok: true };
  }

  private async findOrFail(id: number, user: AuthUser) {
    const d = await this.db
      .selectFrom('departments')
      .select(['id', 'name', 'evolution_instance', 'wa_state', 'active'])
      .where('id', '=', id)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!d) throw new NotFoundException('Caixa de entrada não encontrada.');
    assertInboxAccess(user, id);
    return d;
  }
}
