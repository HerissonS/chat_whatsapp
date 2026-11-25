// Testes das regras críticas do sistema (rodam sobre o código compilado em dist/).
// Uso: npm run build && npm test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isStatusUpgrade, mapStatus, parseProtocol, parseWaMessage, phoneFromJid, previewOf } from '../dist/whatsapp/message-parser.js';
import { parseMenuChoice } from '../dist/tickets/tickets.service.js';
import { formatDuration, pdfSafe, TicketReportService } from '../dist/closure/ticket-report.service.js';
import { sanitizeFileName } from '../dist/media/media-storage.service.js';
import { displayName, formatPhone } from '../dist/chat/chat.repository.js';
import { effectivePermissions } from '../dist/common/permissions.js';

const key = (over = {}) => ({ id: 'ABC', remoteJid: '5594999990001@s.whatsapp.net', fromMe: false, ...over });

describe('menu', () => {
  it('aceita as formas comuns de resposta', () => {
    for (const t of ['1', ' 2 ', '3 - Outras dúvidas', '2.', '1)', '2 quero suporte']) assert.notEqual(parseMenuChoice(t), null, t);
    assert.equal(parseMenuChoice('3 - Outras dúvidas'), 3);
  });
  it('recusa respostas que não são número de opção', () => {
    for (const t of ['oi', 'opção 2', '', null, '123', 'AT249']) assert.equal(parseMenuChoice(t), null, String(t));
  });
});

describe('interpretação das mensagens da Evolution', () => {
  it('texto simples', () => {
    const m = parseWaMessage({ key: key(), pushName: 'Vitor', message: { conversation: 'Olá' }, messageType: 'conversation', messageTimestamp: 1795100000 });
    assert.equal(m.type, 'text');
    assert.equal(m.body, 'Olá');
    assert.equal(m.pushName, 'Vitor');
    assert.equal(m.timestamp.getTime(), 1795100000 * 1000);
  });

  it('resposta citada e mensagem encaminhada', () => {
    const m = parseWaMessage({
      key: key(),
      message: { conversation: 'sim' },
      contextInfo: { stanzaId: 'Q1', participant: '5594@s.whatsapp.net', quotedMessage: { conversation: 'Funcionou?' }, isForwarded: true },
      messageType: 'conversation',
    });
    assert.deepEqual(m.quoted, { waId: 'Q1', preview: 'Funcionou?', sender: '5594@s.whatsapp.net' });
    assert.equal(m.forwarded, true);
  });

  it('documento com nome e tamanho', () => {
    const m = parseWaMessage({ key: key(), message: { documentMessage: { fileName: 'relatorio.pdf', mimetype: 'application/pdf', fileLength: '2048', caption: 'segue' } }, messageType: 'documentMessage' });
    assert.equal(m.type, 'document');
    assert.equal(m.body, 'segue');
    assert.deepEqual(m.media, { kind: 'document', mime: 'application/pdf', name: 'relatorio.pdf', size: 2048 });
  });

  it('áudio gravado e imagem', () => {
    assert.equal(parseWaMessage({ key: key(), message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } }, messageType: 'audioMessage' }).media.mime, 'audio/ogg');
    assert.equal(parseWaMessage({ key: key(), message: { imageMessage: { mimetype: 'image/jpeg' } }, messageType: 'imageMessage' }).type, 'image');
  });

  it('reação aponta para a mensagem original', () => {
    const m = parseWaMessage({ key: key(), message: { reactionMessage: { key: { id: 'ORIG' }, text: '👍' } }, messageType: 'reactionMessage' });
    assert.deepEqual(m.reaction, { targetId: 'ORIG', emoji: '👍' });
  });

  it('identificador @lid usa o número alternativo', () => {
    const m = parseWaMessage({ key: key({ remoteJid: '123@lid', remoteJidAlt: '5594999990001@s.whatsapp.net' }), message: { conversation: 'x' } });
    assert.equal(m.chatJid, '5594999990001@s.whatsapp.net');
  });

  it('grupo guarda o participante', () => {
    const m = parseWaMessage({ key: key({ remoteJid: '1203@g.us', participant: '5594988880002@s.whatsapp.net' }), pushName: 'Técnico', message: { conversation: 'oi' } });
    assert.equal(m.participantJid, '5594988880002@s.whatsapp.net');
  });

  it('ignora status, canais e mensagens de controle', () => {
    assert.equal(parseWaMessage({ key: key({ remoteJid: 'status@broadcast' }), message: { conversation: 'x' } }), null);
    assert.equal(parseWaMessage({ key: key({ remoteJid: '1@newsletter' }), message: { conversation: 'x' } }), null);
    assert.equal(parseWaMessage({ key: key(), message: { protocolMessage: { type: 3 } }, messageType: 'protocolMessage' }), null);
    assert.equal(parseWaMessage({ message: { conversation: 'sem chave' } }), null);
  });

  it('mensagem apagada e editada', () => {
    assert.deepEqual(parseProtocol({ key: { id: 'M1' }, type: 0 }), { kind: 'revoke', targetId: 'M1', text: null });
    assert.deepEqual(parseProtocol({ key: { id: 'M1' }, type: 'MESSAGE_EDIT', editedMessage: { conversation: 'novo' } }), { kind: 'edit', targetId: 'M1', text: 'novo' });
  });

  it('status só avança (enviada → entregue → lida)', () => {
    assert.equal(mapStatus('DELIVERY_ACK'), 'delivered');
    assert.equal(mapStatus('PLAYED'), 'read');
    assert.equal(isStatusUpgrade('sent', 'read'), true);
    assert.equal(isStatusUpgrade('read', 'delivered'), false);
  });

  it('prévia de conteúdo e telefone do JID', () => {
    assert.equal(previewOf({ imageMessage: { caption: 'foto' } }), '[Imagem] foto');
    assert.equal(phoneFromJid('5594999990001@s.whatsapp.net'), '5594999990001');
    assert.equal(phoneFromJid('1203@g.us'), null);
  });
});

