# Manual do usuário

## Acesso

- Entre com usuário e senha. No primeiro acesso, o sistema pede para trocar a senha temporária.
- Depois de 5 senhas erradas seguidas, o usuário fica bloqueado por 15 minutos. Um administrador pode desbloquear antes.
- O ícone no canto inferior esquerdo alterna o tema: claro, escuro ou automático (segue o computador).
- **Tamanho do texto:** no menu do seu avatar, escolha Padrão, A, A+ ou A++. Vale só para você.
- No menu do seu avatar: **Trocar senha** e **Sair**.
- A bolinha acima do tema mostra o WhatsApp: verde (conectado), amarela (conectando) ou vermelha (desconectado).

## Início

A tela inicial resume o atendimento. O período (Hoje, 7 dias ou 30 dias) fica no canto superior direito.

- **Agora:** chamados em aberto (individuais e grupos), aguardando menu, sem responsável, os seus e as conversas com mensagens não lidas. Clique em um cartão para abrir a lista correspondente.
- **No período:**
  - tempo médio de 1ª resposta e % respondidos em até 15 minutos, sempre **sem grupos** e contados do primeiro contato do técnico até a primeira mensagem de um atendente (o bot não conta);
  - duração média, chamados aguardando resposta, abertos, encerrados, mensagens e e-mails com falha.
- **Gráficos:** chamados por dia e por classificação.
- **Tabela por atendente:** encerramentos e tempo médio de 1ª resposta de cada um.

Os números se atualizam sozinhos.

## Caixas de entrada

Cada **caixa de entrada** tem o seu próprio número de WhatsApp, menu do bot, textos e destinatários de e-mail (por exemplo, Suporte e Compras). Você vê apenas as conversas das caixas em que está.

- Quando você está em mais de uma caixa, a lista de conversas ganha o seletor **Todas as caixas de entrada**, e cada conversa mostra a caixa a que pertence.
- Na **Nova conversa**, escolha por qual caixa (qual WhatsApp) a conversa vai sair.
- O Início também pode ser filtrado por caixa.

## Atendimento

### Lista de conversas
| Aba | Mostra |
|---|---|
| Minhas | Chamados abertos atribuídos a você |
| Não atribuídas | Chamados abertos sem responsável |
| Aguardando menu | Contatos que ainda não escolheram a opção do menu |
| Todas | Todos os chamados abertos |
| Grupos | Conversas de grupos |
| Encerradas | Conversas cujo último chamado foi encerrado |

- **Buscar** por nome ou telefone: clique na busca ou use `Ctrl+K`.
- **Nova conversa:** botão **+**. Pesquise o contato na agenda do WhatsApp pelo nome ou número, ou digite um número completo, com DDI e DDD.
- **Fechar a conversa:** botão **X** no topo da conversa ou tecla `Esc`.
- Para receber avisos com o navegador minimizado, clique no sino e permita as notificações.

### Conversando
- `Enter` envia e `Shift+Enter` quebra a linha. Funciona a formatação do WhatsApp: `*negrito*`, `_itálico_`, `~riscado~`.
- **Arquivos:** use o clipe, arraste para a conversa ou cole uma imagem com `Ctrl+V`. O texto digitado vai como legenda.
- **Figurinhas:** o botão de figurinha ao lado do clipe mostra as figurinhas recentes (recebidas ou enviadas); clique para enviar. Para transformar uma imagem em figurinha, anexe a imagem e marque **Enviar como figurinha**.
- **Ver imagens e fotos de perfil:** clique na imagem da conversa ou na foto do contato. A imagem abre na própria página; feche com o **X**, com `Esc` ou clicando fora dela. O botão de download baixa o arquivo original.
- **Ações da mensagem** (aparecem ao passar o mouse sobre ela):

| Ação | O que faz |
|---|---|
| Responder | Cita a mensagem na sua resposta |
| Reagir | Envia um emoji de reação. Clique de novo no mesmo emoji para remover |
| Encaminhar | Envia a mensagem para até 10 conversas |
| Copiar | Copia o texto |
| Apagar | Apaga para todos. Só vale para mensagens enviadas pelo suporte |

- **Quem enviou:** cada mensagem do suporte mostra o nome do atendente, "Mensagem automática" (bot) ou "Enviada pelo celular".
- **Nome do atendente para o técnico:** conforme a configuração do setor, ele recebe seu nome em negrito antes do texto.

