import { Inject, Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { PinoLogger } from 'nestjs-pino';
import { ChatEventsService } from '../chat/chat-events.service.js';
import { ChatRepository } from '../chat/chat.repository.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { MediaStorageService, sanitizeFileName } from '../media/media-storage.service.js';
import type { MediaJob } from '../queue/queue.module.js';
import { EvolutionClient, type WaKey } from '../whatsapp/evolution.client.js';

/** Baixa a mídia das mensagens recebidas (pela Evolution) e guarda no volume. */
@Injectable()
export class MediaProcessor {
  constructor(
    private readonly chat: ChatRepository,
    private readonly evolution: EvolutionClient,
    private readonly storage: MediaStorageService,
    private readonly events: ChatEventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Media');
  }

  async process(job: MediaJob, isLastAttempt: boolean): Promise<void> {
    const msg = await this.chat.db
      .selectFrom('messages')
      .select(['id', 'department_id', 'media_status', 'media_name', 'media_mime', 'type'])
      .where('id', '=', job.messageId)
      .executeTakeFirst();
    if (!msg || msg.media_status === 'ready') return;

    try {
      const r = await this.evolution.getMediaBase64(job.instance, job.raw as { key: WaKey; message: unknown });
      const buffer = Buffer.from(r.base64 ?? '', 'base64');
      if (!buffer.length) throw new Error('mídia vazia');
      if (buffer.length > this.config.MEDIA_MAX_MB * 1024 * 1024) {
        await this.markFailed(msg.id, msg.department_id, 'arquivo acima do limite');
        return;
      }
      // O tipo real vem do conteúdo; o tipo declarado só é usado quando não dá para identificar (ex.: texto).
      const sniffed = await fileTypeFromBuffer(buffer);
      const mime = sniffed?.mime ?? r.mimetype?.split(';')[0] ?? msg.media_mime ?? 'application/octet-stream';
      const name = sanitizeFileName(msg.media_name ?? r.fileName, `${msg.type}${sniffed?.ext ? `.${sniffed.ext}` : ''}`);
      const mediaId = await this.storage.saveBuffer({ departmentId: msg.department_id, buffer, mime, originalName: name });
      await this.chat.db
        .updateTable('messages')
        .set({ media_id: mediaId, media_status: 'ready', media_mime: mime, media_name: name, media_size: buffer.length })
        .where('id', '=', msg.id)
        .execute();
      this.logger.info({ message_id: msg.id, media_id: mediaId, mime, size: buffer.length }, 'mídia armazenada');
      await this.events.message(msg.department_id, msg.id);
    } catch (err) {
      this.logger.warn({ message_id: msg.id, err: (err as Error).message, last_attempt: isLastAttempt }, 'falha ao baixar mídia');
      if (isLastAttempt) await this.markFailed(msg.id, msg.department_id, (err as Error).message);
      throw err;
    }
  }

  private async markFailed(messageId: number, departmentId: number, reason: string): Promise<void> {
    await this.chat.db.updateTable('messages').set({ media_status: 'failed' }).where('id', '=', messageId).execute();
    this.logger.warn({ message_id: messageId, reason }, 'mídia marcada como indisponível');
    await this.events.message(departmentId, messageId);
  }
}
