import type { Migration } from 'kysely/migration';
import * as m0001 from './0001_init.js';
import * as m0002 from './0002_core.js';
import * as m0003 from './0003_contact_avatars.js';
import * as m0004 from './0004_group_permissions.js';

/**
 * Lista ordenada de migrations. Para criar uma nova:
 * 1. crie `NNNN_descricao.ts` com `up` (e `down` quando possível);
 * 2. registre aqui com a mesma chave do nome do arquivo.
 * Nunca altere uma migration que já foi aplicada em algum ambiente.
 */
export const migrations: Record<string, Migration> = {
  '0001_init': m0001,
  '0002_core': m0002,
  '0003_contact_avatars': m0003,
  '0004_group_permissions': m0004,
};
