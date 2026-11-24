import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

/** Parâmetros argon2id (OWASP): 19 MiB de memória, 2 iterações, paralelismo 1. */
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Hash fixo usado quando o usuário não existe, para o tempo de resposta não revelar isso. */
  private dummyHash: Promise<string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.dummyHash = argon2.hash('senha-inexistente-para-tempo-constante', ARGON_OPTS);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON_OPTS);
  }

  async verify(hash: string | null, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? (await this.dummyHash), password);
    } catch {
      return false;
    }
  }

  /** Política mínima: tamanho configurável, letras e números, sem conter o login. */
  assertStrong(password: string, username?: string): void {
    const min = this.config.PASSWORD_MIN_LENGTH;
    const problems: string[] = [];
    if (password.length < min) problems.push(`ter pelo menos ${min} caracteres`);
    if (password.length > 128) problems.push('ter no máximo 128 caracteres');
    if (!/[a-zA-Z]/.test(password)) problems.push('conter letras');
    if (!/[0-9]/.test(password)) problems.push('conter números');
    if (username && password.toLowerCase().includes(username.toLowerCase())) problems.push('não conter o usuário');
    if (problems.length) throw new BadRequestException(`A senha deve ${problems.join(', ')}.`);
  }
}
