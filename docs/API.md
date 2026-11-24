# API

Todas as rotas ficam em `/api/` e respondem JSON. A autenticação usa o cookie de sessão `atl_sid` (HttpOnly).
Requisições que alteram dados (POST, PUT, PATCH, DELETE) exigem o cabeçalho `X-CSRF-Token`, cujo valor vem de `GET /api/auth/me`.

Erros seguem o formato `{ "statusCode": 400, "message": "..." }`. Erros de validação trazem `fields`.

## Autenticação

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/login` | `{ username, password }`. Limite: 10 por minuto por IP no nginx e 20 a cada 15 minutos no backend |
| POST | `/auth/logout` | Encerra a sessão atual |
| GET | `/auth/me` | Usuário, permissões, caixas de entrada, token CSRF, limites |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }`. Encerra as outras sessões |
| POST | `/auth/preferences` | Preferências do usuário |

## Atendimento

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| GET | `/conversations?tab=&q=&offset=&limit=` | chat.read | `tab`: mine, unassigned, menu, all, groups, closed, everything |
| GET | `/conversations/counts` | chat.read | Contadores das abas |
| GET | `/conversations/:id` | chat.read | Resumo e histórico de chamados |
| GET | `/conversations/:id/messages?beforeId=&limit=` | chat.read | Mensagens (paginação para trás) |
| POST | `/conversations/:id/read` | chat.read | Zera não lidas e envia confirmação de leitura |
| POST | `/conversations` | chat.send | Nova conversa `{ phone }` (valida no WhatsApp) |
| POST | `/conversations/:id/messages` | chat.send | Texto `{ text, quotedMessageId? }` |
| POST | `/conversations/:id/media` | chat.send | Multipart: `file`, `caption?`, `quotedMessageId?`, `asSticker?` (`1` = enviar imagem como figurinha) |
| POST | `/messages/:id/reaction` | chat.send | `{ emoji }` (vazio remove) |
| POST | `/messages/:id/forward` | chat.send | `{ conversationIds: [...] }` (até 10) |
| DELETE | `/messages/:id` | chat.delete | Apaga para todos (só mensagens do suporte) |
| PATCH | `/contacts/:id` | contact.edit | `{ customName?, isVip? }` |
| GET | `/media/:id[?download=1]` | chat.read | Arquivo. Só tipos seguros são exibidos na página |
| GET | `/classifications?departmentId=` | chat.read | Opções do menu |
| GET | `/users` | chat.read | Usuários ativos (para atribuição) |
| GET | `/whatsapp/status` | chat.read | Estado da conexão dos caixas de entrada do usuário |
| GET | `/inboxes` | (login) | Caixas de entrada do usuário (administrador: todas) |
| GET | `/dashboard?days=1\|7\|30&departmentId=` | dashboard.view | Indicadores da tela de Início |
| GET | `/stickers/recent` | chat.send | Figurinhas recentes das caixas do usuário |
| POST | `/conversations/:id/sticker` | chat.send | Envia figurinha armazenada `{ mediaId, quotedMessageId? }` |
| GET | `/contacts?q=&limit=` | chat.read | Agenda (contatos importados e que já conversaram) |
| POST | `/contacts/:id/open` | chat.send | Abre ou cria a conversa com o contato |
| GET | `/contacts/:id/avatar` | chat.read | Foto de perfil (cópia local; 404 sem foto) |

## Chamados

| Método | Rota | Permissão | Descrição |
|---|---|---|---|
| POST | `/tickets/:id/assign` | ticket.assign | `{ userId \| null }` |
| POST | `/tickets/:id/close` | ticket.close | `{ contract, equipment?, classificationId }` |
| POST | `/tickets/:id/resend-email` | ticket.close | Reenfileira o e-mail |
| GET | `/tickets/:id/pdf` | chat.read | PDF do histórico |
| GET | `/catalog/contracts?departmentId=` | ticket.close | Contratos (catálogo + extras) |
| GET | `/catalog/equipments?departmentId=&contract=` | ticket.close | Equipamentos ativos do contrato |

## Administração

| Rota | Permissão |
|---|---|
| `GET/POST /admin/users`, `PATCH /admin/users/:id`, `POST /admin/users/:id/reset-password`, `POST /admin/users/:id/unlock` | admin.users |
| `GET /admin/permissions` (catálogo), `GET/POST /admin/groups`, `PATCH/DELETE /admin/groups/:id` (`{ name, description, memberIds, permissions }`) | admin.users |
| `GET/POST /admin/departments`, `PATCH/DELETE /admin/departments/:id` | admin.departments |
| `GET/PUT /admin/departments/:id/bot` | admin.bot |
| `GET/PUT /admin/departments/:id/email-recipients`, `POST /admin/departments/:id/email-test` | admin.email |
| `POST /admin/whatsapp/:departmentId/connect` (`{ number? }` para pareamento), `GET .../state`, `POST .../logout`, `POST .../restart`, `POST .../import-contacts` | admin.whatsapp |
| `GET/POST /admin/extra-contracts`, `PATCH/DELETE /admin/extra-contracts/:id` | admin.catalog |
| `GET/POST /admin/catalog/contracts`, `PATCH/DELETE /admin/catalog/contracts/:id` | admin.catalog |
| `GET/POST /admin/catalog/equipments`, `PATCH/DELETE /admin/catalog/equipments/:id` | admin.catalog |
| `POST /admin/catalog/import` (CSV `contrato;codigo;tipo`) | admin.catalog |
| `PUT /admin/branding`, `POST /admin/branding/reset`, `POST/DELETE /admin/branding/logo/:slot` | admin.branding |
| `GET /admin/audit?username=&action=&from=&to=&page=` | admin.audit |

Rotas públicas: `GET /branding`, `GET /branding/logo/:slot` (light, dark, favicon, pdf), `GET /health`, `GET /health/ready`.

## Eventos em tempo real (Socket.IO, caminho `socket.io/`)

A conexão usa o mesmo cookie de sessão e só é aceita da mesma origem. Os eventos chegam por caixa de entrada.

| Evento | Conteúdo |
|---|---|
| `message:upsert` | Mensagem nova ou alterada (status, reação, mídia baixada, apagada) |
| `conversation:upsert` | Resumo da conversa (última mensagem, não lidas, chamado) |
| `whatsapp:status` | `{ departmentId, state }` |
| `whatsapp:qrcode` | `{ departmentId, base64, pairingCode }` (só administradores) |

## Webhook interno (não exposto)

`POST http://chat_backend:3000/webhook/evolution` com o cabeçalho `x-webhook-token`. É configurado automaticamente na Evolution quando o administrador conecta o WhatsApp.
