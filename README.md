# Agendae

Plataforma especializada em agendamentos e gestão de filas para estabelecimentos como barbearias, clínicas, salões e consultórios.

## Demonstração atual

O frontend está em `frontend/` e não precisa de instalação ou compilação. Ele inclui:

- página principal para localizar um estabelecimento;
- login e painel vinculado ao estabelecimento;
- página pública própria, como `/barbeariadorenam`;
- agendamento para hoje ou outra data;
- painel com atendimentos, horários livres e senhas chamadas;
- dois estabelecimentos de demonstração com dados separados;
- apresentação da futura API de integração.

Nesta fase, os dados ficam no `localStorage` do navegador. As chaves seguem o formato `agendae:v2:establishment:{slug}`, evitando mistura acidental entre os ambientes da demonstração. O isolamento seguro entre empresas, autenticação, permissões e sincronização entre dispositivos exigem o backend.

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

## Próxima etapa recomendada

Criar a API multi-tenant com autenticação, autorização por estabelecimento, banco de dados, prevenção de conflito de horários, notificações e documentação OpenAPI. O frontend já separa os dados por identificador de estabelecimento para facilitar essa integração.
