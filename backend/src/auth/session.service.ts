import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { REDIS } from '../redis/redis.module.js';

export const SESSION_COOKIE = 'atl_sid';

export interface SessionData {
  userId: number;
  csrf: string;
  createdAt: number;
  lastSeen: number;
  ip: string;
}

/**
 * Sessões de login guardadas no Redis.
 * - O navegador recebe um id aleatório de 256 bits (cookie HttpOnly).
 * - No Redis, a chave é o HMAC do id: um vazamento do Redis não permite sequestrar sessões.
 * - Expiração por inatividade e duração máxima; revogação imediata por usuário.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  hashId(sid: string): string {
    return createHmac('sha256', this.config.SESSION_SECRET).update(sid).digest('hex');
  }

  private key(hash: string) {
    return `sess:${hash}`;
  }

  private userKey(userId: number) {
    return `usess:${userId}`;
  }

  get idleSeconds(): number {
    return this.config.SESSION_IDLE_MINUTES * 60;
  }

  async create(userId: number, ip: string): Promise<{ sid: string; hash: string; csrf: string }> {
    const sid = randomBytes(32).toString('base64url');
    const hash = this.hashId(sid);
    const csrf = randomBytes(24).toString('base64url');
    const now = Date.now();
    const data: SessionData = { userId, csrf, createdAt: now, lastSeen: now, ip };
    await this.redis
      .multi()
      .set(this.key(hash), JSON.stringify(data), 'EX', this.idleSeconds)
      .sadd(this.userKey(userId), hash)
      .expire(this.userKey(userId), this.config.SESSION_MAX_HOURS * 3600)
      .exec();
    return { sid, hash, csrf };
  }

  /** Busca e renova a sessão. Retorna null se não existe, expirou por inatividade ou passou da duração máxima. */
  async touch(sid: string): Promise<{ hash: string; data: SessionData } | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(sid)) return null;
    const hash = this.hashId(sid);
    return this.touchByHash(hash);
  }

  async touchByHash(hash: string): Promise<{ hash: string; data: SessionData } | null> {
    const raw = await this.redis.get(this.key(hash));
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    const now = Date.now();
    if (now - data.createdAt > this.config.SESSION_MAX_HOURS * 3600_000) {
      await this.destroy(hash, data.userId);
      return null;
    }
    // Evita escrever no Redis a cada requisição: renova no máximo a cada 60 s.
    if (now - data.lastSeen > 60_000) {
      data.lastSeen = now;
      await this.redis.set(this.key(hash), JSON.stringify(data), 'EX', this.idleSeconds);
    }
    return { hash, data };
  }

  /** Verifica se a sessão ainda existe, sem renovar a inatividade (usado pelo WebSocket). */
  async isAlive(hash: string): Promise<boolean> {
    return (await this.redis.exists(this.key(hash))) === 1;
  }

  async destroy(hash: string, userId?: number): Promise<void> {
    await this.redis.del(this.key(hash));
    if (userId) await this.redis.srem(this.userKey(userId), hash);
  }

  /** Sessões abertas do usuário (hashes), para avisar os navegadores dele. */
  async hashesForUser(userId: number): Promise<string[]> {
    return this.redis.smembers(this.userKey(userId));
  }

  /** Revoga todas as sessões do usuário (exceto, opcionalmente, a atual). Retorna os hashes revogados. */
  async destroyAllForUser(userId: number, exceptHash?: string): Promise<string[]> {
    const hashes = await this.redis.smembers(this.userKey(userId));
    const revoke = hashes.filter((h) => h !== exceptHash);
    if (revoke.length) {
      await this.redis.del(...revoke.map((h) => this.key(h)));
      await this.redis.srem(this.userKey(userId), ...revoke);
    }
    return revoke;
  }
}
