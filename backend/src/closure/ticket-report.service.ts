import { readFile } from 'node:fs/promises';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { BrandingService } from '../branding/branding.service.js';
import { ChatRepository, displayName, formatPhone, type MessageDto } from '../chat/chat.repository.js';
import { toBool } from '../common/validation.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { MediaStorageService } from '../media/media-storage.service.js';
import { TicketsService } from '../tickets/tickets.service.js';

const FONT = '/usr/share/fonts/dejavu/DejaVuSans.ttf';
/** Limites das imagens no PDF (tamanho de exibição e quantidade, para o anexo não ficar enorme). */
const MAX_IMG_W = 260;
const MAX_IMG_H = 220;
const MAX_PDF_IMAGES = 60;
const FONT_BOLD = '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf';

const TYPE_LABEL: Record<string, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
  sticker: 'Figurinha',
  location: 'Localização',
  contact: 'Contato',
  poll: 'Enquete',
};

/** Remove emojis (a fonte do PDF não tem esses glifos) e caracteres de controle. */
export function pdfSafe(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\p{Extended_Pictographic}|‍|️|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  if (totalMin < 1) return 'menos de 1 minuto';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hs = h ? `${h} ${h === 1 ? 'hora' : 'horas'}` : '';
  const ms_ = m ? `${m} ${m === 1 ? 'minuto' : 'minutos'}` : '';
  return [hs, ms_].filter(Boolean).join(' e ');
}

export interface TicketReport {
  ticketId: number;
  departmentId: number;
  conversationId: number;
  contactName: string;
  phone: string;
  isGroup: boolean;
  agentName: string;
  classification: string;
  contract: string;
  equipment: string | null;
  openedAt: Date;
  closedAt: Date;
  durationText: string;
  subject: string;
}

/** Monta os dados, o assunto, o corpo do e-mail e o PDF de um chamado encerrado. */
@Injectable()
export class TicketReportService {
  constructor(
    private readonly chat: ChatRepository,
    private readonly tickets: TicketsService,
    private readonly branding: BrandingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly storage?: MediaStorageService,
  ) {}

  /** Imagem da conversa para o PDF (JPEG/PNG até 8 MB). Null quando não dá para incluir. */
  private async imageFor(m: MessageDto): Promise<Buffer | null> {
    const media = m.media;
    if (!this.storage || m.deleted || !media?.id || media.status !== 'ready') return null;
    if (media.mime !== 'image/jpeg' && media.mime !== 'image/png') return null;
    if ((media.size ?? 0) > 8 * 1024 * 1024) return null;
    try {
      return (await this.storage.read(media.id)).buffer;
    } catch {
      return null;
    }
  }

