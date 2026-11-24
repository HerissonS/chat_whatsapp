import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PinoLogger } from 'nestjs-pino';
import type { AuthUser } from '../common/auth-user.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';

export interface AuditEntry {
  action: string;
  user?: Pick<AuthUser, 'id' | 'username' | 'organizationId'> | null;
  username?: string | null;
  targetType?: string;
  targetId?: string | number;
  ip?: string;
  details?: Record<string, unknown>;
}

/**
 * Trilha de auditoria. Grava no banco (consultável pela interface) e também no log estruturado.
 * Nunca inclua senhas, tokens ou conteúdo de mensagens em `details`.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Audit');
  }

  async log(entry: AuditEntry): Promise<void> {
    const username = entry.user?.username ?? entry.username ?? null;
    try {
      await this.db
        .insertInto('audit_logs')
        .values({
          organization_id: entry.user?.organizationId ?? 1,
          user_id: entry.user?.id ?? null,
          username,
          action: entry.action,
          target_type: entry.targetType ?? null,
          target_id: entry.targetId != null ? String(entry.targetId) : null,
          ip: entry.ip ?? null,
          details: entry.details ? JSON.stringify(entry.details) : null,
        })
        .execute();
    } catch (err) {
      this.logger.error({ err: (err as Error).message, action: entry.action }, 'falha ao gravar auditoria');
    }
    this.logger.info(
      { audit: entry.action, user: username, target: entry.targetType, target_id: entry.targetId, ip: entry.ip },
      'auditoria',
    );
  }
}
