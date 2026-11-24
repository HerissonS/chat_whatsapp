import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { loadConfig } from '../config/env.js';

/**
 * Campos que nunca podem aparecer nos logs. O pino substitui o valor por "[REDACTED]".
 * Ao criar novos DTOs com dados sensíveis, inclua o caminho aqui.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.apikey',
  'req.headers["x-gateway-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.senha',
  '*.token',
  '*.apikey',
  '*.apiKey',
  '*.secret',
  '*.passwordHash',
  '*.password_hash',
];

const REQUEST_ID = /^[a-zA-Z0-9-]{8,64}$/;

/** Esconde o token do webhook, que faz parte do caminho da URL. */
function safeUrl(url: string | undefined): string | undefined {
  return url?.replace(/^\/webhook\/evolution\/[^/?]+/, '/webhook/evolution/[REDACTED]');
}

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: loadConfig().LOG_LEVEL,
        base: { service: process.env.SERVICE_NAME ?? 'api' },
        timestamp: stdTimeFunctions.isoTime,
        formatters: { level: (label: string) => ({ level: label }) },
        redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
        genReqId: (req: IncomingMessage) => {
          const incoming = req.headers['x-request-id'];
          return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        },
        customProps: (req: IncomingMessage) => ({ request_id: req.id }),
        autoLogging: {
          ignore: (req: IncomingMessage) => req.url?.startsWith('/api/health') ?? false,
        },
        serializers: {
          req: (req: { id: unknown; method: string; url: string; remoteAddress?: string }) => ({
            id: req.id,
            method: req.method,
            url: safeUrl(req.url),
            ip: req.remoteAddress,
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      },
    }),
  ],
})
export class LoggerModule {}
