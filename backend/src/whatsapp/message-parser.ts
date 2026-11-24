import type { MessageType } from '../database/schema.js';

/**
 * Converte a mensagem crua da Evolution (messages.upsert / send.message) no formato do sistema.
 * Só lê campos; nunca executa nada do conteúdo.
 */

type AnyObj = Record<string, any>;

export interface ParsedMedia {
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mime: string;
  name: string | null;
  size: number | null;
}

export interface ParsedMessage {
  waId: string;
  chatJid: string;
  fromMe: boolean;
  participantJid: string | null;
  pushName: string | null;
  timestamp: Date;
  type: MessageType;
  body: string | null;
  media: ParsedMedia | null;
  quoted: { waId: string; preview: string; sender: string | null } | null;
  forwarded: boolean;
  /** Reação: aponta para outra mensagem. emoji vazio = reação removida. */
  reaction: { targetId: string; emoji: string } | null;
}

export const IGNORED_JID_SUFFIXES = ['@broadcast', '@newsletter'];

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

export function phoneFromJid(jid: string): string | null {
  const m = /^(\d{6,20})@s\.whatsapp\.net$/.exec(jid);
  return m ? m[1] : null;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  if (typeof v === 'object' && v !== null && 'low' in v) {
    const o = v as { low: number; high: number };
    return o.high * 2 ** 32 + (o.low >>> 0);
  }
  return null;
}

function toDate(ts: unknown): Date {
  const n = toNumber(ts);
  if (!n) return new Date();
  return new Date(n < 1e12 ? n * 1000 : n);
}

