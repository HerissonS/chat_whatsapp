import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';
import { attachSocketServer } from './realtime/socket-server.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');
  // A API só responde JSON; a CSP do frontend fica no nginx.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
  // O webhook da Evolution fica fora do prefixo /api e não é exposto pelo nginx do frontend.
  app.setGlobalPrefix('api', { exclude: ['webhook/{*path}'] });
  app.enableShutdownHooks();
  // Limite de JSON: os eventos do webhook da Evolution podem ter alguns MB. Uploads usam multipart.
  app.useBodyParser('json', { limit: '5mb' });

  await attachSocketServer(app);
  await app.listen(config.PORT, '0.0.0.0');
  app.get(Logger).log(`API ouvindo na porta ${config.PORT}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  // Sem logger disponível ainda: escreve só a mensagem, sem variáveis de ambiente.
  console.error(JSON.stringify({ level: 'fatal', service: 'api', msg: 'falha ao iniciar', err: (err as Error).message }));
  process.exit(1);
});
