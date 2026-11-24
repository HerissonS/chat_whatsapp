# Arquitetura

## Visão geral

```
Navegador ──HTTP(S)──▶ chat_frontend (nginx)  ── único ponto publicado (BIND_IP:HTTP_PORT)
                         ├─ SPA React (arquivos estáticos)
                         ├─ /api/*        ─▶ chat_backend
                         └─ /socket.io/*  ─▶ chat_backend (WebSocket)

chat_backend (NestJS) ── API REST, WebSocket, webhook interno (/webhook/evolution)
      │  grava eventos e enfileira
      ▼
chat_redis (BullMQ) ──▶ chat_worker ── processa eventos, baixa mídia, gera PDF, envia e-mail
                                         │
chat_evolution (WhatsApp) ◀── REST (apikey) ── backend/worker
chat_evolution ── webhook (token no cabeçalho) ──▶ chat_backend

chat_mariadb ── banco do sistema          chat_evolution_db ── banco só da Evolution
chat_backup  ── dump diário dos dois bancos em ./backups
```

| Rede | Tipo | Serviços |
|---|---|---|
| `chat-whatsapp_public` | bridge | frontend, backend |
| `chat-whatsapp_internal` | internal (sem internet) | mariadb, redis, evolution_db, evolution, backend, worker, backup |
| `chat-whatsapp_egress` | bridge | evolution (WhatsApp), worker (SMTP) |

## Fluxos principais

### Mensagem recebida
1. A Evolution envia o evento ao webhook interno com o cabeçalho `x-webhook-token`.
2. O backend valida o token, grava o evento em `webhook_events` (sem a apikey) e enfileira.
3. O worker processa **um evento por vez, na ordem**:
   - garante o contato e a conversa;
   - aplica as regras do chamado: menu, VIP, grupo, classificação;
   - grava a mensagem de forma idempotente (chave única: caixa de entrada + id do WhatsApp);
   - publica a mensagem para os navegadores.
4. Se a mensagem tem mídia, um job da fila `media` baixa o arquivo pela Evolution e guarda no volume `media`.
5. Se o chamado exige, o bot responde: menu, opção inválida ou confirmação.

### Mensagem enviada pelo atendente
1. O backend marca "envio em andamento" no Redis para a conversa.
2. Envia pela Evolution, prefixando `*Nome do atendente:*` se o caixa de entrada estiver configurado assim.
3. Grava a mensagem e aplica as regras do chamado na mesma transação, com trava da conversa (`SELECT ... FOR UPDATE`). O primeiro atendente que responde vira o responsável.
4. Quando o webhook de confirmação chega, o worker reconhece a mensagem e não a duplica.

Mensagens enviadas **pelo celular** chegam pelo webhook sem registro prévio e aparecem como "Enviada pelo celular".

### Encerramento
1. O atendente informa o contrato (obrigatório), o equipamento (opcional, do contrato) e a classificação.
2. O chamado é fechado em transação e a mensagem de encerramento é enviada ao contato (configurável).
3. Um registro em `email_outbox` é criado e enfileirado.
4. O worker gera o PDF (PDFKit) e envia por SMTP, com até 6 tentativas e espera crescente.
5. O status do e-mail aparece no histórico do chamado, com a opção **Reenviar**.

### Máquina de estados do chamado

```
(sem chamado) ──mensagem do contato──▶ menu ──opção válida──▶ open ──Encerrar──▶ closed
      │                                 │ └─inválida x N──▶ open (opção padrão)
      │                                 └─atendente responde──▶ open (opção padrão)
      ├──VIP / menu desligado──▶ open (opção padrão)
      ├──grupo──▶ open (opção padrão)
      └──mensagem enviada por nós──▶ open (opção padrão)
```

## Modelo de dados (banco `chat_whatsapp`)

| Tabela | Conteúdo |
|---|---|
| `organizations`, `departments` | Empresa e caixas de entrada (instância WhatsApp, opções do bot, fonte do catálogo) |
| `users`, `user_groups`, `user_group_members`, `user_departments` | Usuários, grupos e caixas de entrada de cada usuário |
| `contacts`, `conversations` | Contato ou grupo e a conversa com ele (última mensagem, não lidas, chamado aberto) |
| `tickets`, `ticket_events` | Chamados e a linha do tempo de cada um |
| `messages`, `message_reactions`, `media_files` | Mensagens, reações e arquivos |
| `classifications`, `bot_templates` | Opções do menu e textos automáticos por caixa de entrada |
| `catalog_contracts`, `catalog_equipments`, `extra_contracts` | Catálogo local e contratos extras |
| `email_recipients`, `email_outbox` | Destinatários e fila persistente de e-mails |
| `webhook_events` | Eventos brutos da Evolution (retenção configurável) |
| `audit_logs` | Auditoria |
| `app_settings` | Configurações gerais (ex.: aparência) |
| `schema_migrations` | Controle das migrations (Kysely) |

As migrations ficam em `backend/src/database/migrations` e são aplicadas automaticamente quando o backend sobe.

## Código

| Pasta | Conteúdo |
|---|---|
| `backend/src/auth` | Login, sessões (Redis), guarda global com permissões e CSRF |
| `backend/src/admin` | Usuários, grupos, caixas de entrada (bot, e-mail) e auditoria |
| `backend/src/whatsapp` | Cliente da Evolution, webhook, conexão e interpretação das mensagens |
| `backend/src/chat` | Conversas, mensagens, envio, contatos e mídia |
| `backend/src/tickets` | Regras do chamado, atribuição e encerramento |
| `backend/src/closure` | PDF e e-mail de encerramento |
| `backend/src/catalog` | Contratos e equipamentos (local ou banco externo) |
| `backend/src/branding` | Aparência (cores, modais e logos) |
| `backend/src/worker` | Processadores das filas |
| `frontend/src/chat` | Tela de atendimento |
| `frontend/src/admin` | Telas de administração |
| `frontend/src/styles/tokens.css` | Design tokens padrão (sobrescritos pela tela Aparência) |
