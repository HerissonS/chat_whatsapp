import { Queue } from 'bullmq';
import { loadConfig } from '../config/env.js';
import { createDb } from '../database/create-db.js';
import { bullConnection, QUEUE_PREFIX, QueueNames } from '../queue/queue.module.js';

/**
 * Reenfileira eventos do webhook que ficaram com erro ou pendentes (ex.: banco indisponível por alguns minutos).
 * O processamento é idempotente: reprocessar não duplica mensagens.
 * Uso: node dist/cli/reprocess-events.js [--hours 24]
 */
async function main(): Promise<void> {
  const i = process.argv.indexOf('--hours');
  const hours = i >= 0 ? Math.min(Math.max(Number(process.argv[i + 1]) || 24, 1), 24 * 30) : 24;
  const config = loadConfig();
  const db = createDb(config);
  const queue = new Queue(QueueNames.events, { connection: bullConnection(config), prefix: QUEUE_PREFIX });
  try {
    const rows = await db
      .selectFrom('webhook_events')
      .select(['id', 'event'])
      .where('status', 'in', ['error', 'pending'])
      .where('received_at', '>=', new Date(Date.now() - hours * 3600_000))
      .orderBy('id')
      .execute();
    for (const r of rows) await queue.add(r.event, { eventId: String(r.id) }, { jobId: `re-${r.id}-${Date.now()}` });
    console.log(`${rows.length} evento(s) reenfileirado(s) das últimas ${hours} hora(s).`);
  } finally {
    await queue.close();
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(`Erro: ${(err as Error).message}`);
  process.exit(1);
});
