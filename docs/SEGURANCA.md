# Segurança

## Autenticação e sessões

| Medida | Detalhe |
|---|---|
| Senhas | argon2id (19 MiB, 2 iterações). Mínimo de 8 caracteres (configurável) com letras e números, sem conter o usuário |
| Primeiro acesso | Troca de senha obrigatória. Não existe usuário ou senha padrão: o primeiro administrador é criado por `scripts/create-admin.sh` |
| Força bruta | Bloqueio do usuário após 5 erros (15 min). Limite por IP no backend (20 a cada 15 min) e no nginx (10 por minuto) |
| Resposta de erro | Mensagem genérica e tempo constante, mesmo para usuário inexistente |
| Sessão | Cookie `HttpOnly` e `SameSite=Strict`, além de `Secure` com `COOKIE_SECURE=true`. Id aleatório de 256 bits; no Redis fica só o HMAC do id |
| Expiração | Por inatividade (12 h) e duração máxima (7 dias), configuráveis |
| Revogação | Logout, troca de senha, desativação, mudança de perfil e redefinição de senha encerram as sessões e derrubam o WebSocket |
| CSRF | Token por sessão exigido no cabeçalho `X-CSRF-Token` em toda alteração, além do `SameSite=Strict` |
| Permissões | Guarda global: toda rota exige login, exceto as marcadas como públicas. Administrador tem acesso total; os demais usuários têm a soma das permissões dos seus grupos, conferidas no backend a cada requisição |
| Escalada de privilégio | Quem gerencia usuários sem ser Administrador não cria nem edita Administradores, só concede permissões e caixas de entrada que ele próprio tem |
| Caixas de entrada | Cada usuário só vê conversas, contatos, mídias e configurações das caixas em que está |
| WebSocket | Mesmo cookie de sessão, verificação de origem e revalidação a cada 5 minutos |

## Segredos

- Todos os segredos ficam só no `.env` (permissão `600`, fora do controle de versão), gerados por `scripts/init-env.sh` com 256 bits.
- A senha do Redis é passada ao servidor pela entrada padrão, não pela linha de comando.
- A apikey da Evolution fica só no backend. A apikey que a Evolution envia no corpo do webhook é descartada antes de gravar.
- O token do webhook vai num cabeçalho (`x-webhook-token`), não na URL, e é comparado em tempo constante.
- A configuração é validada na inicialização. Em caso de erro, só o nome da variável aparece, nunca o valor.
- `scripts/security-scan.sh` roda o Gitleaks para encontrar segredos esquecidos no código e na documentação.
- O `.gitignore` impede versionar `.env`, chaves e certificados, backups e dumps de banco (`*.sql*`, `*.dump`), `docker-compose.override.yml` local e arquivos de editor.

## Imagens e containers

| Medida | Aplicação |
|---|---|
| Versão e digest fixos | Todas as imagens base (`tag@sha256:...`) |
| Alpine | Todas, exceto o MariaDB (a imagem oficial não tem variante Alpine) |
| Atualizações de segurança | `apk upgrade` nas imagens próprias construídas (`backend`, `frontend`, `backup`). A pipeline passa a data do build (`APK_REFRESH`), o que força essa etapa a rodar de novo a cada dia em vez de reaproveitar o cache |
| Testes no build | A imagem do backend só é gerada se os testes passarem |
| Contexto de build mínimo | Cada `.dockerignore` bloqueia tudo e libera só os arquivos usados no build; o `.env` (na raiz) nunca entra em nenhuma imagem |
| Usuário não root | backend e worker (`node`), frontend (`nginx`), backup (`1000:1000`), Redis, MariaDB, PostgreSQL |
| Sistema de arquivos só leitura | Todos, exceto a Evolution |
| `cap_drop: ALL` e `no-new-privileges` | Todos os containers |
| Limites de CPU e memória | Todos os containers |
| Superfície mínima | Sem npm, npx, yarn e corepack na imagem final do backend. Sem curl no frontend. Sem gosu na imagem de backup |
| Supply Chain (GHCR + Cosign) | Imagens próprias multi-arch (`amd64`/`arm64`) publicadas por SHA/digest imutável, assinadas com Cosign keyless (Sigstore OIDC) e com SBOM CycloneDX atestado |

