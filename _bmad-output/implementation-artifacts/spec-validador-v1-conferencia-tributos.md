---
title: 'Conferência de tributos por nota: leitura corrigida, valor zero e detalhe por campo'
type: 'feature'
created: '2026-10-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '6e441258b685f6e4c0b43acaeb227fe5da7843d2'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-validador-notas-v1/campos-reforma.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A auditoria de 41 NFS-e reais (lote Supera, 03/2026) mostrou três erros de leitura e um critério frouxo: base do ISS declarada 0 vira o valor do serviço; a base do IBS/CBS informada em `IBS/BaseCalculo` é dada como ausente; o IBS municipal informado como `IBS/AliquotaMunicipal` é dado como ausente; e CBS e IBS informados com alíquota e valor zero contam como preenchidos. A tela também mostra pouco de cada nota.

**Approach:** Corrigir as três leituras; tornar pendência todo campo de valor da reforma informado com zero (decisão do usuário, opção A); renomear a seção para "Conferência de tributos por nota" e a aba do Excel para "Pendências de tributos"; e mostrar, em cada nota, tributação atual e da reforma lado a lado com alíquota, base e valor, um resumo em linguagem de contador, selos por tipo de problema, o leiaute da nota e o código do serviço.

## Boundaries & Constraints

**Always:** campos de valor da reforma (Base de cálculo do IBS/CBS, IBS estadual, IBS municipal, CBS) informados com zero são pendência "informado com valor zero", exceto quando o CST do IBS/CBS da nota existe na tabela e não exige o grupo padrão (`exigeGrupoPadrao: false`, como imunidade e não incidência); Imposto Seletivo continua só informativo; tipos de problema exibidos: ausente, zerado, parcial (NF-e e NFC-e) e incompatível; base do ISS declarada (tag presente) é usada como está, inclusive 0, e só é calculada quando a tag não existe; tudo continua respeitando os filtros e a data de corte.

**Decisão do usuário (2026-10-21, revisão):** IBS municipal informado com zero não é pendência em notas emitidas em 2026, porque o art. 343 da LC 214/2025 só prevê alíquota estadual nesse ano; volta a ser pendência a partir de 2027 (art. 344). IBS municipal ausente continua pendência.

**Never:** mostrar valores "esperados" ou propor correção (fora da v1); converter alíquotas; mudar importação, filtros ou login; editar `backend/data/*.json`.

## I/O & Edge-Case Matrix