describe('encerramento', () => {
  const report = new TicketReportService({}, {}, {}, { APP_TIMEZONE: 'America/Sao_Paulo' });
  const date = new Date('2026-11-19T15:00:00-03:00');

  it('assunto com equipamento', () => {
    assert.equal(
      report.buildSubject({ date, contract: 'AMC', equipment: 'AT249', classification: 'Solicitação de Suporte' }),
      '[20261119][AMC][AT249] Solicitação de Suporte',
    );
  });
  it('assunto sem equipamento', () => {
    assert.equal(report.buildSubject({ date, contract: 'CHAMADO INTERNO', equipment: null, classification: 'Outras dúvidas' }), '[20261119][CHAMADO INTERNO] Outras dúvidas');
  });
  it('data do assunto no fuso configurado (23h30 em Brasília ainda é o mesmo dia)', () => {
    assert.equal(report.ymd(new Date('2026-11-20T02:30:00Z')), '20261119');
  });
  it('duração legível', () => {
    assert.equal(formatDuration(12 * 60_000), '12 minutos');
    assert.equal(formatDuration(65 * 60_000), '1 hora e 5 minutos');
    assert.equal(formatDuration(20_000), 'menos de 1 minuto');
  });
  it('texto do PDF sem emojis', () => {
    assert.equal(pdfSafe('Ok 👍🏽 feito ✅'), 'Ok  feito ');
  });
});