A Evolution roda como root dentro do container, por limitação da imagem oficial. Ela fica sem capabilities, sem porta publicada e sem acesso de navegadores.

### Risco residual da Evolution (imagem oficial)

A Evolution é a única imagem de terceiros que o projeto não reconstrói. Ela é usada como publicada pelo fornecedor (versão e digest fixos), sem `apk upgrade`, e por isso herda as pendências do fornecedor:

- **Pacotes do sistema (Alpine):** a última varredura apontou cerca de 56 pacotes com vulnerabilidades corrigidas upstream, ainda não atualizados na imagem oficial;
- **Bibliotecas Node:** dependências do próprio código da Evolution.

Não publicamos imagem derivada da Evolution, por decisão de não distribuir imagens de terceiros a partir deste repositório. As mitigações são:

- só redes `internal` (bancos e backend) e `egress` (saída para o WhatsApp); nenhuma porta publicada e nenhum acesso de navegadores;
- `cap_drop: ALL`, `no-new-privileges` e limites de CPU e memória;
- apikey global conhecida só pelo backend;
- auditoria diária da pipeline e Dependabot (somente versões *patch*) para adotar correções assim que o fornecedor publicar.

Quem precisar zerar as pendências de pacotes do sistema pode, por conta própria, construir localmente uma imagem com `apk upgrade` e referenciá-la num `docker-compose.override.yml` (ignorado pelo Git), sem publicá-la.

## Rede

| Rede | Tipo | Quem participa |
|---|---|---|
| `chat-whatsapp_public` | bridge | frontend e backend |
| `chat-whatsapp_internal` | **internal** (sem internet) | MariaDB, PostgreSQL, Redis, Evolution, backend, worker, backup |
| `chat-whatsapp_egress` | bridge | Evolution (WhatsApp) e worker (SMTP) |

- Só o frontend publica porta.
- O nginx encaminha apenas `/api/` e `/socket.io/`. O webhook (`/webhook/`) não é alcançável de fora.

## HTTP e conteúdo

- **Cabeçalhos de segurança:**
  - CSP restritiva: só recursos do próprio servidor, sem scripts inline e sem iframes;
  - `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` e COOP.
- **nginx:** versão oculta, arquivos ocultos bloqueados, limite de requisições por IP e `Upgrade` restrito exclusivamente a `websocket` (mitigação contra *H2C smuggling*).
- **Textos recebidos:** a formatação do WhatsApp é aplicada sem HTML. Os links abrem em nova aba com `noopener noreferrer`.
- **Arquivos enviados:**
  - tamanho limitado (`MEDIA_MAX_MB`) e tipo identificado pelo conteúdo real, não pela extensão;
  - gravados com nome aleatório;
  - nome original sanitizado contra caminhos e caracteres inválidos.
- **Arquivos servidos:**
  - só para usuários do caixa de entrada;
  - imagens, vídeos e áudios aparecem na página; os demais tipos sempre como download;
  - `Content-Security-Policy: sandbox` e `nosniff`.
- **Logos:** só PNG, JPG ou WebP de até 2 MB, conferidos pelo conteúdo. SVG enviado por usuário não é aceito.
- **Fotos de perfil:** o backend baixa uma cópia local, porque a CSP não permite imagens de outros domínios.
  - só por HTTPS e de servidores `*.whatsapp.net`, sem seguir redirecionamentos;
  - até 1 MB, tipo conferido pelo conteúdo;
  - no máximo 3 downloads simultâneos e uma busca por contato por vez.

## Banco de dados

- O usuário da aplicação (`chat_app`) acessa só o banco `chat_whatsapp`.
- Todas as queries são parametrizadas (Kysely). Não há SQL montado com texto do usuário.
- A criação de chamados usa trava de linha (`SELECT ... FOR UPDATE`), o que evita chamados duplicados com envios simultâneos.
- O catálogo externo, quando usado, exige um usuário **somente leitura**.

