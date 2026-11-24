import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DomainModule } from './domain.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RealtimeModule } from './realtime/realtime.service.js';
import { RedisModule } from './redis/redis.module.js';
import { EmailProcessor } from './worker/email.processor.js';
import { EventsProcessor } from './worker/events.processor.js';
import { MaintenanceProcessor } from './worker/maintenance.processor.js';
import { MediaProcessor } from './worker/media.processor.js';

/** Worker de filas: eventos do webhook, mídia, e-mail e manutenção. */
@Module({
  imports: [ConfigModule, LoggerModule, DatabaseModule, RedisModule, RealtimeModule, QueueModule, AuditModule, DomainModule],
  providers: [EventsProcessor, MediaProcessor, EmailProcessor, MaintenanceProcessor],
})
export class WorkerModule {}
