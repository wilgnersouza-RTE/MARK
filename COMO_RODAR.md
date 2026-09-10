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

O login é simulado: qualquer e-mail válido entra e a sessão é criada a partir
dele. Não há banco de dados — trocar isso por autenticação real é o passo
descrito no `DEVELOPMENT.md`.

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

Todas as rotas abaixo de `/api/v1` exigem o header `Authorization: Bearer <token>`.
O `x-session-id` é devolvido no login e deve acompanhar as chamadas de upload,
dashboard e export.

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
| POST   | `/api/v1/upload/nfe`            | ZIP com XMLs (`tipo`, `modelo`, `file`) |
| POST   | `/api/v1/upload/clear-session`  | Limpa os documentos da sessão           |
| GET    | `/api/v1/upload/session-stats`  | Estatísticas da sessão                  |

### Dashboard
| Método | Rota                               | Descrição                    |
| ------ | ---------------------------------- | ---------------------------- |
| GET    | `/api/v1/dashboard`                | Análise completa             |
| GET    | `/api/v1/dashboard/resumo`         | Resumo geral                 |
| GET    | `/api/v1/dashboard/divergencias`   | Divergências encontradas     |
| GET    | `/api/v1/dashboard/regimes`        | Consolidado por regime       |
| GET    | `/api/v1/dashboard/fornecedores`   | Top fornecedores             |
| GET    | `/api/v1/dashboard/transicao`      | Transição 2024-2027          |
| GET    | `/api/v1/dashboard/documentos`     | Documentos (com paginação)   |

### Export
| Método | Rota                                | Descrição              |
| ------ | ----------------------------------- | ---------------------- |
| GET    | `/api/v1/export/excel`              | Planilha com 6 abas    |
| GET    | `/api/v1/export/json`               | JSON completo          |
| GET    | `/api/v1/export/csv-divergencias`   | CSV das divergências   |

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
  -F "file=@suas-notas.zip" -F "tipo=entrada" -F "modelo=55"

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

O `modelo` informado no upload precisa bater com a tag `<mod>` do XML, senão o
arquivo é rejeitado com o erro correspondente — os demais XMLs do ZIP continuam
sendo processados normalmente.

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

**O arquivo que acompanha o projeto é parcial** — contém apenas os códigos de
referência. Para carregar a tabela oficial completa:

1. Baixe a planilha no Portal Nacional da NF-e (aba Documentos > Diversos).
2. Rode:

```bash
cd backend
npm run importar:cclasstrib -- /caminho/da/tabela-cclasstrib.xlsx
```

O script reconhece as colunas pelo nome, em qualquer ordem, e reporta a
distribuição de códigos por CST ao final.

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

## Simulação da Reforma Tributária (2026-2033)

A aba **Reforma 2027-2033** simula a carga tributária de cada ano da transição,
e a aba **Divergências** permite recalcular as ocorrências pela legislação de
qualquer ano do período.

### O que vem da lei e o que é estimativa

| Item | Origem |
| ---- | ------ |
| Fatores de transição (ICMS/ISS a 90%, 80%, 70%, 60%, extinção) | EC 132/2023 e LC 214/2025 |
| Extinção de PIS/Cofins e IPI zerado em 2027 | LC 214/2025 |
| IBS a 0,1% em 2026-2028 | LC 214/2025 |
| **Alíquota do IVA (28%) e do Imposto Seletivo** | **Estimativa — pendente de resolução do Senado (art. 349)** |

Por isso as alíquotas são **parâmetro editável na tela**, não constante do
sistema. O arquivo `backend/data/reforma-transicao.json` tem os campos
`revisadoPor` e `revisadoEm`, hoje nulos: preencha-os quando o time tributário
validar os números, e o aviso da interface deixa de aparecer.

### Endpoints

| Método | Rota                                   | Descrição                          |
| ------ | -------------------------------------- | ---------------------------------- |
| GET    | `/api/v1/reforma/metadados`            | Anos, regimes e avisos             |
| GET    | `/api/v1/reforma/simulacao?ano=2033`   | Simulação de um ano                |
| GET    | `/api/v1/reforma/serie`                | Série 2026-2033 para gráficos      |
| GET    | `/api/v1/reforma/divergencias?ano=`    | Divergências recalculadas por ano  |

Parâmetros aceitos: `iva`, `cbs`, `is`, `regime`, `sujeitoIS`.

### O que não é calculado

**Tributos em cadeia (resíduo tributário).** Exige matriz insumo-produto por
CNAE, que o XML da NF-e não fornece. A tela declara isso explicitamente em vez
de exibir um número estimado sem lastro.

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

A aba **Painel** é a tela inicial: layout denso no estilo BI, com cabeçalho
compacto, chips de filtro, alertas, KPIs, heatmap e tabelas.

Diferença importante em relação às outras abas: o painel **baixa os documentos
uma vez e calcula tudo no navegador**. Os filtros de regime e tipo respondem na
hora, sem nova chamada ao servidor. Para bases muito grandes (acima de ~5.000
notas), vale mover essas agregações para o backend.

Os alertas do topo são gerados a partir dos próprios dados — concentração em um
fornecedor, participação do Simples Nacional, variação de tributos no período e
volume de divergências. Não são textos fixos.

O heatmap cruza tributo × ano da transição: azul indica avanço, rosa indica
recuo, e o valor em reais aparece ao passar o mouse.


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