## Logs e auditoria

- Logs em JSON com `request_id`.
- Redação automática de senhas, tokens, cookies, apikey e hashes. Telefones nas URLs da Evolution aparecem mascarados. O conteúdo das mensagens não vai para os logs.
- A auditoria registra:
  - logins (sucesso, falha, bloqueio);
  - gestão de usuários;
  - VIP;
  - atribuição e encerramento de chamados;
  - mensagens apagadas;
  - conexão do WhatsApp;
  - alterações de configuração e aparência.

## Resultado da última varredura (`scripts/security-scan.sh`)

| Item | Resultado |
|---|---|
| npm audit (produção) | 0 vulnerabilidades |
| Imagens backend, frontend, backup, Redis | 0 HIGH/CRITICAL corrigíveis |
| Evolution (imagem oficial v2.3.7) | Pendências upstream do fornecedor: pacotes Alpine (cerca de 56) e bibliotecas Node. Mitigadas conforme [Risco residual da Evolution](#risco-residual-da-evolution-imagem-oficial) |
| MariaDB / PostgreSQL | Apenas o `gosu` (Go antigo), que não é executado porque os containers rodam com usuário fixo |
| Gitleaks | Nenhum segredo encontrado |

## Pipelines DevSecOps (GitHub Actions)

Todas as pipelines operam com `permissions: {}` no nível global (menor privilégio por job), Actions pinadas por commit SHA de 40 caracteres, `persist-credentials: false`, sem upload SARIF (100% compatível com conta gratuita) e relatórios consolidados no GitHub Actions Job Summary:

- **CI/CD & Supply Chain (`.github/workflows/devsecops-pipeline.yml`):** em PRs para `dev` e `main` e merges na `main`, executa em cadeia: Gitleaks (árvore atual e commits do PR) + testes unitários → Semgrep (SAST) → Trivy FS + CycloneDX (SCA & SBOM) → Trivy Config + Hadolint (Misconfiguration) → Build & Trivy Image + SBOM. No merge na `main`, constrói e publica as 3 imagens próprias (`backend`, `frontend`, `backup`) em multi-arquitetura (`linux/amd64`, `linux/arm64`) no GHCR com tag baseada em SHA, assina com **Cosign keyless (Sigstore OIDC)** pelo digest `@sha256`, atesta o SBOM CycloneDX e valida com `cosign verify`. O comentário consolidado só é publicado em PRs do próprio repositório; em PRs do Dependabot e de forks (token somente leitura), o relatório fica no Job Summary.
- **Auditoria Diária (`.github/workflows/daily-security-audit.yml`):** roda diariamente verificando novas CVEs em dependências e imagens (GHCR e terceiros), pacotes `npm` desatualizados e novos digests `@sha256` (compose, Dockerfiles, scripts e workflows), abrindo/atualizando automaticamente uma única Issue consolidada (`security-audit`).
- **Exceções do Trivy (`.trivyignore`):** só `DS-0026` (HEALTHCHECK no Dockerfile), porque a verificação de saúde é feita por serviço no docker-compose. Cada exceção fica justificada no arquivo.
- **Dependabot (`.github/dependabot.yml`):** abre PRs semanais para `npm`, `docker` (Dockerfiles), `docker-compose` e `github-actions` direcionados à branch `dev`. No compose, ignora versões *major* de PostgreSQL e MariaDB (exigem migração de dados) e aceita só *patch* da Evolution.

## Recomendações para produção

- Publicar atrás de proxy com TLS e definir `COOKIE_SECURE=true`. Configurar HSTS no proxy.
- Restringir `BIND_IP` ao endereço interno ou a `127.0.0.1` quando houver proxy local.
- Rodar `scripts/update-digests.sh --check` e `scripts/security-scan.sh` mensalmente.
- Incluir `./backups` e os volumes `chat-whatsapp_media` e `chat-whatsapp_evolution_instances` na cópia de segurança do servidor.
