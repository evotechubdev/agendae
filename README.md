# Agendae

Plataforma especializada em agendamentos e gestão de filas para estabelecimentos como barbearias, clínicas, salões e consultórios.

## Demonstração atual

O frontend está em `frontend/` e não precisa de instalação ou compilação. Ele inclui:

- página principal para localizar um estabelecimento;
- login e painel vinculado ao estabelecimento;
- página pública própria, como `/barbeariadorenam`;
- agendamento para hoje ou outra data;
- confirmação de presença pelo cliente com nome ou senha e leitura do QR code do estabelecimento;
- confirmação manual da chegada pela equipe para clientes sem celular ou internet;
- bloqueio automático dos horários de hoje que já passaram;
- navegação lateral entre as agendas dos profissionais, com setas e avanço automático a cada cinco segundos;
- painel com atendimentos, horários livres e senhas chamadas;
- dois estabelecimentos de demonstração com dados separados;
- aba de API para administrar a integração com sites próprios.

Os agendamentos e as configurações ficam no Firebase. O backend de integração fica no repositório separado `evotechubdev/agendae-backend` e usa o mesmo Firestore.

## Executar localmente

Sirva a pasta `frontend` em qualquer servidor HTTP estático. Por exemplo:

```bash
python -m http.server 4173 --directory frontend
```

Depois acesse `http://localhost:4173`.

## GitHub Pages

O workflow `.github/workflows/pages.yml` publica automaticamente o conteúdo de `frontend/` após cada envio para a branch `main`.

No repositório do GitHub, abra **Settings → Pages** e selecione **GitHub Actions** em **Source**. A URL esperada é:

`https://evotechubdev.github.io/agendae/`

## Firebase

O frontend está conectado ao projeto `agendae-prod` usando Firebase Authentication e Cloud Firestore.

Antes do primeiro acesso:

1. Ative **Authentication → Sign-in method → E-mail/senha**.
2. Adicione `evotechubdev.github.io` em **Authentication → Settings → Authorized domains**.
3. Crie o usuário `barbeariadorenam-admin@agendae.com.br` no Authentication. No site, selecione a Barbearia do Renam e use o login `admin`.
4. Crie o banco Cloud Firestore em modo de produção.
5. Publique as regras com `npx firebase-tools deploy --only firestore --project agendae-prod` usando uma conta com acesso ao projeto.
6. Copie o UID desse usuário no Authentication e crie o documento `users/{UID}` no Firestore com os campos de texto `name: Administrador`, `email: barbeariadorenam-admin@agendae.com.br`, `role: admin` e `establishmentSlug: barbeariadorenam`. O ID do documento deve ser o UID exato, não o e-mail nem o login.

O erro `agendae/profile-not-found` significa que a autenticação funcionou, mas esse documento está ausente. Com uma sessão administrativa do Firebase CLI e o pacote no cache do npm, `node scripts/link-admin-profile.cjs` verifica o vínculo da conta admin; acrescentar `--apply` cria somente o perfil ausente. O script não substitui um perfil existente.

Os dados ficam organizados em `establishments/{slug}`. Agendamentos privados e filas só podem ser lidos por usuários cujo documento `users/{uid}` esteja vinculado ao mesmo `establishmentSlug`. Horários ocupados e o estado público da fila não expõem dados pessoais.

### Criar estabelecimentos pela interface

O botão **Entrar** da página principal abre o acesso do administrador do sistema. Para habilitar a primeira conta desse tipo, crie uma conta de e-mail e senha no Firebase Authentication e, no Firestore, crie `systemAdmins/{UID}` com `active: true` (booleano) e `name` (texto). O ID deve ser o UID exato da conta. Com uma sessão administrativa do Firebase CLI, `node scripts/link-system-admin.cjs EMAIL` verifica o vínculo e `node scripts/link-system-admin.cjs EMAIL --apply` o cria após confirmar que a conta existe. Esse vínculo inicial é feito por um operador com acesso ao Firebase; o site não permite criar administradores do sistema. Publique as regras atuais de `firestore.rules` antes de usar o fluxo.

Na interface, o administrador do sistema informa somente o nome do estabelecimento. O sistema gera o identificador sem espaços ou acentos e em letras minúsculas (por exemplo, `Salão Bela` → `salaobela`), cria o login `admin` com o e-mail `salaobela-admin@agendae.com.br` e uma senha temporária única. Os dados de acesso aparecem uma vez após o cadastro e devem ser entregues ao responsável da loja. No primeiro login, ele precisa definir uma senha definitiva de pelo menos oito caracteres antes de acessar as configurações. A loja começa com `setupComplete: false`, sem aparecer na busca ou aceitar agendamentos. O endereço de primeiro acesso da loja é `https://evotechubdev.github.io/agendae/?route=login&establishment=SLUG`.

Ao entrar, o administrador da loja abre **Configurações da loja → Loja** para definir nome, categoria, bairro, endereço e expediente. Nas abas **Funcionários**, **Horários** e **Serviços**, cadastra a equipe, as escalas e os serviços. Depois usa **Publicar estabelecimento** na aba **Loja**. A publicação exige esses dados e torna a página pública visível na busca. O identificador da URL fica fixo após a criação.

### Confirmação de presença

Ao criar um agendamento, o cliente recebe uma senha de seis caracteres. Na página pública ele pode localizar o horário pelo nome completo ou por essa senha e, ao chegar, ler o QR code exibido no balcão. O painel da equipe gera o QR exclusivo do estabelecimento e também permite confirmar a chegada manualmente pela lista de atendimentos.

As bibliotecas de QR ficam versionadas em `frontend/vendor/`, portanto a geração e a leitura não dependem de serviços externos de imagens. Para usar a câmera, o site precisa estar em HTTPS (ou em `localhost`) e o navegador deve receber permissão de acesso.

### Expediente extra e janela de presença

No painel, **Expediente extra** libera somente a data selecionada, usando as escalas dos profissionais. A exceção não se repete na semana seguinte. Para abrir outra data, cadastre uma nova liberação.

A presença por QR ou pela equipe só é aceita na data real do agendamento, no fuso de São Paulo, de uma hora antes do início até o término previsto. Um atendimento das 09:20 com duração de 20 minutos permite confirmar das 08:20 às 09:40. A duração fica salva na reserva, e as regras do Firestore verificam a janela com o relógio do servidor.

Publique também `firestore.rules` ao publicar o frontend: as novas reservas e consultas incluem `durationMinutes`. A preparação do QR no painel sincroniza as durações do catálogo para validar reservas antigas sem esse campo.

Para testar as regras localmente com Java e Firebase CLI instalados:

```bash
firebase emulators:exec --only firestore --project demo-agendae --config firebase.emulator.json "node --test tests/firestore-presence.emulator.mjs"
```

## API de integração

O administrador pode abrir **Configurações da loja → API** para gerar, trocar ou revogar a chave do estabelecimento. Um único serviço Render, em `https://agendae-backend-t5ax.onrender.com`, atende todas as lojas; cada loja tem uma variável própria, como `api-barbeariadorenam`, e uma rota própria. Com `RENDER_API_KEY` configurada no backend, o modal salva a variável da loja pela API do Render e solicita o deploy automaticamente. A nova chave passa a valer ao fim do deploy. A chave também deve ficar no servidor do site cliente; a interface pública desse site consulta o seu próprio servidor. A documentação das rotas e da publicação está no README do repositório `agendae-backend`.
