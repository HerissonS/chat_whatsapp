# Plano de Implementação — Central de Atendimento WhatsApp

> Status: **fases 0 a 7 concluídas em 2026-11-19. Fase 8 (homologação com número real) pendente** (revisão 7)
> Data: 2026-11-19
> Este documento não contém credenciais. Os segredos ficam em `.env` (fora do controle de versão), e a documentação usa apenas `.env.example` com placeholders.

---

## 1. Objetivo

Criar um sistema web **independente** de atendimento estilo chat, integrado ao WhatsApp por uma **Evolution API v2.3.7 dedicada**, para substituir o Chatwoot e o n8n no atendimento. O sistema deve:

- ter **login, usuários, grupos e perfis próprios**, sem depender do SOS. O SOS terá apenas um atalho para o chat;
- ser **portátil**: tudo fica numa única pasta (aqui, a pasta do projeto), que pode ser copiada para outro servidor e configurada só pelo `.env`;
- ter **aparência personalizável** pela interface (cores e logos), começando com a identidade visual da empresa;
- receber e enviar mensagens (texto, imagens, vídeos, áudios, PDF, Word, ZIP e outros documentos);
- permitir responder uma mensagem específica, reagir, encaminhar, ver grupos e iniciar novas conversas;
- mostrar também as mensagens enviadas pelo celular do suporte;
- enviar um menu automático de classificação, exceto para contatos VIP e grupos;
- gerar chamados com um único responsável, sem impedir que outros atendentes respondam;
- no encerramento, enviar um e-mail via Gmail com o assunto padronizado e o PDF do histórico daquele atendimento;
- conectar o WhatsApp (QR Code) **pela interface do próprio sistema**.

A arquitetura deve servir a outros setores, departamentos ou empresas (multi-setor).

---

## 2. Decisões confirmadas

| Tema | Decisão |
|---|---|
| Independência | Sistema próprio, sem dependência do SOS. O SOS ganha só um atalho (card ou link) |
| Portabilidade | Pasta única. Neste servidor: a pasta do projeto. Tudo configurável por `.env` (endereço, porta, caminho base, banco, SMTP) |
| Endereço no teste | `http://10.254.2.200:8870` |
| Login | Próprio: usuários, grupos e perfis **Administrador** e **Operador** (mesmos nomes do SOS) |
| Evolution API | Container novo e dedicado, `evoapicloud/evolution-api:v2.3.7` fixado por digest. A Evolution atual não é usada nem alterada |
| Exposição da Evolution | Nenhuma porta publicada. Acessível só pelas redes Docker do projeto |
| Conexão do WhatsApp | Pela tela de administração do sistema (QR Code ou código de pareamento) |
| Banco do sistema | **MariaDB próprio**, container novo dentro do compose do projeto (`chat_mariadb`), sem porta publicada. Não depende de nenhum banco existente |
| Banco da Evolution | **PostgreSQL Alpine dedicado** em rede interna, sem porta publicada |
| Contratos e equipamentos | Conector configurável (seção 7.6). No teste: cadastro próprio no sistema. Depois, opcionalmente: leitura de um banco de equipamentos externo |
| E-mail | Gmail com senha de app no `.env`. Destinatários configuráveis na interface |
| Nome do atendente | As mensagens chegam ao técnico com o nome de quem enviou (ex.: `*Rodrigo Sales:*`) |
| Infraestrutura | 100% Docker, imagens Alpine fixadas por `@sha256` |
| Logs | Sem dados sensíveis, mas suficientes para diagnóstico e auditoria |
| UI/UX | Moderna e agradável. Cores, logos e estilo dos modais em **variáveis globais (design tokens)**, editáveis na tela **Aparência**. Valores iniciais neutros; a identidade da empresa é configurada na própria tela |
| Git | Nenhum comando git será executado. O versionamento no GitHub é feito por você depois |
| Containers existentes | Nenhum container em execução será parado ou recriado |
| Foco atual | Desenvolvimento e funcionamento completos no servidor de teste `10.254.2.200`. Produção (`10.254.2.210`) fica para depois |
| Número de teste | Será fornecido na hora de conectar |

---

## 3. Bancos de dados

Tudo sobe **novo neste servidor**, dentro do compose do projeto. Nenhum banco existente é usado ou alterado.

| Banco | Container | Usado por |
|---|---|---|
| `chat_whatsapp` | **MariaDB** imagem oficial (`chat_mariadb`) | Sistema: usuários, chamados, mensagens, catálogo, aparência, auditoria, configurações |
| `evolution` | **PostgreSQL** alpine (`chat_evolution_db`) | Somente a Evolution API |

