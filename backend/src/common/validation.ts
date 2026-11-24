import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Valida a entrada com um schema zod. Em caso de erro, responde 400 com a lista de campos inválidos
 * (sem ecoar os valores recebidos).
 */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new BadRequestException({
      message: 'Dados inválidos',
      fields: r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

export const idParam = z.coerce.number().int().positive();

/** Texto livre: remove caracteres de controle (exceto quebra de linha e tab) e espaços nas pontas. */
export const cleanText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim());

export const toBool = (v: number | boolean | null | undefined): boolean => v === 1 || v === true;