describe('segurança e apresentação', () => {
  it('nome de arquivo sem caminho nem caracteres perigosos', () => {
    assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeFileName('C:\\temp\\rel<1>.pdf'), 'rel1.pdf');
    assert.equal(sanitizeFileName('.env'), 'env');
    assert.equal(sanitizeFileName(''), 'arquivo');
  });
  it('telefone e nome do contato', () => {
    assert.equal(formatPhone('5594999990001'), '+55 (94) 99999-0001');
    assert.equal(formatPhone('14155550100'), '+14155550100');
    assert.equal(displayName({ custom_name: null, push_name: null, phone: null, jid: '1203@g.us' }), 'Grupo sem nome');
    assert.equal(displayName({ custom_name: 'Vitor', push_name: 'V', phone: '55', jid: 'x' }), 'Vitor');
  });
  it('permissões: administrador tem tudo; usuário só o que os grupos dão', () => {
    assert.ok(effectivePermissions('admin', []).includes('admin.whatsapp'));
    const u = effectivePermissions('operator', ['chat.read', 'ticket.close', 'chat.read', 'inexistente']);
    assert.deepEqual(u.sort(), ['chat.read', 'ticket.close']);
    assert.equal(effectivePermissions('operator', []).length, 0);
  });
});

describe('horário de funcionamento (indicadores)', async () => {
  const { businessMs, parseBusinessHours, slaTone, businessHoursSchema } = await import('../dist/dashboard/business-hours.js');
  const tz = 'America/Sao_Paulo'; // UTC-3, sem horário de verão
  const at = (s) => new Date(`${s}-03:00`).getTime();
  const weekday = { open: '08:00', close: '18:00', lunchStart: '12:00', lunchEnd: '13:00' };
  const hours = { days: [null, weekday, weekday, weekday, weekday, weekday, null] };
  const min = (ms) => ms / 60_000;

  it('sem horário definido conta o tempo corrido', () => {
    assert.equal(min(businessMs(at('2026-11-23T22:00:00'), at('2026-11-24T08:10:00'), null, tz)), 610);
  });
  it('dentro do expediente conta normalmente', () => {
    assert.equal(min(businessMs(at('2026-11-24T09:00:00'), at('2026-11-24T09:12:00'), hours, tz)), 12);
  });
  it('desconta o almoço', () => {
    assert.equal(min(businessMs(at('2026-11-24T11:50:00'), at('2026-11-24T13:05:00'), hours, tz)), 15);
  });
  it('mensagem da noite respondida na manhã seguinte conta só a partir da abertura', () => {
    assert.equal(min(businessMs(at('2026-11-23T22:00:00'), at('2026-11-24T08:10:00'), hours, tz)), 10);
  });
  it('fim de semana não conta (sexta 17:50 até segunda 08:05)', () => {
    assert.equal(min(businessMs(at('2026-11-27T17:50:00'), at('2026-11-30T08:05:00'), hours, tz)), 15);
  });
  it('totalmente fora do expediente é zero', () => {
    assert.equal(businessMs(at('2026-11-28T10:00:00'), at('2026-11-28T15:00:00'), hours, tz), 0);
  });
  it('semáforo: verde abaixo de 2/3 da meta, amarelo até a meta, vermelho acima', () => {
    assert.equal(slaTone(9 * 60_000, 15), 'ok');
    assert.equal(slaTone(10 * 60_000, 15), 'warning');
    assert.equal(slaTone(15 * 60_000, 15), 'warning');
    assert.equal(slaTone(16 * 60_000, 15), 'danger');
  });
  it('valida o horário informado', () => {
    assert.equal(businessHoursSchema.safeParse(hours).success, true);
    const bad = (d) => businessHoursSchema.safeParse({ days: [null, d, null, null, null, null, null] }).success;
    assert.equal(bad({ open: '18:00', close: '08:00', lunchStart: null, lunchEnd: null }), false);
    assert.equal(bad({ open: '08:00', close: '18:00', lunchStart: '12:00', lunchEnd: null }), false);
    assert.equal(bad({ open: '08:00', close: '18:00', lunchStart: '07:00', lunchEnd: '08:30' }), false);
    assert.equal(bad({ open: '8:00', close: '18:00', lunchStart: null, lunchEnd: null }), false);
    assert.equal(parseBusinessHours('{"x":1}'), null);
    assert.deepEqual(parseBusinessHours(JSON.stringify(hours)), hours);
  });
});
