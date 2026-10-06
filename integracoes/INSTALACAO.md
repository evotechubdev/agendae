# Instalação da interface de agendamento Agendae

Este pacote conecta um site cliente ao Agendae sem incorporar a interface à estrutura do site. O widget cria seu próprio HTML e CSS dentro de um **Shadow DOM**, portanto não depende de framework, folha de estilos, logomarca ou JavaScript do cliente.

## Arquivo entregue

Copie `agendae-booking-widget.js` para este local do site cliente:

```text
<raiz-pública-do-site>/integracoes/agendae-booking-widget.js
```

O arquivo é autônomo. A logomarca oficial é carregada do endereço público do Agendae. Se necessário, outro endereço pode ser informado por `data-agendae-logo`.

## 1. Adicionar o botão

O botão pode ficar em qualquer ponto do HTML. Apenas o atributo `data-agendae-open` é obrigatório:

```html
<button type="button" data-agendae-open>
  Agendar horário
</button>
```

O desenho externo do botão pertence ao site cliente. Ele pode receber qualquer classe CSS sem alterar a janela do Agendae.

## 2. Carregar a interface

Inclua a tag abaixo no `<head>` ou antes do fechamento de `</body>`:

```html
<script
  src="/integracoes/agendae-booking-widget.js"
  data-agendae-api="https://BACKEND-DO-CLIENTE.example/api/agenda"
  data-agendae-establishment="NOME DO ESTABELECIMENTO"
  defer
></script>
```

Configurações disponíveis:

| Atributo | Obrigatório | Função |
| --- | --- | --- |
| `data-agendae-api` | Sim | URL pública do proxy de agendamento no backend do cliente, sem barra final. |
| `data-agendae-establishment` | Não | Nome apresentado no texto da interface. Se omitido, usa o nome retornado pelo catálogo. |
| `data-agendae-logo` | Não | URL alternativa da logomarca Agendae. |
| `data-agendae-open-selector` | Não | Seletor CSS alternativo para os botões de abertura. O padrão é `[data-agendae-open]`. |

A interface também pode ser aberta e fechada pelo JavaScript do cliente:

```js
window.AgendaeBooking.open();
window.AgendaeBooking.close();
```

O gerente escolhe a modalidade em **Configurações da loja → Dados do estabelecimento → Modalidade de atendimento**. O AGENDAE salva essa configuração e o catálogo informa `bookingMode: "scheduled"` para estabelecimentos com agendamento ou `bookingMode: "daily"` para estabelecimentos que trabalham somente com senhas do dia. O site cliente não configura esse comportamento. No modo diário, o widget preenche a data de hoje e impede sua alteração automaticamente.

## 3. Configurar a chave nos dois backends

Para um estabelecimento com slug `octn`, use exatamente o mesmo nome e o mesmo valor secreto nos dois serviços do Render:

```text
API_AGENDAE_OCTN=ag_live_...
```

O padrão para outros clientes é:

```text
API_AGENDAE_{SLUG_EM_MAIÚSCULAS}
```

Exemplo: o slug `salao-bela` usa `API_AGENDAE_SALAO_BELA`.

Nunca coloque a chave `ag_live_...` no HTML, no widget, em variável JavaScript pública ou em repositório do frontend.

## 4. Criar o proxy no backend do cliente

O navegador conversa somente com o backend do cliente. Esse backend lê `API_AGENDAE_{SLUG}` e encaminha as chamadas para:

```text
https://agendae-backend-t5ax.onrender.com/v1/establishments/{slug}
```

O proxy público precisa oferecer este contrato:

| Rota do cliente | Destino Agendae | Método |
| --- | --- | --- |
| `/api/agenda/catalog` | `/catalog` | `GET` |
| `/api/agenda/availability?...` | `/availability?...` | `GET` |
| `/api/agenda/appointments` | `/appointments` | `POST` |

Em todas as chamadas servidor a servidor, envie:

```http
Authorization: Bearer ag_live_...
Accept: application/json
```

No `POST`, encaminhe `Content-Type: application/json` e somente os campos `date`, `time`, `professional`, `service`, `client` e `phone`. Configure CORS no backend do cliente para aceitar apenas o domínio público do próprio site.

## 5. Publicar sem interromper a integração

Ao trocar um nome antigo de variável:

1. adicione `API_AGENDAE_{SLUG}` com o mesmo valor nos dois serviços Render;
2. faça o deploy do backend Agendae;
3. faça o deploy do backend do cliente;
4. confirme os endpoints de saúde e o carregamento do catálogo;
5. remova a variável antiga somente após a validação.

As versões atuais aceitam temporariamente os nomes antigos para permitir essa migração sem indisponibilidade. Toda nova geração ou rotação de chave passa a usar apenas `API_AGENDAE_{SLUG}`.

## Exemplo OCTN

```html
<button class="header-booking-button" type="button" data-agendae-open>
  Agendamento
</button>

<script
  src="./integracoes/agendae-booking-widget.js"
  data-agendae-api="https://backend-a3kp.onrender.com/api/agenda"
  data-agendae-establishment="OCTN"
  defer
></script>
```

Variável nos dois serviços Render:

```text
API_AGENDAE_OCTN=ag_live_...
```

## Checklist de entrega

- O arquivo está em `/integracoes/agendae-booking-widget.js`.
- O botão possui `data-agendae-open`.
- A tag `<script>` aponta para o backend do cliente, nunca diretamente para a API privada do Agendae.
- O mesmo segredo está cadastrado nos dois backends.
- A chave não aparece no código-fonte público.
- Catálogo, disponibilidade e confirmação foram testados após o deploy.
