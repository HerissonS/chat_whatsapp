import { sql } from 'kysely';

/**
 * "Aguardando resposta": chamado aberto (já classificado) de um contato (não grupo)
 * em que a última mensagem que não é do bot foi do contato.
 * Usa o índice ix_messages_ticket. Espera o alias `t` para tickets e `ct` para contacts.
 */
export const awaitingReplySql = sql<boolean>`(t.status = 'open' AND ct.is_group = 0 AND (
  SELECT m.origin FROM messages m
  WHERE m.ticket_id = t.id AND m.origin <> 'bot'
  ORDER BY m.wa_timestamp DESC, m.id DESC LIMIT 1
) = 'contact')`;
