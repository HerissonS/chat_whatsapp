import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';
import { REDIS } from '../redis/redis.module.js';
import { EvolutionClient } from '../whatsapp/evolution.client.js';
import { isGroupJid, phoneFromJid } from '../whatsapp/message-parser.js';

/** Foto encontrada: renova depois de 24 h. Sem foto: tenta de novo depois de 12 h. */
const AVATAR_TTL_MS = 24 * 3600_000;
const NO_AVATAR_TTL_MS = 12 * 3600_000;
const AVATAR_MAX_BYTES = 1024 * 1024;
const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Máximo de buscas simultâneas de foto na Evolution/WhatsApp (por processo). */
const AVATAR_CONCURRENCY = 3;

export type AvatarState = 'yes' | 'no' | 'unknown';

export function avatarState(c: { avatar_path: string | null; avatar_checked_at: Date | null }): AvatarState {
  if (c.avatar_path) return 'yes';
  if (c.avatar_checked_at && Date.now() - c.avatar_checked_at.getTime() < NO_AVATAR_TTL_MS) return 'no';
  return 'unknown';
}

/**
 * Contatos sincronizados pelo WhatsApp e fotos de perfil.
 * - Importação: lê os contatos e grupos que a Evolution sincronizou do celular e grava/atualiza no sistema.
 * - Foto: o navegador não pode carregar direto dos servidores do WhatsApp (CSP e URLs temporárias),
 *   então o backend baixa uma cópia, valida e guarda no volume de mídia.
 */
@Injectable()
export class ContactsService {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly evolution: EvolutionClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Contacts');
  }

  // ------------------------------------------------------------------ importação

  async importFromWhatsapp(departmentId: number): Promise<{ contacts: number; groups: number; skipped: number }> {
    const dept = await this.db.selectFrom('departments').select(['id', 'evolution_instance']).where('id', '=', departmentId).executeTakeFirstOrThrow();
    if (!dept.evolution_instance) throw new Error('Caixa de entrada sem instância do WhatsApp.');
    const instance = dept.evolution_instance;

    const [contacts, groups] = await Promise.all([
      this.evolution.findContacts(instance),
      this.evolution.fetchAllGroups(instance).catch(() => [] as Array<{ id: string; subject?: string | null }>),
    ]);

    let imported = 0;
    let skipped = 0;
    const now = new Date();
    for (const c of contacts ?? []) {
      const jid = String(c.remoteJid ?? '');
      // Só números de telefone: identificadores @lid, status e canais não viram contato.
      if (!jid.endsWith('@s.whatsapp.net') || !phoneFromJid(jid)) {
        if (!isGroupJid(jid)) skipped++;
        continue;
      }
      const name = typeof c.pushName === 'string' && c.pushName.trim() ? c.pushName.trim().slice(0, 150) : null;
      await this.db
        .insertInto('contacts')
        .values({ department_id: departmentId, jid, phone: phoneFromJid(jid), push_name: name, is_group: 0, imported_at: now })
        .onDuplicateKeyUpdate({ ...(name ? { push_name: name } : {}), imported_at: now })
        .execute();
      imported++;
    }

    let groupCount = 0;
    for (const g of groups ?? []) {
      const jid = String(g.id ?? '');
      if (!isGroupJid(jid)) continue;
      const subject = typeof g.subject === 'string' && g.subject.trim() ? g.subject.trim().slice(0, 150) : null;
      await this.db
        .insertInto('contacts')
        .values({ department_id: departmentId, jid, phone: null, push_name: subject, is_group: 1, imported_at: now })
        .onDuplicateKeyUpdate({ ...(subject ? { push_name: subject } : {}), imported_at: now })
        .execute();
      groupCount++;
    }

    this.logger.info({ department_id: departmentId, contacts: imported, groups: groupCount, skipped }, 'contatos importados do WhatsApp');
    return { contacts: imported, groups: groupCount, skipped };
  }

  // ------------------------------------------------------------------ foto de perfil

  private async slot(): Promise<() => void> {
    if (this.running >= AVATAR_CONCURRENCY) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    return () => {
      this.running--;
      this.waiting.shift()?.();
    };
  }

  /** Caminho absoluto da foto do contato (busca/renova quando preciso). Null se o contato não tem foto. */
  async avatarFile(contactId: number): Promise<string | null> {
    const c = await this.db
      .selectFrom('contacts as ct')
      .innerJoin('departments as d', 'd.id', 'ct.department_id')
      .select(['ct.id', 'ct.jid', 'ct.avatar_path', 'ct.avatar_checked_at', 'd.evolution_instance', 'd.wa_state'])
      .where('ct.id', '=', contactId)
      .executeTakeFirst();
    if (!c) return null;

    const fresh = c.avatar_checked_at && Date.now() - c.avatar_checked_at.getTime() < (c.avatar_path ? AVATAR_TTL_MS : NO_AVATAR_TTL_MS);
    if (fresh || !c.evolution_instance || c.wa_state !== 'open') return c.avatar_path ? this.abs(c.avatar_path) : null;

    // Uma busca por contato por vez (várias abas/usuários abrindo a mesma lista).
    const lock = await this.redis.set(`avatar-lock:${c.id}`, '1', 'EX', 30, 'NX');
    if (!lock) return c.avatar_path ? this.abs(c.avatar_path) : null;

    const release = await this.slot();
    try {
      const rel = await this.download(c.evolution_instance, c.jid, c.id);
      // undefined = falha temporária: mantém a foto anterior. null = contato sem foto.
      const next = rel === undefined ? c.avatar_path : rel;
      await this.db.updateTable('contacts').set({ avatar_path: next, avatar_checked_at: new Date() }).where('id', '=', c.id).execute();
      return next ? this.abs(next) : null;
    } finally {
      release();
      await this.redis.del(`avatar-lock:${c.id}`);
    }
  }

  private abs(rel: string): string {
    return join(this.config.MEDIA_DIR, rel);
  }

  /**
   * Baixa a foto. Retorna o caminho relativo salvo, null se o contato não tem foto,
   * ou undefined em falha temporária (mantém a foto anterior).
   */
  private async download(instance: string, jid: string, contactId: number): Promise<string | null | undefined> {
    let url: string | null;
    try {
      url = await this.evolution.profilePictureUrl(instance, jid);
    } catch (err) {
      this.logger.debug({ contact_id: contactId, err: (err as Error).message }, 'falha ao consultar a foto');
      return undefined;
    }
    if (!url) return null;

    // Só baixa de servidores do WhatsApp por HTTPS (evita usar o backend para acessar outros endereços).
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' || !(parsed.hostname === 'whatsapp.net' || parsed.hostname.endsWith('.whatsapp.net'))) {
      this.logger.warn({ contact_id: contactId, host: parsed.hostname }, 'foto de perfil com endereço não permitido');
      return null;
    }

    try {
      const res = await fetch(parsed, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!res.ok) return res.status === 404 ? null : undefined;
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > AVATAR_MAX_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > AVATAR_MAX_BYTES) return null;
      const type = await fileTypeFromBuffer(buf);
      if (!type || !AVATAR_TYPES.has(type.mime)) return null;
      const rel = join('avatars', `${contactId}.${type.ext}`);
      await mkdir(join(this.config.MEDIA_DIR, 'avatars'), { recursive: true });
      await writeFile(this.abs(rel), buf, { mode: 0o640 });
      return rel;
    } catch (err) {
      this.logger.debug({ contact_id: contactId, err: (err as Error).message }, 'falha ao baixar a foto');
      return undefined;
    }
  }
}
