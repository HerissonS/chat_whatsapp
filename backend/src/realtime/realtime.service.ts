import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { createRedis } from '../redis/redis.module.js';

/** Salas do Socket.IO. */
export const rooms = {
  department: (id: number) => `dept:${id}`,
  user: (id: number) => `user:${id}`,
  session: (hash: string) => `sess:${hash}`,
  admins: 'admins',
};

/**
 * Publica eventos em tempo real para os navegadores.
 * Usa o Redis (emitter), então funciona igual na API e no worker: o servidor Socket.IO da API
 * recebe pelo adapter Redis e entrega aos clientes conectados.
 */
@Injectable()
export class RealtimeService implements OnApplicationShutdown {
  private readonly redis: Redis;
  private readonly emitter: Emitter;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.redis = createRedis(config, 'chat-whatsapp-emitter');
    this.emitter = new Emitter(this.redis);
  }

  toDepartment(departmentId: number, event: string, payload: unknown): void {
    this.emitter.to(rooms.department(departmentId)).emit(event, payload);
  }

  toAdmins(event: string, payload: unknown): void {
    this.emitter.to(rooms.admins).emit(event, payload);
  }

  toUser(userId: number, event: string, payload: unknown): void {
    this.emitter.to(rooms.user(userId)).emit(event, payload);
  }

  /** Pede aos navegadores dessas sessões para recarregar permissões e caixas de entrada (reconecta o WebSocket). */
  refreshSessions(hashes: string[]): void {
    for (const h of hashes) this.emitter.to(rooms.session(h)).emit('session:refresh', {});
  }

  /** Derruba as conexões WebSocket das sessões revogadas. */
  disconnectSessions(hashes: string[]): void {
    for (const h of hashes) this.emitter.in(rooms.session(h)).disconnectSockets(true);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}

@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
