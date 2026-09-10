# Correções aplicadas

Registro do que estava quebrado no pacote original e do que foi feito.

---

## Bugs que impediam o funcionamento

### 1. O `.env` era completamente ignorado
**Onde:** `src/server.ts` e `src/config/index.ts`

O `server.ts` chamava `dotenv.config()` na linha 14, mas importava `./config` na
linha 5. Em CommonJS os imports são resolvidos antes de qualquer instrução do
módulo — então o `config` lia `process.env` quando ele ainda estava vazio.

Efeito: a porta caía sempre em 3000 (colidindo com o frontend) e o `JWT_SECRET`
caía no valor padrão `'sua-chave-secreta-padrao-INSEGURA-MUDAR-EM-PRODUCAO'`,
que está no código-fonte. Qualquer pessoa com acesso ao repositório conseguiria
forjar tokens válidos.

**Correção:** `dotenv.config()` movido para o topo de `config/index.ts`, antes
da leitura das variáveis. O `dotenv` foi removido do `server.ts`.

### 2. O parser não lia nota fiscal real
**Onde:** `src/services/nfeParser.ts`

Três problemas somados:

- O `xml2js` era configurado com `explicitArray: false`, mas o código acessava
  todos os campos com `[0]`. Com essa opção, `ide.mod` é a string `"55"`, então
  `ide.mod[0]` retornava `"5"` — a validação de modelo rejeitava toda nota.
- `nfe.total?.[0]?.ICMSTot?.[0]` resultava em `undefined`, então **todos os
  tributos eram lidos como zero**. O dashboard mostraria uma análise vazia
  mesmo com o upload bem-sucedido.
- Só reconhecia a raiz `<NFe>`. A nota autorizada pela SEFAZ vem embrulhada em
  `<nfeProc>`, que é o caso mais comum na prática.

**Correção:** três helpers (`no`, `texto`, `numero`) normalizam o acesso
independentemente de o nó vir como objeto ou array; a navegação aceita as raízes
`<nfeProc>` e `<NFe>`; prefixos de namespace são removidos; `dEmi` é aceito além
de `dhEmi`; e `vISSQN`/`vIR` são aceitos como alternativas a `vISS`/`vIRRF`.

### 3. A sessão nunca persistia entre requisições
**Onde:** `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/routes/upload.ts`

O middleware gerava `req.sessionId = \`${userId}-${Date.now()}\`` a cada
requisição — um ID novo toda vez. O upload gravava numa sessão e o dashboard
lia de outra, sempre vazia.

Pior: `criarOuRecuperarSessao()` não era chamado em lugar nenhum do código. O
upload verificava `obterSessao()` e devolvia **401 "Sessão inválida ou
expirada"** em 100% das tentativas. O fluxo principal do produto não funcionava.

**Correção:** o login cria a sessão, embute o `sessionId` no JWT e devolve no
corpo da resposta. O middleware resolve a sessão na ordem header → token →
derivado do usuário. O upload recria a sessão se ela não existir (caso de
reinício do servidor), em vez de rejeitar um usuário autenticado.

### 4. Rotas que o frontend chamava e não existiam
**Onde:** `src/routes/dashboard.ts`

O `App.tsx` fazia `Promise.all` com quatro requisições, mas
`/api/v1/dashboard/regimes` e `/api/v1/dashboard/transicao` não existiam. Como
`Promise.all` rejeita inteiro no primeiro erro, o dashboard nunca carregava —
nem as duas rotas que funcionavam.

**Correção:** implementadas `/regimes`, `/fornecedores`, `/transicao` e
`/documentos` (esta com paginação). Em `export`, foram implementadas `/json` e
`/csv-divergencias`, que a documentação prometia.

### 5. Formato de resposta incompatível com o frontend
**Onde:** `src/routes/dashboard.ts` e `frontend/src/App.tsx`

O backend devolvia `data: { resumo: {...} }` e `data: { divergencias: [...] }`,
mas o front fazia `setResumo(res.data.data)` e `setDivergencias(res.data.data)`.
O resultado seria `divergencias.map is not a function` na renderização.