- Os dois ficam na rede interna `chat_internal` (`internal: true`), **sem porta publicada**. Só os serviços do projeto os acessam.
- Os dados do negócio ficam no MariaDB. A Evolution pode ser trocada ou atualizada sem tocar nos chamados e mensagens.
- O MariaDB usa `utf8mb4` (emojis), datas em `DATETIME(3)` (ordem das mensagens) e colunas `JSON`.
- Volumes próprios (`chat_mariadb_data`, `chat_evolution_pgdata`) e backup diário dos dois (seção 12).
- **Exceção ao Alpine:** a imagem oficial do MariaDB não tem variante Alpine. Usaremos a imagem **oficial** (`mariadb` LTS), fixada por digest, porque imagens Alpine de terceiros não têm a mesma garantia de manutenção e segurança. Todas as outras imagens são Alpine.

### Usuários do MariaDB
| Usuário | Permissões |
|---|---|
| `root` | Só para manutenção. Senha gerada e guardada apenas no `.env` |
| `chat_app` | ALL apenas no banco `chat_whatsapp` (o sistema aplica as próprias migrations) |

### Geração dos segredos sem expô-los
O script `scripts/init-env.sh` cria o `.env` a partir do `.env.example` e **gera automaticamente** senhas e tokens fortes (MariaDB, PostgreSQL, Redis, apikey da Evolution, token do webhook, segredo de sessão), com `chmod 600`. Você só preenche o que é externo: e-mail e senha de app do Gmail. Nenhuma senha aparece em tela, log ou documentação.

---

## 4. Arquitetura

```
 Navegador ──HTTP(S)──▶ proxy reverso existente (opcional: Nginx Proxy Manager / nginx)
                         │
                         ▼
             ${BIND_IP}:${HTTP_PORT}  (único ponto publicado; aqui 10.254.2.200:8870)
┌────────────────────────┴───────────────────────────────────────────────────┐
│ chat_whatsapp/ (docker compose próprio)                                     │
│                                                                             │
│  ── rede chat_public (bridge, só o frontend publica porta) ──               │
│  chat_frontend  (nginx-unprivileged alpine)                                 │
│     ├─ SPA React (caminhos relativos ao BASE_PATH)                          │
│     ├─ api/*        → chat_backend                                          │
│     └─ socket.io/*  → chat_backend (WebSocket)                              │
│  chat_backend   (Node.js alpine)  API REST + WebSocket + webhook interno    │
│  chat_worker    (mesma imagem)    filas: eventos, mídia, PDF, e-mail        │
│                                                                             │
│  ── rede chat_internal (internal: true, sem saída e sem porta) ──           │
│  chat_mariadb       (MariaDB oficial)    banco do sistema                   │
│  chat_redis         (Redis alpine)       sessões, filas, Socket.IO, cache   │
│  chat_evolution_db  (PostgreSQL alpine)  banco exclusivo da Evolution       │
│  chat_evolution     (Evolution v2.3.7)   também na rede chat_egress         │
│  (backend e worker também estão nesta rede)                                 │
│                                                                             │
│  ── rede chat_egress (saída para a internet: WhatsApp) ──                   │
│  chat_evolution                                                             │
│                                                                             │
│  volumes: chat_media, chat_branding, chat_mariadb_data,                     │
│           chat_evolution_instances, chat_evolution_pgdata, chat_redis_data  │
└────────────────────────────────────────────────────────────────────────────┘

 chat_worker ──SMTP TLS──▶ smtp.gmail.com
 chat_backend ⇄ chat_evolution (REST com apikey  /  webhook com token)
```

### Princípios
- **Desacoplamento**: frontend, backend/worker, Evolution e bancos são serviços independentes, com imagem e ciclo de atualização próprios.
- **Exposição mínima**: só o frontend publica porta, em IP e porta definidos no `.env`. Evolution, Redis, PostgreSQL e backend não publicam portas. MariaDB, Redis e PostgreSQL ficam numa rede `internal`, sem acesso externo.
- **O webhook nunca é público**: a Evolution chama o backend pela rede interna. O frontend **não** encaminha `/webhook`.
- **Caminho base configurável** (`BASE_PATH`): o sistema funciona na raiz (`http://servidor:8870/`) ou num subcaminho (`https://dominio/chat-whatsapp/`) atrás de um proxy, sem rebuild.
- **Processamento assíncrono e idempotente**: o webhook grava o evento e responde rápido. O worker processa com retentativa.
- **Adaptabilidade**: menu, textos, classificações, destinatários, contratos extras e fonte do catálogo são configurados por **setor** na interface.

