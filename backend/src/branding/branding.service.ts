import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DB } from '../database/database.module.js';
import type { Database } from '../database/schema.js';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use uma cor no formato #RRGGBB');

export const colorsSchema = z.object({
  primary: hex,
  primaryHover: hex,
  primaryContrast: hex,
  sidebar: hex,
  sidebarText: hex,
  muted: hex,
  border: hex,
  background: hex,
  surface: hex,
  text: hex,
  bubbleIn: hex,
  bubbleOut: hex,
  success: hex,
  warning: hex,
  danger: hex,
});

export const brandingSchema = z.object({
  systemName: z.string().trim().min(2).max(60),
  colors: colorsSchema,
  dark: colorsSchema,
  modal: z.object({
    radius: z.number().int().min(0).max(24),
    overlayOpacity: z.number().min(0.2).max(0.9),
    shadow: z.enum(['none', 'sm', 'md', 'lg']),
  }),
  // Fontes já instaladas nos computadores (sem baixar de servidores externos, respeitando a CSP).
  font: z.enum(['system', 'arial', 'verdana', 'trebuchet', 'georgia']),
  /** Tamanho base do texto em % (100 = 16 px). Cada usuário pode ajustar o seu no menu. */
  fontScale: z.number().int().min(90).max(140).default(112),
});

export type BrandingData = z.infer<typeof brandingSchema>;
export const LOGO_SLOTS = ['light', 'dark', 'favicon', 'pdf'] as const;
export type LogoSlot = (typeof LOGO_SLOTS)[number];

interface StoredLogo {
  file: string;
  mime: string;
  v: string;
}

/** Valores padrão neutros. A identidade de cada instalação (nome, cores, logos) é configurada na tela Aparência. */
export const DEFAULT_BRANDING: BrandingData = {
  systemName: 'Central de Atendimento',
  colors: {
    primary: '#1F4070',
    primaryHover: '#1F3F6E',
    primaryContrast: '#FFFFFF',
    sidebar: '#122440',
    sidebarText: '#E6EBF2',
    muted: '#5B6D88',
    border: '#ACB4BF',
    background: '#F3F5F8',
    surface: '#FFFFFF',
    text: '#16202E',
    bubbleIn: '#FFFFFF',
    bubbleOut: '#DFE8F5',
    success: '#1F7A4D',
    warning: '#A15C00',
    danger: '#B42318',
  },
  dark: {
    primary: '#3F6FB5',
    primaryHover: '#5583C4',
    primaryContrast: '#FFFFFF',
    sidebar: '#0A1424',
    sidebarText: '#E6EBF2',
    muted: '#9AA8BD',
    border: '#2B3B55',
    background: '#0D1626',
    surface: '#16233A',
    text: '#E6EBF2',
    bubbleIn: '#1C2B45',
    bubbleOut: '#23406B',
    success: '#4CC38A',
    warning: '#F0B357',
    danger: '#F97066',
  },
  modal: { radius: 10, overlayOpacity: 0.55, shadow: 'lg' },
  font: 'system',
  fontScale: 112,
};

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'branding');
/** Só o ícone da aba tem um padrão genérico. Sem logo enviado, a interface mostra o nome do sistema em texto. */
export const DEFAULT_LOGOS: Partial<Record<LogoSlot, { path: string; mime: string }>> = {
  favicon: { path: join(ASSETS, 'favicon.svg'), mime: 'image/svg+xml' },
};

/**
 * Aparência por organização: cores (design tokens), estilo dos modais, fonte, nome do sistema e logos.
 * Guardada em app_settings; logos enviados ficam no volume de mídia, pasta "branding".
 */
@Injectable()
export class BrandingService {
  private readonly dir: string;

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.dir = join(config.MEDIA_DIR, 'branding');
  }

  private key(orgId: number) {
    return `branding:${orgId}`;
  }

  private async raw(orgId: number): Promise<{ data: BrandingData; logos: Partial<Record<LogoSlot, StoredLogo>> }> {
    const row = await this.db.selectFrom('app_settings').select('setting_value').where('setting_key', '=', this.key(orgId)).executeTakeFirst();
    if (!row) return { data: DEFAULT_BRANDING, logos: {} };
    try {
      const v = (typeof row.setting_value === 'string' ? JSON.parse(row.setting_value) : row.setting_value) as {
        data?: unknown;
        logos?: Partial<Record<LogoSlot, StoredLogo>>;
      };
      const parsed = brandingSchema.safeParse(v.data);
      return { data: parsed.success ? parsed.data : DEFAULT_BRANDING, logos: v.logos ?? {} };
    } catch {
      return { data: DEFAULT_BRANDING, logos: {} };
    }
  }

  private async save(orgId: number, data: BrandingData, logos: Partial<Record<LogoSlot, StoredLogo>>) {
    const value = JSON.stringify({ data, logos });
    await this.db
      .insertInto('app_settings')
      .values({ setting_key: this.key(orgId), setting_value: value })
      .onDuplicateKeyUpdate({ setting_value: value })
      .execute();
  }

  /** Dados públicos (usados também na tela de login). */
  async publicView(orgId = 1) {
    const { data, logos } = await this.raw(orgId);
    return {
      ...data,
      logos: Object.fromEntries(
        LOGO_SLOTS.map((s) => [
          s,
          { url: logos[s] || DEFAULT_LOGOS[s] ? `api/branding/logo/${s}?v=${logos[s]?.v ?? 'default'}` : null, custom: !!logos[s] },
        ]),
      ) as Record<LogoSlot, { url: string | null; custom: boolean }>,
    };
  }

  async update(orgId: number, data: BrandingData): Promise<void> {
    const { logos } = await this.raw(orgId);
    await this.save(orgId, data, logos);
  }

  async reset(orgId: number): Promise<void> {
    const { logos } = await this.raw(orgId);
    for (const l of Object.values(logos)) if (l) await rm(join(this.dir, l.file), { force: true });
    await this.db.deleteFrom('app_settings').where('setting_key', '=', this.key(orgId)).execute();
  }

  async setLogo(orgId: number, slot: LogoSlot, buffer: Buffer, mime: string, ext: string): Promise<void> {
    const { data, logos } = await this.raw(orgId);
    await mkdir(this.dir, { recursive: true });
    const file = `${slot}-${randomUUID()}.${ext}`;
    await writeFile(join(this.dir, file), buffer, { mode: 0o640 });
    const old = logos[slot];
    logos[slot] = { file, mime, v: randomUUID().slice(0, 8) };
    await this.save(orgId, data, logos);
    if (old) await rm(join(this.dir, old.file), { force: true });
  }

  async removeLogo(orgId: number, slot: LogoSlot): Promise<void> {
    const { data, logos } = await this.raw(orgId);
    const old = logos[slot];
    delete logos[slot];
    await this.save(orgId, data, logos);
    if (old) await rm(join(this.dir, old.file), { force: true });
  }

  async logoFile(orgId: number, slot: LogoSlot): Promise<{ path: string; mime: string } | null> {
    const { logos } = await this.raw(orgId);
    const l = logos[slot];
    return l ? { path: join(this.dir, l.file), mime: l.mime } : (DEFAULT_LOGOS[slot] ?? null);
  }

  async systemName(orgId = 1): Promise<string> {
    return (await this.raw(orgId)).data.systemName;
  }

  async primaryColor(orgId = 1): Promise<string> {
    return (await this.raw(orgId)).data.colors.primary;
  }
}
