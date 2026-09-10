# Publicando a aplicação

> **Atalho temporário (só para demonstrar):** dá para apontar o frontend da
> Vercel para a URL da porta 5000 do Codespaces. Funciona, mas **apenas
> enquanto o Codespace estiver rodando** — ele hiberna após ~30 minutos de
> inatividade e a URL muda quando o container é recriado. Não serve para um
> link que outras pessoas vão acessar.


O projeto tem duas metades que precisam de hospedagens diferentes:

| Parte | Onde | Por quê |
| ----- | ---- | ------- |
| Frontend | Vercel | Arquivos estáticos, é o que a Vercel faz bem |
| Backend | Render, Railway, Fly.io ou VPS | Precisa de **processo persistente** |

## Por que o backend não pode ir para a Vercel

Duas características do backend impedem serverless:

1. **Sessões ficam em memória** (`Map` no `session.ts`). Cada função serverless
   sobe uma instância nova — o upload gravaria numa instância e o dashboard
   leria de outra, vazia.
2. **Usuários são gravados em arquivo** (`data/usuarios.json`). O disco de uma
   função serverless é descartado ao fim da execução; todo cadastro se perderia.

Trocar as duas coisas por Redis e um banco de dados resolveria, e é o caminho
recomendado se o produto crescer. Enquanto isso, um host com processo contínuo
funciona sem alterar código.

---

## 1. Onde guardar os usuários (antes de tudo)

O plano gratuito do Render **não permite disco persistente**. Sem disco, o
sistema de arquivos é apagado a cada deploy e a cada hibernação — todos os
cadastros desapareceriam.

A solução gratuita é um Redis gerenciado. No **Upstash**
(https://upstash.com), crie um banco Redis no plano gratuito e copie os dois
valores da seção REST API:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Você vai colar esses valores no Render no próximo passo. O backend detecta
essas variáveis e passa a guardar os usuários lá, sem tocar em disco.

**Se você preferir plano pago no Render** (a partir de US$ 7/mês), pode usar
disco em vez de Redis: remova as variáveis `UPSTASH_*`, defina
`WRITABLE_DIR=/var/dados` e descomente o bloco `disk` no fim do `render.yaml`.

**Se não configurar nem um nem outro**, a aplicação funciona, mas os usuários
somem no próximo deploy — e o backend registra um aviso no log alertando sobre
isso.

## 2. Backend no Render

1. Suba o projeto para o GitHub.
2. No Render: **New > Blueprint**, aponte para o repositório. Ele lê o
   `render.yaml` da raiz.
3. Em **Environment**, cole `UPSTASH_REDIS_REST_URL` e
   `UPSTASH_REDIS_REST_TOKEN`. Elas estão marcadas como `sync: false` no
   blueprint justamente para não ficarem no repositório.
4. Antes de confirmar, ajuste `CORS_ORIGIN` para a URL real do seu frontend na
   Vercel. **Em produção, apenas as origens listadas aí são aceitas** — é o que
   impede qualquer site de consumir sua API.
5. No log do primeiro deploy, confirme a linha `✅ Usuários em Redis: ...`. Se
   aparecer `✅ Usuários em arquivo (...)`, as variáveis do Upstash não foram
   lidas e os cadastros serão perdidos no próximo deploy.

Ao final você terá uma URL como `https://nfe-validator-api.onrender.com`.
Teste antes de seguir:

```
https://nfe-validator-api.onrender.com/health
```

Deve responder `{"status":"ok",...}`.

> **Plano gratuito do Render:** o serviço hiberna após inatividade e a primeira
> requisição pode levar ~30 segundos para responder. A tela de login vai
> parecer travada nesse intervalo. Em plano pago isso não acontece.

## 3. Frontend na Vercel

### Configuração do projeto

No painel da Vercel, em **Settings > General**:

- **Root Directory**: `frontend`
- **Framework Preset**: `Vite`

Isso é importante: como o repositório tem `frontend/` e `backend/`, a Vercel
oferece o preset **Services**, que publicaria os dois juntos. **Não use esse
preset neste projeto** — ele roda o backend como função serverless, e este
backend precisa de disco e memória persistentes (é o motivo de ele ir para o
Render). Apontando a Root Directory para `frontend`, a Vercel publica só o
frontend, que é o correto.

O arquivo `frontend/vercel.json` já traz o preset e o redirecionamento de rotas.

### Variável de ambiente

Em **Settings > Environment Variables**, defina:

```
VITE_API_URL = https://nfe-validator-api.onrender.com
```

Sem barra no final. **Esse é o passo que estava faltando** se você viu a
mensagem citando `https://SEU-BACKEND-PUBLICO.com`: aquele texto é um exemplo
de preenchimento, não uma URL real.

Depois de salvar, **refaça o deploy**. Variáveis `VITE_*` entram no código no
momento do build; alterá-las sem reconstruir não muda nada.

O `vercel.json` na raiz já configura o build a partir da pasta `frontend/` e o
redirecionamento de rotas para o `index.html`.

## 4. Conferindo

1. Abra a URL da Vercel.
2. Crie a primeira conta.
3. Se falhar, abra o **F12 > Console**:
   - `CORS policy` → o `CORS_ORIGIN` do Render não bate com a URL da Vercel
   - `ERR_NAME_NOT_RESOLVED` → `VITE_API_URL` errada ou build não refeito
   - Demora e depois responde → hibernação do plano gratuito

No painel do Render, a aba **Logs** mostra
`⚠️ CORS bloqueou a origem: <url>` sempre que uma origem é recusada. É o
diagnóstico mais direto.

---

## Separação entre dados de leitura e de escrita

O backend usa dois diretórios diferentes, e confundi-los quebra a aplicação:

| Variável | Conteúdo | Onde deve apontar |
| -------- | -------- | ----------------- |
| `DATA_DIR` | Tabelas fiscais (`tax-rules.json`, `cclasstrib.json`, `reforma-transicao.json`) | **Não defina.** Vêm versionadas com o código, em `backend/data` |
| `WRITABLE_DIR` | `usuarios.json`, gravado em execução | Disco persistente (`/var/dados` no `render.yaml`) |

Apontar `DATA_DIR` para o disco montado faria as tabelas fiscais sumirem, já que
o disco começa vazio. Deixar os usuários fora do disco os apagaria a cada deploy.

## Antes de uso real

- **Troque o `JWT_SECRET`** se em algum momento a chave de exemplo foi usada. No
  `render.yaml` ele é gerado automaticamente, o que já resolve.
- **Faça backup de `data/usuarios.json`.** É um arquivo, não um banco: não tem
  transação nem réplica.
- **Substitua a tabela cClassTrib pela oficial**
  (`npm run importar:cclasstrib`) — o arquivo incluído é apenas uma amostra.
- **Valide as alíquotas** de `data/reforma-transicao.json` com o time
  tributário e preencha `revisadoPor` e `revisadoEm`.
- **Considere migrar sessões e usuários** para Redis e banco de dados antes de
  abrir para vários usuários simultâneos.