Além disso, `transicaoAnual` é orientado a colunas
(`{anos: [], tributos: {icms: []}}`) e o Recharts precisa de linhas
(`[{ano, icms, iss}]`).

**Correção:** as rotas passaram a devolver o payload direto em `data`. A rota
`/transicao` converte para linhas e mantém o formato original em `bruto`.

### 6. CORS bloqueava o header de sessão
**Onde:** `src/server.ts`

`allowedHeaders` listava apenas `Content-Type` e `Authorization`. Como toda
chamada do dashboard envia `x-session-id`, o navegador barraria todas elas no
preflight — o `curl` funcionaria e o app não, que é o pior tipo de bug para
diagnosticar.

**Correção:** `x-session-id` adicionado aos headers permitidos e
`Content-Disposition` exposto, para o front conseguir ler o nome do arquivo no
download do Excel.

### 7. O frontend não era um projeto
**Onde:** raiz do pacote original

Existiam `App.tsx` (25 KB), `index.tsx`, `index.css`, `index.html` e
`tailwind.config.js` soltos, mas: o `package.json` era só do backend e não tinha
`react`, `react-dom`, `recharts` nem `lucide-react`; não havia bundler algum; o
`index.html` não tinha a tag `<script>`; e o `App.tsx` usava
`process.env.REACT_APP_API_URL`, sintaxe do Create React App, apontando para a
porta 5000 enquanto o backend subia na 3000.

**Correção:** criado projeto Vite + React completo — `package.json` com as
dependências reais, `vite.config.ts` (porta 3000 e proxy `/api` opcional),
`tsconfig.json`, `postcss.config.js`, `index.html` com o entry point,
`src/main.tsx`, `.env.example` e `Dockerfile` com build multi-stage servido por
nginx. O `App.tsx` passou a usar `import.meta.env.VITE_API_URL`.

---

## Segurança

- **`.env` estava no pacote** com o `JWT_SECRET` preenchido, e o `.gitignore`
  ignorava apenas `node_modules`. O arquivo iria para o Git. Foi removido do
  pacote (só o `.env.example` permanece) e o `.gitignore` foi ampliado.
  **Se essa chave já foi versionada ou compartilhada, troque-a.**
- **`validateConfig()` apenas avisava** quando o `JWT_SECRET` faltava em
  produção. Agora lança erro e impede a subida.
- **O header `x-session-id` era aceito sem verificação.** Um usuário autenticado
  poderia ler os documentos de outro apenas trocando o header. Agora o header só
  é aceito se a sessão pertencer ao dono do token.
- **A rota de upload não tinha autenticação.** Bastava um `x-session-id` válido.
  Agora passa por `authenticate`, assim como `clear-session` e `session-stats`.
- **A pasta `dist/` estava versionada** no pacote. Foi removida e adicionada ao
  `.gitignore`.

---

## Organização

- Estrutura reorganizada em `backend/` e `frontend/` conforme o `ESTRUTURA.md`,
  que descrevia pastas que não existiam no pacote achatado. Todos os imports
  relativos foram reescritos para os novos caminhos.
- `tsconfig.json` do backend com `rootDir: ./src`, para o build gerar
  `dist/server.js` e não `dist/src/server.js`.
- Removido `types-cors.d.ts` (um `declare module 'cors'` que anulava a tipagem),
  substituído pelo pacote oficial `@types/cors`.
- `typescript` movido de `dependencies` para `devDependencies`.
- `@types/uuid` alinhado com a versão instalada do `uuid` (9.x, não 10.x).
- `Dockerfile` do backend atualizado para Node 20 e `npm ci --omit=dev`.
- `docker-compose.yml` corrigido: portas coerentes, `JWT_SECRET` obrigatório e
  serviço de frontend com build real.

---

## Validação executada

