import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { PinoLogger } from 'nestjs-pino';
import { BrandingService } from '../branding/branding.service.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

/** Envio de e-mail por SMTP (Gmail com senha de app). As credenciais vêm só do .env. */
@Injectable()
export class MailService {
  private transporter: Transporter | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly branding: BrandingService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Mail');
  }

  get configured(): boolean {
    return !!(this.config.SMTP_USER && this.config.SMTP_PASSWORD);
  }

  private transport(): Transporter {
    if (!this.configured) {
      throw new ServiceUnavailableException('E-mail não configurado: preencha SMTP_USER e SMTP_PASSWORD no .env.');
    }
    this.transporter ??= nodemailer.createTransport({
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_SECURE,
      requireTLS: !this.config.SMTP_SECURE,
      auth: { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD },
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
    });
    return this.transporter;
  }

  async send(m: MailMessage): Promise<string> {
    const info = await this.transport().sendMail({
      from: { name: this.config.SMTP_FROM_NAME || (await this.branding.systemName()), address: this.config.SMTP_USER },
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
      attachments: m.attachments,
    });
    this.logger.info({ recipients: m.to.length, message_id: info.messageId }, 'e-mail enviado');
    return info.messageId;
  }
}
