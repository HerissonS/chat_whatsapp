import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BrandingController } from './branding/branding.controller.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { ChatController } from './chat/chat.controller.js';
import { EmailAdminController } from './closure/email-admin.controller.js';
import { ConfigModule } from './config/config.module.js';
import { ContactsController } from './contacts/contacts.controller.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DatabaseModule } from './database/database.module.js';
import { DomainModule } from './domain.module.js';
import { HealthController } from './health/health.controller.js';
import { LoggerModule } from './logger/logger.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RealtimeModule } from './realtime/realtime.service.js';
import { RedisModule } from './redis/redis.module.js';
import { TicketsController } from './tickets/tickets.controller.js';
import { WebhookController } from './whatsapp/webhook.controller.js';
import { WhatsappBootstrap, WhatsappController } from './whatsapp/whatsapp.controller.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    RealtimeModule,
    QueueModule,
    AuditModule,
    AuthModule,
    DomainModule,
    AdminModule,
  ],
  controllers: [
    HealthController,
    WebhookController,
    WhatsappController,
    ChatController,
    TicketsController,
    CatalogController,
    BrandingController,
    EmailAdminController,
    ContactsController,
    DashboardController,
  ],
  providers: [WhatsappBootstrap],
})
export class AppModule {}
