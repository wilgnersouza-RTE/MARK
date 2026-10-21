---
title: 'Conferência da reforma por nota, resumo pelo percentual e relatório'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '16f1c1e46a8761e7137b620fc5ca73c3cac17d21'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-validador-notas-v1/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-validador-notas-v1/campos-reforma.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A conferência atual só diz se cada campo existe, mistura campos atuais e da reforma na contagem, não valida CST x cClassTrib, não considera a data de corte e não entra no Excel. O contador não consegue ver nem levar ao cliente o que falta ajustar no emissor (CAP-4, CAP-5, CAP-8 da SPEC v1; regras em `campos-reforma.md`).

**Approach:** Cada nota recebe uma situação da reforma calculada sobre os sete campos de `campos-reforma.md`, com a regra de vínculo do cClassTrib validada por item e a data de corte de 01/01/2026. O Painel mostra o percentual de notas completas em entradas e saídas e a lista de notas com o que falta, pelo nome do campo. O Excel ganha as abas de pendências por nota e do consolidado por campo, com os filtros e a empresa analisada no cabeçalho.

## Boundaries & Constraints

**Always:** situações possíveis: `completa`, `com pendência`, `fora do período` (emissão antes de 01/01/2026), `sem data` (XML sem data de emissão); só `completa` e `com pendência` entram no percentual; pendência = campo da reforma ausente (em NF-e e NFC-e, ausente em algum item) ou cClassTrib cujos três primeiros dígitos diferem do CST do IBS/CBS; cClassTrib ou CST fora da tabela carregada é aviso com a versão da tabela, nunca pendência; tudo respeita os filtros Entrada/Saída, CFOP e NCM.

**Decisão do usuário (2026-10-21):** Imposto Seletivo ausente nunca é pendência na v1; aparece como informativo "só exigido para itens sujeitos ao Seletivo". A nota fica completa com os outros seis campos presentes e o vínculo correto.

**Never:** tratar código ausente da tabela parcial como erro; editar `backend/data/cclasstrib.json` (só via `npm run importar:cclasstrib`); propor como corrigir (fora da v1); persistir resultados; mexer em importação, filtros ou login.

## I/O & Edge-Case Matrix

| Cenário | Entrada / Estado | Resultado esperado | Erros |
|----------|--------------|---------------------------|----------------|
| Completa | NF-e 2026, sete campos em todos os itens, cClassTrib 000001 com CST 000 | `completa`, sem pendências | N/A |
| Campo ausente | NFS-e 2026 sem CBS | `com pendência`: "CBS" | N/A |
| Parcial em itens | NF-e 2026, 3 itens, cClassTrib em 2 | `com pendência`: "cClassTrib (2 de 3 itens)" | N/A |
| Vínculo errado | Item com CST 000 e cClassTrib 200001 | `com pendência`: "cClassTrib incompatível com o CST" | N/A |
| Fora da tabela | cClassTrib 000099 com CST 000, ausente da tabela | `completa` com aviso "não consta na tabela carregada (v1.31)" | N/A |
| Antes do corte | Emissão 15/12/2025 | `fora do período`, sem pendências, fora do percentual | N/A |
| Sem data | XML sem dhEmi, dEmi e equivalentes | `sem data`, aviso, fora do percentual | N/A |
| Percentual | 4 entradas exigíveis, 3 completas | Entradas: 4 notas, 3 completas, 75% | N/A |
| Excel | Filtro Entradas | Abas de pendências e consolidado só com entradas; cabeçalho com filtros e empresa | Recorte vazio → 400 existente |

</frozen-after-approval>

## Code Map

