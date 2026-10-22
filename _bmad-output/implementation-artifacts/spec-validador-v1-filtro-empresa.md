---
title: 'Filtro por empresa com todas as importações do cliente e totalizador'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '429f6a8a849d28cf06bdd42e6a86667f0f4999ac'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-validador-v1-analises-salvas.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O painel mostra só o lote aberto na sessão. O contador quer filtrar por cliente e ver todas as importações vinculadas a ele, com o totalizador de valores (pedido do usuário em 2026-10-22).

**Approach:** O cartão de filtros ganha a lista EMPRESA, com "Lote atual" (comportamento de hoje) e as empresas com análises salvas. Escolhida uma empresa, o painel junta as notas da versão mais recente de cada competência daquele cliente (decisão do usuário, opção A) e todo o resto (indicadores, Painel, Resumo, conferência de tributos, Regimes e Excel) passa a valer para esse conjunto, com os filtros Entrada/Saída, CFOP e NCM por cima. Um bloco "Importações do cliente" lista cada importação incluída com notas, valor total e tributos, e uma linha de total geral.

## Boundaries & Constraints

**Always:** só entra a versão mais recente de cada competência da empresa; versões antigas continuam salvas e fora da soma; "Lote atual" é o padrão e mantém o comportamento atual; a escolha da empresa não altera o lote da sessão nem as análises salvas (só leitura); as opções de CFOP e NCM e o sentido padrão passam a refletir o conjunto da empresa quando ela está escolhida; o totalizador do bloco "Importações do cliente" respeita os filtros Entrada/Saída, CFOP e NCM; a carga do conjunto da empresa é feita uma vez e reaproveitada nas chamadas seguintes da mesma sessão enquanto a empresa e as análises não mudarem; com armazenamento em memória ou Supabase fora, a empresa escolhida mostra o aviso com a causa e o painel não quebra.

**Never:** somar várias versões da mesma competência; gravar ou alterar análises ao filtrar; trazer a chave da Supabase ao frontend; mudar login, importação ou exclusão.

## I/O & Edge-Case Matrix

| Cenário | Entrada / Estado | Resultado esperado | Erros |
|----------|--------------|---------------------------|----------------|
| Lote atual | EMPRESA = "Lote atual" | Painel igual ao de hoje | N/A |
| Empresa com versões | Supera: 03/2026 v1, v2, v3 | Só v3 entra; 41 notas, não 123 | N/A |
| Várias competências | Empresa com 01/2026 v1 e 02/2026 v2 | As duas competências somadas | N/A |
| Totalizador | Empresa escolhida | Uma linha por importação incluída (competência, versão, data, notas, valor total, tributos) e total geral igual à soma | N/A |
| Com filtro | Empresa + Entradas/Compras | Indicadores, lista e totalizador só com entradas | N/A |
| Empresa sem análises | CNPJ sem análise completa | Painel vazio com aviso "Nenhuma análise salva desta empresa" | N/A |
| Análise excluída | Versão mais recente excluída após a carga | Próxima carga usa a versão anterior | N/A |
| Supabase fora | Erro na carga | Aviso com a causa; "Lote atual" continua funcionando | 503 com `causaDaFalha` |
| Parâmetro inválido | `empresa=abc` | 400 | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/routes/dashboard.ts` -- `carregarDashboard` (l. 35) decide de onde vêm os documentos (hoje a sessão); todas as rotas (l. 77-264) passam por ela ou leem a sessão direto (`/campos`, `/filtros`): acrescentar o parâmetro `empresa`.
- `backend/src/routes/export.ts` -- `/excel` (l. 20) lê os documentos da sessão: mesma origem com `empresa`.
- `backend/src/services/analises.ts`, `backend/src/services/armazenamentoAnalises.ts` -- `listar`, `obter`, `listarEmpresas` para montar o conjunto (versão mais recente por competência) e a tabela de importações.
- `backend/src/utils/filtros.ts` -- `lerFiltros`, `filtrarDocumentos`, `opcoesDoLote`.
- `frontend/src/components/FiltrosAnalise.tsx` -- `EstadoFiltros` (l. 14), `ParametrosFiltro` (l. 36), `paraParametros` (l. 38): acrescentar EMPRESA.
- `frontend/src/App.tsx` -- `DashboardContent` mantém o estado dos filtros e chama as rotas com os parâmetros; acrescentar o bloco "Importações do cliente" no Painel.

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/conjuntoEmpresa.ts` -- montar o conjunto da empresa (versão mais recente por competência), com cache por sessão invalidado quando a lista de análises da empresa muda, e a tabela de importações com totais.
- [x] `backend/src/routes/dashboard.ts`, `backend/src/routes/export.ts` -- parâmetro `empresa` em todas as rotas de leitura e no Excel; `/filtros` devolve as empresas e as opções do conjunto; nova `GET /dashboard/importacoes?empresa=` com a tabela e o total geral.
- [x] `frontend/src/components/FiltrosAnalise.tsx`, `frontend/src/App.tsx` -- lista EMPRESA ("Lote atual" + empresas), envio em todas as buscas e no Exportar, bloco "Importações do cliente".
- [x] testes em `backend/src/routes/dashboard.test.ts` e `backend/src/services/conjuntoEmpresa.test.ts` -- matriz com o armazenamento em memória.
- [x] `COMO_RODAR.md` -- parâmetro `empresa` e rota nova.

**Acceptance Criteria:**
- Given a empresa Supera escolhida, when o painel carrega, then mostra 41 notas da 03/2026 v3 e o totalizador com uma linha e total igual.
- Given "Lote atual", when escolhido de novo, then o painel volta ao lote da sessão.

## Verification

**Commands:**
- `cd backend && npx tsc --noEmit` -- sem erros
- `cd backend && npx jest --runInBand` -- todos os testes passam
- `cd frontend && npm run build` -- build sem erros
