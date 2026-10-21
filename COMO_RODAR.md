# Como rodar o projeto

Testado de ponta a ponta: login → upload de ZIP com XMLs → dashboard → export.

Pré-requisito: Node.js 18 ou superior.

---

## 1. Backend (porta 5000)

```bash
cd backend
npm install
cp .env.example .env
```

Gere uma chave JWT própria e coloque no `.env`:

```bash
openssl rand -hex 32
```

Depois:

```bash
npm run dev      # desenvolvimento, com reload automático
```

Ou, para rodar o build compilado:

```bash
npm run build
npm start
```

Confirme que subiu:

```bash
curl http://localhost:5000/health
```

## 2. Frontend (porta 3000)

Em outro terminal:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Abra http://localhost:3000.

Na primeira vez, a tela pede para criar uma conta; a primeira conta vira
administradora. Detalhes na seção **Autenticação**, mais abaixo.

## 3. Docker (opcional)

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose up --build
```

Frontend em http://localhost:3000, backend em http://localhost:5000.

---

## Portas

| Serviço  | Porta | Observação                                    |
| -------- | ----- | --------------------------------------------- |
| Backend  | 5000  | definida em `backend/.env`                    |
| Frontend | 3000  | definida em `frontend/vite.config.ts`         |

Se mudar a porta do backend, atualize `VITE_API_URL` no `frontend/.env` **e**
`CORS_ORIGIN` no `backend/.env`, senão o navegador bloqueia as requisições.

---

## Endpoints

Todas as rotas abaixo de `/api/v1` exigem o header `Authorization: Bearer <token>`,
menos as marcadas como públicas. O `x-session-id` é devolvido no login e deve
acompanhar as chamadas de upload, dashboard e export.

As rotas de dashboard (menos `/filtros`) e o `/export/excel` aceitam os filtros
da análise na query string: `?sentido=entrada|saida|indefinido&cfop=5102&ncm=84713012`.
Valor ausente ou inválido vale como "todos". O CFOP é o do emitente, como
consta no XML.

### Autenticação
| Método | Rota                        | Descrição                          |
| ------ | --------------------------- | ---------------------------------- |
| POST   | `/api/v1/auth/login`        | Login; devolve `token` e `sessionId` |
| POST   | `/api/v1/auth/register`     | Registro                            |
| GET    | `/api/v1/auth/verify`       | Valida o token                      |
| GET    | `/api/v1/auth/session-info` | Dados da sessão                     |

### Upload
| Método | Rota                            | Descrição                              |
| ------ | ------------------------------- | -------------------------------------- |
| POST   | `/api/v1/upload/nfe`            | ZIP com XMLs (só o campo `file`)       |
| POST   | `/api/v1/upload/empresa`        | Troca a empresa analisada (`{ cnpj }`) |
| POST   | `/api/v1/upload/clear-session`  | Limpa os documentos da sessão           |
| GET    | `/api/v1/upload/session-stats`  | Estatísticas da sessão                  |

O upload não pede tipo nem modelo. O modelo de cada XML (NF-e, NFC-e, CT-e,
CT-e OS, NFS-e) é lido da própria estrutura, a empresa analisada é o CNPJ
presente em pelo menos 80% das notas, e cada nota vira entrada (a empresa é
destinatária ou tomadora), saída (a empresa é emitente) ou sem vínculo. Quando
a empresa não é clara, a resposta traz `precisaEscolherEmpresa` e os
`candidatosEmpresa`.

### Dashboard
| Método | Rota                               | Descrição                    |
| ------ | ---------------------------------- | ---------------------------- |
| GET    | `/api/v1/dashboard`                | Análise completa             |
| GET    | `/api/v1/dashboard/resumo`         | Resumo geral                 |
| GET    | `/api/v1/dashboard/regimes`        | Consolidado por regime       |
| GET    | `/api/v1/dashboard/fornecedores`   | Top fornecedores             |
| GET    | `/api/v1/dashboard/documentos`     | Documentos (com paginação)   |
| GET    | `/api/v1/dashboard/campos`         | Conferência da reforma por nota |
| GET    | `/api/v1/dashboard/filtros`        | CFOPs e NCMs do lote, com quantidade |

### Export
| Método | Rota                                | Descrição              |
| ------ | ----------------------------------- | ---------------------- |
| GET    | `/api/v1/export/excel`              | Planilha do recorte filtrado |
| GET    | `/api/v1/export/json`               | JSON completo (sem filtros) |
| POST   | `/api/v1/export/erros-importacao`   | Planilha dos XMLs recusados |

O Excel traz as abas Resumo, Documentos, Por Regime, Fornecedores,
Pendências da reforma e Consolidado por campo. As duas últimas têm no
cabeçalho a empresa analisada, os filtros usados, a versão da tabela de
cClassTrib e a data de corte.

### Tributação (rotas públicas)
| Método | Rota                                  | Descrição                |
| ------ | ------------------------------------- | ------------------------ |
| GET    | `/api/v1/tax/rules`                   | Todas as regras          |
| GET    | `/api/v1/tax/rules/:ano`              | Regras de um ano         |
| GET    | `/api/v1/tax/aliquota`                | Alíquota específica      |
| GET    | `/api/v1/tax/comparison/:tributo`     | Comparação entre anos    |
| GET    | `/api/v1/tax/status`                  | Status do serviço        |

---

## Teste rápido pelo terminal

```bash
# 1. Login
LOGIN=$(curl -s -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"voce@empresa.com","password":"123456"}')

TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
SID=$(echo "$LOGIN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['sessionId'])")

# 2. Upload de um ZIP com XMLs
curl -X POST http://localhost:5000/api/v1/upload/nfe \
  -H "Authorization: Bearer $TOKEN" -H "x-session-id: $SID" \
  -F "file=@suas-notas.zip"

# 3. Resumo
curl http://localhost:5000/api/v1/dashboard/resumo \
  -H "Authorization: Bearer $TOKEN" -H "x-session-id: $SID"

# 4. Excel
curl http://localhost:5000/api/v1/export/excel \
  -H "Authorization: Bearer $TOKEN" -H "x-session-id: $SID" \
  -o analise.xlsx
```

---

## Formatos de XML aceitos

O parser lê tanto a nota autorizada pela SEFAZ (raiz `<nfeProc>`) quanto a nota
apenas assinada (raiz `<NFe>`), com ou sem prefixo de namespace. Os valores
vêm de `total/ICMSTot` e a data de emissão aceita `dhEmi` (NF-e 4.0) e `dEmi`
(versões antigas).

O mesmo ZIP pode misturar NF-e (55), NFC-e (65), CT-e (57), CT-e OS (67) e
NFS-e, de entrada e de saída. Um XML que não é nenhum desses documentos, ou que
está corrompido, é recusado com o motivo; os demais XMLs do ZIP continuam sendo
processados normalmente.

---

## Atenção: dados em memória

As sessões vivem na memória do processo. Reiniciar o backend apaga os
documentos importados. O token continua válido e a sessão é recriada vazia no
próximo upload — é comportamento esperado, não erro. Para persistir, veja o
`DEVELOPMENT.md`.

---

## Tabela cClassTrib e CST (Reforma Tributária do Consumo)

A tela de importação segue o Validador da Reforma Tributária do Consumo da
SEFAZ (Informe Técnico 2025.002). Os códigos vêm de `backend/data/cclasstrib.json`,
não do código-fonte, porque a SEFAZ republica a tabela a cada poucos meses.

O arquivo do projeto traz a tabela oficial do Informe Técnico 2025.002,
versão 1.70 (173 cClassTrib e 18 CST). Quando o Portal publicar outra versão:

1. Baixe a planilha no Portal Nacional da NF-e (aba Documentos > Diversos),
   mantendo o nome original do arquivo, que traz a versão
   (ex.: `IT 2025.002 v.1.70 - cClassTrib.xlsx`).
2. Rode:

```bash
cd backend
npm run importar:cclasstrib -- /caminho/da/tabela-cclasstrib.xlsx
```

O script reconhece as colunas pelo nome, em qualquer ordem, importa as abas de
cClassTrib (com a vigência) e de CST (com os grupos exigidos), grava a versão
lida do nome do arquivo e reporta a distribuição de códigos por CST ao final.
Reinicie o backend para ele ler a tabela nova.

### Endpoints

| Método | Rota                          | Descrição                              |
| ------ | ----------------------------- | -------------------------------------- |
| GET    | `/api/v1/rtc/metadados`       | Versão da tabela carregada             |
| GET    | `/api/v1/rtc/opcoes`          | Listas dos seletores da configuração   |
| GET    | `/api/v1/rtc/cst`             | Tabela de CST                          |
| GET    | `/api/v1/rtc/cclasstrib?cst=` | cClassTrib filtrado por CST            |
| POST   | `/api/v1/rtc/validar`         | Valida a combinação CST + cClassTrib   |

### Regra de vínculo

Os três primeiros dígitos do cClassTrib são idênticos ao CST-IBS/CBS. É por
isso que a lista de cClassTrib só abre depois de escolher o CST, e por isso a
API rejeita combinações cruzadas.

---

## Conferência da Reforma Tributária

O Painel mostra, em cartões de Entradas e Saídas, o percentual de notas com os
campos da reforma completos, e a lista de notas com o que falta em cada uma.
O Excel traz a mesma conferência nas abas **Pendências da reforma** e
**Consolidado por campo**.

### Regras

| Situação | Quando |
| -------- | ------ |
| Completa | CST do IBS/CBS, cClassTrib, base de cálculo, IBS estadual, IBS municipal e CBS presentes (em NF-e e NFC-e, em todos os itens) e cClassTrib compatível com o CST |
| Com pendência | Falta algum desses campos, ou os três primeiros dígitos do cClassTrib diferem do CST |
| Fora do período | Emissão antes de 01/01/2026 |
| Sem data | O XML não traz data de emissão válida |

- Só "Completa" e "Com pendência" entram no percentual.
- A data de emissão é lida no fuso do próprio XML, sem conversão.
- Imposto Seletivo ausente nunca é pendência: o XML não indica se ele incide
  sobre o item. Aparece só como informativo.
- Código de CST ou cClassTrib fora da tabela carregada gera aviso com a versão
  da tabela, nunca pendência. A vigência do cClassTrib é comparada com a data de
  emissão da nota.

---

## Autenticação

O login é real: senha validada contra hash bcrypt e usuários persistidos em
`backend/data/usuarios.json`. Não há mais o modo simulado em que qualquer
e-mail entrava.

### Primeiro acesso

Numa instalação nova o arquivo de usuários não existe, e a tela de login abre
direto em "criar a primeira conta". Depois disso, o cadastro fica disponível
pelo link "Criar conta".

Requisito de senha: mínimo de 8 caracteres.

### Recuperação de senha

O fluxo de token está implementado — geração, validade de 30 minutos, uso
único e invalidação após o uso. **O envio por e-mail não está configurado**:
não há SMTP neste projeto. Em desenvolvimento o token volta na resposta da API
e a tela o preenche automaticamente; em produção (`NODE_ENV=production`) ele
nunca é retornado, e é preciso integrar um serviço de e-mail para entregá-lo
ao usuário.

### Imagem da tela de login

Coloque a arte oficial em `frontend/public/login-hero.jpg`. Enquanto o arquivo
não existir, um gradiente equivalente aparece no lugar — a tela não quebra por
imagem ausente.

### Endpoints

| Método | Rota                             | Descrição                          |
| ------ | -------------------------------- | ---------------------------------- |
| GET    | `/api/v1/auth/status`            | Informa se já existe algum usuário |
| POST   | `/api/v1/auth/register`          | Cria conta                         |
| POST   | `/api/v1/auth/login`             | Autentica                          |
| POST   | `/api/v1/auth/esqueci-senha`     | Gera token de redefinição          |
| POST   | `/api/v1/auth/redefinir-senha`   | Redefine com o token               |

### Limitação conhecida

`usuarios.json` é arquivo, não banco de dados: sem transações nem controle de
concorrência. Serve para uso interno com poucos usuários. Para produção com
acesso simultâneo, substitua a implementação de `ler`/`gravar` em
`services/usuarios.ts` por um banco real — a interface pública da classe não
muda.

---

## Tema escuro e imagens

A interface usa a paleta escura do portal Contabilidade.net, definida em
`frontend/tailwind.config.js`:

| Token           | Cor       | Uso                          |
| --------------- | --------- | ---------------------------- |
| `fundo`         | `#0a0a0f` | Fundo da página              |
| `fundo-card`    | `#13131c` | Superfície dos cards         |
| `fundo-eleva`   | `#1c1c28` | Inputs e cabeçalhos          |
| `fundo-borda`   | `#2a2a3a` | Bordas                       |
| `marca-azul`    | `#2f6fff` | Cor principal                |
| `marca-roxo`    | `#7c3aed` | Gradientes                   |
| `marca-ciano`   | `#22d3ee` | Destaques                    |