---

## 5. Stack tecnológica

| Camada | Tecnologia | Motivo |
|---|---|---|
| Backend | **Node.js LTS + NestJS + TypeScript** | Modular, tipado, fácil de manter e com suporte longo |
| Banco / migrations | **Kysely** + driver `mysql2` | Query builder tipado, queries parametrizadas e migrations versionadas. Escolhido no lugar do Prisma, que em nov/2026 estava com um release candidate como versão `latest` |
| Catálogo externo | `mysql2` com queries parametrizadas e usuário só SELECT | Isolado no módulo `catalog` |
| Senhas | **argon2id** | Algoritmo recomendado pela OWASP |
| Sessão | Cookie de sessão `HttpOnly` e `SameSite=Strict` com dados no Redis | Revogação imediata (logout, bloqueio, troca de senha) |
| Filas | **BullMQ** (Redis) | Retentativa com backoff e jobs idempotentes |
| Tempo real | **Socket.IO** com adapter Redis | Atualização instantânea entre atendentes |
| E-mail | **Nodemailer** → Gmail (`smtp.gmail.com`, TLS) | Senha de app no `.env` |
| PDF | **PDFKit** | Sem Chromium, imagem pequena |
| Segurança HTTP | `helmet`, `@nestjs/throttler`, validação com `class-validator` / `zod`, proteção CSRF | |
| Logs | **pino** (JSON estruturado) | Ver seção 10 |
| Frontend | **React + Vite + TypeScript** | Build estático leve |
| UI | **Tailwind CSS + shadcn/ui (Radix)** + ícones **Lucide** | Componentes modernos e acessíveis |
| Dados no frontend | TanStack Query + Socket.IO client | Cache e sincronização em tempo real |
| Servidor web | **nginx-unprivileged** (alpine) | Roda sem root |
| Redis | `redis` alpine com senha | Um Redis para o sistema e a Evolution (bancos lógicos separados) |
| Banco da Evolution | `postgres` alpine | Provider oficial da Evolution |

### Versões fixadas na Fase 0

| Componente | Versão |
|---|---|
| Node.js (backend e build) | 24.22.3 alpine |
| NestJS | 12.5 (ESM) |
| TypeScript | 6.0 |
| React / Vite / Tailwind | 19.3 / 8.3 / 4.3 |
| nginx-unprivileged | 1.31.7 alpine |
| MariaDB | 12.3.3 (imagem oficial; sem variante Alpine) |
| PostgreSQL | 18.7 alpine |
| Redis | 8.10.3 alpine |
| Evolution API | v2.3.7 |

As versões exatas e os digests SHA256 são levantados no build (`docker buildx imagetools inspect`) e fixados nos Dockerfiles e no compose. O script `scripts/update-digests.sh` faz a atualização controlada.

---

## 6. Autenticação e autorização (próprias)

### Login
- Tela de login com a identidade visual configurada. Usuário (ou e-mail) e senha.
- Senhas com **argon2id**. Política mínima configurável (padrão: 8 caracteres).
- **Bloqueio progressivo** por tentativas (ex.: 5 falhas → 15 min), rate limit por IP e mensagem genérica de erro.
- Sessão em cookie `HttpOnly`, `SameSite=Strict`, `Secure` quando servido por HTTPS, com expiração por inatividade e duração máxima configuráveis.
- Logout, desativação do usuário ou troca de senha **derrubam todas as sessões** dele, inclusive o WebSocket.
- Primeiro acesso: o script `scripts/create-admin.sh` cria o primeiro Administrador de forma interativa. Não existe usuário ou senha padrão.
- O administrador redefine senhas. O usuário troca a própria senha e é obrigado a trocar no primeiro acesso.
- Opcional (pode ser ativado depois): segundo fator TOTP (Google Authenticator) para administradores.

### Perfis
| Perfil | Pode |
|---|---|
| **Administrador** | Atende e acessa a **Administração**: usuários, grupos, setores, conexão do WhatsApp, classificações, textos do bot, destinatários de e-mail, contratos extras, fonte do catálogo e auditoria |
| **Operador** | Atende qualquer conversa do seu setor, atribui, encerra e marca VIP |

As permissões ficam modeladas internamente por ações (ex.: `ticket.close`, `admin.whatsapp`). Isso permite criar outros perfis no futuro sem mudar o código.

### Grupos e setores
- **Grupos de usuários** (equipes) para organizar e filtrar (ex.: "Suporte N1").
- **Setores** definem o que o usuário vê: cada setor tem sua instância WhatsApp, menu, textos e destinatários. Um usuário pode estar em mais de um setor.

