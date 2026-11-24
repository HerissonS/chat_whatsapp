import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql, type Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { Public } from '../common/auth-user.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { REDIS } from '../redis/redis.module.js';

type Status = 'ok' | 'erro';

/**
 * Saúde do sistema.
 * - /api/health: o processo está vivo (usado pelo healthcheck do Docker).
 * - /api/health/ready: dependências respondendo. Não expõe detalhes de erro, só o status de cada componente;
 *   o motivo da falha vai para o log.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HealthController.name);
  }

  @Get()
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis, evolution] = await Promise.all([
      this.check('database', () => sql`SELECT 1`.execute(this.db)),
      this.check('redis', () => this.redis.ping()),
      this.check('evolution', () => this.pingEvolution()),
    ]);
    const components = { database, redis, evolution };
    const ok = Object.values(components).every((s) => s === 'ok');
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degradado', components };
  }

  private async pingEvolution(): Promise<void> {
    const r = await fetch(this.config.EVOLUTION_URL, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }

  private async check(name: string, fn: () => Promise<unknown>): Promise<Status> {
    try {
      await fn();
      return 'ok';
    } catch (err) {
      this.logger.warn({ component: name, err: (err as Error).message }, 'dependência indisponível');
      return 'erro';
    }
  }
}
