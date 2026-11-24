import { Global, Module } from '@nestjs/common';
import { BotService } from './bot/bot.service.js';
import { BrandingService } from './branding/branding.service.js';
import { CatalogService } from './catalog/catalog.service.js';
import { ChatEventsService } from './chat/chat-events.service.js';
import { ChatRepository } from './chat/chat.repository.js';
import { MessageSenderService } from './chat/message-sender.service.js';
import { MailService } from './closure/mail.service.js';
import { ContactsService } from './contacts/contacts.service.js';
import { TicketReportService } from './closure/ticket-report.service.js';
import { MediaStorageService } from './media/media-storage.service.js';
import { TicketsService } from './tickets/tickets.service.js';
import { EvolutionClient } from './whatsapp/evolution.client.js';

/** Serviços de negócio compartilhados entre a API e o worker. */
const services = [
  ChatRepository,
  ChatEventsService,
  MessageSenderService,
  TicketsService,
  BotService,
  EvolutionClient,
  MediaStorageService,
  BrandingService,
  CatalogService,
  TicketReportService,
  MailService,
  ContactsService,
];

@Global()
@Module({ providers: services, exports: services })
export class DomainModule {}
