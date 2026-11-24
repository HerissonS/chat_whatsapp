import type { Server as HttpServer } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { PinoLogger } from 'nestjs-pino';
import { Server } from 'socket.io';
import { readCookie } from '../auth/auth.guard.js';
import { SESSION_COOKIE, SessionService } from '../auth/session.service.js';
import { UserLoaderService } from '../auth/user-loader.service.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { createRedis } from '../redis/redis.module.js';
import { rooms } from './realtime.service.js';

/** Intervalo de verificação da sessão de cada conexão (expiração por inatividade, desativação do usuário). */
const RECHECK_MS = 5 * 60_000;

/**
 * Servidor Socket.IO acoplado ao HTTP da API.
 * - Autentica pelo mesmo cookie de sessão da API.
 * - Recusa conexões de outra origem (proteção contra Cross-Site WebSocket Hijacking).
 * - Cada conexão entra nas salas dos setores do usuário, do próprio usuário e da sessão.
 */
export async function attachSocketServer(app: INestApplication): Promise<Server> {
  const config = app.get<AppConfig>(APP_CONFIG);
  const sessions = app.get(SessionService);
  const users = app.get(UserLoaderService);
  const logger = await app.resolve(PinoLogger);
  logger.setContext('Realtime');

  const io = new Server(app.getHttpServer() as HttpServer, {
    path: '/socket.io',
    serveClient: false,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      const host = req.headers['x-forwarded-host'] ?? req.headers.host;
      if (origin) {
        try {
          if (new URL(origin).host !== host) return cb('origem não permitida', false);
        } catch {
          return cb('origem inválida', false);
        }
      }
      cb(null, true);
    },
  });

  const pub = createRedis(config, 'chat-whatsapp-io-pub');
  const sub = createRedis(config, 'chat-whatsapp-io-sub');
  io.adapter(createAdapter(pub, sub));

  io.use(async (socket, next) => {
    try {
      const sid = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      const session = sid ? await sessions.touch(sid) : null;
      if (!session) return next(new Error('não autenticado'));
      const user = await users.load(session.data.userId);
      if (!user || user.mustChangePassword) return next(new Error('não autorizado'));
      socket.data.userId = user.id;
      socket.data.sessionHash = session.hash;
      await socket.join([
        rooms.user(user.id),
        rooms.session(session.hash),
        ...user.departmentIds.map(rooms.department),
        ...(user.permissions.includes('admin.whatsapp') ? [rooms.admins] : []),
      ]);
      next();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'falha na autenticação do WebSocket');
      next(new Error('erro interno'));
    }
  });

  io.on('connection', (socket) => {
    const timer = setInterval(async () => {
      const alive = await sessions.isAlive(socket.data.sessionHash as string);
      const user = alive ? await users.load(socket.data.userId as number) : null;
      if (!user) socket.disconnect(true);
    }, RECHECK_MS);
    socket.on('disconnect', () => clearInterval(timer));
  });

  app.enableShutdownHooks();
  const close = async () => {
    io.close();
    await Promise.allSettled([pub.quit(), sub.quit()]);
  };
  process.once('SIGTERM', () => void close());
  return io;
}
