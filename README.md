# Agendae

Plataforma especializada em agendamentos e gestão de filas para estabelecimentos como barbearias, clínicas, salões e consultórios.

## Demonstração atual

O frontend está na raiz deste repositório e não precisa de instalação ou compilação. Ele inclui:

- página principal de apresentação da plataforma completa e da API, com seletor compacto de estabelecimentos parceiros;
- login que libera as funções de gestão na própria página de agendamento, sem painel separado;
- página pública própria para cada estabelecimento, como `/salaobela`;
- agendamento para hoje ou outra data;
- confirmação de presença pelo cliente com nome ou senha e leitura do QR code do estabelecimento;
- confirmação manual da chegada pela equipe para clientes sem celular ou internet;
- bloqueio automático dos horários de hoje que já passaram;
- navegação lateral entre as agendas dos profissionais, com setas e avanço automático a cada cinco segundos;
- agenda única com atendimentos, horários livres, senhas chamadas e controles da equipe;
- estabelecimentos carregados do Firestore com dados separados;
- aba de API para administrar a integração com sites próprios.

Os agendamentos e as configurações ficam no Firebase. O backend de integração fica no repositório separado `evotechubdev/agendae-backend` e usa o mesmo Firestore.

## Executar localmente

Na raiz do repositório, execute qualquer servidor HTTP estático. Por exemplo:

```bash
python -m http.server 4173
```

Depois acesse `http://localhost:4173`.

## GitHub Pages

O workflow `.github/workflows/pages.yml` publica automaticamente a raiz do repositório após cada envio para a branch `main`.

No repositório do GitHub, abra **Settings → Pages** e selecione **GitHub Actions** em **Source**. A URL esperada é:

`https://evotechubdev.github.io/agendae-frontend/`

## Configuração externa

O frontend não contém arquivos de configuração, credenciais, regras ou índices do Firebase. A configuração pública necessária ao navegador é fornecida pelo backend no Render pela rota `GET /v1/config/firebase`.

O mapa público usa automaticamente a Google Maps Embed API para localizar o endereço escolhido. O campo Complemento fornece o nome do edifício; rua, número, cidade e estado ajudam a localizar o lugar. Configure `API_GOOGLE_MAPS` no serviço Render do backend; o frontend recebe essa chave pela rota `GET /v1/config/firebase`. Sem a variável, o mapa fica indisponível. A chave aparece no navegador porque a Maps Embed API a exige no URL do iframe: mantenha-a restrita à Maps Embed API e ao domínio público.

O botão **Contato WhatsApp** da página inicial usa `CONTATO_WHATSAPP` no serviço Render do backend. Informe DDD e número com 11 dígitos, sem `55`, espaços ou sinais (por exemplo, `71999999999`). O backend envia o número pela rota pública `GET /v1/config/firebase`; sem um número válido, o botão aparece indisponível.

### Criar estabelecimentos pela interface

A configuração da aplicação web Firebase é carregada da variável `DADOS_FIREBASE` do backend no Render por `GET /v1/config/firebase`. Configure essa variável antes de publicar uma versão do frontend que use essa rota. O JSON precisa conter `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` e `appId`. Esses identificadores ainda são visíveis ao navegador; a segurança dos dados depende das regras do Firebase e da autenticação. A conta de serviço permanece no arquivo secreto do Render.

O botão **Acesso Interno** da página principal abre o acesso do administrador do sistema. A conta `admin` é resolvida pela variável `EMAILS_ADMIN` do serviço `agendae-backend-t5ax` no Render. Configure `EMAILS_ADMIN=admin@agendae.com.br` (para mais administradores, separe os e-mails por vírgula) e crie cada conta com senha no Firebase Authentication. Administradores do sistema não entram em `logins`: o perfil `admin` é exclusivo desse acesso e vem diretamente do Render. A senha nunca é colocada na variável. O backend verifica o Firebase ID token e o e-mail da lista antes de criar uma loja. O site não permite criar administradores do sistema.

Após entrar, o administrador do sistema é levado à aba **Gerenciar Estabelecimentos**. Essa tela lista as lojas cadastradas, indica quais ainda estão em configuração e permite criar outra loja informando apenas o nome. As abas **Home** e **Gerenciar Estabelecimentos** aparecem apenas na navegação administrativa; sem login, a navegação mostra somente o botão **Acesso Interno**.