Para trocar as cores, edite apenas esse arquivo — todas as telas usam os
tokens, não valores soltos.

### Imagens

Coloque os arquivos em `frontend/public/`:

| Arquivo           | Onde aparece                    |
| ----------------- | ------------------------------- |
| `login-hero.jpg`  | Lateral direita da tela de login |
| `banner.jpg`      | Banner do topo do dashboard      |

Enquanto os arquivos não existirem, gradientes equivalentes aparecem no lugar
— nenhuma tela quebra por imagem ausente.

---

## Painel executivo

A tela tem duas abas, **Painel** e **Regimes**, abaixo do cartão **Filtros da
análise** (Entrada/Saída, CFOP do emitente e NCM). A seleção vale para os
indicadores do topo, as duas abas, a conferência da reforma e o botão
Exportar, e continua a mesma ao trocar de aba. Sem empresa analisada, o filtro
abre em "Todas"; com empresa e alguma entrada, em "Entradas/Compras".

O Painel traz, nesta ordem: os cartões da conferência da reforma, o painel
executivo (alertas, KPIs, participação por tributo, fornecedores por valor e
composição por regime), o bloco **Resumo** com a distribuição de tributos e a
lista de notas da conferência.

O painel executivo baixa os documentos do recorte e calcula no navegador; os
chips de Regime dentro dele respondem na hora. Para bases muito grandes (acima
de ~5.000 notas), vale mover essas agregações para o backend.

