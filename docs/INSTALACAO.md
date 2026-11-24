# Instalação

Instalação do sistema em um servidor novo. A stack é autocontida (bancos incluídos), compatível com **x86_64 (`linux/amd64`) e ARM64 (`linux/arm64`)**, e não altera nenhum container existente.

## Pré-requisitos

- Linux com Docker Engine e Docker Compose v2.
- `openssl` (usado para gerar os segredos aleatórios).
- Acesso à internet a partir do servidor (WhatsApp, Gmail e registro de imagens GHCR/Docker Hub).
- Uma porta livre para publicar a interface (padrão `8870`).
- Recursos mínimos sugeridos: 2 vCPU e 4 GB de RAM livres.
- *(Opcional, recomendado em produção)* `cosign` instalado para validar a assinatura digital das imagens antes do `pull`.

---

## Opção 1 — Produção com imagens assinadas no GHCR (Recomendado)

Não precisa compilar código no servidor: basta baixar as imagens multi-arquitetura já construídas, escaneadas e assinadas pela pipeline DevSecOps.

1. **Baixe o projeto** no servidor novo:
   ```sh
   git clone https://github.com/HerissonS/chat_whatsapp.git
   cd chat_whatsapp
   ```
   *(Se preferir um servidor mínimo sem código-fonte, copie apenas `docker-compose.prod.yml`, `.env.example`, `scripts/deploy.sh` e `scripts/create-admin.sh`.)*

2. **Execute o assistente de implantação em modo produção:**
   ```sh
   scripts/deploy.sh --prod
   ```
   - Gera automaticamente todas as 7 senhas e tokens aleatórios de 256 bits no `.env` (permissão `600`, sem exibir na tela).
   - Solicita IP de publicação, porta, HTTPS (`COOKIE_SECURE`), SMTP opcional e as 3 referências imutáveis (`BACKEND_IMAGE`, `FRONTEND_IMAGE` e `BACKUP_IMAGE`) geradas no **Relatório de Segurança** do último merge na branch `main`.
   - Oferece verificação automática com `cosign verify` (se `cosign` estiver instalado) antes de executar `pull` e `up -d`.

3. **Confira** se todos os containers estão `healthy` (a primeira inicialização leva cerca de 1 a 2 minutos):
   ```sh
   docker compose -f docker-compose.prod.yml ps
   ```

4. **Crie o primeiro administrador** (a senha é digitada sem aparecer na tela):
   ```sh
   scripts/create-admin.sh
   ```

5. **Acesse** `http://<IP_DO_SERVIDOR>:<PORTA>`, entre com o administrador e configure pela interface:
   - **Administração > WhatsApp:** gere o QR Code e leia com o celular do número de atendimento.
   - **Administração > E-mail:** cadastre os destinatários e envie um e-mail de teste.
   - **Administração > Contratos:** importe o CSV de contratos e equipamentos (ou use um banco externo, ver [CONFIGURACAO.md](CONFIGURACAO.md)).
   - **Administração > Usuários:** crie os operadores. Cada um troca a senha no primeiro acesso.

---

## Opção 2 — Ambiente local / build a partir do código-fonte

Para desenvolvimento ou homologação construindo as imagens localmente:

```sh
scripts/deploy.sh --local
scripts/create-admin.sh
```

Ou manualmente:

```sh
scripts/init-env.sh --bind-ip <IP_DO_SERVIDOR> --port 8870
# edite o .env se quiser configurar SMTP_USER e SMTP_PASSWORD
docker compose up -d --build
scripts/create-admin.sh
```

Para testar sem dados reais, `scripts/seed-demo.sh` carrega contratos e equipamentos fictícios.

---

## HTTPS e proxy reverso

Para acesso externo, publique o sistema atrás de um proxy reverso com TLS (nginx, Nginx Proxy Manager, Traefik, Caddy etc.):

- aponte o proxy para `http://<BIND_IP>:<HTTP_PORT>`;
- encaminhe também o WebSocket (cabeçalhos `Upgrade` e `Connection`) do caminho `socket.io/`;
- defina `COOKIE_SECURE=true` no `.env` (e inclua o IP do proxy em `TRUST_PROXY` se for externo) e reaplique com `docker compose -f docker-compose.prod.yml up -d` (ou `docker compose up -d`);
- o sistema funciona na raiz do domínio ou em um subcaminho (ex.: `/chat-whatsapp/`), porque o frontend usa caminhos relativos. Em subcaminho, o proxy deve remover o prefixo antes de repassar.