| Etapa | Resultado |
| ----- | --------- |
| `tsc` no backend | 0 erros |
| `tsc --noEmit` + `vite build` no frontend | build gerado |
| `POST /auth/login` | token + sessionId |
| `POST /upload/nfe` (3 XMLs, 2 em `nfeProc`) | 3 processados, 0 erros |
| `GET /dashboard/resumo` | valores conferem com os XMLs |
| `GET /dashboard/regimes`, `/fornecedores`, `/transicao` | dados corretos |
| `GET /export/excel` | 40 KB, 6 abas |
| `GET /export/csv-divergencias` | CSV com BOM e `;` |
| Requisição sem token / com token inválido | 401 |
| Header de sessão forjado | descartado, cai na sessão do token |
| Preflight CORS de `localhost:3000` | 204 com os headers corretos |

---

## O que continua pendente

Não são bugs, são limitações de escopo do projeto original:

- **Autenticação é simulada.** Qualquer e-mail entra, sem senha e sem banco.
- **Zero persistência.** Reiniciar o backend apaga os documentos importados.
- **Sem testes automatizados.** O Jest está configurado, mas não há arquivos de
  teste. As validações acima foram feitas manualmente.
- **A inferência de regime tributário é heurística** — deduz o regime a partir
  dos tributos presentes na nota, o que não é confiável para auditoria real.
- **As alíquotas em `data/tax-rules.json` precisam de conferência** por quem
  domina a legislação, antes de qualquer uso em produção.
- **O bundle do frontend tem 622 KB.** Funciona, mas vale code splitting.


---

## Correções de interface (tema escuro)

### Campo perdia o foco a cada tecla digitada
**Onde:** `frontend/src/components/TelaLogin.tsx` e `AbaDivergencias.tsx`

Os componentes `Campo` e `Cabecalho` estavam declarados **dentro** dos
componentes que os usavam. A cada render o React criava uma função nova,
entendia que era um componente diferente do anterior, desmontava o `<input>` e
montava outro no lugar. O foco morria junto com o elemento antigo — por isso era
preciso clicar no campo de novo a cada caractere.

**Correção:** ambos movidos para o escopo do módulo, recebendo por props o que
antes liam do closure. Verificado que não restou nenhum componente aninhado.

### Texto invisível nos campos
**Onde:** `frontend/src/index.css`

Vários inputs e selects não tinham classe de cor, então usavam o padrão do
navegador — fundo branco e texto preto — o que os deixava ilegíveis no tema
escuro. O autofill do Chrome piorava, repintando o campo de branco.

**Correção:** regra global de `input`, `textarea` e `select` com fundo e texto
do tema, cursor na cor da marca, e `-webkit-text-fill-color` branco também no
estado de autofill. Checkbox, radio e range ficam de fora da regra de fundo,
para não perderem a aparência nativa.


---

## Build falhando no Render

**Sintoma:** `Cannot find type definition file for 'jest'`, o mesmo para
`node`, e `Option 'moduleResolution=node10' has been removed`. Nada disso
acontecia localmente.

**Causa:** o `render.yaml` define `NODE_ENV=production`, e nesse modo o
`npm ci` **pula as devDependencies** — onde está o TypeScript. Sem o compilador
local, o `npm run build` caía num `tsc` do sistema, de versão mais nova, que
não encontra os `@types` (também devDependencies) e já removeu a opção de
`moduleResolution` usada aqui. Um único problema produzindo três erros
aparentemente independentes.

**Correção:**

1. `buildCommand: npm ci --include=dev && npm run build` — garante o TypeScript
   do projeto, na versão declarada, independentemente do `NODE_ENV`.
2. `moduleResolution` passou de `"node"` para `"node10"`, que é o nome atual do
   mesmo comportamento e é aceito desde o TypeScript 5.
3. `types` deixou de exigir `"jest"`, que não é necessário para compilar o
   servidor e só existe com as devDependencies instaladas.

Validado reproduzindo o ambiente: `NODE_ENV=production npm ci --include=dev &&
npm run build` compila sem erros, e `node dist/server.js` sobe com o Redis.
