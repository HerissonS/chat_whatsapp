import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { type ConnectionOptions, Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

export const QUEUE_PREFIX = 'atl';
export const QueueNames = {
  events: 'events',
  media: 'media',
  email: 'email',
  maintenance: 'maintenance',
} as const;

export function bullConnection(config: AppConfig): ConnectionOptions {
  return {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
    db: config.REDIS_DB,
    maxRetriesPerRequest: null,
  };
}

export interface EventJob {
  eventId: string;
}
export interface MediaJob {
  messageId: number;
  instance: string;
  raw: { key: unknown; message: unknown };
}
export interface EmailJob {
  outboxId: number;
}

/** Produtores das filas. Usado pela API e pelo worker. */
@Injectable()
export class Queues implements OnApplicationShutdown {
  readonly events: Queue<EventJob>;
  readonly media: Queue<MediaJob>;
  readonly email: Queue<EmailJob>;
  readonly maintenance: Queue;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const opts = { connection: bullConnection(config), prefix: QUEUE_PREFIX };
    this.events = new Queue<EventJob>(QueueNames.events, {
      ...opts,
      defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    });
    this.media = new Queue<MediaJob>(QueueNames.media, {
      ...opts,
      defaultJobOptions: { attempts: 4, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    });
    this.email = new Queue<EmailJob>(QueueNames.email, {
      ...opts,
      defaultJobOptions: { attempts: 6, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    });
    this.maintenance = new Queue(QueueNames.maintenance, { ...opts, defaultJobOptions: { removeOnComplete: 50, removeOnFail: 50 } });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.events.close(), this.media.close(), this.email.close(), this.maintenance.close()]);
  }
}

@Global()
@Module({ providers: [Queues], exports: [Queues] })
export class QueueModule {}
