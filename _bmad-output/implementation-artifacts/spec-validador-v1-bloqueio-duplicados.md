---
title: 'Bloqueio de XMLs duplicados na importação'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '7f22ef014ff67c4f29166a4188193a58aca3441b'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-validador-v1-filtro-empresa.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O mesmo XML pode entrar mais de uma vez: repetido no próprio ZIP ou já importado em outra competência da mesma empresa, inflando os totais (pedido do usuário em 2026-10-22).

**Approach:** Na importação, cada nota recebe uma identidade; repetidas dentro do ZIP e notas que já existem nas análises salvas da mesma empresa (versão mais recente de cada competência, exceto a competência que está sendo importada) são puladas. As notas novas entram e a tela lista os duplicados com o motivo e onde a nota já está.

## Boundaries & Constraints

**Always:** identidade: NF-e, NFC-e e CT-e pela chave de acesso de 44 dígitos; NFS-e por CNPJ do prestador + número + código de verificação quando houver; nota sem identidade confiável (chave vazia, "N/A", NFS-e sem número) nunca é bloqueada e entra com aviso; dentro do ZIP, a primeira cópia entra e as seguintes são puladas; contra as análises salvas, só a mesma empresa e só competências diferentes da competência do lote (reimportar a mesma competência gera versão completa); duplicados aparecem na resposta do upload e na tela com o motivo ("repetido no ZIP" ou "já importada em <empresa> · <competência> · v<n>") e entram na planilha de arquivos recusados; se todas as notas forem duplicadas, a importação é recusada com "Todas as notas deste ZIP já foram importadas" e nada é salvo; lote sem empresa identificada aplica só a regra do ZIP, e a escolha da empresa depois aplica a regra contra as análises salvas, removendo do lote as duplicadas antes de atualizar a análise salva.

**Never:** bloquear por coincidência de período, valor, fornecedor ou CFOP; aplicar o bloqueio em "Reprocessar"; comparar com outras empresas; apagar ou alterar análises já salvas.

## I/O & Edge-Case Matrix

| Cenário | Entrada / Estado | Resultado esperado | Erros |
|----------|--------------|---------------------------|----------------|
| Repetido no ZIP | Mesmo XML duas vezes | Uma entra; a outra pulada "repetido no ZIP" | N/A |
| Já em outra competência | Nota já salva em 02/2026 da empresa; lote de 03/2026 | Pulada com "já importada em <empresa> · 02/2026 · v1" | N/A |
| Reimportação da mesma competência | Lote completo de 03/2026 já salvo como v3 | v4 completa com todas as notas | N/A |
| Outra empresa | Mesma chave salva noutra empresa | Não bloqueia | N/A |
| Sem identidade | NFS-e sem número | Entra com aviso | N/A |
| Tudo duplicado | Todas as notas já salvas em outras competências | 400 "Todas as notas deste ZIP já foram importadas"; nada salvo | N/A |
| Empresa escolhida depois | Lote sem empresa; escolha de empresa com notas já salvas noutra competência | Duplicadas removidas antes de atualizar a análise; aviso | N/A |
| NFS-e | Mesmo prestador e número, código de verificação igual | Duplicada | N/A |
| Reprocessar | ZIP salvo com notas que existem noutra competência | Nada é pulado | N/A |
| Supabase fora | Erro ao ler as análises salvas | Importa aplicando só a regra do ZIP e avisa que a checagem contra as análises salvas não foi feita | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/services/analises.ts` -- `lerLoteZip` (leitura do ZIP e recusados), `salvarAposUpload`, `atualizarAposTrocaEmpresa`, `reprocessar`, `calcularCompetencia`.
- `backend/src/routes/upload.ts` -- `POST /nfe` e `POST /empresa`: aplicar o bloqueio, devolver `duplicados` e avisos, recusar quando tudo for duplicado.
- `backend/src/services/conjuntoEmpresa.ts` -- já monta as notas da empresa por competência (versão mais recente) e tem chave de nota para deduplicar: reaproveitar a regra de identidade num módulo único.
- `backend/src/services/nfeParser.ts` -- `chaveNFe` por tipo (NFS-e usa `CodigoVerificacao`, `NumeroNfse`...): a identidade precisa do número e do código de verificação separados para NFS-e.
- `backend/src/routes/export.ts` -- `/erros-importacao`: incluir duplicados com o motivo.
- `frontend/src/App.tsx` -- `UploadSection`: mostrar a lista de duplicados junto dos recusados.

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/utils/identidadeNota.ts` -- identidade da nota por tipo, com "sem identidade" explícito; usada também na deduplicação do conjunto da empresa.
- [x] `backend/src/services/nfeParser.ts`, `backend/src/types/index.ts` -- guardar número e código de verificação da NFS-e para a identidade.
- [x] `backend/src/services/duplicados.ts` -- regra do ZIP e regra contra as análises salvas da empresa (exceto a competência do lote), com o motivo e a origem.
- [x] `backend/src/routes/upload.ts`, `backend/src/services/analises.ts` -- aplicar no upload e na troca de empresa; não aplicar no reprocessar; recusar quando tudo for duplicado.
- [x] `backend/src/routes/export.ts`, `frontend/src/App.tsx` -- lista de duplicados na tela e na planilha.
- [x] testes cobrindo a matriz; `COMO_RODAR.md` com a regra.

**Acceptance Criteria:**
- Given um ZIP com um XML repetido, when importado, then entra uma vez e a tela lista o repetido.
- Given o ZIP de 03/2026 importado de novo, when salvo, then a nova versão tem todas as notas.

## Verification

**Commands:**
- `cd backend && npx tsc --noEmit` -- sem erros
- `cd backend && npx jest --runInBand` -- todos os testes passam
- `cd frontend && npm run build` -- build sem erros
