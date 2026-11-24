import { loadConfig } from '../config/env.js';
import { createDb } from '../database/create-db.js';

/**
 * Dados de DEMONSTRAÇÃO do catálogo local (contratos e equipamentos fictícios) para testes.
 * Não usar em produção. Uso: node dist/cli/seed-demo.js
 */
const DEMO: Record<string, string[]> = {
  AMC: ['AT249', 'AT250', 'AT251'],
  'DEMO-SUL': ['DS001', 'DS002'],
  'DEMO-NORTE': ['DN010', 'DN011', 'DN012'],
};

async function main(): Promise<void> {
  const db = createDb(loadConfig());
  try {
    for (const [contract, codes] of Object.entries(DEMO)) {
      await db.insertInto('catalog_contracts').ignore().values({ organization_id: 1, name: contract }).execute();
      for (const code of codes) {
        await db
          .insertInto('catalog_equipments')
          .ignore()
          .values({ organization_id: 1, contract_name: contract, code, equip_type: 'ATSMSX' })
          .execute();
      }
    }
    console.log('Catálogo de demonstração carregado.');
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(`Erro: ${(err as Error).message}`);
  process.exit(1);
});