/** Desembrulha mensagens temporárias e de visualização única. */
function unwrap(message: AnyObj | null | undefined): AnyObj {
  let m = message ?? {};
  for (let i = 0; i < 4; i++) {
    const inner =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.viewOnceMessageV2Extension?.message ??
      m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

const LABELS: Record<string, string> = {
  imageMessage: 'Imagem',
  videoMessage: 'Vídeo',
  ptvMessage: 'Vídeo',
  audioMessage: 'Áudio',
  documentMessage: 'Documento',
  stickerMessage: 'Figurinha',
  locationMessage: 'Localização',
  liveLocationMessage: 'Localização',
  contactMessage: 'Contato',
  contactsArrayMessage: 'Contatos',
  pollCreationMessage: 'Enquete',
  pollCreationMessageV2: 'Enquete',
  pollCreationMessageV3: 'Enquete',
};

/** Texto curto que descreve qualquer conteúdo (usado em citações e na lista de conversas). */
export function previewOf(message: AnyObj | null | undefined): string {
  const m = unwrap(message);
  if (typeof m.conversation === 'string') return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text as string;
  for (const [key, label] of Object.entries(LABELS)) {
    if (m[key]) {
      const caption = m[key].caption ?? m[key].fileName ?? m[key].name ?? m[key].displayName;
      return caption ? `[${label}] ${caption}` : `[${label}]`;
    }
  }
  return '[Mensagem]';
}

/** Tipos que não viram mensagem na conversa (controle interno do WhatsApp). */
const SKIP_TYPES = new Set([
  'protocolMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'pollUpdateMessage',
  'keepInChatMessage',
  'albumMessage',
  'associatedChildMessage',
  'encReactionMessage',
  'peerDataOperationRequestResponseMessage',
]);

export function parseWaMessage(raw: AnyObj): ParsedMessage | null {
  const key = raw?.key as AnyObj | undefined;
  if (!key?.id || !key.remoteJid) return null;

  let chatJid = String(key.remoteJid);
  if (chatJid.endsWith('@lid') && key.remoteJidAlt) chatJid = String(key.remoteJidAlt);
  if (IGNORED_JID_SUFFIXES.some((s) => chatJid.endsWith(s))) return null;

  const fromMe = key.fromMe === true;
  const participantRaw = (key.participantAlt ?? key.participant ?? raw.participant ?? null) as string | null;
  const participantJid = isGroupJid(chatJid) ? participantRaw : null;
  const m = unwrap(raw.message as AnyObj);
  const ctx = (raw.contextInfo ?? m[Object.keys(m)[0]]?.contextInfo ?? null) as AnyObj | null;

  const base = {
    waId: String(key.id),
    chatJid,
    fromMe,
    participantJid,
    pushName: fromMe ? null : ((raw.pushName as string | undefined)?.slice(0, 150) ?? null),
    timestamp: toDate(raw.messageTimestamp),
    quoted: ctx?.stanzaId
      ? {
          waId: String(ctx.stanzaId),
          preview: previewOf(ctx.quotedMessage).slice(0, 250),
          sender: (ctx.participant as string | undefined) ?? null,
        }
      : null,
    forwarded: ctx?.isForwarded === true || (toNumber(ctx?.forwardingScore) ?? 0) > 0,
    reaction: null,
    media: null,
  };

  if (m.reactionMessage?.key?.id) {
    return {
      ...base,
      type: 'unknown',
      body: null,
      quoted: null,
      reaction: { targetId: String(m.reactionMessage.key.id), emoji: String(m.reactionMessage.text ?? '') },
    };
  }

  const msgType = String(raw.messageType ?? Object.keys(m)[0] ?? 'unknown');
  if (SKIP_TYPES.has(msgType) && !m.conversation) return null;

  if (typeof m.conversation === 'string' || m.extendedTextMessage) {
    return { ...base, type: 'text', body: (m.conversation ?? m.extendedTextMessage?.text ?? '') as string };
  }

  const mediaKinds: Array<[string, ParsedMedia['kind']]> = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['ptvMessage', 'video'],
    ['audioMessage', 'audio'],
    ['documentMessage', 'document'],
    ['stickerMessage', 'sticker'],
  ];
  for (const [k, kind] of mediaKinds) {
    const mm = m[k] as AnyObj | undefined;
    if (!mm) continue;
    return {
      ...base,
      type: kind,
      body: (mm.caption as string | undefined) ?? null,
      media: {
        kind,
        mime: String(mm.mimetype ?? 'application/octet-stream').split(';')[0].slice(0, 150),
        name: (mm.fileName as string | undefined)?.slice(0, 255) ?? null,
        size: toNumber(mm.fileLength),
      },
    };
  }

  const loc = (m.locationMessage ?? m.liveLocationMessage) as AnyObj | undefined;
  if (loc) {
    const lat = Number(loc.degreesLatitude);
    const lng = Number(loc.degreesLongitude);
    const label = [loc.name, loc.address].filter(Boolean).join(' - ');
    return { ...base, type: 'location', body: `${label ? `${label}\n` : ''}https://maps.google.com/?q=${lat},${lng}` };
  }

  if (m.contactMessage || m.contactsArrayMessage) {
    const names = m.contactMessage
      ? [m.contactMessage.displayName]
      : ((m.contactsArrayMessage.contacts ?? []) as AnyObj[]).map((c) => c.displayName);
    return { ...base, type: 'contact', body: names.filter(Boolean).join(', ') || 'Contato' };
  }

  const poll = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3;
  if (poll) {
    const opts = ((poll.options ?? []) as AnyObj[]).map((o) => `• ${o.optionName}`).join('\n');
    return { ...base, type: 'poll', body: `${poll.name ?? 'Enquete'}\n${opts}` };
  }

  return { ...base, type: 'unknown', body: `[${LABELS[msgType] ?? 'Tipo de mensagem não suportado'}]` };
}

/** Interpreta o evento messages.edited (protocolMessage): mensagem apagada (REVOKE) ou editada. */
export function parseProtocol(data: AnyObj): { kind: 'revoke' | 'edit'; targetId: string; text: string | null } | null {
  const targetId = data?.key?.id;
  if (!targetId) return null;
  const type = data.type;
  if (type === 0 || type === 'REVOKE') return { kind: 'revoke', targetId: String(targetId), text: null };
  if (type === 14 || type === 'MESSAGE_EDIT') {
    const em = unwrap(data.editedMessage as AnyObj);
    const text = em.conversation ?? em.extendedTextMessage?.text ?? em.imageMessage?.caption ?? em.videoMessage?.caption ?? null;
    return { kind: 'edit', targetId: String(targetId), text: text as string | null };
  }
  return null;
}

const STATUS_RANK = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 } as const;
export type WaStatus = keyof typeof STATUS_RANK;

export function mapStatus(s: unknown): WaStatus | null {
  switch (s) {
    case 'PENDING':
      return 'pending';
    case 'SERVER_ACK':
      return 'sent';
    case 'DELIVERY_ACK':
      return 'delivered';
    case 'READ':
    case 'PLAYED':
      return 'read';
    case 'ERROR':
      return 'failed';
    default:
      return null;
  }
}

export function isStatusUpgrade(current: string, next: WaStatus): boolean {
  const c = STATUS_RANK[current as WaStatus] ?? 0;
  return next === 'failed' ? c < 1 : STATUS_RANK[next] > c;
}
