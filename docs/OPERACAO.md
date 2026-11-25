# Operação

Comandos executados na pasta do projeto.

## Estado dos serviços

```sh
docker compose ps                         # estado e healthcheck de cada container
curl -s http://<BIND_IP>:<HTTP_PORT>/api/health/ready
```

O `/api/health/ready` responde `200` quando banco, Redis e Evolution estão respondendo, e `503` com o componente em erro caso contrário.

## Logs

Os logs são JSON estruturado (um evento por linha), com rotação automática (5 arquivos de 10 MB por container).

```sh
docker compose logs -f backend worker     # acompanhar API e worker
docker compose logs --since 1h backend    # última hora
docker compose logs backend | grep '"level":"error"'
```

Campos principais: `time` (UTC), `level`, `service` (`api`, `worker`, `migrate`, `backup`), `request_id`, `context`, `msg`.

- O `request_id` é gerado pelo nginx do frontend e acompanha a requisição até o backend. Use-o para seguir um problema de ponta a ponta.
- Senhas, tokens, cookies e o token do webhook aparecem como `[REDACTED]`.

### Exemplos de diagnóstico

| Situação | Comando |
|---|---|
| Mensagem do técnico não apareceu | `docker compose logs --since 30m worker \| grep -E 'mensagem recebida\|falhou'` |
| Bot não respondeu | `docker compose logs worker \| grep '"context":"Bot"'` |
| E-mail não chegou | `docker compose logs worker \| grep EmailOutbox` (o erro do SMTP aparece em `err`) |
| Erro na Evolution | `docker compose logs evolution --since 1h` e `docker compose logs backend \| grep '"context":"Evolution"'` |
| Quem fez uma ação | Administração > Auditoria |

## Administradores e dados de teste

```sh
scripts/create-admin.sh      # cria ou redefine um administrador (interativo; a senha aparece como *)
scripts/seed-demo.sh         # carrega contratos e equipamentos FICTÍCIOS (somente testes)
```

O `create-admin.sh` pergunta usuário, nome e senha e repete a pergunta se algo estiver inválido. Para automação, a senha vai pela entrada padrão (nunca como argumento):

```sh
printf '%s\n' "$SENHA" | scripts/create-admin.sh --username joao.silva --name "João Silva" --password-stdin
```

## Eventos do WhatsApp

Os eventos recebidos da Evolution ficam na tabela `webhook_events` por `WEBHOOK_RETENTION_DAYS` dias. Se algum falhou (ex.: banco reiniciando), reprocesse sem risco de duplicar mensagens:

```sh
scripts/reprocess-events.sh            # últimas 24 horas
scripts/reprocess-events.sh --hours 72
```

## Segurança periódica

```sh
scripts/update-digests.sh --check   # há correções novas para as versões fixadas?
scripts/security-scan.sh            # npm audit + Trivy + Gitleaks
```

O Trivy guarda o banco de vulnerabilidades no volume `trivy-cache` (pode ser removido a qualquer momento).

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Aviso "WhatsApp desconectado" | Sessão encerrada no celular ou expirada | Administração > WhatsApp > Gerar QR Code |
| Envio falha com "WhatsApp está desconectado" | Igual ao anterior | Reconectar |
| E-mail com status "falhou" | SMTP sem credenciais, senha de app revogada ou sem destinatários | Conferir `.env` (SMTP_*) e Administração > E-mail; depois **Reenviar** no chamado |
| Mídia "Arquivo indisponível" | O WhatsApp não liberou o download (arquivo antigo ou apagado) | Pedir para o técnico reenviar |
| Contratos não aparecem no encerramento | Catálogo vazio ou banco externo inacessível | Administração > Contratos, ou conferir `CATALOG_DB_*` |
| Tela não atualiza sozinha | WebSocket bloqueado por proxy | O proxy deve repassar `Upgrade`/`Connection` e o `Host` com a porta |
| Usuário bloqueado | 5 senhas erradas | Administração > Usuários > desbloquear |

## Backup

O container `chat_backup` faz backup diário no horário `BACKUP_TIME` e guarda em `./backups`:

- `mariadb_chat_whatsapp_<data>.sql.gz`: banco do sistema;
- `postgres_evolution_<data>.dump`: banco da Evolution.

Backup manual a qualquer momento:

```sh
docker compose exec backup /usr/local/bin/backup.sh once
```

Os volumes `chat-whatsapp_media` (arquivos das conversas) e `chat-whatsapp_evolution_instances` (sessão do WhatsApp) também devem entrar na cópia de segurança do servidor.

## Restauração

> Faça antes um backup do estado atual. A restauração sobrescreve os dados.

Banco do sistema:
```sh
docker compose stop backend worker
gunzip -c backups/mariadb_chat_whatsapp_<data>.sql.gz | \
  docker compose exec -T mariadb sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
docker compose start backend worker
```

Banco da Evolution:
```sh
docker compose stop evolution
docker compose exec -T evolution_db sh -c 'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < backups/postgres_evolution_<data>.dump
docker compose start evolution
```

## Atualizar imagens

A Evolution API e os bancos são referenciados diretamente pelas imagens oficiais fixadas por digest `@sha256` em `docker-compose.yml` e `docker-compose.prod.yml`. Para mudar a versão da Evolution, troque a tag nesses arquivos e atualize o digest:

```sh
scripts/update-digests.sh --check   # mostra se há digest novo para as versões fixadas
scripts/update-digests.sh           # aplica
docker compose build && docker compose up -d
```

Em produção com imagens assinadas do GHCR (`docker-compose.prod.yml`), execute `scripts/deploy.sh --prod` ou atualize `BACKEND_IMAGE`, `FRONTEND_IMAGE` e `BACKUP_IMAGE` no `.env` com as referências imutáveis publicadas pela pipeline na `main`, valide com `cosign verify` e aplique com:

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Atualizar o sistema

```sh
docker compose build
docker compose up -d
```

As migrations do banco são aplicadas automaticamente quando o backend sobe.

### Versão com migration de banco

Quando a versão nova traz migration (arquivo novo em `backend/src/database/migrations/`):

1. Faça um backup manual antes (`docker compose -f docker-compose.prod.yml exec backup /usr/local/bin/backup.sh once`) e confira o arquivo novo em `./backups`.
2. Atualize normalmente. O backend aplica a migration antes de subir; confira com `docker compose -f docker-compose.prod.yml logs backend | grep migration` (deve aparecer `migration aplicada`).
3. Se a migration falhar, o backend não sobe e o erro aparece no mesmo log; os demais containers seguem funcionando.

**Voltar para a versão anterior:** a versão antiga não conhece a migration nova e o backend dela recusa subir (o banco tem uma migration que ela não reconhece). Para voltar, restaure o backup do passo 1 (ver [Restauração](#restauração)) e depois volte as imagens.

## Parar e iniciar

```sh
docker compose stop        # para os containers do projeto (os dados ficam nos volumes)
docker compose start
```

`docker compose down` remove os containers, mas mantém os volumes. **Nunca** use `docker compose down -v` em produção: isso apaga os bancos e a sessão do WhatsApp.
