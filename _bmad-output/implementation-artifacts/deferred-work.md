- source_spec: none
  summary: Conferência da reforma por nota (campos ausentes, CST x cClassTrib, corte em 01/01/2026), resumo pelo percentual de entradas e saídas e relatório Excel do que precisa mudar (CAP-4, CAP-5, CAP-8 de _bmad-output/specs/spec-validador-notas-v1/SPEC.md).
  evidence: Dividida da v1 por decisão do usuário em 2026-10-21; entrega própria, depende da classificação entrada/saída por nota da importação automática.
- source_spec: none
  summary: Painel e filtros enxutos (remoção de simulação, Detalhado, evolução mensal, transição e abas; Configurações viram filtros básicos e avançados; filtro por NCM) (CAP-6, CAP-7, CAP-9 de _bmad-output/specs/spec-validador-notas-v1/SPEC.md).
  evidence: Dividida da v1 por decisão do usuário em 2026-10-21; entrega própria, os filtros atuam sobre o resumo e o relatório da conferência.
- source_spec: `_bmad-output/implementation-artifacts/spec-validador-v1-importacao-automatica.md`
  summary: Dashboard soma as notas "Sem vínculo" nos totais; decidir se ficam fora ou aparecem separadas.
  evidence: backend/src/services/dashboard.ts não lê doc.tipo; comportamento anterior, decisão de produto da entrega de conferência e resumo.
- source_spec: `_bmad-output/implementation-artifacts/spec-validador-v1-importacao-automatica.md`
  summary: Filtro de sentido do painel não oferece "Sem vínculo" e esconde essas notas quando um chip de tipo está ativo.
  evidence: frontend/src/components/PainelExecutivo.tsx:306 e :601 só têm entrada e saida; filtros são da entrega de painel e filtros.
- source_spec: `_bmad-output/implementation-artifacts/spec-validador-v1-importacao-automatica.md`
  summary: Planilhas exportadas não informam a empresa analisada (CNPJ, nome, identificada ou escolhida).
  evidence: services/export.ts sem cabeçalho de empresa; o relatório é da entrega de conferência.
- source_spec: `_bmad-output/implementation-artifacts/spec-validador-v1-importacao-automatica.md`
  summary: Não há CI; os testes do backend só rodam quando alguém executa npm test à mão.
  evidence: .github/workflows não existe no repositório; anterior a este story.
