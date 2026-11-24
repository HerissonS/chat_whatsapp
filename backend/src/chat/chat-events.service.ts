import { Injectable } from '@nestjs/common';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ChatRepository } from './chat.repository.js';

/** Publica alterações de mensagens e conversas para os navegadores do setor. */
@Injectable()
export class ChatEventsService {
  constructor(
    private readonly chat: ChatRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async message(departmentId: number, messageId: number): Promise<void> {
    const dto = await this.chat.message(messageId);
    if (dto) this.realtime.toDepartment(departmentId, 'message:upsert', dto);
  }

  async conversation(departmentId: number, conversationId: number): Promise<void> {
    const dto = await this.chat.conversationSummary(conversationId);
    if (dto) this.realtime.toDepartment(departmentId, 'conversation:upsert', dto);
  }
}