### Atalho no SOS
Basta um card ou link no SOS apontando para o endereço do chat. Os dois sistemas continuam independentes, cada um com o próprio login.

---

## 7. Regras de negócio

### 7.1 Recebimento (webhook)
Eventos assinados: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `MESSAGES_DELETE`, `SEND_MESSAGE`, `CONTACTS_UPSERT`, `CONTACTS_UPDATE`, `CHATS_UPSERT`, `GROUPS_UPSERT`, `GROUPS_UPDATE`, `GROUP_PARTICIPANTS_UPDATE`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`.

1. `POST /webhook/evolution/{token}` (só na rede interna): valida o token em tempo constante, grava em `webhook_events` e enfileira.
2. O worker processa de forma idempotente (chave única: instância + id da mensagem no WhatsApp).
3. Mídia: o worker baixa via `getBase64FromMediaMessage`, valida MIME e tamanho, grava no volume e calcula o SHA256.
4. A mensagem é publicada via WebSocket para os atendentes do setor.

### 7.2 Mensagens enviadas pelo celular
Chegam com `fromMe = true`. Quando o id não é de uma mensagem enviada pelo sistema ou pelo bot, a mensagem aparece com o selo **"Enviado pelo celular"**. Mensagens do sistema e do bot são reconhecidas pelo id retornado no envio, o que evita duplicação.

### 7.3 Menu automático

```
Mensagem recebida de contato individual
│
├─ Contato VIP? ────────────────▶ Chamado ABERTO, "Outras dúvidas", sem menu
├─ Tem chamado aberto? ─────────▶ Anexa a mensagem ao chamado
└─ Não tem chamado
      └─▶ Chamado AGUARDANDO_MENU + envia o menu
             ├─ Responde 1, 2 ou 3 ──▶ classifica + envia confirmação → ABERTO
             ├─ Resposta inválida ──▶ aviso + menu (até 3 vezes; depois ABERTO como "Outras dúvidas")
             └─ Atendente responde antes ──▶ bot para, ABERTO como "Outras dúvidas"

Grupo ───────────────────────────────────────▶ ABERTO, "Outras dúvidas", sem menu
Conversa iniciada por nós (sistema ou celular) ─▶ ABERTO, "Outras dúvidas", sem menu
Mensagens do bot nunca abrem chamado.
```

Textos padrão (editáveis por setor):
- **Menu:** "Olá! Bem-vindo ao nosso atendimento. Por favor, escolha uma das opções abaixo para direcionarmos seu atendimento: 1 - Equipamento - Solicitação de Suporte / 2 - Equipamento - Validação / 3 - Outras dúvidas"
- **Confirmação:** "Seu atendimento foi registrado, em breve um analista irá te responder."
- **Encerramento:** "Informamos que seu chamado foi encerrado em nosso sistema." (individual: ligado; grupo: desligado)

| Nº | Texto no menu | Texto no assunto |
|---|---|---|
| 1 | Equipamento - Solicitação de Suporte | Solicitação de Suporte |
| 2 | Equipamento - Validação | Validação |
| 3 | Outras dúvidas | Outras dúvidas (padrão) |

### 7.4 Atribuição (no estilo do Chatwoot)
- Cada chamado tem **um responsável** (ou nenhum). **Qualquer atendente envia mensagens em qualquer conversa do setor**, e cada mensagem registra quem a enviou.
- Se o chamado não tiver responsável, o primeiro atendente que responder vira responsável. Se ninguém respondeu, quem encerrar vira responsável.
- Ações: "Atribuir a mim", "Atribuir a...", "Remover atribuição". Tudo fica em `ticket_events`.
- **Nome do atendente na mensagem**: o técnico recebe `*Rodrigo Sales:*` seguido do texto (negrito do WhatsApp). Em mídias, o nome vai na legenda. Pode ser desligado por setor, mas vem ligado por padrão.

### 7.5 Encerramento
1. O atendente clica em **Encerrar**. Abre o modal **"Confirme as seguintes informações"**:
   - **Contrato** (obrigatório), com busca.
   - **Equipamento** (opcional): equipamentos do contrato escolhido com `ativo = 1`, com busca por `codigo`.
   - **Classificação**: vem preenchida e pode ser alterada.
   - Pré-visualização do assunto.
2. **Confirmar encerramento**, numa transação: fecha o chamado, grava contrato, equipamento, classificação e quem encerrou, enfileira o PDF e o e-mail na `email_outbox` e envia a mensagem de encerramento.
3. O worker gera o PDF e envia o e-mail com retentativa. O status do e-mail aparece no chamado, com botão **Reenviar**.

**Assunto:** `[AAAAMMDD][CONTRATO][EQUIPAMENTO] Classificação`. Sem equipamento: `[AAAAMMDD][CONTRATO] Classificação`. A data é a do encerramento.

**Corpo:**
```
ENCERRAMENTO DE ATENDIMENTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 DADOS DO ATENDIMENTO:
Cliente: {nome do contato ou do grupo}
Telefone: {+55...}
Técnico Responsável: {responsável pelo chamado}