Os alertas do topo são gerados a partir dos próprios dados — concentração em um
fornecedor, participação do Simples Nacional e variação de tributos no período.
Não são textos fixos.


---

## URL do backend: detecção automática

O frontend descobre sozinho onde está o backend, nesta ordem:

1. `VITE_API_URL`, se estiver definido no `frontend/.env` — sempre vence.
2. **GitHub Codespaces / Gitpod**: a URL do frontend tem a porta no nome
   (`...-3000.app.github.dev`). O sistema troca para `-5000` e usa esse
   endereço.
3. **Local**: `http://localhost:5000`.

Ou seja: em ambiente remoto **não é mais preciso configurar URL a cada novo
container**. O `frontend/.env.example` já vem com a variável comentada.

O que ainda é necessário no Codespaces: na aba **Portas**, a porta **5000**
precisa estar com visibilidade **Pública**. Sem isso o navegador recebe a
página de login do GitHub em vez da resposta da API. Se a conexão falhar, a
própria tela avisa exatamente isso.

Se o backend estiver noutra porta ou noutro host, defina `VITE_API_URL` no
`frontend/.env` e reinicie o Vite (variáveis de ambiente só são lidas na
inicialização).


## CORS em ambiente remoto

O backend aceita automaticamente, **apenas em desenvolvimento**, origens de:

- `localhost` e `127.0.0.1` em qualquer porta
- `*.app.github.dev` (GitHub Codespaces)
- `*.githubpreview.dev`
- `*.gitpod.io`

Isso evita ter de reconfigurar `CORS_ORIGIN` a cada container novo. O sintoma
de um CORS mal configurado é traiçoeiro: o navegador bloqueia a resposta antes
de o código enxergá-la, e o erro aparece como falha de rede, sem citar CORS.

Com `NODE_ENV=production`, essa flexibilidade é desligada e **apenas** o que
estiver em `CORS_ORIGIN` é aceito. A variável aceita várias origens separadas
por vírgula:

```
CORS_ORIGIN=https://app.exemplo.com,https://admin.exemplo.com
```

Quando uma origem é recusada, o terminal do backend registra:
`⚠️  CORS bloqueou a origem: <url>` — o primeiro lugar para olhar se algo
parar de funcionar depois de publicar.
