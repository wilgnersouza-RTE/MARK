---
title: 'Importação automática: tipo e sentido identificados por nota'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '5121ff7f56f95ed618e33d07157b8bddf21c0a85'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-validador-notas-v1/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hoje o contador precisa escolher tipo (entrada/saída) e modelo antes do upload, o parser recusa XML de modelo diferente do escolhido e o lote é recusado inteiro quando mistura entradas e saídas. O ZIP real do mês traz NF-e, NFC-e, CT-e e NFS-e, de entrada e de saída, juntos (CAP-1, CAP-2, CAP-3 da SPEC v1).

**Approach:** Um ZIP por vez, por arrastar e soltar ou botão, sem seletores. O parser identifica o modelo pela estrutura do XML; o sistema identifica o CNPJ da empresa analisada no lote e classifica cada nota como entrada (empresa é destinatária ou tomadora) ou saída (empresa é emitente). Quando a empresa não pode ser identificada, a tela lista os CNPJs encontrados para o contador escolher, e a escolha reclassifica as notas já importadas.

## Boundaries & Constraints

**Always:** cada ZIP substitui a análise anterior, só em memória; recusa por arquivo continua (XML corrompido, sem valores fiscais ou de estrutura desconhecida) sem derrubar o lote; o contador pode trocar a empresa analisada depois do upload; mensagens e identificadores em português; envelope `{ success, data | error, timestamp }`.

**Never:** recusar XML ou lote por modelo ou sentido; usar `tpNF` para o sentido (é o ponto de vista do emitente); persistir lote ou empresa; mexer em conferência de campos, resumo, painel, filtros ou na página Configurações (entregas seguintes); editar `backend/data/*.json`; versionar XML real.

## I/O & Edge-Case Matrix

| Cenário | Entrada / Estado | Resultado esperado | Erros |
|----------|--------------|---------------------------|----------------|
| Lote misto | ZIP com NF-e, CT-e e NFS-e; empresa X destinatária em umas e emitente em outras | Todas aceitas, cada uma com seu modelo; entradas e saídas contadas; empresa X informada | N/A |
| Empresa clara | CNPJ X presente em ≥ 80% das notas e mais que qualquer outro | Empresa X escolhida automaticamente | N/A |
| Empresa ambígua | 1 nota, ou empate entre os mais frequentes, ou nenhum CNPJ em ≥ 80% | Notas importadas sem sentido; resposta pede escolha e lista candidatos (CNPJ, nome, quantidade de notas) | N/A |
| Escolha da empresa | `POST /upload/empresa` com CNPJ dos candidatos | Notas da sessão reclassificadas; dashboard regenerado | CNPJ fora do lote → 400 |
| Nota sem vínculo | Empresa não é emitente nem destinatária/tomadora | Sentido `indefinido`, contada à parte | N/A |
| Empresa nos dois lados | Emitente e destinatário iguais | Saída | N/A |
| XML desconhecido | Não é NF-e, NFC-e, CT-e nem NFS-e | Arquivo recusado com motivo; demais seguem | Lista de recusados |
| ZIP sem nota válida | Nenhum XML reconhecido | 400 "Nenhuma nota fiscal reconhecida no ZIP" com recusados | `details` |

</frozen-after-approval>

## Code Map