Na interface, o administrador do sistema informa somente o nome do estabelecimento. O sistema gera o identificador sem espaços ou acentos e em letras minúsculas (por exemplo, `Salão Bela` → `salaobela`), cria o login `admin` com o e-mail `salaobela-admin@agendae.com.br` e uma senha temporária única. Os dados de acesso aparecem uma vez após o cadastro e devem ser entregues ao responsável da loja. No primeiro login, ele precisa definir uma senha definitiva de pelo menos oito caracteres antes de acessar as configurações. A rota `https://evotechubdev.github.io/agendae-frontend/?route=SLUG` é disponibilizada imediatamente com a mesma página de agendamento das demais lojas: cabeçalho, painel de atendimento, agenda, serviços e acesso da equipe. Enquanto o responsável não concluir o cadastro, a página informa que a agenda está em configuração e não permite reservas. A loja começa com `setupComplete: false` e não aparece na busca até ser publicada. O endereço direto de primeiro acesso é `https://evotechubdev.github.io/agendae-frontend/?route=login&establishment=SLUG`.

Ao entrar, o administrador permanece na mesma página de agendamento. O login apenas libera os controles da equipe e o modal **Configurações da loja**; não existe um painel administrativo separado. O nome e o identificador do estabelecimento são definidos pelo administrador do sistema na criação e ficam imutáveis; para usar outro nome, o estabelecimento deve ser excluído e criado novamente. Na aba **Loja**, o responsável define categoria, bairro, Endereço 1, Endereço 2 opcional e o expediente de cada dia da semana. Nas abas **Funcionários**, **Horários**, **Serviços**, **Presença** e **API**, administra a equipe, as escalas, os serviços, o QR de check-in e a integração. Cada serviço pode usar o Endereço 1, o Endereço 2 ou **Atendimento On line**, com link de reunião opcional. Também pode valer para todo o expediente da loja ou apenas para dias e intervalos escolhidos. A reserva só é oferecida quando a duração inteira do serviço cabe no intervalo dele, no expediente do dia e na escala do profissional. A agenda, a fila e a API seguem essas regras; mudanças que afetariam reservas futuras são recusadas. Depois, o administrador usa **Publicar estabelecimento** na aba **Loja**. A publicação exige esses dados e torna a página pública visível na busca. O identificador da URL fica fixo após a criação.

Em **Horários → Horários de almoço**, o administrador define início e fim para cada profissional e escolhe **Todos os dias** ou **Selecionar dias**. Nos dias sem almoço, a escala libera os horários correspondentes. Na tela pública de agendamento, o seletor **Dia / Mês** alterna entre a grade de horários do dia e um calendário mensal com os dias de expediente. Ao escolher uma data no mês, a grade diária mostra os horários efetivamente disponíveis para reservar.

### Confirmação de presença

Ao criar um agendamento, o cliente recebe uma senha de seis caracteres. Na página pública ele pode localizar o horário pelo nome completo ou por essa senha e, ao chegar, ler o QR code exibido no balcão. A equipe encontra o QR exclusivo em **Configurações da loja → Presença** e pode confirmar a chegada manualmente diretamente na agenda.

As bibliotecas de QR ficam versionadas em `vendor/`, portanto a geração e a leitura não dependem de serviços externos de imagens. Para usar a câmera, o site precisa estar em HTTPS (ou em `localhost`) e o navegador deve receber permissão de acesso.

### Expediente extra e janela de presença

Em **Configurações da loja → Horários**, **Expediente extra** libera somente a data selecionada, usando as escalas dos profissionais. A exceção não se repete na semana seguinte. Para abrir outra data, cadastre uma nova liberação.

A presença por QR ou pela equipe só é aceita na data real do agendamento, no fuso de São Paulo, de uma hora antes do início até o término previsto. Um atendimento das 09:20 com duração de 20 minutos permite confirmar das 08:20 às 09:40. A duração fica salva na reserva, e as regras do Firestore verificam a janela com o relógio do servidor.

## API de integração

O administrador pode abrir **Configurações da loja → API** para gerar, trocar ou revogar a chave do estabelecimento. Um único serviço Render, em `https://agendae-backend-t5ax.onrender.com`, atende todas as lojas; cada loja tem uma variável própria no formato `API_AGENDAE_{SLUG}`, como `API_AGENDAE_SALAOBELA`, e uma rota própria. Com `RENDER_API_KEY` configurada no backend, o modal salva essa variável pela API do Render e solicita o deploy automaticamente. No backend do sistema externo, cadastre o mesmo valor `ag_live_...` com o mesmo nome de variável. A nova chave passa a valer ao fim do deploy. A chave deve ficar apenas no servidor do sistema externo; sua interface pública consulta o próprio servidor. O widget independente e seu manual estão em `integracoes/`.
