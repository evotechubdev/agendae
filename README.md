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

O mapa público usa a Google Maps Embed API. Ative essa API no Google Cloud, crie uma chave restrita ao domínio do site e configure `GOOGLE_MAPS_EMBED_KEY` no backend Render. A rota pública `GET /v1/config/firebase` entrega a chave ao navegador junto com a configuração web; sem ela, a seção de localização informa que o mapa está indisponível. Cada Endereço usa o nome do edifício em Complemento e a rua, número, cidade e estado para localizar o lugar.

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

A configuração da aplicação web Firebase é carregada da variável `DADOS_FIREBASE` do backend no Render por `GET /v1/config/firebase`. Configure essa variável antes de publicar uma versão do frontend que use essa rota. O JSON precisa conter `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` e `appId`. Esses identificadores ainda são visíveis ao navegador; a segurança dos dados depende das regras do Firebase e da autenticação. A conta de serviço permanece no arquivo secreto do Render.

O botão **Entrar** da página principal abre o acesso do administrador do sistema. A conta `admin` é resolvida pela variável `EMAILS_ADMIN` do serviço `agendae-backend-t5ax` no Render. Configure `EMAILS_ADMIN=admin@agendae.com.br` (para mais administradores, separe os e-mails por vírgula) e crie cada conta com senha no Firebase Authentication. A senha nunca é colocada na variável. O backend verifica o Firebase ID token e o e-mail da lista antes de criar uma loja. O site não permite criar administradores do sistema. Publique também as regras atuais de `firestore.rules`.

Após entrar, o administrador do sistema é levado à aba **Gerenciar Estabelecimentos**. Essa tela lista as lojas cadastradas, indica quais ainda estão em configuração e permite criar outra loja informando apenas o nome. As abas **Home** e **Gerenciar Estabelecimentos** aparecem apenas na navegação administrativa; sem login, a navegação mostra somente o botão **Entrar**.

Na interface, o administrador do sistema informa somente o nome do estabelecimento. O sistema gera o identificador sem espaços ou acentos e em letras minúsculas (por exemplo, `Salão Bela` → `salaobela`), cria o login `admin` com o e-mail `salaobela-admin@agendae.com.br` e uma senha temporária única. Os dados de acesso aparecem uma vez após o cadastro e devem ser entregues ao responsável da loja. No primeiro login, ele precisa definir uma senha definitiva de pelo menos oito caracteres antes de acessar as configurações. A rota `https://evotechubdev.github.io/agendae/?route=SLUG` é disponibilizada imediatamente com a mesma página de agendamento das demais lojas: cabeçalho, painel de atendimento, agenda, serviços e acesso da equipe. Enquanto o responsável não concluir o cadastro, a página informa que a agenda está em configuração e não permite reservas. A loja começa com `setupComplete: false` e não aparece na busca até ser publicada. O endereço direto de primeiro acesso é `https://evotechubdev.github.io/agendae/?route=login&establishment=SLUG`.

Ao entrar, o administrador da loja abre **Configurações da loja → Loja** para definir nome, categoria, bairro, Endereço 1, Endereço 2 opcional e o expediente de cada dia da semana. Nas abas **Funcionários**, **Horários** e **Serviços**, cadastra a equipe, as escalas e os serviços. Cada serviço pode usar o Endereço 1, o Endereço 2 ou **Atendimento On line**, com link de reunião opcional. Também pode valer para todo o expediente da loja ou apenas para dias e intervalos escolhidos. A reserva só é oferecida quando a duração inteira do serviço cabe no intervalo dele, no expediente do dia e na escala do profissional. A agenda, a fila e a API seguem essas regras; mudanças que afetariam reservas futuras são recusadas. Depois, o administrador usa **Publicar estabelecimento** na aba **Loja**. A publicação exige esses dados e torna a página pública visível na busca. O identificador da URL fica fixo após a criação.

Em **Horários → Horários de almoço**, o administrador define início e fim para cada profissional e escolhe **Todos os dias** ou **Selecionar dias**. Nos dias sem almoço, a escala libera os horários correspondentes. Na tela pública de agendamento, o seletor **Dia / Mês** alterna entre a grade de horários do dia e um calendário mensal com os dias de expediente. Ao escolher uma data no mês, a grade diária mostra os horários efetivamente disponíveis para reservar.

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