| Cenário | Entrada / Estado | Resultado esperado | Erros |
|----------|--------------|---------------------------|----------------|
| Base ISS zero | NFS-e com `BaseCalculo` 0, `ValorServicos` 1980 | Base do ISS 0 | N/A |
| Base ISS ausente | NFS-e sem tag de base | Base calculada como hoje | N/A |
| Base IBS/CBS no grupo IBS | `<IBS><BaseCalculo>1000</BaseCalculo>` | Base de cálculo do IBS/CBS presente, 1000 | N/A |
| IBS municipal por alíquota | `<IBS><AliquotaEstadual>0.1</AliquotaEstadual><AliquotaMunicipal>0.05</AliquotaMunicipal><Vlr>…` | IBS estadual e IBS municipal presentes, cada um com sua alíquota | N/A |
| Zerado | CBS com Aliquota 0 e Vlr 0, CST ausente | Pendência "CBS informada com valor zero" e selo "zerado" | N/A |
| Zero legítimo | CST 410 na tabela (`exigeGrupoPadrao: false`) e CBS 0 | Sem pendência de zero | N/A |
| NF-e parcial zerada | 3 itens, CBS 0 em 2 | "CBS informada com valor zero (2 de 3 itens)" | N/A |
| Lote Supera | 24 NFS-e com grupos zerados | Pendências: CST, cClassTrib e os quatro campos de valor zerados; sem "ausente" falso de base e IBS municipal | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/services/nfeParser.ts` -- `parseNFSe`: base do ISS em l. 370-371 (`baseDeclarada > 0 ? … : total - deducoes` ignora 0 declarado); campos da reforma em l. 472-499 (`BaseCalculoIBSCBS`, `IBSMunicipal` procurados como tags próprias; ler também `IBS/BaseCalculo`, `IBS/AliquotaEstadual`, `IBS/AliquotaMunicipal`); `chaveNFe` e códigos de serviço (`CodigoTributacaoMunicipio`, `CodigoServico` no leiaute Paulistana, `cTribNac` no nacional). NF-e (`lerItens`, l. ~540-587) e CT-e (l. ~700) já leem valores por item ou nota.
- `backend/src/services/camposTributarios.ts` -- `conferirCamposNFSe` (l. 62), `conferirCamposNFe` (l. 129), `conferirCamposCTe` (l. 189); `presente()` conta zero como presente; `CampoTributario` (types l. ~137) só guarda `valor` em texto: acrescentar alíquota, base e valor numéricos opcionais.
- `backend/src/services/conferenciaReforma.ts` -- `conferirReforma` (l. 176) monta pendências; acrescentar o tipo de problema e a regra de zero com a exceção do CST; `tabelaCarregada()` dá o CST (`obterCSTPorCodigo` do `rtcService`).
- `backend/src/routes/dashboard.ts` (`/campos`), `backend/src/services/export.ts` (aba "Pendências da reforma") -- levar os tipos, o leiaute e o código do serviço; renomear a aba.
- `frontend/src/components/CamposTributarios.tsx` -- título, linha da nota, área expandida (hoje duas colunas só com valor ou "não informado").
- Leiautes do lote real: Paulistana (raiz `NFe`, `ValorISS`, `CodigoServico`, sem campos da reforma) e municipal com grupos (raiz `NFSe`, `ValoresNFSe` com `CBS`, `IBS` e `IS`).

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/nfeParser.ts` -- corrigir as três leituras; guardar leiaute (`leiaute`) e código do serviço (`codigoServico`) na NFS-e.
- [x] `backend/src/types/index.ts`, `backend/src/services/camposTributarios.ts` -- alíquota, base e valor numéricos por campo quando houver; zero distinguível de ausente.
- [x] `backend/src/services/conferenciaReforma.ts` -- tipo de problema por pendência (`ausente`, `zerado`, `parcial`, `incompativel`), regra de zero com a exceção do CST e resumo em uma frase.
- [x] `backend/src/routes/dashboard.ts`, `backend/src/services/export.ts` -- `/campos` com tipos, resumo, leiaute e código do serviço; aba renomeada "Pendências de tributos" com coluna de tipo de problema.
- [x] `frontend/src/components/CamposTributarios.tsx` -- título "Conferência de tributos por nota"; selos por tipo; resumo na linha; ao expandir, atual e reforma lado a lado com alíquota, base e valor; leiaute e código do serviço.
- [x] Testes em `nfeParser.test.ts`, `conferenciaReforma.test.ts`, `dashboard.test.ts`, `export.test.ts` -- cobrir a matriz com XMLs mínimos fictícios nos dois leiautes do lote real.

**Acceptance Criteria:**
- Given o lote Supera importado, when a conferência abre, then nenhuma das 24 notas com grupos acusa base do IBS/CBS ou IBS municipal como ausente, e todas mostram CBS e IBS como zerados.
- Given uma nota expandida, when o contador olha, then vê para cada tributo a alíquota, a base e o valor que estão na nota.
- Given a planilha exportada, when aberta, then a aba se chama "Pendências de tributos" e cada pendência traz o tipo de problema.

## Verification

**Commands:**
- `cd backend && npx tsc --noEmit` -- sem erros
- `cd backend && npx jest --runInBand` -- todos os testes passam
- `cd frontend && npm run build` -- build sem erros

**Manual checks:**
- Rodar a auditoria no lote real (fora do repositório) e conferir as 41 notas contra o XML.
