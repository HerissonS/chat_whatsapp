import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ChatRepository } from '../chat/chat.repository.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { MediaStorageService } from '../media/media-storage.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { EvolutionClient } from '../whatsapp/evolution.client.js';

/** Tarefas periódicas: limpeza de eventos antigos e de uploads abandonados, e sincronização do estado da conexão. */
@Injectable()
export class MaintenanceProcessor {
  constructor(
    private readonly chat: ChatRepository,
    private readonly evolution: EvolutionClient,
    private readonly storage: MediaStorageService,
    private readonly realtime: RealtimeService,
    private readonly contacts: ContactsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Maintenance');
  }

  async process(name: string, data?: { departmentId?: number }): Promise<void> {
    if (name === 'import-contacts' && data?.departmentId) {
      await this.contacts.importFromWhatsapp(data.departmentId);
      return;
    }
    if (name === 'cleanup') return this.cleanup();
    if (name === 'sync-connection') return this.syncConnection();
  }

  private async cleanup(): Promise<void> {
    const limit = new Date(Date.now() - this.config.WEBHOOK_RETENTION_DAYS * 86_400_000);
    const r = await this.chat.db.deleteFrom('webhook_events').where('received_at', '<', limit).executeTakeFirst();
    let tmpRemoved = 0;
    try {
      for (const f of await readdir(this.storage.tmpDir)) {
        const p = join(this.storage.tmpDir, f);
        if (Date.now() - (await stat(p)).mtimeMs > 6 * 3600_000) {
          await rm(p, { force: true });
          tmpRemoved++;
        }
      }
    } catch {
      /* pasta temporária ainda não existe */
    }
    this.logger.info({ webhook_events_removed: Number(r.numDeletedRows), tmp_files_removed: tmpRemoved }, 'limpeza concluída');
  }

  private async syncConnection(): Promise<void> {
    const depts = await this.chat.db
      .selectFrom('departments')
      .select(['id', 'evolution_instance', 'wa_state'])
      .where('evolution_instance', 'is not', null)
      .where('active', '=', 1)
      .execute();
    for (const d of depts) {
      try {
        if (!(await this.evolution.instanceExists(d.evolution_instance!))) continue;
        const state = await this.evolution.connectionState(d.evolution_instance!);
        if (state !== d.wa_state) {
          await this.chat.db.updateTable('departments').set({ wa_state: state, wa_updated_at: new Date() }).where('id', '=', d.id).execute();
          this.realtime.toDepartment(d.id, 'whatsapp:status', { departmentId: d.id, state });
          this.realtime.toAdmins('whatsapp:status', { departmentId: d.id, state });
        }
      } catch (err) {
        this.logger.warn({ department_id: d.id, err: (err as Error).message }, 'não foi possível consultar a conexão');
      }
    }
  }
}