🕐 INFORMAÇÕES DE TEMPO:
Duração do Atendimento: {X horas Y minutos}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 HISTÓRICO DA CONVERSA: ver PDF anexo
```

**PDF anexo** (`atendimento_{id}_{AAAAMMDD}.pdf`):
- Cabeçalho com o logo configurado e os dados do chamado.
- Mensagens **somente daquele chamado**: data e hora, remetente (contato, participante do grupo, atendente, "Celular" ou "Bot") e conteúdo.
- Mídias aparecem como `[Imagem: foto.jpg]`. Respostas mostram o trecho citado. Reações aparecem ao lado da mensagem.

A duração conta da primeira mensagem do chamado até o encerramento.

### 7.6 Catálogo de contratos e equipamentos (conector)
Para o sistema funcionar em qualquer lugar, contratos e equipamentos vêm de um **conector configurável por setor**:

| Fonte | Uso |
|---|---|
| `external_mariadb` (opcional) | Lê um banco externo, como o banco de equipamentos da empresa, com usuário só SELECT. Contratos = `contracts.name` ∪ `equipament.contrato` (distintos, sem vazios). Equipamentos = `equipament` com `contrato` igual ao escolhido e `ativo = 1` |
| `local` (padrão no teste) | Contratos e equipamentos cadastrados no próprio sistema (tela de administração e importação por CSV) |

No teste, o catálogo local recebe alguns contratos e equipamentos de exemplo, e você pode importar um CSV real. Em qualquer fonte, os **contratos extras** (ex.: CHAMADO INTERNO) são somados à lista. Se o banco externo estiver fora do ar, o modal avisa claramente e permite tentar de novo.

### 7.7 Conexão do WhatsApp pela interface (Administrador)
- **Status da conexão** em tempo real, também visível como indicador no topo para todos.
- **Conectar**: o backend cria a instância na Evolution se ela não existir, configura o webhook e chama `GET /instance/connect/{instancia}`. A tela mostra o **QR Code**, que se atualiza sozinho via `QRCODE_UPDATED`, com opção de **código de pareamento** por número.
- **Desconectar** e **Reiniciar**, com confirmação e registro em auditoria.
- A API key da Evolution fica só no `.env` do backend e nunca chega ao navegador.

---

## 8. UI/UX

- **Layout em três colunas**: lista de conversas, chat e painel do contato ou chamado (recolhível).
- **Cores e logos nunca fixos no código**: tudo vem dos design tokens da seção 8.1.
- **Tema claro e escuro**, com preferência salva por usuário.
- Bolhas de mensagem com contraste adequado (WCAG AA), agrupamento por dia e por remetente, avatar e nome do participante em grupos.
- **Fluxos rápidos**: `Ctrl+K` para buscar conversa, `Enter` para enviar, `Shift+Enter` para quebrar linha, arrastar e soltar arquivos, colar imagem com `Ctrl+V`.
- **Feedback claro**: skeleton loading, toasts, estados vazios, indicador de conexão do WhatsApp, status de envio e de e-mail.
- Menu de contexto na mensagem: **Responder, Reagir, Encaminhar, Copiar, Baixar, Apagar**.
- Abas **Minhas**, **Não atribuídas**, **Aguardando menu**, **Todas**, **Grupos** e **Encerradas**, com contadores e busca.
- Notificações do navegador e som (configuráveis).
- Responsivo, utilizável também em tablet.
- Antes de codificar as telas, entrego um **protótipo navegável** (layout e fluxo de encerramento) para validação.

---

### 8.1 Aparência personalizável (design tokens)

Todas as cores, logos e o estilo dos modais vêm de **variáveis globais** (CSS custom properties). Nenhum componente usa cor fixa. Os tokens ficam no banco e são aplicados na hora, sem rebuild.

**Tokens de cor** (valores iniciais):

| Token | Uso | Valor inicial |
|---|---|---|
| `--color-primary` | Botões principais, links, destaques | `#1F4070` |
| `--color-primary-hover` | Hover e foco | `#1F3F6E` |
| `--color-sidebar` | Barra lateral e cabeçalho | `#122440` |
| `--color-muted` | Textos secundários e ícones | `#5B6D88` |
| `--color-border` | Bordas e divisores | `#ACB4BF` |
| `--color-background` | Fundo da aplicação | neutro claro |
| `--color-surface` | Cartões, painéis e modais | branco |
| `--color-bubble-in` / `--color-bubble-out` | Bolhas de mensagem recebida e enviada | derivadas da primária |
| `--color-success` / `--color-warning` / `--color-danger` | Estados | padrões acessíveis |

