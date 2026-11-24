import { Body, Controller, ForbiddenException, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PinoLogger } from 'nestjs-pino';
import { safeEqual } from '../auth/auth.guard.js';
import { Public } from '../common/auth-user.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { Queues } from '../queue/queue.module.js';
import { WEBHOOK_TOKEN_HEADER } from './evolution.client.js';

/** Eventos aceitos. Qualquer outro é descartado sem gravar. */
const ACCEPTED = new Set([
  'qrcode.updated', 'connection.update', 'messages.upsert', 'messages.update', 'messages.delete', 'messages.edited',
  'send.message', 'contacts.upsert', 'contacts.update', 'groups.upsert', 'groups.update',
]);

/**
 * Webhook da Evolution. Fica fora do prefixo /api e só é alcançável pela rede interna do Docker
 * (o nginx público não encaminha /webhook). Exige o token no cabeçalho, comparado em tempo constante.
 * Só grava o evento e enfileira: o processamento é feito pelo worker.
 */
@Public()
@Controller('webhook')
export class WebhookController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queues: Queues,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Webhook');
  }

  @Post('evolution')
  @HttpCode(200)
  async receive(@Headers(WEBHOOK_TOKEN_HEADER) token: string | undefined, @Body() body: Record<string, unknown>) {
    if (typeof token !== 'string' || !safeEqual(token, this.config.WEBHOOK_TOKEN)) {
      this.logger.warn('webhook recusado: token inválido');
      throw new ForbiddenException();
    }
    const event = typeof body?.event === 'string' ? body.event.toLowerCase().replace(/_/g, '.') : '';
    const instance = typeof body?.instance === 'string' ? body.instance.slice(0, 50) : '';
    if (!ACCEPTED.has(event) || !instance) return { ok: true, ignored: true };

    // A Evolution envia a apikey da instância no corpo: nunca é gravada.
    const { apikey: _apikey, server_url: _server, ...clean } = body;
    const r = await this.db
      .insertInto('webhook_events')
      .values({ instance, event, payload: JSON.stringify(clean) })
      .executeTakeFirstOrThrow();
    const eventId = String(r.insertId);
    await this.queues.events.add(event, { eventId }, { jobId: `ev-${eventId}` });
    return { ok: true };
  }
}
