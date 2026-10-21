---
title: 'Painel enxuto com filtros de Entrada/Saída, CFOP e NCM'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a7c27e1d655ba099c5a5aa1c8a63217a5a864a4e'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-validador-notas-v1/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Depois de testar a importação automática, o usuário pediu: excluir a opção de configurações tributárias; tirar as abas Reforma 2027-2033 e Transição; levar o conteúdo da aba Detalhado para dentro do Painel, com o nome "Resumo"; e ter um cartão de filtros Entrada/Saída, CFOP e NCM, em listas suspensas como na imagem enviada, valendo para todas as abas, sem o filtro de empresa que aparece na imagem (CAP-6, CAP-7, CAP-9, CAP-10 da SPEC v1).

**Approach:** O parser passa a guardar CFOP e NCM de cada nota. O backend filtra os documentos da sessão por sentido, CFOP e NCM antes de calcular qualquer indicador, e informa as opções disponíveis no lote. O frontend ganha uma barra única de filtros acima das abas, que alimenta os indicadores do topo, o Painel (com o bloco Resumo) e a aba Regimes.

## Boundaries & Constraints

**Always:** filtros combinam entre si (E lógico); nota entra no filtro de CFOP ou NCM se qualquer item (ou a operação, no CT-e) tiver o código; listas de CFOP e NCM mostram só códigos presentes no lote, com a quantidade de notas; "Todos" é a opção neutra de cada filtro; o filtro Entrada/Saída abre em "Entradas/Compras" quando há empresa analisada e em "Todas" quando não há; mensagens e identificadores em português; envelope `{ success, data | error, timestamp }`.

**Decisão do usuário (2026-10-21, revisão):** o filtro de CFOP usa o código como consta no XML, do ponto de vista do emitente, sem converter para o CFOP de entrada; a tela avisa "CFOP do emitente". Os códigos da matriz são exemplos.

**Never:** filtro por empresa; recalcular a importação ou alterar a classificação de sentido; mexer na conferência de campos da reforma, além de fazê-la respeitar os filtros; mexer em login, cadastro e administração; editar `backend/data/*.json`; manter filtros avançados (CST, cClassTrib, finalidade, CRT).

## I/O & Edge-Case Matrix