Para o **tema escuro**, o sistema deriva automaticamente as variantes a partir dos mesmos tokens, e o administrador pode ajustá-las.

**Tokens de modal e componentes**: `--radius` (arredondamento), `--modal-overlay` (cor e opacidade do fundo), `--modal-shadow`, `--modal-width-sm/md/lg` e `--font-family`. Todos os modais (encerramento, encaminhar, nova conversa, confirmações) usam um único componente base com esses tokens.

**Logos** (enviadas pela interface):

| Logo | Uso | Inicial |
|---|---|---|
| Logo para fundo claro | Tela de login e tema claro | `arco_azul_nome_azul.png` |
| Logo para fundo escuro | Barra lateral e tema escuro | `arco_branco_nome_branco.png` |
| Ícone / favicon | Aba do navegador e notificações | gerado de `logo_azul_royal.svg` |
| Logo do PDF e do e-mail | Cabeçalho do PDF de atendimento | `arco_azul_nome_azul.png` |

**Tela Aparência** (Administrador):
- seletores de cor com **pré-visualização ao vivo** (chat, modal e botões de exemplo);
- **aviso de contraste** quando uma combinação não atinge WCAG AA;
- upload de logos em PNG, JPG ou WebP (SVG só depois de sanitizado), com limite de tamanho e validação do arquivo real;
- nome do sistema exibido no topo e na aba do navegador;
- botão **Restaurar padrão**;
- toda alteração fica registrada na auditoria.

A aparência vale por organização, o que permite outra empresa usar o sistema com a própria marca. O PDF e o e-mail de encerramento também usam a logo e a cor primária configuradas.

---

## 9. Administração

| Tela | Conteúdo |
|---|---|
| Usuários | Criar, editar, desativar, redefinir senha, perfil, grupos e setores |
| Grupos | Equipes de atendimento |
| Setores | Nome, instância WhatsApp, prefixo com nome do atendente, fonte do catálogo |
| WhatsApp | Status, QR Code, pareamento, desconectar, reiniciar |
| Bot e classificações | Opções do menu, textos e tentativas inválidas |
| E-mail | Destinatários por setor e envio de teste |
| Contratos | Contratos extras e, na fonte `local`, contratos e equipamentos (com importação CSV) |
| Aparência | Cores, logos, estilo dos modais e nome do sistema (seção 8.1) |
| Auditoria | Consulta com filtros por usuário, ação e período |

---

## 10. Logs, auditoria e diagnóstico

| Tipo | Onde | Conteúdo |
|---|---|---|
| Log de aplicação | stdout em JSON (pino), com rotação pelo Docker (`max-size`, `max-file`) | Nível, data, serviço, `request_id`, `user`, `ticket_id`, `conversation_id`, id da mensagem do WhatsApp, rota, status, latência, erro com stack |
| Auditoria | Tabela `audit_logs` (consulta na interface) | Quem, quando, IP, ação e alvo: login (sucesso e falha), bloqueio, gestão de usuários, atribuição, VIP, encerramento, reenvio de e-mail, conexão do WhatsApp, configurações |
| Eventos brutos | Tabela `webhook_events` | Payload da Evolution para reprocessamento, com retenção configurável (padrão 30 dias) |
| Envios de e-mail | Tabela `email_outbox` | Status, tentativas, último erro do SMTP, data de envio |

O que **nunca** vai para os logs: senhas, hashes, tokens, apikey, cookies e conteúdo de mensagens ou arquivos. A redação é automática, e telefones aparecem mascarados (`+55949***7385`). O `request_id` segue a requisição do frontend até o worker, para rastrear um problema de ponta a ponta.

---

## 11. Modelo de dados (banco `chat_whatsapp`)

Todas as tabelas de negócio têm `department_id` (multi-setor).

