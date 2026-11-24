# Central de Atendimento WhatsApp

Helpdesk de atendimento via WhatsApp, com caixas de entrada independentes (um número de WhatsApp por caixa, por exemplo Suporte e Compras):

- **chat web** para a equipe: responder, reagir, encaminhar, apagar, enviar e receber arquivos, grupos, novas conversas e mensagens enviadas pelo celular;
- **menu automático** de classificação no primeiro contato, exceto para contatos VIP e grupos;
- **chamados** com um único responsável, mas qualquer atendente pode responder;
- **encerramento** com contrato e equipamento, que envia um e-mail com o resumo e o histórico em PDF;
- **conexão do WhatsApp pela própria interface**, por QR Code ou código de pareamento;
- **aparência configurável**: nome do sistema, cores, modais, tamanho do texto e logos. Nada da marca fica fixo no código;
- **permissões por grupo**: cada grupo define quais páginas e ações seus membros acessam.

O sistema é independente e autocontido. Tudo roda em Docker e é configurado pelo arquivo `.env`.

## Componentes

| Serviço (nome usado nos comandos) | Container (padrão) | Função |
|---|---|---|
| frontend | `chat_wpp_frontend` | Interface web (React) e proxy para a API. **Único serviço com porta publicada** |
| backend | `chat_wpp_backend` | API, WebSocket e webhook interno da Evolution |
| worker | `chat_wpp_worker` | Filas: eventos do WhatsApp, mídia, PDF e e-mail |
| mariadb | `chat_wpp_mariadb` | Banco do sistema (`chat_whatsapp`) |
| redis | `chat_wpp_redis` | Sessões, filas e tempo real |
| evolution | `chat_wpp_evolution` | Conexão com o WhatsApp (Evolution API v2.3.7 oficial) |
| evolution_db | `chat_wpp_evolution_db` | Banco exclusivo da Evolution (PostgreSQL) |
| backup | `chat_wpp_backup` | Backup diário dos dois bancos em `./backups` |

## Instalação rápida

```sh
scripts/init-env.sh --bind-ip <IP_DO_SERVIDOR> --port 8870   # cria o .env e gera os segredos
# edite o .env: SMTP_USER e SMTP_PASSWORD (senha de app do Gmail)
docker compose up -d --build
scripts/create-admin.sh                                      # cria o primeiro administrador
```

Depois:

1. acesse `http://<IP_DO_SERVIDOR>:8870`;
2. conecte o WhatsApp em **Administração > WhatsApp**;
3. cadastre os destinatários em **Administração > E-mail**.

O passo a passo completo está em [docs/INSTALACAO.md](docs/INSTALACAO.md).

## Scripts

| Script | Para quê |
|---|---|
| `scripts/deploy.sh` | Assistente interativo de implantação (`docker-compose.prod.yml` ou `docker-compose.yml`), gerando senhas/tokens aleatórios |
| `scripts/init-env.sh` | Cria o `.env` com todos os segredos gerados |
| `scripts/create-admin.sh` | Cria ou redefine um administrador (senha digitada sem aparecer) |
| `scripts/seed-demo.sh` | Carrega contratos e equipamentos **fictícios** para testes |
| `scripts/reprocess-events.sh` | Reprocessa eventos do WhatsApp que falharam |
| `scripts/update-digests.sh` | Atualiza os digests `@sha256` das imagens |
| `scripts/security-scan.sh` | npm audit, Trivy e Gitleaks |

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/MANUAL_USUARIO.md](docs/MANUAL_USUARIO.md) | Como atender e como administrar |
| [docs/INSTALACAO.md](docs/INSTALACAO.md) | Instalação em um servidor novo |
| [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md) | Variáveis de ambiente (sem valores) |
| [docs/OPERACAO.md](docs/OPERACAO.md) | Logs, backup, restauração, atualização, solução de problemas |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Componentes, fluxos e modelo de dados |
| [docs/API.md](docs/API.md) | Rotas da API e eventos em tempo real |
| [docs/SEGURANCA.md](docs/SEGURANCA.md) | Medidas de segurança aplicadas e pipelines DevSecOps |
| [docs/CHECKLIST_HOMOLOGACAO.md](docs/CHECKLIST_HOMOLOGACAO.md) | Roteiro de testes com a equipe |
| [SECURITY.md](SECURITY.md) | Política de divulgação responsável e verificação Cosign |

## Produção com imagens assinadas no GHCR

Para implantar em produção (ou localmente) de forma guiada, com geração automática de senhas/tokens aleatórios e validação opcional via Cosign, execute:

```sh
scripts/deploy.sh
```

Ou manualmente com [docker-compose.prod.yml](docker-compose.prod.yml), definindo `BACKEND_IMAGE`, `FRONTEND_IMAGE` e `BACKUP_IMAGE` no `.env` com os digests `@sha256` publicados pela pipeline DevSecOps:

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

As imagens são multi-arquitetura (`linux/amd64` e `linux/arm64`), assinadas com **Cosign (keyless OIDC)** e acompanhadas de **SBOM CycloneDX**. Veja [SECURITY.md](SECURITY.md) para validar as assinaturas antes do deploy.

## Licença

Este projeto é distribuído sob a **Licença MIT** (veja o texto oficial em [LICENSE](LICENSE)). Em resumo: você pode usar, copiar, modificar e distribuir o software livremente, desde que mantenha o aviso de direitos autorais e da licença, sem garantias expressas ou implícitas.

## Desenvolvimento

```sh
cd backend && npm ci && npm run build && npm test   # testes das regras críticas
cd frontend && npm ci && npm run build
```

O build da imagem do backend roda os testes automaticamente e falha se algum teste não passar.

## Regras do repositório

- O arquivo `.env` **nunca** é versionado (já está no `.gitignore`). Use `.env.example` como modelo.
- Nenhum documento deve conter senhas, tokens ou chaves reais.
- Toda imagem Docker é fixada por versão **e** digest `@sha256`. Atualize com `scripts/update-digests.sh`.
