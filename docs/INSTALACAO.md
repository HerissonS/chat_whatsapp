# Instalação

Instalação do sistema em um servidor novo. A stack é autocontida (bancos incluídos) e não altera nenhum container existente.

## Pré-requisitos

- Linux com Docker Engine e Docker Compose v2.
- `openssl` (usado para gerar os segredos).
- Acesso à internet a partir do servidor (WhatsApp, Gmail e registro de imagens Docker).
- Uma porta livre para publicar a interface (padrão `8870`).
- Recursos mínimos sugeridos: 2 vCPU e 4 GB de RAM livres.

## Passo a passo

1. **Copie a pasta do projeto** para o servidor (o nome da pasta pode ser qualquer um).

2. **Gere o `.env`** com todos os segredos:
   ```sh
   scripts/init-env.sh --bind-ip <IP_DO_SERVIDOR> --port 8870
   ```
   - O script não exibe nenhum segredo e cria o arquivo com permissão `600`.
   - Ele não sobrescreve um `.env` existente.
   - `--bind-ip 127.0.0.1` deixa o sistema acessível só pelo próprio servidor (útil atrás de um proxy reverso local).

3. **Configure o e-mail**: edite o `.env` e preencha `SMTP_USER` (conta Gmail) e `SMTP_PASSWORD` (senha de app do Gmail, não a senha normal da conta).

4. **Suba a stack**:
   ```sh
   docker compose up -d --build
   ```
   A primeira inicialização leva cerca de 1 a 2 minutos (a Evolution cria o próprio banco).

5. **Confira** se todos os containers estão `healthy`:
   ```sh
   docker compose ps
   ```

6. **Crie o primeiro administrador** (a senha é digitada sem aparecer na tela):
   ```sh
   scripts/create-admin.sh
   ```

7. **Acesse** `http://<IP_DO_SERVIDOR>:<PORTA>` e entre com o administrador.

8. **Configure pela interface:**
   - **Administração > WhatsApp:** gere o QR Code e leia com o celular do número de atendimento.
   - **Administração > E-mail:** cadastre os destinatários e envie um e-mail de teste.
   - **Administração > Contratos:** importe o CSV de contratos e equipamentos (ou use um banco externo, ver [CONFIGURACAO.md](CONFIGURACAO.md)).
   - **Administração > Usuários:** crie os operadores. Cada um troca a senha no primeiro acesso.

Para testar sem dados reais, `scripts/seed-demo.sh` carrega contratos e equipamentos fictícios.

## HTTPS e proxy reverso

Para acesso externo, publique o sistema atrás de um proxy reverso com TLS (nginx, Nginx Proxy Manager etc.):

- aponte o proxy para `http://<BIND_IP>:<HTTP_PORT>`;
- encaminhe também o WebSocket (cabeçalhos `Upgrade` e `Connection`) do caminho `socket.io/`;
- defina `COOKIE_SECURE=true` no `.env` e reinicie com `docker compose up -d`;
- o sistema funciona na raiz do domínio ou em um subcaminho (ex.: `/chat-whatsapp/`), porque o frontend usa caminhos relativos. Em subcaminho, o proxy deve remover o prefixo antes de repassar.

