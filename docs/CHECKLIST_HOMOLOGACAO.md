# Checklist de homologação

Roteiro para a equipe validar o sistema no servidor de teste antes da produção.
Use um **número de WhatsApp de teste** no sistema e outro celular fazendo o papel do técnico.

Marque cada item com ✅ ou anote o problema.

## 1. Preparação (administrador)
- [ ] Criar o administrador: `scripts/create-admin.sh`
- [ ] Entrar no sistema e trocar a senha, se pedido
- [ ] Administração > WhatsApp > **Gerar QR Code** e ler com o celular de teste
- [ ] O indicador fica verde e o aviso "WhatsApp desconectado" some
- [ ] Administração > E-mail: cadastrar destinatários e **Enviar e-mail de teste** (exige SMTP no `.env`)
- [ ] Administração > Contratos: importar o CSV real ou cadastrar alguns contratos e equipamentos
- [ ] Administração > Usuários: criar um operador e entrar com ele em outro navegador

## 2. Menu e classificação
- [ ] O técnico manda "Oi" e recebe o menu com as 3 opções
- [ ] O técnico responde "abc": recebe o aviso de opção inválida e o menu de novo
- [ ] O técnico responde "1": recebe a confirmação e o chamado aparece como **Solicitação de Suporte**
- [ ] Depois de 3 respostas inválidas (outro técnico), o chamado abre como **Outras dúvidas**
- [ ] Um atendente responde antes da escolha: o bot para e o chamado abre como **Outras dúvidas**
- [ ] Contato marcado como **VIP** não recebe o menu
- [ ] Mensagem em **grupo** não recebe menu e abre chamado como **Outras dúvidas**

## 3. Conversa
- [ ] Enviar e receber texto, incluindo emojis e formatação (`*negrito*`)
- [ ] O técnico recebe `*Nome do atendente:*` antes do texto
- [ ] Receber e enviar imagem, vídeo, áudio (gravado no celular e arquivo), PDF, Word e ZIP
- [ ] Arrastar um arquivo para a conversa e colar uma imagem com Ctrl+V
- [ ] Responder uma mensagem específica: a citação aparece no celular e no sistema
- [ ] Reagir a uma mensagem e ver a reação do técnico aparecer no sistema
- [ ] Encaminhar uma mensagem para outra conversa
- [ ] Apagar uma mensagem do suporte para todos
- [ ] Mensagem enviada **pelo celular do suporte** aparece como "Enviada pelo celular"
- [ ] Mensagem apagada ou editada pelo técnico é atualizada no sistema
- [ ] Status enviada, entregue e lida nas mensagens do suporte
- [ ] **Nova conversa** por número: aceita número válido e recusa número sem WhatsApp
- [ ] Notificação sonora e do navegador para mensagem nova

## 4. Atribuição
- [ ] "Atribuir a mim" e atribuir a outro atendente
- [ ] O outro atendente também consegue enviar mensagens na conversa
- [ ] As abas "Minhas" e "Não atribuídas" mostram o esperado
- [ ] Duas pessoas com o sistema aberto veem as mensagens em tempo real

## 5. Encerramento
- [ ] **Encerrar** exige o contrato e não deixa confirmar sem ele
- [ ] O equipamento lista só os do contrato escolhido e permite pesquisar pelo código
- [ ] O contrato **CHAMADO INTERNO** aparece na lista
- [ ] O assunto mostrado no modal segue `[AAAAMMDD][CONTRATO][EQUIPAMENTO] Classificação`
- [ ] Sem equipamento, o assunto fica `[AAAAMMDD][CONTRATO] Classificação`
- [ ] O técnico recebe "Informamos que seu chamado foi encerrado em nosso sistema."
- [ ] O e-mail chega com o corpo no formato combinado e o **PDF** anexo
- [ ] O PDF tem só as mensagens daquele chamado, com data, hora e remetente
- [ ] A duração do atendimento está correta
- [ ] A próxima mensagem do técnico abre um **novo chamado** com o menu
- [ ] No painel do contato: baixar o PDF de chamados antigos e reenviar e-mail

## 6. Administração e aparência
- [ ] Alterar os textos do bot e as opções do menu, e conferir no WhatsApp
- [ ] Desligar "nome do atendente nas mensagens" e conferir
- [ ] Alterar cores e logos, ver a pré-visualização, salvar e conferir em outro navegador
- [ ] **Restaurar padrão** e conferir que nome e logos voltam ao neutro (depois, reenviar a identidade)
- [ ] Tema escuro e uso no celular
- [ ] Auditoria registra logins, encerramentos, VIP e alterações

## 6.1 Caixas de entrada e permissões
- [ ] Criar uma caixa de entrada (ex.: Compras), conectar outro número e conferir que as conversas ficam separadas
- [ ] Configurar menu e destinatários diferentes por caixa
- [ ] Criar um grupo só com Atendimento, incluir um usuário e conferir que ele não vê o Início nem a Administração
- [ ] Usuário com "Usuários e grupos" (sem ser Administrador) não consegue criar Administrador
- [ ] Enviar figurinha recente e imagem como figurinha
- [ ] Clicar na foto do perfil e em uma imagem: abre na página e fecha com X, Esc ou clique fora
- [ ] Botão Sair volta para a tela de login

## 7. Segurança e operação
- [ ] Operador não vê o menu Administração e recebe erro ao acessar `#/admin`
- [ ] 5 senhas erradas bloqueiam o usuário, e o administrador desbloqueia
- [ ] Desativar um usuário derruba a sessão dele na hora
- [ ] `docker compose ps`: todos os serviços `healthy`
- [ ] Backup manual: `docker compose exec backup /usr/local/bin/backup.sh once`
- [ ] Reiniciar o servidor e conferir que tudo volta sozinho, inclusive o WhatsApp conectado
- [ ] `scripts/security-scan.sh` sem pendências novas

## Resultado

| Data | Responsável | Aprovado? | Observações |
|---|---|---|---|
| | | | |
