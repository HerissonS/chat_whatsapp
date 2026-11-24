import { createInterface } from 'node:readline/promises';
import argon2 from 'argon2';
import { loadConfig } from '../config/env.js';
import { createDb } from '../database/create-db.js';

/**
 * Cria (ou redefine) um usuário Administrador.
 *
 * Interativo (recomendado):   scripts/create-admin.sh
 * Automatizado:               ... --username joao.silva --name "João Silva" --password-stdin  (senha pela entrada padrão)
 *
 * A senha nunca é aceita como argumento de linha de comando, nunca é exibida e não fica no histórico.
 */
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const interactive = process.stdin.isTTY === true && !args.includes('--password-stdin');

const C = process.stdout.isTTY ? { b: '\x1b[1m', g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', x: '\x1b[0m' } : { b: '', g: '', r: '', d: '', x: '' };
const out = (s = '') => process.stdout.write(`${s}\n`);
const warn = (s: string) => out(`${C.r}  ✗ ${s}${C.x}`);

/** Pergunta com texto visível. */
async function ask(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  try {
    const answer = (await rl.question(`${question}${fallback ? ` ${C.d}[${fallback}]${C.x}` : ''}: `)).trim();
    return answer || fallback || '';
  } finally {
    rl.close();
  }
}

/** Pergunta de senha: mostra * a cada caractere, aceita Backspace, Enter confirma e Ctrl+C cancela. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(`${question}: `);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\nCancelado.\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch >= ' ') {
          value += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

/** Lê uma linha da entrada padrão (modo automatizado). */
async function readStdinLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    rl.close();
    return line;
  }
  return '';
}

function usernameProblem(u: string): string | null {
  return /^[a-z0-9._-]{3,60}$/.test(u) ? null : 'Use de 3 a 60 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado (ex.: joao.silva).';
}

function passwordProblem(p: string, username: string, min: number): string | null {
  const problems: string[] = [];
  if (p.length < min) problems.push(`ter pelo menos ${min} caracteres`);
  if (!/[a-zA-Z]/.test(p)) problems.push('conter letras');
  if (!/[0-9]/.test(p)) problems.push('conter números');
  if (p.toLowerCase().includes(username)) problems.push('não conter o usuário');
  return problems.length ? `A senha deve ${problems.join(', ')}.` : null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const min = config.PASSWORD_MIN_LENGTH;
  const db = createDb(config);

  try {
    let username = arg('--username')?.toLowerCase() ?? '';
    let name = arg('--name') ?? '';
    let password = '';

    if (interactive) {
      out();
      out(`${C.b}Criar ou redefinir administrador${C.x}`);
      out(`${C.d}Responda às perguntas e tecle Enter. Ctrl+C cancela.${C.x}`);
      out();
      for (;;) {
        username = (await ask('Usuário (login)', username || undefined)).toLowerCase();
        const p = usernameProblem(username);
        if (!p) break;
        warn(p);
        username = '';
      }
      const existing = await db.selectFrom('users').select(['name']).where('username', '=', username).executeTakeFirst();
      if (existing) out(`${C.d}  Usuário já existe: a senha será redefinida e ele ficará como Administrador ativo.${C.x}`);
      for (;;) {
        name = await ask('Nome completo', name || existing?.name);
        if (name.trim().length >= 2) break;
        warn('Informe o nome (aparece para os técnicos nas mensagens).');
      }
      out(`${C.d}  Senha: mínimo de ${min} caracteres, com letras e números, sem conter o usuário.${C.x}`);
      for (;;) {
        password = await askHidden('Senha');
        const p = passwordProblem(password, username, min);
        if (p) {
          warn(p);
          continue;
        }
        if ((await askHidden('Repita a senha')) === password) break;
        warn('As senhas não conferem. Tente de novo.');
      }
    } else {
      if (!args.includes('--password-stdin')) {
        throw new Error('Sem terminal interativo. Rode scripts/create-admin.sh em um terminal, ou use --username, --name e --password-stdin.');
      }
      password = await readStdinLine();
      const problem = usernameProblem(username) ?? (name.trim().length < 2 ? 'Informe --name.' : null) ?? passwordProblem(password, username, min);
      if (problem) throw new Error(problem);
    }

    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    password = '';
    const existing = await db.selectFrom('users').select('id').where('username', '=', username).executeTakeFirst();
    if (existing) {
      await db
        .updateTable('users')
        .set({ name: name.trim(), password_hash: hash, role: 'admin', active: 1, failed_logins: 0, locked_until: null, must_change_password: 0, password_changed_at: new Date() })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await db
        .insertInto('users')
        .values({ organization_id: 1, username, name: name.trim(), password_hash: hash, role: 'admin', active: 1, must_change_password: 0, password_changed_at: new Date() })
        .execute();
    }
    await db
      .insertInto('audit_logs')
      .values({ organization_id: 1, username, action: existing ? 'cli.admin.updated' : 'cli.admin.created', target_type: 'user' })
      .execute();

    out();
    out(`${C.g}${C.b}✓ Administrador "${username}" ${existing ? 'atualizado' : 'criado'}.${C.x}`);
    if (process.env.PUBLIC_URL) out(`  Acesse ${process.env.PUBLIC_URL} e entre com esse usuário e senha.`);
    else out('  Acesse o sistema pelo navegador e entre com esse usuário e senha.');
    out();
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  out();
  warn(`Erro: ${(err as Error).message}`);
  process.exit(1);
});