| Cenário | Entrada / Estado | Resultado esperado | Erros |
|----------|--------------|---------------------------|----------------|
| Sem filtro | Sentido "Todas", CFOP e NCM "Todos" | Indicadores iguais ao lote inteiro | N/A |
| Só entradas | Sentido "Entradas/Compras" | Só notas `entrada` em indicadores, Painel, Resumo e Regimes | N/A |
| Sem vínculo | Sentido "Sem vínculo" | Só notas `indefinido` | N/A |
| CFOP | CFOP 1102 | Notas com algum item ou operação 1102; NFS-e fora | N/A |
| NCM | NCM 84713012 | NF-e/NFC-e com algum item desse NCM; CT-e e NFS-e fora | N/A |
| Combinação vazia | Filtros sem nota em comum | Indicadores zerados e aviso "Nenhuma nota com os filtros escolhidos" | N/A |
| Parâmetro inválido | `sentido=xyz` | Ignorado, tratado como "Todas" | N/A |
| Lote sem empresa | Todas as notas `indefinido` | Filtro abre em "Todas" | N/A |
| Exportar filtrado | Sentido "Entradas/Compras" e CFOP 1102 | Excel só com as notas desse recorte | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/services/nfeParser.ts` -- `lerItens` (l. 515) percorre `det`; acrescentar CFOP e NCM de `det/prod`; CT-e: CFOP em `ide.CFOP`. Remover import sem uso de `reformaService` (l. 12).
- `backend/src/types/index.ts` -- `NFeDocument` (l. 98): `cfops: string[]`, `ncms: string[]`.
- `backend/src/routes/dashboard.ts` -- `carregarDashboard` (l. 23) centraliza leitura da sessão: aplicar o filtro de `req.query` aqui; `/campos` (l. 213) lê `sessao.documentos` direto e precisa do mesmo filtro; `/transicao` (l. 141) sai; nova rota `GET /filtros` com as opções.
- `backend/src/services/dashboard.ts` -- `calcularTransicaoAnual` (l. 282-338) sai com a rota.
- `backend/src/routes/reforma.ts`, `backend/src/services/reforma.ts`, registro em `backend/src/server.ts` (l. 16, 110) -- removidos; só a aba Reforma e o heatmap do Painel os consumiam.
- `backend/src/services/export.ts` -- aba Excel "Transição 2024-2027" (l. 173-200) sai.
- `frontend/src/App.tsx` -- abas (l. 863-869), aba `resumo` "Detalhado" (l. 899-1023) vira bloco no Painel, `transicao` (l. 1129) e `reforma` (l. 1163) saem; `refreshDashboard` (l. 1251) busca `/transicao`; página e estado `config` (l. 1199-1202, 1345-1355), botão de Configurações no `UploadSection` e envio de `configuracao`; menu do `Header` com o item Configurações.
- `frontend/src/components/PainelExecutivo.tsx` -- busca `/dashboard/documentos` (l. 277) e `/reforma/serie` (l. 287); chips Regime e Tipo (l. 583-622); evolução mensal (l. 665-692) e heatmap (l. 694-750) saem conforme a SPEC v1.
- `frontend/src/components/AbaReforma.tsx`, `AbaDivergencias.tsx` (órfão), `ConfiguracoesImportacao.tsx` -- removidos.
- `frontend/src/components/CamposTributarios.tsx` -- busca `/dashboard/campos` (l. 44); passa a enviar os filtros.
- `backend/src/routes/export.ts` -- `/excel` (l. 19-61) monta a planilha com todos os documentos da sessão; o botão "Exportar Excel" atual fica em `App.tsx` (`handleExportExcel`, l. 745) e passa para o cartão de filtros.

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/types/index.ts`, `backend/src/services/nfeParser.ts` -- guardar `cfops` e `ncms` únicos por nota (vazios em NFS-e; só CFOP em CT-e) -- base dos filtros.
- [x] `backend/src/utils/filtros.ts` -- `lerFiltros(query)` e `filtrarDocumentos(docs, filtros)` puros -- regra única para todas as rotas.
- [x] `backend/src/routes/dashboard.ts` -- aplicar filtros em `carregarDashboard` e `/campos`; `GET /filtros` devolve CFOPs e NCMs do lote com quantidade, e se há empresa; remover `/transicao`.
- [x] Backend de reforma e transição -- remover `routes/reforma.ts`, `services/reforma.ts`, registro em `server.ts`, `calcularTransicaoAnual` e a aba Excel de transição.
- [x] `frontend/src/components/FiltrosAnalise.tsx` -- cartão no modelo da imagem: ícone, título "Filtros da análise", subtítulo "Entrada/Saída, CFOP e NCM do lote", botões "Retrair" (recolhe as listas) e "Exportar" (Excel, respeitando os filtros); três listas suspensas com rótulo em maiúsculas acima: ENTRADA/SAÍDA (Entradas/Compras, Saídas/Vendas, Sem vínculo, Todas), CFOP ("Todos os CFOPs" e códigos com quantidade), NCM ("Todos os NCMs" e códigos com quantidade).
- [x] `backend/src/routes/export.ts` -- `/excel` aplica `filtrarDocumentos` com os mesmos parâmetros -- o Exportar do cartão sai com o recorte da tela.
- [x] `frontend/src/App.tsx` -- estado dos filtros no `DashboardContent`, enviado em todas as buscas; abas Painel e Regimes; bloco "Resumo" (antigo Detalhado) dentro do Painel; aviso de combinação vazia; sem `config`, botão, página e item de menu de configurações.
- [x] `frontend/src/components/PainelExecutivo.tsx`, `CamposTributarios.tsx` -- receber filtros por propriedade e repassar à API; tirar chips de Tipo, evolução mensal e heatmap; manter chips de Regime.
- [x] Remover `AbaReforma.tsx`, `AbaDivergencias.tsx`, `ConfiguracoesImportacao.tsx`.
- [x] `backend/src/utils/filtros.test.ts`, `backend/src/services/nfeParser.test.ts`, `backend/src/routes/dashboard.test.ts` -- cobrir a matriz, a extração de CFOP/NCM e `GET /filtros`.

**Acceptance Criteria:**
- Given o Painel aberto, when o contador olha as abas, then existem só Painel e Regimes, e o Painel traz o bloco Resumo com a distribuição de tributos.
- Given a tela de upload e o menu do usuário, when abertos, then não há opção de configurações tributárias.
- Given um filtro aplicado, when o contador troca de aba, then a seleção continua a mesma e vale para a aba nova.
- Given `GET /api/v1/dashboard/filtros`, when chamado, then devolve só CFOPs e NCMs presentes no lote, cada um com a quantidade de notas.

## Design Notes

Filtros chegam ao backend como query string: `?sentido=entrada|saida|indefinido&cfop=1102&ncm=84713012`. Ausente ou inválido equivale a "todos". A lista de opções de CFOP e NCM é calculada sobre o lote inteiro, não sobre o resultado filtrado, para o contador poder trocar de código sem limpar os outros filtros.

## Verification

**Commands:**
- `cd backend && npx tsc --noEmit` -- sem erros
- `cd backend && npx jest --runInBand` -- todos os testes passam
- `cd frontend && npm run build` -- build sem erros

**Manual checks:**
- Em http://localhost:3000, importar `exemplos/notas-exemplo.zip`, trocar Entrada/Saída, CFOP e NCM e conferir que indicadores, Painel e Regimes mudam juntos.
