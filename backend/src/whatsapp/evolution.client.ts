import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

/** Eventos que o sistema assina na Evolution. */
export const WEBHOOK_EVENTS = [
  'QRCODE_UPDATED',
  'CONNECTION_UPDATE',
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'MESSAGES_EDITED',
  'SEND_MESSAGE',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'GROUPS_UPSERT',
  'GROUP_UPDATE',
] as const;

/** URL interna do webhook (rede Docker). Nunca passa pelo nginx público. */
/** Nome do serviço no compose (não o container_name), para não depender do nome do container. */
export const INTERNAL_WEBHOOK_URL = 'http://backend:3000/webhook/evolution';
export const WEBHOOK_TOKEN_HEADER = 'x-webhook-token';

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface WaKey {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  participant?: string;
}

export interface SentMessage {
  key: WaKey;
  messageTimestamp?: number | string;
  status?: string;
}

export interface ConnectResult {
  base64?: string;
  code?: string;
  pairingCode?: string | null;
  count?: number;
}

/**
 * Cliente HTTP da Evolution API v2.3.7.
 * Formatos conferidos no código-fonte da própria versão (validate/*.schema.ts).
 * A apikey vai só no cabeçalho e nunca é registrada em log.
 */
@Injectable()
export class EvolutionClient {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Evolution');
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000, expected: number[] = []): Promise<T> {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.config.EVOLUTION_URL}${path}`, {
        method,
        headers: { apikey: this.config.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      this.logger.error({ method, path: this.safePath(path), err: (err as Error).message }, 'Evolution indisponível');
      throw new EvolutionError('Não foi possível falar com o serviço do WhatsApp.', 503);
    }
    const text = await res.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    const ms = Date.now() - started;
    if (!res.ok) {
      const detail = this.errorDetail(data);
      if (expected.includes(res.status)) throw new EvolutionError(detail, res.status);
      this.logger.warn({ method, path: this.safePath(path), status: res.status, ms, detail }, 'Evolution respondeu com erro');
      throw new EvolutionError(detail || `Erro ${res.status} no serviço do WhatsApp.`, res.status);
    }
    this.logger.debug({ method, path: this.safePath(path), status: res.status, ms }, 'chamada à Evolution');
    return data as T;
  }

  /** Remove números de telefone de query strings dos logs. */
  private safePath(path: string): string {
    return path.replace(/([?&]number=)[^&]+/, '$1***');
  }

  private errorDetail(data: unknown): string {
    if (!data || typeof data !== 'object') return typeof data === 'string' ? data.slice(0, 200) : '';
    const d = data as { response?: { message?: unknown }; message?: unknown; error?: unknown };
    const msg = d.response?.message ?? d.message ?? d.error;
    const flat = Array.isArray(msg) ? msg.flat(3).map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('; ') : msg;
    return typeof flat === 'string' ? flat.slice(0, 300) : JSON.stringify(flat ?? '').slice(0, 300);
  }

  private enc(instance: string): string {
    return encodeURIComponent(instance);
  }

  // ---------------------------------------------------------------- instância

  async instanceExists(instance: string): Promise<boolean> {
    try {
      const list = await this.request<unknown[]>('GET', `/instance/fetchInstances?instanceName=${this.enc(instance)}`, undefined, 30_000, [404]);
      return Array.isArray(list) && list.length > 0;
    } catch (err) {
      if (err instanceof EvolutionError && err.status === 404) return false;
      throw err;
    }
  }

  async createInstance(instance: string): Promise<ConnectResult | undefined> {
    const r = await this.request<{ qrcode?: ConnectResult }>('POST', '/instance/create', {
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: this.webhookConfig(),
    });
    return r?.qrcode;
  }

  async setWebhook(instance: string): Promise<void> {
    await this.request('POST', `/webhook/set/${this.enc(instance)}`, { webhook: this.webhookConfig() });
  }

  async setSettings(instance: string): Promise<void> {
    await this.request('POST', `/settings/set/${this.enc(instance)}`, {
      rejectCall: false,
      groupsIgnore: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    });
  }

  private webhookConfig() {
    return {
      enabled: true,
      url: INTERNAL_WEBHOOK_URL,
      byEvents: false,
      base64: false,
      headers: { [WEBHOOK_TOKEN_HEADER]: this.config.WEBHOOK_TOKEN },
      events: [...WEBHOOK_EVENTS],
    };
  }

  connect(instance: string, number?: string): Promise<ConnectResult> {
    const q = number ? `?number=${encodeURIComponent(number)}` : '';
    return this.request<ConnectResult>('GET', `/instance/connect/${this.enc(instance)}${q}`);
  }

  async connectionState(instance: string): Promise<string> {
    const r = await this.request<{ instance?: { state?: string } }>('GET', `/instance/connectionState/${this.enc(instance)}`);
    return r?.instance?.state ?? 'close';
  }

  async logout(instance: string): Promise<void> {
    await this.request('DELETE', `/instance/logout/${this.enc(instance)}`);
  }

  async restart(instance: string): Promise<void> {
    await this.request('POST', `/instance/restart/${this.enc(instance)}`);
  }

  async deleteInstance(instance: string): Promise<void> {
    try {
      await this.request('DELETE', `/instance/delete/${this.enc(instance)}`, undefined, 30_000, [404]);
    } catch (err) {
      if (err instanceof EvolutionError && err.status === 404) return;
      throw err;
    }
  }

  // ---------------------------------------------------------------- mensagens

  sendText(instance: string, number: string, text: string, quotedId?: string): Promise<SentMessage> {
    return this.request<SentMessage>('POST', `/message/sendText/${this.enc(instance)}`, {
      number,
      text,
      linkPreview: false,
      ...(quotedId && { quoted: { key: { id: quotedId } } }),
    });
  }

  sendMedia(
    instance: string,
    p: {
      number: string;
      mediatype: 'image' | 'video' | 'audio' | 'document';
      mimetype: string;
      base64: string;
      fileName: string;
      caption?: string;
      quotedId?: string;
    },
  ): Promise<SentMessage> {
    return this.request<SentMessage>(
      'POST',
      `/message/sendMedia/${this.enc(instance)}`,
      {
        number: p.number,
        mediatype: p.mediatype,
        mimetype: p.mimetype,
        media: p.base64,
        fileName: p.fileName,
        ...(p.caption && { caption: p.caption }),
        ...(p.quotedId && { quoted: { key: { id: p.quotedId } } }),
      },
      180_000,
    );
  }

  /** Figurinha: WebP já pronto vai sem conversão (preserva animação); PNG/JPG/GIF a Evolution converte. */
  sendSticker(instance: string, number: string, base64: string, convert: boolean, quotedId?: string): Promise<SentMessage> {
    return this.request<SentMessage>(
      'POST',
      `/message/sendSticker/${this.enc(instance)}`,
      { number, sticker: base64, notConvertSticker: !convert, ...(quotedId && { quoted: { key: { id: quotedId } } }) },
      120_000,
    );
  }

  sendReaction(instance: string, key: WaKey, emoji: string): Promise<SentMessage> {
    return this.request<SentMessage>('POST', `/message/sendReaction/${this.enc(instance)}`, {
      key: { id: key.id, remoteJid: key.remoteJid, fromMe: key.fromMe, ...(key.participant && { participant: key.participant }) },
      reaction: emoji,
    });
  }

  async deleteForEveryone(instance: string, key: WaKey): Promise<void> {
    await this.request('DELETE', `/chat/deleteMessageForEveryone/${this.enc(instance)}`, {
      id: key.id,
      remoteJid: key.remoteJid,
      fromMe: key.fromMe,
      ...(key.participant && { participant: key.participant }),
    });
  }

  async markRead(instance: string, keys: WaKey[]): Promise<void> {
    if (!keys.length) return;
    await this.request('POST', `/chat/markMessageAsRead/${this.enc(instance)}`, {
      readMessages: keys.map((k) => ({ id: k.id, remoteJid: k.remoteJid, fromMe: k.fromMe })),
    });
  }

  async checkNumber(instance: string, number: string): Promise<{ exists: boolean; jid: string } | null> {
    const r = await this.request<Array<{ exists: boolean; jid: string; number: string }>>(
      'POST',
      `/chat/whatsappNumbers/${this.enc(instance)}`,
      { numbers: [number] },
    );
    return r?.[0] ?? null;
  }

  /** Baixa a mídia de uma mensagem recebida (a Evolution descriptografa). */
  getMediaBase64(
    instance: string,
    message: { key: WaKey; message: unknown },
  ): Promise<{ base64: string; mimetype?: string; fileName?: string; size?: { fileLength?: number } }> {
    return this.request('POST', `/chat/getBase64FromMediaMessage/${this.enc(instance)}`, { message, convertToMp4: false }, 180_000);
  }

  /** Contatos sincronizados pela Evolution (agenda e conversas do celular). */
  findContacts(instance: string): Promise<Array<{ remoteJid: string; pushName?: string | null; profilePicUrl?: string | null }>> {
    return this.request('POST', `/chat/findContacts/${this.enc(instance)}`, { where: {} }, 60_000);
  }

  /** Grupos dos quais o número participa. */
  fetchAllGroups(instance: string): Promise<Array<{ id: string; subject?: string | null }>> {
    return this.request('GET', `/group/fetchAllGroups/${this.enc(instance)}?getParticipants=false`, undefined, 60_000);
  }

  /** URL temporária da foto de perfil (servidores do WhatsApp). */
  async profilePictureUrl(instance: string, jid: string): Promise<string | null> {
    const r = await this.request<{ profilePictureUrl?: string | null }>('POST', `/chat/fetchProfilePictureUrl/${this.enc(instance)}`, { number: jid }, 20_000);
    return r?.profilePictureUrl ?? null;
  }

  async groupSubject(instance: string, groupJid: string): Promise<string | null> {
    const r = await this.request<{ subject?: string }>(
      'GET',
      `/group/findGroupInfos/${this.enc(instance)}?groupJid=${encodeURIComponent(groupJid)}`,
    );
    return r?.subject ?? null;
  }
}
