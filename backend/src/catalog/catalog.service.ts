import { Inject, Injectable, type OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';

export interface Equipment {
  code: string;
  type: string | null;
}

/**
 * Catálogo de contratos e equipamentos usado no encerramento.
 * - local: cadastro do próprio sistema;
 * - external_mariadb: leitura (somente SELECT) de um banco externo no formato do banco de equipamentos
 *   (contracts.name + equipament.contrato/codigo/equip_type/ativo), configurado por CATALOG_DB_* no .env.
 * Em qualquer fonte, os contratos extras (ex.: CHAMADO INTERNO) entram na lista.
 */
@Injectable()
export class CatalogService implements OnApplicationShutdown {
  private external: Pool | null = null;

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Catalog');
  }

  private async source(departmentId: number): Promise<string> {
    const d = await this.db.selectFrom('departments').select('catalog_source').where('id', '=', departmentId).executeTakeFirst();
    return d?.catalog_source ?? 'local';
  }

  private pool(): Pool {
    const c = this.config;
    if (!c.CATALOG_DB_HOST || !c.CATALOG_DB_NAME || !c.CATALOG_DB_USER) {
      throw new ServiceUnavailableException('Banco externo de equipamentos não configurado (CATALOG_DB_* no .env).');
    }
    this.external ??= createPool({
      host: c.CATALOG_DB_HOST,
      port: c.CATALOG_DB_PORT,
      database: c.CATALOG_DB_NAME,
      user: c.CATALOG_DB_USER,
      password: c.CATALOG_DB_PASSWORD,
      connectionLimit: 3,
      connectTimeout: 5000,
      charset: 'utf8mb4_unicode_ci',
      multipleStatements: false,
    });
    return this.external;
  }

  private async externalQuery<T>(sqlText: string, params: unknown[]): Promise<T[]> {
    try {
      const [rows] = await this.pool().query<RowDataPacket[]>(sqlText, params);
      return rows as T[];
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error({ err: (err as Error).message }, 'falha ao consultar o banco externo de equipamentos');
      throw new ServiceUnavailableException('Banco de equipamentos indisponível. Tente novamente em instantes.');
    }
  }

  async contracts(organizationId: number, departmentId: number): Promise<string[]> {
    const extras = await this.db
      .selectFrom('extra_contracts')
      .select('name')
      .where('organization_id', '=', organizationId)
      .where('active', '=', 1)
      .execute();
    let base: string[];
    if ((await this.source(departmentId)) === 'external_mariadb') {
      const rows = await this.externalQuery<{ name: string }>(
        `SELECT name FROM contracts
         UNION
         SELECT DISTINCT TRIM(contrato) AS name FROM equipament WHERE contrato IS NOT NULL AND TRIM(contrato) <> ''`,
        [],
      );
      base = rows.map((r) => r.name);
    } else {
      const rows = await this.db
        .selectFrom('catalog_contracts')
        .select('name')
        .where('organization_id', '=', organizationId)
        .where('active', '=', 1)
        .execute();
      base = rows.map((r) => r.name);
    }
    return [...new Set([...extras.map((e) => e.name), ...base].map((s) => s.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    );
  }

  async equipments(organizationId: number, departmentId: number, contract: string): Promise<Equipment[]> {
    if ((await this.source(departmentId)) === 'external_mariadb') {
      const rows = await this.externalQuery<{ codigo: string; equip_type: string | null }>(
        'SELECT codigo, equip_type FROM equipament WHERE ativo = 1 AND TRIM(contrato) = ? ORDER BY codigo LIMIT 2000',
        [contract],
      );
      return rows.map((r) => ({ code: r.codigo, type: r.equip_type }));
    }
    const rows = await this.db
      .selectFrom('catalog_equipments')
      .select(['code', 'equip_type'])
      .where('organization_id', '=', organizationId)
      .where('contract_name', '=', contract)
      .where('active', '=', 1)
      .orderBy('code')
      .limit(2000)
      .execute();
    return rows.map((r) => ({ code: r.code, type: r.equip_type }));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.external?.end();
  }
}
