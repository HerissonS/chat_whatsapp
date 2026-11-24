import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';

/** Tipos que o navegador pode exibir dentro da página. Todo o resto é servido como download. */
export const INLINE_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/3gpp', 'video/quicktime',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/amr',
]);

/** Remove caminhos e caracteres problemáticos do nome de arquivo informado pelo usuário ou pelo WhatsApp. */
export function sanitizeFileName(name: string | null | undefined, fallback = 'arquivo'): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return clean || fallback;
}

/**
 * Armazenamento dos arquivos das conversas no volume `media`.
 * Os arquivos são gravados com nome aleatório (sem extensão) e o tipo fica no banco,
 * então nenhum arquivo enviado é executado ou servido pelo nome original.
 */
@Injectable()
export class MediaStorageService {
  readonly root: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DB) private readonly db: Kysely<Database>,
  ) {
    this.root = normalize(config.MEDIA_DIR);
  }

  get tmpDir(): string {
    return join(this.root, 'tmp');
  }

  /** Caminho absoluto a partir do caminho relativo salvo no banco, sem permitir sair da pasta raiz. */
  resolve(relative: string): string {
    const full = normalize(join(this.root, relative));
    if (!full.startsWith(this.root + sep)) throw new Error('caminho de mídia inválido');
    return full;
  }

  private newRelativePath(): string {
    const d = new Date();
    return join(String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'), randomUUID());
  }

  async saveBuffer(p: { departmentId: number | null; buffer: Buffer; mime: string; originalName: string | null }): Promise<number> {
    const rel = this.newRelativePath();
    const full = this.resolve(rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, p.buffer, { mode: 0o640 });
    const sha256 = createHash('sha256').update(p.buffer).digest('hex');
    return this.insert(p.departmentId, rel, p.mime, p.buffer.length, sha256, p.originalName);
  }

  /** Move um arquivo temporário (upload) para o armazenamento definitivo. */
  async saveTempFile(p: { departmentId: number; tempPath: string; mime: string; originalName: string | null }): Promise<number> {
    const rel = this.newRelativePath();
    const full = this.resolve(rel);
    await mkdir(join(full, '..'), { recursive: true });
    const sha256 = await this.hashFile(p.tempPath);
    await rename(p.tempPath, full);
    const { size } = await stat(full);
    return this.insert(p.departmentId, rel, p.mime, size, sha256, p.originalName);
  }

  async read(mediaId: number): Promise<{ buffer: Buffer; mime: string; name: string | null }> {
    const row = await this.db.selectFrom('media_files').selectAll().where('id', '=', mediaId).executeTakeFirstOrThrow();
    return { buffer: await readFile(this.resolve(row.storage_path)), mime: row.mime, name: row.original_name };
  }

  async removeTemp(path: string | undefined): Promise<void> {
    if (path) await rm(path, { force: true });
  }

  private hashFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const h = createHash('sha256');
      createReadStream(path)
        .on('data', (c) => h.update(c))
        .on('end', () => resolve(h.digest('hex')))
        .on('error', reject);
    });
  }

  private async insert(
    departmentId: number | null,
    rel: string,
    mime: string,
    size: number,
    sha256: string,
    originalName: string | null,
  ): Promise<number> {
    const r = await this.db
      .insertInto('media_files')
      .values({ department_id: departmentId, storage_path: rel, mime, size, sha256, original_name: originalName })
      .executeTakeFirstOrThrow();
    return Number(r.insertId);
  }
}
