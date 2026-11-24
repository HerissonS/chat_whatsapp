import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { type Job, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { Logger, PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from './config/env.js';
import { bullConnection, type EmailJob, type EventJob, type MediaJob, QUEUE_PREFIX, QueueNames, Queues } from './queue/queue.module.js';
import { REDIS } from './redis/redis.module.js';
import { EmailProcessor } from './worker/email.processor.js';
import { EventsProcessor } from './worker/events.processor.js';
import { MaintenanceProcessor } from './worker/maintenance.processor.js';
import { MediaProcessor } from './worker/media.processor.js';
import { WorkerModule } from './worker.module.js';

/** Arquivo de batimento usado pelo healthcheck do Docker. */
const HEARTBEAT_FILE = '/tmp/worker-heartbeat';

const isLast = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = await app.resolve(PinoLogger);
  logger.setContext('Worker');
  const connection = bullConnection(config);
  const opts = { connection, prefix: QUEUE_PREFIX };

  const events = app.get(EventsProcessor);
  const media = app.get(MediaProcessor);
  const email = app.get(EmailProcessor);
  const maintenance = app.get(MaintenanceProcessor);

  const workers = [
    // Concorrência 1: mantém a ordem das mensagens e do menu.
    new Worker<EventJob>(QueueNames.events, (job) => events.process(job.data.eventId), { ...opts, concurrency: 1 }),
    new Worker<MediaJob>(QueueNames.media, (job) => media.process(job.data, isLast(job)), { ...opts, concurrency: 2 }),
    new Worker<EmailJob>(QueueNames.email, (job) => email.process(job.data.outboxId, isLast(job)), { ...opts, concurrency: 1 }),
    new Worker(QueueNames.maintenance, (job) => maintenance.process(job.name, job.data as { departmentId?: number }), { ...opts, concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) =>
      logger.warn({ queue: w.name, job_id: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job falhou'),
    );
    w.on('error', (err) => logger.error({ queue: w.name, err: err.message }, 'erro no worker'));
  }

  const queues = app.get(Queues);
  await queues.maintenance.upsertJobScheduler('cleanup', { pattern: '30 3 * * *', tz: config.APP_TIMEZONE }, { name: 'cleanup' });
  await queues.maintenance.upsertJobScheduler('sync-connection', { every: 5 * 60_000 }, { name: 'sync-connection' });

  const redis = app.get<Redis>(REDIS);
  const beat = async () => {
    try {
      await redis.ping();
      writeFileSync(HEARTBEAT_FILE, String(Date.now()));
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'worker sem conexão com o Redis');
    }
  };
  await beat();
  const timer = setInterval(beat, 15_000);

  process.once('SIGTERM', async () => {
    clearInterval(timer);
    await Promise.allSettled(workers.map((w) => w.close()));
    await app.close();
    process.exit(0);
  });

  logger.info('worker pronto');
}

bootstrap().catch((err: unknown) => {
  console.error(JSON.stringify({ level: 'fatal', service: 'worker', msg: 'falha ao iniciar', err: (err as Error).message }));
  process.exit(1);
});