### Chamados
- Quando um técnico manda a primeira mensagem, ele recebe o menu. A opção escolhida classifica o chamado.
- **Responsável:** use o botão **Sem responsável / nome** no topo para atribuir a você ou a outro atendente. Qualquer atendente pode responder, mas o chamado tem um único responsável. Se ninguém foi atribuído, quem responder primeiro vira o responsável.
- **Encerrar:**
  1. Clique em **Encerrar** e informe o **Contrato** (obrigatório). Digite para pesquisar.
  2. Escolha o **Equipamento** (opcional): só aparecem os equipamentos do contrato escolhido, e dá para pesquisar pelo código.
  3. Confira a **Classificação** e o assunto do e-mail.
  4. Clique em **Confirmar encerramento**.
- **Depois de encerrar:**
  - o técnico recebe a mensagem de encerramento;
  - o e-mail com o PDF da conversa é enviado aos destinatários configurados;
  - a próxima mensagem do técnico abre um novo chamado, com o menu.

### Painel do contato (lado direito)
- **Editar o nome** pelo lápis. O nome do WhatsApp continua visível abaixo.
- **Contato VIP:** não recebe o menu automático.
- **Chamados anteriores:** baixe o PDF de cada um e acompanhe o envio do e-mail. Se falhou, use **Reenviar**.

## Administração (perfil Administrador)

| Seção | Para quê |
|---|---|
| WhatsApp | Conectar o número por QR Code ou código de pareamento, desconectar, reiniciar, **importar contatos** (também é feito automaticamente 1 minuto depois de conectar) |
| Usuários | Criar usuários (senha temporária), escolher o perfil (Administrador ou Usuário), as caixas de entrada e os grupos, redefinir senha, desbloquear, desativar |
| Grupos | Definir quais páginas e ações cada grupo acessa (Início, Atendimento e cada tela da Administração) e quem faz parte dele |
| Caixas de entrada | Criar caixas (cada uma ganha a sua instância do WhatsApp), nome do atendente nas mensagens, menu ligado ou desligado, tentativas inválidas, mensagens de encerramento, fonte do catálogo |
| Bot e menu | Por caixa de entrada: opções do menu (número, texto no menu, texto no assunto, padrão) e textos automáticos, com pré-visualização |
| E-mail | Por caixa de entrada: destinatários dos encerramentos e e-mail de teste |
| Contratos | Contratos extras (ex.: CHAMADO INTERNO), catálogo de contratos e equipamentos, importação CSV |
| Aparência | Cores dos temas claro e escuro, modais, fonte, **tamanho do texto padrão**, nome do sistema e logos (com aviso de contraste e botão **Restaurar padrão**). Sem logo enviado, o sistema mostra o nome em texto |
| Auditoria | Quem fez o quê e quando |

### Perfis e permissões
- **Administrador:** acesso total, sempre.
- **Usuário:** acessa o que os **grupos** dele permitem. Um usuário pode estar em vários grupos, e as permissões se somam. Sem grupo, ele entra, mas não vê nenhuma página.
- **Gestão de usuários por quem não é Administrador:**
  - não pode criar nem editar Administradores;
  - só concede permissões e caixas de entrada que ele próprio tem.
- **Alterações de grupo ou caixa:** valem na hora; a tela do usuário se atualiza sozinha.

### Nova caixa de entrada (outro WhatsApp)
1. Administração > **Caixas de entrada** > **Nova caixa de entrada** (ex.: Compras).
2. Administração > **WhatsApp**: a nova caixa aparece; gere o QR Code e leia com o celular do outro número.
3. Administração > **Bot e menu** e **E-mail**: escolha a caixa e ajuste o menu e os destinatários.
4. Administração > **Usuários**: inclua a caixa nos usuários que vão atendê-la.

### Importar equipamentos (CSV)
Arquivo em UTF-8 com as colunas `contrato;codigo;tipo` (o tipo é opcional). A primeira linha pode ser o cabeçalho. Por exemplo:

```
contrato;codigo;tipo
AMC;AT249;ATSMSX
AMC;AT250;ATSMSX
```

Equipamentos com o mesmo código são atualizados. Contratos novos são criados automaticamente.