  private fmt(d: Date, withSeconds = true): string {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: this.config.APP_TIMEZONE,
      dateStyle: 'short',
      timeStyle: withSeconds ? 'medium' : 'short',
    }).format(d);
  }

  /** AAAAMMDD no fuso configurado. */
  ymd(d: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: this.config.APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return parts.replaceAll('-', '');
  }

  buildSubject(p: { date: Date; contract: string; equipment: string | null; classification: string }): string {
    const eq = p.equipment ? `[${p.equipment}]` : '';
    return `[${this.ymd(p.date)}][${p.contract}]${eq} ${p.classification}`.slice(0, 250);
  }

  async load(ticketId: number): Promise<TicketReport> {
    const t = await this.chat.db
      .selectFrom('tickets as t')
      .innerJoin('conversations as cv', 'cv.id', 't.conversation_id')
      .innerJoin('contacts as ct', 'ct.id', 'cv.contact_id')
      .leftJoin('classifications as cl', 'cl.id', 't.classification_id')
      .leftJoin('users as u', 'u.id', 't.assignee_id')
      .select([
        't.id', 't.department_id', 't.conversation_id', 't.status', 't.opened_at', 't.closed_at', 't.contract', 't.equipment',
        'ct.custom_name', 'ct.push_name', 'ct.phone', 'ct.jid', 'ct.is_group', 'cl.subject_label', 'u.name as agent_name',
      ])
      .where('t.id', '=', ticketId)
      .executeTakeFirst();
    if (!t) throw new NotFoundException('Chamado não encontrado.');
    const closedAt = t.closed_at ?? new Date();
    const first = (await this.tickets.firstMessageAt(ticketId)) ?? t.opened_at;
    const classification = t.subject_label ?? 'Outras dúvidas';
    const contract = t.contract ?? '-';
    return {
      ticketId: t.id,
      departmentId: t.department_id,
      conversationId: t.conversation_id,
      contactName: displayName(t),
      phone: toBool(t.is_group) ? 'Grupo do WhatsApp' : (formatPhone(t.phone) ?? t.jid.split('@')[0]),
      isGroup: toBool(t.is_group),
      agentName: t.agent_name ?? '-',
      classification,
      contract,
      equipment: t.equipment,
      openedAt: first,
      closedAt,
      durationText: formatDuration(closedAt.getTime() - first.getTime()),
      subject: this.buildSubject({ date: closedAt, contract, equipment: t.equipment, classification }),
    };
  }

  emailText(r: TicketReport): string {
    return [
      'ENCERRAMENTO DE ATENDIMENTO',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '📋 DADOS DO ATENDIMENTO:',
      `Cliente: ${r.contactName}`,
      `Telefone: ${r.phone}`,
      `Técnico Responsável: ${r.agentName}`,
      '',
      '🕐 INFORMAÇÕES DE TEMPO:',
      `Duração do Atendimento: ${r.durationText}`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '💬 HISTÓRICO DA CONVERSA: ver PDF anexo',
      '',
    ].join('\n');
  }

  async emailHtml(r: TicketReport): Promise<string> {
    const color = await this.branding.primaryColor();
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const row = (k: string, v: string) => `<tr><td style="padding:2px 12px 2px 0;color:#5B6D88">${esc(k)}</td><td style="padding:2px 0"><strong>${esc(v)}</strong></td></tr>`;
    return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#16202e">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e3e7ee">
<div style="background:${esc(color)};color:#fff;padding:16px 20px;font-size:16px;font-weight:bold;letter-spacing:.5px">ENCERRAMENTO DE ATENDIMENTO</div>
<div style="padding:20px">
<p style="margin:0 0 6px;font-weight:bold">📋 DADOS DO ATENDIMENTO:</p>
<table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">${row('Cliente:', r.contactName)}${row('Telefone:', r.phone)}${row('Técnico Responsável:', r.agentName)}</table>
<p style="margin:0 0 6px;font-weight:bold">🕐 INFORMAÇÕES DE TEMPO:</p>
<table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">${row('Duração do Atendimento:', r.durationText)}</table>
<hr style="border:none;border-top:1px solid #e3e7ee;margin:16px 0">
<p style="margin:0;font-weight:bold">💬 HISTÓRICO DA CONVERSA: ver PDF anexo</p>
</div></div></body></html>`;
  }

  private senderLabel(m: MessageDto, r: TicketReport): string {
    if (m.origin === 'bot') return 'Bot (mensagem automática)';
    if (m.origin === 'agent') return `${m.userName ?? m.senderName ?? 'Atendente'} (atendente)`;
    if (m.origin === 'phone') return 'Suporte (celular)';
    if (r.isGroup) return m.senderName ?? m.senderJid?.split('@')[0] ?? 'Participante';
    return r.contactName;
  }

  private content(m: MessageDto): string {
    if (m.deleted) return '[mensagem apagada]';
    const label = TYPE_LABEL[m.type];
    if (m.media || label) {
      const name = m.media?.name ? `: ${m.media.name}` : '';
      const caption = m.body ? `\n${m.body}` : '';
      return m.type === 'location' || m.type === 'contact' || m.type === 'poll' ? `[${label}] ${m.body ?? ''}` : `[${label ?? 'Arquivo'}${name}]${caption}`;
    }
    return m.body ?? '';
  }

  async pdf(r: TicketReport): Promise<Buffer> {
    const messages = await this.chat.messages({ ticketId: r.ticketId });
    const color = await this.branding.primaryColor();
    const logo = await this.branding.logoFile(1, 'pdf');
    const logoBuf = !logo || logo.mime === 'image/svg+xml' ? null : await readFile(logo.path).catch(() => null);
    const systemName = await this.branding.systemName();

    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 50, bottom: 50, left: 50, right: 50 }, info: { Title: `Atendimento ${r.ticketId}`, Author: systemName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    doc.registerFont('regular', FONT);
    doc.registerFont('bold', FONT_BOLD);
    const width = doc.page.width - 100;

    if (logoBuf) {
      try {
        doc.image(logoBuf, 50, 40, { fit: [110, 60] });
      } catch {
        /* logo inválido: segue sem imagem */
      }
    }
    if (!logoBuf) doc.font('bold').fontSize(13).fillColor(color).text(pdfSafe(systemName), 50, 52, { width: 200 });
    doc.font('bold').fontSize(16).fillColor(color).text('Histórico do Atendimento', 180, 50, { width: width - 130, align: 'right' });
    doc.font('regular').fontSize(10).fillColor('#5B6D88').text(`Chamado nº ${r.ticketId}`, 180, 72, { width: width - 130, align: 'right' });
    doc.moveTo(50, 110).lineTo(50 + width, 110).strokeColor(color).lineWidth(1.5).stroke();

    let y = 122;
    const info: Array<[string, string]> = [
      ['Cliente', r.contactName],
      ['Telefone', r.phone],
      ['Técnico responsável', r.agentName],
      ['Classificação', r.classification],
      ['Contrato', r.contract],
      ['Equipamento', r.equipment ?? '-'],
      ['Início', this.fmt(r.openedAt)],
      ['Encerramento', this.fmt(r.closedAt)],
      ['Duração', r.durationText],
    ];
    for (const [k, v] of info) {
      doc.font('bold').fontSize(9.5).fillColor('#5B6D88').text(`${k}:`, 50, y, { width: 130 });
      doc.font('regular').fillColor('#16202E').text(pdfSafe(v), 180, y, { width: width - 130 });
      y = Math.max(doc.y, y + 14);
    }
    doc.moveTo(50, y + 6).lineTo(50 + width, y + 6).strokeColor('#ACB4BF').lineWidth(0.5).stroke();
    doc.font('bold').fontSize(12).fillColor(color).text('Conversa', 50, y + 16);
    doc.moveDown(0.6);

    let images = 0;
    for (const m of messages) {
      if (doc.y > doc.page.height - 110) doc.addPage();
      const who = pdfSafe(this.senderLabel(m, r));
      doc.font('bold').fontSize(9).fillColor(m.fromMe ? color : '#16202E').text(`${this.fmt(m.timestamp)}  ·  ${who}`, { width });
      if (m.quoted) {
        doc.font('regular').fontSize(8.5).fillColor('#5B6D88').text(`↪ Em resposta a: ${pdfSafe(m.quoted.preview).slice(0, 160)}`, { width, indent: 10 });
      }
      if (m.forwarded) doc.font('regular').fontSize(8.5).fillColor('#5B6D88').text('Encaminhada', { width, indent: 10 });
      const img = images < MAX_PDF_IMAGES ? await this.imageFor(m) : null;
      let embedded = false;
      if (img) {
        try {
          // openImage existe no PDFKit, mas não está declarado nos tipos.
          const opened = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(img);
          const scale = Math.min(MAX_IMG_W / opened.width, MAX_IMG_H / opened.height, 1);
          const w = opened.width * scale;
          const h = opened.height * scale;
          if (doc.y + h + 10 > doc.page.height - 60) doc.addPage();
          const y = doc.y + 3;
          doc.image(opened as unknown as Buffer, 60, y, { width: w, height: h });
          doc.rect(60, y, w, h).strokeColor('#ACB4BF').lineWidth(0.5).stroke();
          doc.y = y + h + 4;
          doc.x = 50;
          embedded = true;
          images++;
        } catch {
          embedded = false;
        }
      }
      const text = embedded ? pdfSafe(m.body ?? '').trim() : pdfSafe(this.content(m)).trim() || '[conteúdo sem texto]';
      if (text) doc.font('regular').fontSize(10).fillColor('#16202E').text(text, 50, doc.y, { width, indent: 10 });
      if (m.edited && !m.deleted) doc.font('regular').fontSize(8).fillColor('#5B6D88').text('(editada)', { indent: 10 });
      if (m.reactions.length) {
        const who2 = m.reactions.map((x) => pdfSafe(`${x.emoji} ${x.reactorName ?? ''}`).trim() || 'reação').join(', ');
        doc.font('regular').fontSize(8).fillColor('#5B6D88').text(`Reações: ${who2}`, { indent: 10 });
      }
      doc.moveDown(0.5);
    }
    if (!messages.length) doc.font('regular').fontSize(10).fillColor('#5B6D88').text('Nenhuma mensagem registrada neste chamado.');

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Sem margem inferior durante o rodapé, para não abrir uma página nova.
      doc.page.margins.bottom = 0;
      doc.font('regular').fontSize(8).fillColor('#5B6D88').text(
        `${systemName} · Chamado ${r.ticketId} · Página ${i + 1} de ${range.count}`,
        50,
        doc.page.height - 35,
        { width, align: 'center', lineBreak: false },
      );
    }
    doc.end();
    return done;
  }
}
