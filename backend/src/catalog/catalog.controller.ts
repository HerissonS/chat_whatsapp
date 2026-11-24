import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { Kysely } from 'kysely';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type AuthUser, clientIp, CurrentUser, RequirePermission } from '../common/auth-user.js';
import { cleanText, idParam, parse, toBool } from '../common/validation.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { CatalogService } from './catalog.service.js';

const nameSchema = z.object({ name: cleanText(255).pipe(z.string().min(1)), active: z.boolean().optional() });
const equipSchema = z.object({
  contractName: cleanText(255).pipe(z.string().min(1)),
  code: cleanText(100).pipe(z.string().min(1)),
  equipType: cleanText(60).optional().nullable(),
  active: z.boolean().optional(),
});

function deptAllowed(user: AuthUser, departmentId: number) {
  if (!user.departmentIds.includes(departmentId)) throw new ForbiddenException('Caixa de entrada não permitida.');
}

/** Divide uma linha de CSV respeitando aspas. Aceita ";" ou "," como separador. */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === sep && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

@Controller()
export class CatalogController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ uso no encerramento

  @Get('catalog/contracts')
  @RequirePermission('ticket.close')
  async contracts(@CurrentUser() user: AuthUser, @Query('departmentId') dep: string) {
    const departmentId = parse(idParam, dep);
    deptAllowed(user, departmentId);
    return this.catalog.contracts(user.organizationId, departmentId);
  }

  @Get('catalog/equipments')
  @RequirePermission('ticket.close')
  async equipments(@CurrentUser() user: AuthUser, @Query('departmentId') dep: string, @Query('contract') contract: string) {
    const departmentId = parse(idParam, dep);
    deptAllowed(user, departmentId);
    const c = parse(z.string().trim().min(1).max(255), contract);
    return this.catalog.equipments(user.organizationId, departmentId, c);
  }

  // ------------------------------------------------------------ contratos extras

  @Get('admin/extra-contracts')
  @RequirePermission('admin.catalog')
  async listExtras(@CurrentUser() user: AuthUser) {
    const rows = await this.db.selectFrom('extra_contracts').selectAll().where('organization_id', '=', user.organizationId).orderBy('name').execute();
    return rows.map((r) => ({ id: r.id, name: r.name, active: toBool(r.active) }));
  }

  @Post('admin/extra-contracts')
  @RequirePermission('admin.catalog')
  async createExtra(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: Request) {
    const data = parse(nameSchema, body);
    try {
      const r = await this.db.insertInto('extra_contracts').values({ organization_id: user.organizationId, name: data.name }).executeTakeFirstOrThrow();
      await this.audit.log({ action: 'admin.extra_contract.created', user, ip: clientIp(req), details: { name: data.name } });
      return { id: Number(r.insertId) };
    } catch {
      throw new ConflictException('Esse contrato extra já existe.');
    }
  }

  @Patch('admin/extra-contracts/:id')
  @RequirePermission('admin.catalog')
  async updateExtra(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const data = parse(nameSchema.partial(), body);
    await this.db
      .updateTable('extra_contracts')
      .set({ ...(data.name && { name: data.name }), ...(data.active !== undefined && { active: data.active ? 1 : 0 }) })
      .where('id', '=', id)
      .where('organization_id', '=', user.organizationId)
      .execute();
    await this.audit.log({ action: 'admin.extra_contract.updated', user, ip: clientIp(req), targetId: id });
    return { ok: true };
  }

  @Delete('admin/extra-contracts/:id')
  @RequirePermission('admin.catalog')
  async deleteExtra(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    await this.db.deleteFrom('extra_contracts').where('id', '=', id).where('organization_id', '=', user.organizationId).execute();
    await this.audit.log({ action: 'admin.extra_contract.deleted', user, ip: clientIp(req), targetId: id });
    return { ok: true };
  }

  // ------------------------------------------------------------ catálogo local

  @Get('admin/catalog/contracts')
  @RequirePermission('admin.catalog')
  async listContracts(@CurrentUser() user: AuthUser) {
    const rows = await this.db
      .selectFrom('catalog_contracts as c')
      .leftJoin('catalog_equipments as e', (j) => j.onRef('e.contract_name', '=', 'c.name').onRef('e.organization_id', '=', 'c.organization_id'))
      .select(['c.id', 'c.name', 'c.active', (eb) => eb.fn.count<number>('e.id').as('equipments')])
      .where('c.organization_id', '=', user.organizationId)
      .groupBy(['c.id', 'c.name', 'c.active'])
      .orderBy('c.name')
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, active: toBool(r.active), equipments: Number(r.equipments) }));
  }

  @Post('admin/catalog/contracts')
  @RequirePermission('admin.catalog')
  async createContract(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: Request) {
    const data = parse(nameSchema, body);
    try {
      const r = await this.db.insertInto('catalog_contracts').values({ organization_id: user.organizationId, name: data.name }).executeTakeFirstOrThrow();
      await this.audit.log({ action: 'admin.catalog.contract_created', user, ip: clientIp(req), details: { name: data.name } });
      return { id: Number(r.insertId) };
    } catch {
      throw new ConflictException('Esse contrato já existe.');
    }
  }

  @Patch('admin/catalog/contracts/:id')
  @RequirePermission('admin.catalog')
  async updateContract(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const data = parse(nameSchema.partial(), body);
    const cur = await this.db.selectFrom('catalog_contracts').selectAll().where('id', '=', id).where('organization_id', '=', user.organizationId).executeTakeFirst();
    if (!cur) throw new NotFoundException('Contrato não encontrado.');
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('catalog_contracts')
        .set({ ...(data.name && { name: data.name }), ...(data.active !== undefined && { active: data.active ? 1 : 0 }) })
        .where('id', '=', id)
        .execute();
      if (data.name && data.name !== cur.name) {
        await trx
          .updateTable('catalog_equipments')
          .set({ contract_name: data.name })
          .where('organization_id', '=', user.organizationId)
          .where('contract_name', '=', cur.name)
          .execute();
      }
    });
    await this.audit.log({ action: 'admin.catalog.contract_updated', user, ip: clientIp(req), targetId: id });
    return { ok: true };
  }

  @Delete('admin/catalog/contracts/:id')
  @RequirePermission('admin.catalog')
  async deleteContract(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const cur = await this.db.selectFrom('catalog_contracts').selectAll().where('id', '=', id).where('organization_id', '=', user.organizationId).executeTakeFirst();
    if (!cur) throw new NotFoundException('Contrato não encontrado.');
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('catalog_equipments').where('organization_id', '=', user.organizationId).where('contract_name', '=', cur.name).execute();
      await trx.deleteFrom('catalog_contracts').where('id', '=', id).execute();
    });
    await this.audit.log({ action: 'admin.catalog.contract_deleted', user, ip: clientIp(req), targetId: id, details: { name: cur.name } });
    return { ok: true };
  }

  @Get('admin/catalog/equipments')
  @RequirePermission('admin.catalog')
  async listEquipments(@CurrentUser() user: AuthUser, @Query('contract') contract: string) {
    const c = parse(z.string().trim().min(1).max(255), contract);
    const rows = await this.db
      .selectFrom('catalog_equipments')
      .selectAll()
      .where('organization_id', '=', user.organizationId)
      .where('contract_name', '=', c)
      .orderBy('code')
      .execute();
    return rows.map((r) => ({ id: r.id, contractName: r.contract_name, code: r.code, equipType: r.equip_type, active: toBool(r.active) }));
  }

  @Post('admin/catalog/equipments')
  @RequirePermission('admin.catalog')
  async createEquipment(@CurrentUser() user: AuthUser, @Body() body: unknown, @Req() req: Request) {
    const d = parse(equipSchema, body);
    await this.ensureContract(user.organizationId, d.contractName);
    try {
      const r = await this.db
        .insertInto('catalog_equipments')
        .values({ organization_id: user.organizationId, contract_name: d.contractName, code: d.code, equip_type: d.equipType ?? null })
        .executeTakeFirstOrThrow();
      await this.audit.log({ action: 'admin.catalog.equipment_created', user, ip: clientIp(req), details: { code: d.code } });
      return { id: Number(r.insertId) };
    } catch {
      throw new ConflictException('Já existe um equipamento com esse código.');
    }
  }

  @Patch('admin/catalog/equipments/:id')
  @RequirePermission('admin.catalog')
  async updateEquipment(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Body() body: unknown, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    const d = parse(equipSchema.partial(), body);
    if (d.contractName) await this.ensureContract(user.organizationId, d.contractName);
    await this.db
      .updateTable('catalog_equipments')
      .set({
        ...(d.contractName && { contract_name: d.contractName }),
        ...(d.code && { code: d.code }),
        ...(d.equipType !== undefined && { equip_type: d.equipType ?? null }),
        ...(d.active !== undefined && { active: d.active ? 1 : 0 }),
      })
      .where('id', '=', id)
      .where('organization_id', '=', user.organizationId)
      .execute();
    await this.audit.log({ action: 'admin.catalog.equipment_updated', user, ip: clientIp(req), targetId: id });
    return { ok: true };
  }

  @Delete('admin/catalog/equipments/:id')
  @RequirePermission('admin.catalog')
  async deleteEquipment(@CurrentUser() user: AuthUser, @Param('id') idRaw: string, @Req() req: Request) {
    const id = parse(idParam, idRaw);
    await this.db.deleteFrom('catalog_equipments').where('id', '=', id).where('organization_id', '=', user.organizationId).execute();
    await this.audit.log({ action: 'admin.catalog.equipment_deleted', user, ip: clientIp(req), targetId: id });
    return { ok: true };
  }

  /**
   * Importação de CSV (UTF-8) com as colunas: contrato;codigo;tipo
   * A primeira linha pode ser cabeçalho. Equipamentos existentes (mesmo código) são atualizados.
   */
  @Post('admin/catalog/import')
  @HttpCode(200)
  @RequirePermission('admin.catalog')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async importCsv(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    if (!file?.buffer?.length) throw new BadRequestException('Envie um arquivo CSV.');
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) throw new BadRequestException('Arquivo vazio.');
    const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    const first = splitCsvLine(lines[0], sep).map((s) => s.toLowerCase());
    const hasHeader = first.includes('contrato') || first.includes('codigo') || first.includes('código');
    const rows = (hasHeader ? lines.slice(1) : lines).map((l) => splitCsvLine(l, sep));
    if (rows.length > 20_000) throw new BadRequestException('Máximo de 20.000 linhas por importação.');

    let imported = 0;
    const errors: string[] = [];
    await this.db.transaction().execute(async (trx) => {
      const contracts = new Set<string>();
      for (const [i, cols] of rows.entries()) {
        const [contract, code, type] = cols;
        if (!contract || !code || contract.length > 255 || code.length > 100) {
          if (errors.length < 20) errors.push(`Linha ${i + (hasHeader ? 2 : 1)}: contrato e código são obrigatórios`);
          continue;
        }
        contracts.add(contract);
        await trx
          .insertInto('catalog_equipments')
          .values({ organization_id: user.organizationId, contract_name: contract, code, equip_type: type?.slice(0, 60) || null })
          .onDuplicateKeyUpdate({ contract_name: contract, equip_type: type?.slice(0, 60) || null, active: 1 })
          .execute();
        imported++;
      }
      for (const name of contracts) {
        await trx.insertInto('catalog_contracts').ignore().values({ organization_id: user.organizationId, name }).execute();
      }
    });
    await this.audit.log({ action: 'admin.catalog.imported', user, ip: clientIp(req), details: { imported, errors: errors.length } });
    return { imported, errors };
  }

  private async ensureContract(organizationId: number, name: string) {
    await this.db.insertInto('catalog_contracts').ignore().values({ organization_id: organizationId, name }).execute();
  }
}