- `backend/src/services/nfeParser.ts` -- `parseNFE(xml, tipo, modelo)` (l. 60): despacho por raiz; remover parâmetros e as recusas por modelo (l. 79-91, 109-123, 136-142); usar `modeloXml`/`modeloXmlCte`; `parseNFSe`/`parseCTe` recebem `tipo` só para gravar. Import `reformaService` sem uso (l. 12) fica para a entrega do painel.
- `backend/src/utils/sentidoImportacao.ts` -- `inferirSentido` por lote; substituir por identificação da empresa e classificação por nota. Reaproveitar a nota sobre `tpNF`.
- `backend/src/routes/upload.ts` -- `POST /nfe` exige `tipo`/`modelo` (l. 40-83) e recusa lote (l. 165-190); nova rota `POST /empresa`.
- `backend/src/services/session.ts` -- `adicionarDocumentos` (l. 65) regenera dashboard; precisa guardar a empresa e reclassificar.
- `backend/src/types/index.ts` -- `DocumentType` (l. 52), `ImportacaoArquivo.tipo/modelo` (l. 262-263), `UserSession` (l. 302).
- `backend/src/routes/export.ts` -- `/erros-importacao` (l. 115-169) imprime tipo e modelo selecionados; trocar por nada.
- `backend/src/services/export.ts` -- l. 83 `String(doc.tipo)`; mostrar rótulo legível.
- `frontend/src/App.tsx` -- `UploadSection` (l. 336-583): seletores (l. 459-485), envio (l. 400-405), avisos (l. 504-517).
- `frontend/src/components/PainelExecutivo.tsx` -- filtro compara `d.tipo` minúsculo com `'saida'` (l. 306, 601); com `tipo` gravado como `'saida'` o filtro de Saída passa a funcionar (hoje `'saída'` nunca casa).

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/types/index.ts` -- `DocumentType = 'entrada' | 'saida' | 'indefinido'`; tirar `tipo`/`modelo` de `ImportacaoArquivo`; `UserSession.empresa?: { cnpj, nome, inferida }` -- um só formato de sentido.
- [x] `backend/src/services/nfeParser.ts` -- `parseNFE(xml)` sem tipo nem modelo; devolve `tipo: 'indefinido'` e o modelo lido do XML; erro único para estrutura desconhecida -- autodetecção.
- [x] `backend/src/utils/sentidoImportacao.ts` -- `identificarEmpresa(docs)` (empresa ou candidatos) e `classificarSentido(docs, cnpj)` -- regras da matriz.
- [x] `backend/src/services/session.ts` -- guardar empresa; `definirEmpresa(sessionId, cnpj)` reclassifica e regenera dashboard.
- [x] `backend/src/routes/upload.ts` -- `POST /nfe` só com `file`; resposta com contagem por modelo, por sentido, empresa e `candidatosEmpresa`/`precisaEscolherEmpresa`; `POST /empresa` -- fluxo sem seletores.
- [x] `backend/src/routes/export.ts`, `backend/src/services/export.ts` -- sem colunas de seleção; sentido legível.
- [x] `frontend/src/App.tsx` -- área de arrastar e soltar mais botão; sem seletores; resumo pós-upload (por modelo, entradas, saídas, sem vínculo); empresa com "Alterar"; seletor de candidatos quando necessário; ajuda atualizada.
- [x] `backend/jest.config.js`, `backend/src/utils/sentidoImportacao.test.ts`, `backend/src/services/nfeParser.test.ts` -- configurar ts-jest e testar a matriz e a autodetecção (NF-e com `exemplos/nota1.xml`; CT-e, NFS-e e XML desconhecido com XML mínimo inline).

**Acceptance Criteria:**
- Given a tela de upload, when aberta, then não há seletor de tipo nem de modelo.
- Given um ZIP arrastado para a área de upload, when solto, then a importação começa como pelo botão.
- Given um lote importado com empresa identificada, when o contador clica em "Alterar" e escolhe outro CNPJ, then as contagens de entrada e saída mudam sem novo upload.
- Given a resposta de `/upload/nfe`, when inspecionada, then não contém `tipo` ou `modelo` selecionados e cada documento tem `tipo` em `entrada | saida | indefinido`.

## Design Notes

Identificação da empresa: para cada CNPJ, conte em quantas notas ele aparece (emitente ou destinatário/tomador, uma vez por nota; ignore `N/A`). Vence o primeiro se aparecer em ≥ 80% das notas e estritamente mais que o segundo; senão, candidatos = os cinco mais frequentes com o nome mais recente visto. Em CT-e, `cnpjDestino` já é o tomador.

## Verification

**Commands:**
- `cd backend && npx tsc --noEmit` -- sem erros
- `cd backend && npx jest` -- todos os testes passam
- `cd frontend && npm run build` -- build sem erros

**Manual checks:**
- Em http://localhost:3000, soltar `exemplos/notas-exemplo.zip`: 3 NF-e importadas, empresa identificada ou candidatos oferecidos, e nenhum seletor de tipo ou modelo na tela.
