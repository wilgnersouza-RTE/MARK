---
title: 'Exclusão individual e em lote de análises salvas'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c2a501ea11a4c409ebe4730165fca264871f256a'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-validador-v1-analises-salvas.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** As análises salvas não podem ser excluídas pelo app; o usuário quer excluir, a critério de cada um, uma análise ou várias de uma vez, liberando espaço do plano gratuito (decisão do usuário em 2026-10-22, que substitui "sem exclusão" da entrega de análises salvas).

**Approach:** Botão "Excluir" em cada análise e seleção múltipla com "Excluir selecionadas (N)". Antes de apagar, a tela mostra a lista do que vai sair, o total e o espaço liberado, com "Confirma esta ação? Ela pode ser irreversível." e os botões "Excluir definitivamente" e "Cancelar". A exclusão apaga a análise, as notas e o ZIP.

## Boundaries & Constraints

**Always:** qualquer usuário autenticado pode excluir; nada é apagado sem a confirmação na tela; a exclusão remove as linhas de `analise_notas`, a linha de `analises` e o objeto do ZIP no bucket; o servidor registra no log quem excluiu, quais ids (empresa, competência, versão) e quando; versões restantes não são renumeradas; lote limitado a 100 ids por requisição; se a análise excluída estiver ligada a alguma sessão, o vínculo é desfeito e a tela avisa que a análise aberta não está mais salva; falha ao remover o ZIP não impede a exclusão da análise, mas é registrada no log e devolvida como aviso.

**Never:** excluir sem confirmação; `window.confirm`; renumerar versões; excluir por empresa inteira sem seleção explícita; chave da Supabase no frontend.

## I/O & Edge-Case Matrix

| Cenário | Entrada / Estado | Resultado esperado | Erros |
|----------|--------------|---------------------------|----------------|
| Individual | `DELETE /analises/:id` existente | 200; análise, notas e ZIP removidos; some da lista | N/A |
| Inexistente | `DELETE /analises/:id` sem análise | 404 | N/A |
| Lote | `POST /analises/excluir` com `{ ids: [a, b] }` | 200 com `excluidas: [a, b]` e `bytesLiberados` | N/A |
| Lote parcial | Um id inexistente no lote | Exclui os existentes; devolve `naoEncontradas` | N/A |
| Lote inválido | Sem ids, mais de 100 ou id não uuid | 400 | N/A |
| Versões | Excluir v2 de v1, v2, v3 | v1 e v3 permanecem com os mesmos números; próxima importação vira v4 | N/A |
| Sessão ligada | Excluir a análise aberta numa sessão | Vínculo desfeito; painel continua com os dados em memória e avisa | N/A |
| ZIP ausente | Objeto do ZIP já não existe | Análise excluída; aviso no resultado | N/A |
| Supabase fora | Erro de rede ou pausa | 503 com a causa; nada parcial sem aviso | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/services/armazenamentoAnalises.ts` -- interface e implementações em memória e Supabase: acrescentar `excluir(id)` (DELETE em `analise_notas` e `analises` via PostgREST, DELETE do objeto no Storage `lotes`), devolvendo os dados da análise removida (para log e bytes liberados).
- `backend/src/services/analises.ts` -- regras: lote de até 100, desvincular sessões (`sessionService`, campo `analiseId`), montar o resultado.
- `backend/src/services/session.ts` -- localizar sessões ligadas a um `analiseId` e desfazer o vínculo.
- `backend/src/routes/analises.ts` -- `DELETE /:id` e `POST /excluir`; validação de uuid; 503 com `causaDaFalha` como nas outras rotas; métodos `DELETE` já liberados no CORS de `server.ts`.
- `frontend/src/components/AnalisesSalvas.tsx` -- caixas de seleção, "Selecionar todas desta página", "Excluir" por linha, "Excluir selecionadas (N)" e o quadro de confirmação; atualizar lista e uso após excluir.
- `frontend/src/App.tsx` -- aviso quando a análise aberta foi excluída.
- `COMO_RODAR.md` -- rotas novas e substituição do procedimento manual de liberar espaço pela exclusão no app.

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/armazenamentoAnalises.ts` -- `excluir` nas duas implementações.
- [x] `backend/src/services/analises.ts`, `backend/src/services/session.ts` -- exclusão individual e em lote, desvínculo e log.
- [x] `backend/src/routes/analises.ts` -- rotas novas com validação.
- [x] `frontend/src/components/AnalisesSalvas.tsx`, `frontend/src/App.tsx` -- botões, seleção e confirmação.
- [x] `backend/src/services/analises.test.ts`, `backend/src/routes/analises.test.ts` -- cobrir a matriz, inclusive o `excluir` da Supabase com `fetch` simulado (URLs e métodos dos DELETE).
- [x] `COMO_RODAR.md` -- documentação.

**Acceptance Criteria:**
- Given a lista de análises, when o usuário clica em Excluir, then nada é apagado até ele clicar em "Excluir definitivamente" no quadro de confirmação.
- Given três análises selecionadas, when o usuário confirma, then as três somem da lista e o uso do espaço diminui.

## Verification

**Commands:**
- `cd backend && npx tsc --noEmit` -- sem erros
- `cd backend && npx jest --runInBand` -- todos os testes passam
- `cd frontend && npm run build` -- build sem erros