| Tabela | Finalidade |
|---|---|
| `organizations`, `departments` | Empresa e setor |
| `users` | Usuário, nome, e-mail, hash argon2id, perfil, ativo, troca de senha obrigatória, falhas de login, bloqueado até, último login |
| `roles`, `role_permissions` | Perfis (Administrador, Operador) e permissões por ação |
| `user_groups`, `user_group_members`, `user_departments` | Grupos e setores dos usuários |
| `sessions` (Redis) | Sessões ativas, com índice por usuário para revogação |
| `whatsapp_instances` | Nome da instância na Evolution e status da conexão |
| `contacts` | Contato ou grupo: JID, telefone, nome do WhatsApp, nome editado, `is_vip`, `is_group` |
| `conversations` | Uma por chat por setor. Guarda a última mensagem e os não lidos |
| `tickets`, `ticket_events` | Chamado e linha do tempo |
| `messages`, `message_reactions`, `media_files` | Mensagens, reações e arquivos |
| `classifications`, `bot_templates` | Menu e textos do bot por setor |
| `catalog_contracts`, `catalog_equipments` | Catálogo local (fonte `local`) |
| `extra_contracts` | Contratos fora do catálogo (ex.: CHAMADO INTERNO) |
| `branding_settings`, `branding_assets` | Tokens de cor e de modal, nome do sistema e logos por organização |
| `email_settings`, `email_outbox` | Destinatários e fila persistente de e-mails |
| `webhook_events`, `audit_logs` | Eventos brutos e auditoria |

---

## 12. Segurança (DevSecOps)

| Área | Medida |
|---|---|
| Segredos | `.env` com `chmod 600`, fora do controle de versão. `.env.example` só com placeholders. `init-env.sh` gera senhas e tokens aleatórios fortes |
| Containers | Imagens alpine com digest `@sha256`, usuário não root, `read_only: true` com `tmpfs` onde preciso, `cap_drop: [ALL]`, `no-new-privileges`, limites de CPU e memória, healthchecks |
| Exposição | Só o frontend publica porta (`10.254.2.200:8870` no teste). Evolution, MariaDB, Redis, PostgreSQL e backend sem porta. Bancos e Redis só na rede `internal` |
| Login | argon2id, bloqueio progressivo, rate limit, sessão revogável, troca obrigatória no primeiro acesso, sem usuário padrão |
| Webhook | Rota interna, token longo no path, comparação em tempo constante, limite de tamanho |
| Aplicação | Validação de entrada, queries parametrizadas, proteção CSRF, `helmet` (CSP), checagem de permissão no backend em toda rota |
| Logos | Validação do arquivo real, limite de tamanho, SVG sanitizado, servidas com `Content-Type` correto e `X-Content-Type-Options: nosniff` |
| Uploads | Limite de tamanho configurável, validação de MIME por assinatura, nome sanitizado, mídia servida só para usuários autenticados, `Content-Disposition: attachment` para tipos não exibíveis |
| Banco | Usuário da aplicação com privilégio mínimo. Conector externo (quando usado) só leitura e só nas colunas necessárias |
| HTTPS | Em produção, atrás de proxy com TLS (cookie `Secure` e HSTS). No teste interno por HTTP, o modo é definido no `.env` |
| Supply chain | `npm ci` com lockfile, `npm audit`, **Trivy** nas imagens, **gitleaks** para segredos (`scripts/security-scan.sh`) |
| Backup | Backup diário do MariaDB (`mariadb-dump`) e do PostgreSQL da Evolution (`pg_dump`), com retenção configurável. Script de backup dos volumes de mídia, logos e sessão |
| LGPD | Retenção configurável de mídia e eventos brutos, acesso restrito por setor |

---

## 13. Estrutura do projeto (pasta portátil)

```
chat_whatsapp/                  (pasta portátil; o nome pode ser qualquer um)
├── README.md                   (visão geral e instalação rápida)
├── docker-compose.yml          (frontend, backend, worker, mariadb, redis, evolution, evolution_db, backup)
├── .env.example                (todas as variáveis, sem valores reais)
├── docs/
│   ├── PLANO_IMPLEMENTACAO.md
│   ├── ARQUITETURA.md
│   ├── INSTALACAO.md           (servidor novo do zero, passo a passo)
│   ├── CONFIGURACAO.md         (variáveis de ambiente, sem valores)
│   ├── OPERACAO.md             (backup, restore, logs, atualização, reconexão do WhatsApp)
│   ├── SEGURANCA.md
│   ├── API.md                  (endpoints e eventos WebSocket)
│   └── MANUAL_USUARIO.md
├── backend/                    (NestJS, Kysely, Dockerfile multi-stage alpine)
├── frontend/                   (React, Dockerfile build → nginx-unprivileged alpine)
├── branding/                   (removida: logos são enviados pela tela Aparência)
└── scripts/
    ├── init-env.sh             (cria o .env e gera todos os segredos)
    ├── create-admin.sh         (cria o primeiro Administrador)
    ├── update-digests.sh
    ├── security-scan.sh
    └── backup.sh / restore.sh
```

