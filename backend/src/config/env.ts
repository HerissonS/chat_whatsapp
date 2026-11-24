import { z } from 'zod';

/**
 * Configuração da aplicação, lida das variáveis de ambiente e validada na inicialização.
 * Se algo obrigatório faltar, o processo para com uma mensagem clara (sem exibir valores).
 */
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  APP_TIMEZONE: z.string().min(1).default('America/Sao_Paulo'),
  TRUST_PROXY: z.string().min(1).default('loopback, 172.16.0.0/12'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(16, 'DB_PASSWORD muito curta'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().default(6379),
  REDIS_PASSWORD: z.string().min(16, 'REDIS_PASSWORD muito curta'),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),

  EVOLUTION_URL: z.url(),
  EVOLUTION_API_KEY: z.string().min(32, 'EVOLUTION_API_KEY muito curta'),
  EVOLUTION_INSTANCE: z.string().regex(/^[a-zA-Z0-9_-]{3,50}$/).default('principal'),
  WEBHOOK_TOKEN: z.string().min(32, 'WEBHOOK_TOKEN muito curto'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET muito curto'),
  COOKIE_SECURE: bool.default(false),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(10080).default(720),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(8),

  CATALOG_DB_HOST: z.string().default(''),
  CATALOG_DB_PORT: z.coerce.number().int().default(3306),
  CATALOG_DB_NAME: z.string().default(''),
  CATALOG_DB_USER: z.string().default(''),
  CATALOG_DB_PASSWORD: z.string().default(''),

  WEBHOOK_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_SECURE: bool.default(true),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  /** Nome do remetente. Vazio = usa o nome do sistema definido em Aparência. */
  SMTP_FROM_NAME: z.string().default(''),

  MEDIA_DIR: z.string().default('/data/media'),
  MEDIA_MAX_MB: z.coerce.number().int().min(1).max(2048).default(100),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Mostra apenas o nome da variável e o problema, nunca o valor.
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${problems}`);
  }
  return Object.freeze(parsed.data);
}

export const APP_CONFIG = Symbol('APP_CONFIG');
