import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Kysely } from 'kysely';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, clientIp, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { idParam, parse } from '../common/validation.js';
import { assertInboxAccess } from '../admin/inbox-access.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { EvolutionClient, EvolutionError } from './evolution.client.js';

/** Na primeira inicialização, associa o setor padrão à instância definida no .env. */
@Injectable()
export class WhatsappBootstrap implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly evolution: EvolutionClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const used = await this.db.selectFrom('departments').select('id').where('evolution_instance', '=', this.config.EVOLUTION_INSTANCE).executeTakeFirst();
    if (!used) {
      await this.db.updateTable('departments').set({ evolution_instance: this.config.EVOLUTION_INSTANCE }).where('id', '=', 1).where('evolution_instance', 'is', null).execute();
    }
    // Garante que o webhook de cada instância aponta para o endereço atual (ex.: após renomear containers).
    // Em segundo plano, para não atrasar a subida da API se a Evolution ainda estiver iniciando.
    void this.refreshWebhooks();
  }

  private async refreshWebhooks(): Promise<void> {
    const instances = await this.db.selectFrom('departments').select('evolution_instance').where('evolution_instance', 'is not', null).execute();
    for (let attempt = 0; attempt < 5; attempt++) {
      let pending = 0;
      for (const { evolution_instance: name } of instances) {
        try {
          if (await this.evolution.instanceExists(name!)) await this.evolution.setWebhook(name!);
        } catch {
          pending++;
        }
      }
      if (!pending) return;
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

const connectSchema = z.object({
  number: z
    .string()
    .trim()
    .regex(/^\d{10,15}$/, 'informe o número com DDI e DDD, só dígitos (ex.: 5594999999999)')
    .optional(),
});

/** Conexão do WhatsApp pela interface (somente administrador). */
@Controller()
export class WhatsappController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly evolution: EvolutionClient,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('WhatsApp');
  }

  /** Estado da conexão dos setores do usuário (indicador no topo da tela). */
  @Get('whatsapp/status')
  @RequirePermission('chat.read')
  async status(@CurrentUser() user: AuthUser) {
    if (!user.departmentIds.length) return [];
    const rows = await this.db
      .selectFrom('departments')
      .select(['id', 'name', 'wa_state', 'wa_number', 'wa_name', 'evolution_instance'])
      .where('id', 'in', user.departmentIds)
      .execute();
    return rows.map((d) => ({
      departmentId: d.id,
      departmentName: d.name,
      state: d.evolution_instance ? d.wa_state : 'not_configured',
      number: d.wa_number,
      profileName: d.wa_name,
    }));
  }

  private async dept(id: number, user: AuthUser) {
    const d = await this.db
      .selectFrom('departments')
      .selectAll()
      .where('id', '=', id)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!d) throw new NotFoundException('Caixa de entrada não encontrada.');
    assertInboxAccess(user, d.id);
    if (!d.evolution_instance) throw new ServiceUnavailableException('Caixa de entrada sem instância do WhatsApp definida.');
    return { ...d, evolution_instance: d.evolution_instance };
  }

  private wrap(err: unknown): never {
    if (err instanceof EvolutionError) throw new ServiceUnavailableException(err.message);
    throw err;
  }

  /** Cria a instância (se preciso), garante o webhook e devolve o QR Code ou o código de pareamento. */
  @Post('admin/whatsapp/:departmentId/connect')
  @HttpCode(200)
  @RequirePermission('admin.whatsapp')
  async connect(@CurrentUser() user: AuthUser, @Param('departmentId') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const d = await this.dept(parse(idParam, idRaw), user);
    const { number } = parse(connectSchema, body ?? {});
    try {
      if (!(await this.evolution.instanceExists(d.evolution_instance))) {
        await this.evolution.createInstance(d.evolution_instance);
        this.logger.info({ department_id: d.id }, 'instância criada na Evolution');
      } else {
        await this.evolution.setWebhook(d.evolution_instance);
      }
      await this.evolution.setSettings(d.evolution_instance).catch((err: unknown) =>
        this.logger.warn({ err: (err as Error).message }, 'não foi possível aplicar as configurações da instância'),
      );
      const state = await this.evolution.connectionState(d.evolution_instance);
      if (state === 'open') return { state, base64: null, pairingCode: null };
      const r = await this.evolution.connect(d.evolution_instance, number);
      await this.audit.log({ action: 'admin.whatsapp.connect_requested', user, ip: clientIp(req), targetType: 'department', targetId: d.id, details: { pairing: !!number } });
      return { state: 'connecting', base64: r?.base64 ?? null, pairingCode: r?.pairingCode ?? null };
    } catch (err) {
      this.wrap(err);
    }
  }

  @Get('admin/whatsapp/:departmentId/state')
  @RequirePermission('admin.whatsapp')
  async state(@CurrentUser() user: AuthUser, @Param('departmentId') idRaw: string) {
    const d = await this.dept(parse(idParam, idRaw), user);
    try {
      const exists = await this.evolution.instanceExists(d.evolution_instance);
      const state = exists ? await this.evolution.connectionState(d.evolution_instance) : 'not_created';
      if (exists && state !== d.wa_state) {
        await this.db.updateTable('departments').set({ wa_state: state, wa_updated_at: new Date() }).where('id', '=', d.id).execute();
        this.realtime.toDepartment(d.id, 'whatsapp:status', { departmentId: d.id, state });
      }
      return { state, number: d.wa_number, profileName: d.wa_name, instance: d.evolution_instance };
    } catch (err) {
      this.wrap(err);
    }
  }

  @Post('admin/whatsapp/:departmentId/logout')
  @HttpCode(200)
  @RequirePermission('admin.whatsapp')
  async logout(@CurrentUser() user: AuthUser, @Param('departmentId') idRaw: string, @Req() req: Request) {
    const d = await this.dept(parse(idParam, idRaw), user);
    try {
      await this.evolution.logout(d.evolution_instance);
    } catch (err) {
      this.wrap(err);
    }
    await this.db.updateTable('departments').set({ wa_state: 'close', wa_updated_at: new Date() }).where('id', '=', d.id).execute();
    this.realtime.toDepartment(d.id, 'whatsapp:status', { departmentId: d.id, state: 'close' });
    await this.audit.log({ action: 'admin.whatsapp.logout', user, ip: clientIp(req), targetType: 'department', targetId: d.id });
    return { ok: true };
  }

  @Post('admin/whatsapp/:departmentId/restart')
  @HttpCode(200)
  @RequirePermission('admin.whatsapp')
  async restart(@CurrentUser() user: AuthUser, @Param('departmentId') idRaw: string, @Req() req: Request) {
    const d = await this.dept(parse(idParam, idRaw), user);
    try {
      await this.evolution.restart(d.evolution_instance);
    } catch (err) {
      this.wrap(err);
    }
    await this.audit.log({ action: 'admin.whatsapp.restart', user, ip: clientIp(req), targetType: 'department', targetId: d.id });
    return { ok: true };
  }
}