- `backend/src/services/nfeParser.ts` -- `lerItens` (l. 540-587) já lê `cstReforma` e `cClassTrib` por item, mas descarta; guardar no documento. CT-e (l. 701-702) e NFS-e (l. 445-446) idem, por nota. Data: NF-e l. 150-153, NFS-e l. 375-377, CT-e l. 684 caem em `new Date()` sem marcar; marcar `semDataEmissao`. NFS-e: `buscar` pega a primeira tag `CST` em qualquer profundidade (l. 242-258); preferir o `CST` dentro do grupo `IBSCBS` quando existir.
- `backend/src/types/index.ts` -- `NFeDocument` (l. 110-120), `CampoTributario` (l. 137-145).
- `backend/src/services/camposTributarios.ts` -- campos da reforma identificados por `grupo: 'reforma'` e `campo` ('CST', 'cClassTrib', 'Base de cálculo IBS/CBS', 'IBS estadual', 'IBS municipal', 'CBS', 'Imposto Seletivo'); `situacaoPorItem` (l. 39-42); `resumoDoPreenchimento` (l. 175-183) mistura atual e reforma, não usar para o percentual.
- `backend/src/services/rtc.ts` -- `validarCombinacao` (l. 135-185) aplica vínculo, mas trata CST fora da tabela como erro e valida vigência contra hoje; `obterMetadados().versaoTabela`; `obterCClassTribPorCodigo` (l. 114), `obterCSTPorCodigo` (l. 98). Reaproveitar a tabela, não a regra de erro.
- `backend/src/routes/dashboard.ts` -- `GET /campos` (l. 181-218) já filtra; não devolve `tipo`, `dataEmissao` nem situação da reforma; sem sessão responde `[]`.
- `backend/src/services/export.ts` -- `exportarDados(documentos, dashboard, temEmpresa)` (l. 9-14), abas atuais; `routes/export.ts` (l. 20-73) já filtra e calcula `temEmpresa`.
- `frontend/src/components/CamposTributarios.tsx` -- lista com filtro local Todas/Com campos faltando/Completas (l. 68-136) e colunas atual/reforma ao expandir (l. 182-254).
- `frontend/src/App.tsx` -- Painel: `PainelExecutivo` (l. 986), bloco Resumo (l. 988-1106), `CamposTributarios` (l. 1114).

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/types/index.ts`, `backend/src/services/nfeParser.ts` -- guardar por nota os pares CST/cClassTrib da reforma (por item em NF-e e NFC-e) e `semDataEmissao` -- base da validação.
- [x] `backend/src/services/conferenciaReforma.ts` -- função pura `conferirReforma(doc, tabela)` com situação, pendências pelo nome do campo e avisos; `resumoPorSentido(docs)` com total, completas e percentual de entradas e saídas -- regras da matriz.
- [x] `backend/src/routes/dashboard.ts` -- `/campos` devolve, por nota, sentido, data, situação, pendências e avisos, e o resumo por sentido; sem sessão, mesmo formato vazio.
- [x] `backend/src/services/export.ts`, `backend/src/routes/export.ts` -- abas "Pendências da reforma" (uma linha por nota exigível com pendência ou aviso) e "Consolidado por campo" (quantas notas têm cada problema), com cabeçalho de filtros, empresa e versão da tabela.
- [x] `frontend/src/App.tsx`, `frontend/src/components/CamposTributarios.tsx` -- no topo do Painel, dois cartões Entradas e Saídas com notas exigíveis, completas e percentual; lista com filtro Todas | Com pendência | Completas | Fora do período | Sem data, e as pendências pelo nome em cada nota.
- [x] `backend/src/services/conferenciaReforma.test.ts`, `backend/src/services/nfeParser.test.ts`, `backend/src/routes/dashboard.test.ts`, `backend/src/routes/export.test.ts` -- cobrir a matriz, a extração dos pares e da falta de data, o `/campos` e as abas novas.

**Acceptance Criteria:**
- Given um lote importado, when o Painel abre, then os cartões Entradas e Saídas mostram o percentual de notas completas entre as exigíveis.
- Given uma nota com pendência, when o contador a vê na lista, then os campos aparecem pelo nome, sem precisar expandir.
- Given a tabela de cClassTrib substituída pela oficial via script e o backend reiniciado, when o lote é conferido, then os avisos de "não consta na tabela" somem para os códigos da nova tabela.

## Design Notes

Os cartões Entradas e Saídas ignoram o filtro Entrada/Saída, porque são a própria divisão, e respeitam CFOP e NCM. A vigência do cClassTrib (`fimVigencia`) é comparada com a data de emissão da nota, não com hoje, e só gera aviso.

## Verification

**Commands:**
- `cd backend && npx tsc --noEmit` -- sem erros
- `cd backend && npx jest --runInBand` -- todos os testes passam
- `cd frontend && npm run build` -- build sem erros

**Manual checks:**
- Em http://localhost:3000, importar um ZIP real de `dados-reais/` e conferir os cartões, a lista de pendências e o Excel exportado.
