# Configuração (variáveis de ambiente)

Todas as variáveis ficam no arquivo `.env` na raiz do projeto, criado por `scripts/init-env.sh` a partir do `.env.example`.
Este documento descreve as variáveis, **sem valores reais**.

Variáveis marcadas como **gerada** recebem um segredo aleatório (64 caracteres hexadecimais) na criação do `.env`.
Não altere as senhas de banco depois que os bancos foram criados: os volumes continuariam com a senha antiga.

## Publicação

| Variável | Padrão | Descrição |
|---|---|---|
| `BIND_IP` | `127.0.0.1` | IP do servidor em que a interface é publicada |
| `HTTP_PORT` | `8870` | Porta publicada |
| `COOKIE_SECURE` | `false` | `true` quando o acesso for por HTTPS |
| `TRUST_PROXY` | `loopback, 172.16.0.0/12` | Proxies confiáveis para identificar o IP real (só a rede do Docker). Inclua o IP de um proxy reverso externo, se houver |

## Geral

| Variável | Padrão | Descrição |
|---|---|---|
| `APP_VERSION` | `0.1.0` | Tag das imagens do projeto |
| `TZ` | `America/Sao_Paulo` | Fuso horário de exibição (o banco grava em UTC) |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` ou `trace` |
| `HOST_UID` / `HOST_GID` | usuário que rodou o init | Dono dos arquivos de backup |

## Banco do sistema (MariaDB)

| Variável | Padrão | Descrição |
|---|---|---|
| `MARIADB_ROOT_PASSWORD` | gerada | Senha root, só para manutenção |
| `DB_NAME` | `chat_whatsapp` | Nome do banco |
| `DB_USER` | `chat_app` | Usuário da aplicação (acesso só ao banco do sistema) |
| `DB_PASSWORD` | gerada | Senha do usuário da aplicação |

## Banco da Evolution (PostgreSQL)

| Variável | Padrão | Descrição |
|---|---|---|
| `EVO_DB_NAME` | `evolution` | Nome do banco |
| `EVO_DB_USER` | `evolution` | Usuário |
| `EVO_DB_PASSWORD` | gerada | Senha |

## Redis

| Variável | Padrão | Descrição |
|---|---|---|
| `REDIS_PASSWORD` | gerada | Senha do Redis (usada pelo sistema e pela Evolution) |

## Evolution API

| Variável | Padrão | Descrição |
|---|---|---|
| `EVOLUTION_API_KEY` | gerada | Chave global da Evolution. Fica só no backend, nunca chega ao navegador |
| `EVOLUTION_INSTANCE` | `principal` | Nome da instância do WhatsApp |
| `WEBHOOK_TOKEN` | gerada | Token secreto do webhook interno |

## Login e sessões

| Variável | Padrão | Descrição |
|---|---|---|
| `SESSION_SECRET` | gerada | Segredo usado para proteger os identificadores de sessão no Redis |
| `SESSION_IDLE_MINUTES` | `720` | Minutos sem uso até a sessão expirar |
| `SESSION_MAX_HOURS` | `168` | Duração máxima de uma sessão, mesmo em uso |
| `LOGIN_MAX_FAILURES` | `5` | Senhas erradas seguidas até bloquear o usuário |
| `LOGIN_LOCK_MINUTES` | `15` | Tempo de bloqueio |
| `PASSWORD_MIN_LENGTH` | `8` | Tamanho mínimo das senhas (também exigem letras e números) |

## E-mail

| Variável | Padrão | Descrição |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | Servidor SMTP |
| `SMTP_PORT` | `465` | Porta (465 com TLS direto) |
| `SMTP_SECURE` | `true` | TLS direto |
| `SMTP_USER` | vazio | Conta de envio |
| `SMTP_PASSWORD` | vazio | Senha de app do Gmail |
| `SMTP_FROM_NAME` | vazio | Nome exibido como remetente. Vazio usa o nome do sistema (Aparência) |

Os **destinatários** dos e-mails de encerramento são configurados na interface, não no `.env`.

## Mídia e backup

| Variável | Padrão | Descrição |
|---|---|---|
| `MEDIA_MAX_MB` | `100` | Tamanho máximo de arquivo enviado ou recebido |
| `WEBHOOK_RETENTION_DAYS` | `30` | Dias que os eventos brutos do webhook ficam guardados |
| `BACKUP_TIME` | `02:30` | Horário do backup diário |
| `BACKUP_RETENTION_DAYS` | `14` | Dias que os backups ficam guardados |

## Catálogo externo (opcional)

Usado apenas nos caixas de entrada configurados com a fonte **Banco externo** (Administração > Caixas de entrada). O formato esperado é: tabela `contracts` (`name`) e tabela `equipament` (`contrato`, `codigo`, `equip_type`, `ativo`).

| Variável | Descrição |
|---|---|
| `CATALOG_DB_HOST` / `CATALOG_DB_PORT` | Endereço do MariaDB/MySQL externo |
| `CATALOG_DB_NAME` | Nome do banco |
| `CATALOG_DB_USER` / `CATALOG_DB_PASSWORD` | Usuário **somente leitura** (SELECT nessas duas tabelas) |

Se o servidor do banco externo não estiver na mesma rede, ele precisa ser alcançável a partir do container `chat_backend`.

Depois de alterar o `.env`, aplique com `docker compose up -d`.
