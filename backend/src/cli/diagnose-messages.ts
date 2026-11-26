import { loadConfig } from '../config/env.js';
import { createDb } from '../database/create-db.js';
import { parseWaMessage, SECRET_EDIT_BODY, UNREADABLE_BODY } from '../whatsapp/message-parser.js';

/**
 * Diagnóstico das mensagens gravadas como "não suportadas" ou ilegíveis.
 * Mostra só data, origem, tipo informado pela Evolution e nomes dos campos: nunca o conteúdo.
 * Usa os eventos brutos guardados em webhook_events (WEBHOOK_RETENTION_DAYS, padrão 30 dias).
 *
 * Uso: node dist/cli/diagnose-messages.js [--days 30] [--fix]
 *   --fix  regrava as mensagens que a versão atual já consegue interpretar (texto de botões, listas etc.).
 *          Mídias não são baixadas de novo; o restante fica como está.
 */
async function main(): Promise<void> {
  const i = process.argv.indexOf('--days');
  const days = i >= 0 ? Math.min(Math.max(Number(process.argv[i + 1]) || 30, 1), 365) : 30;
  const fix = process.argv.includes('--fix');
  const db = createDb(loadConfig());
  try {
    const rows = await db
      .selectFrom('messages')
      .select(['id', 'department_id', 'wa_id', 'origin', 'body', 'wa_timestamp'])
      .where('type', '=', 'unknown')
      .where('body', 'is not', null)
      .where('wa_timestamp', '>=', new Date(Date.now() - days * 86_400_000))
      .orderBy('wa_timestamp')
      .execute();
    if (!rows.length) {
      console.log(`Nenhuma mensagem não suportada nos últimos ${days} dia(s).`);
      return;
    }
    const summary = new Map<string, number>();
    let fixed = 0;
    let noEvent = 0;
    console.log(`Mensagens não suportadas nos últimos ${days} dia(s): ${rows.length}\n`);
    console.log('id\tdata\torigem\ttipo Evolution\tcampos\tversão atual');
    for (const r of rows) {
      // O id também aparece em reações e citações: fica só o evento cuja chave é a própria mensagem.
      const candidates = await db
        .selectFrom('webhook_events')
        .select('payload')
        .where('event', 'in', ['messages.upsert', 'send.message'])
        .where('payload', 'like', `%${r.wa_id.replace(/[%_\\"]/g, '')}%`)
        .orderBy('id', 'desc')
        .limit(10)
        .execute();
      const ev = candidates
        .map((c) => JSON.parse(c.payload) as Record<string, any>)
        .map((p) => (p.data ?? p) as Record<string, any>)
        .find((d) => d?.key?.id === r.wa_id);
      if (!ev) {
        noEvent++;
        console.log(`${r.id}\t${r.wa_timestamp.toISOString()}\t${r.origin}\t(evento bruto já removido)`);
        continue;
      }
      const m = parseWaMessage(ev);
      const now = !m
        ? 'ignorada (controle)'
        : m.secretEdit
          ? `edição de mensagem anterior (${m.secretEdit.encType})`
          : m.type !== 'unknown' ? `legível: ${m.type}` : m.body === UNREADABLE_BODY ? 'sem conteúdo (não decifrada)' : 'ainda não suportada';
      const k = `${m?.rawType ?? '?'} [${m?.rawKeys.join(', ') ?? ''}] → ${now}`;
      summary.set(k, (summary.get(k) ?? 0) + 1);
      console.log(`${r.id}\t${r.wa_timestamp.toISOString()}\t${r.origin}\t${m?.rawType ?? '?'}\t${m?.rawKeys.join(',') ?? ''}\t${now}`);
      // Texto agora legível, ou aviso mais claro para as que continuam sem conteúdo. Mídias ficam de fora (exigiriam novo download).
      if (fix && m?.secretEdit) {
        // Não era mensagem nova: vira aviso e a original é marcada como editada.
        if (r.body !== SECRET_EDIT_BODY) {
          await db.updateTable('messages').set({ body: SECRET_EDIT_BODY }).where('id', '=', r.id).where('type', '=', 'unknown').execute();
          fixed++;
        }
        if (m.secretEdit.targetId) {
          await db.updateTable('messages').set({ edited: 1 }).where('wa_id', '=', m.secretEdit.targetId).where('department_id', '=', r.department_id).execute();
        }
        continue;
      }
      if (fix && m && !m.media && !m.reaction && (m.type !== 'unknown' || m.body !== r.body)) {
        await db.updateTable('messages').set({ type: m.type, body: m.body }).where('id', '=', r.id).where('type', '=', 'unknown').execute();
        fixed++;
      }
    }
    console.log('\nResumo (tipo [campos] → situação na versão atual):');
    for (const [k, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${k}`);
    if (noEvent) console.log(`  ${noEvent}× evento bruto já removido (mais antigo que WEBHOOK_RETENTION_DAYS)`);
    if (fix) console.log(`\n${fixed} mensagem(ns) regravada(s). Recarregue a página para ver.`);
    else console.log('\nPara regravar as que a versão atual já interpreta, rode de novo com --fix.');
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(`Erro: ${(err as Error).message}`);
  process.exit(1);
});