Instalação em um servidor novo: copiar a pasta, rodar `scripts/init-env.sh`, preencher o Gmail no `.env`, `docker compose up -d` e `scripts/create-admin.sh`.

---

## 14. Fases de desenvolvimento (no servidor de teste `10.254.2.200`)

| Fase | Entrega | Critério de aceite |
|---|---|---|
| **0. Fundação** ✅ | Pasta portátil, Dockerfiles, compose com digests, redes, MariaDB, PostgreSQL, Redis, Evolution, `init-env.sh`, backups | Stack sobe sem afetar nenhum container existente. Evolution saudável sem porta publicada |
| **1. Autenticação** ✅ | Login, sessões, usuários, grupos, perfis, setores, auditoria, `create-admin.sh` | Administrador e Operador entram com as permissões corretas. Bloqueio e revogação funcionando |
| **2. Conexão e integração Evolution** ✅ | Tela de conexão (QR Code e pareamento), webhook, fila, persistência idempotente, mídia, envio, mensagens do celular | WhatsApp conectado pela interface. Mensagens nos dois sentidos sem duplicação |
| **3. Protótipo e interface de chat** ✅ | Protótipo para validação e depois lista, chat, tempo real, responder, reagir, encaminhar, apagar, nova conversa, grupos, contato e VIP | Todas as funções da seção 8 operando |
| **4. Chamados e bot** ✅ | Máquina de estados, menu, VIP, grupos, atribuição, nome do atendente | Todos os caminhos da seção 7.3 testados |
| **5. Encerramento** ✅ | Modal com catálogo, PDF, Gmail, outbox, mensagem de encerramento | E-mail chega correto com e sem equipamento |
| **6. Administração e aparência** ✅ | Telas da seção 9, incluindo Aparência (cores, logos, modais) | Administrador configura tudo pela interface |
| **7. Hardening e documentação** ✅ | Testes, scans, backup, revisão de logs e docs | Sem vulnerabilidade crítica conhecida. Docs sem credenciais |
| **8. Homologação** ⏳ | Checklist de homologação com a equipe no `.200` | Equipe aprova. Pasta pronta para você versionar no GitHub e levar à produção |

---

### Observações da execução

- A Fase 3 foi feita direto na interface final, em vez de um protótipo separado. Ela foi validada com capturas de tela em navegador automatizado: desktop, celular, tema claro e escuro.
- **Validado sem número real:**
  - criação da instância e QR Code na interface;
  - webhook interno autenticado;
  - menu, VIP, grupos e mensagens do celular, com eventos simulados;
  - encerramento, PDF e assunto do e-mail;
  - tempo real no navegador.
- **Depende do número de teste e do Gmail, a validar na Fase 8:**
  - envio e recebimento reais;
  - mídia real;
  - e-mail entregue.
- Nos testes, o SVG enviado por usuário como logo foi substituído por PNG, JPG ou WebP (mais seguro). O favicon padrão continua SVG, por ser um arquivo do próprio sistema.

## 15. Testes

- **Unitários**: máquina de estados do bot, montagem do assunto, duração, permissões, bloqueio de login.
- **Integração**: webhooks reais anonimizados (texto, mídia, reação, grupo, `fromMe`), idempotência, encerramento ponta a ponta com SMTP de teste.
- **E2E no navegador**: login, atender, encerrar, conectar.
- **Checklist de homologação** em `docs/` para a equipe.

---

## 16. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Evolution (Baileys) é conexão não oficial e pode sofrer mudanças ou banimento | Versão fixada, eventos brutos guardados, monitor de conexão e QR na interface, limite de envio do bot |
| Mesmo número conectado em dois sistemas gera menus duplicados | Usar número de teste. Na virada, desconectar o número do Chatwoot |
| Perda de eventos se o backend cair | Fila persistente e reprocessamento via `webhook_events` |
| Gmail: limite diário de envio e senha de app revogada | Volume esperado bem abaixo do limite. Outbox com retentativa e alerta na interface |
| Indisponibilidade do MariaDB | Healthcheck, reinício automático, mensagens claras na interface e filas retêm o trabalho pendente |
| Cores personalizadas ilegíveis | Aviso de contraste e botão Restaurar padrão |
| Diferenças entre servidores | Stack autocontida (bancos incluídos), tudo configurável no `.env` e `INSTALACAO.md` testado do zero |
