---
id: SPEC-validador-notas-v1
companions:
  - campos-reforma.md
  - telas-v1.md
  - brownfield.md
  - ../../../AGENTS.md
sources:
  - ../../planning-artifacts/briefing-validador-v1-2026-10-21.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Validador de notas v1

## Why

Mandato e oportunidade. A Reforma Tributária do Consumo exige campos novos (IBS, CBS, Imposto Seletivo, CST e cClassTrib) nos documentos fiscais, e os clientes do escritório precisam ajustar seus sistemas emissores (por exemplo, Nibo) para preenchê-los. O contador recebe o lote de notas do mês e hoje não tem como ver rapidamente quais notas estão sem esses campos. O protótipo, pedido pelo Davi e discutido na reunião RTE · NFS de 20/10, vira a especificação: depois será portado para a estrutura do RT360 e adaptado ao design system dele, mantendo a experiência.

## Capabilities

- **CAP-1**
  - **intent:** O contador envia um único ZIP do lote do mês, arrastando e soltando ou escolhendo o arquivo, e a análise começa sem nenhuma escolha prévia.
  - **success:** Soltar um ZIP na área de upload inicia a análise; não existe seletor de modelo nem de tipo na tela; um segundo ZIP substitui a análise anterior.
- **CAP-2**
  - **intent:** O sistema identifica sozinho o tipo de cada documento do ZIP: NF-e (55), NFC-e (65), CT-e (57), CT-e OS (67) e NFS-e.
  - **success:** Um ZIP com os cinco tipos misturados é aceito por inteiro, e cada nota aparece com o tipo correto; nenhum XML é recusado por tipo diferente do esperado.
- **CAP-3**
  - **intent:** O sistema classifica cada nota em entrada ou saída comparando o CNPJ da empresa analisada com o emitente e com o destinatário ou tomador.
  - **success:** Um único ZIP com entradas e saídas juntas é aceito por inteiro; notas em que a empresa é destinatária ou tomadora aparecem como entrada e notas em que ela é emitente aparecem como saída; quando o CNPJ da empresa não pode ser determinado, a tela pede para escolher entre os CNPJs encontrados, em vez de recusar o lote.
- **CAP-4**
  - **intent:** O sistema confere, em cada nota emitida a partir de 01/01/2026, se os campos da reforma estão preenchidos e se o cClassTrib combina com o CST, e lista exatamente o que está errado.
  - **success:** Para cada nota, a tela mostra pelo nome os campos da reforma ausentes e os cClassTrib incompatíveis com o CST, conforme `campos-reforma.md`; uma nota sem nenhum desses problemas aparece como completa; uma nota emitida antes de 2026 aparece como fora do período de exigência, sem pendências.
- **CAP-5**
  - **intent:** O contador vê um resumo do lote a partir do percentual de notas com os campos da reforma completos, separado em entradas e saídas.
  - **success:** O resumo mostra, para entradas e para saídas, total de notas, quantas estão completas e o percentual; a tela abre com o foco em entradas.
- **CAP-6**
  - **intent:** O contador vê o painel do lote com participação por tributo, fornecedores por valor total e composição por regime tributário.
  - **success:** Os três blocos aparecem e respeitam os filtros ativos; evolução mensal e transição de tributação não aparecem.
- **CAP-7**
  - **intent:** O contador filtra a análise por Entrada/Saída, CFOP e NCM numa barra de listas suspensas comum a todas as abas; a opção de configurações tributárias deixa de existir.
  - **success:** Mudar qualquer um dos três filtros atualiza indicadores, painel, resumo e regimes; não há botão nem página de configurações tributárias.
- **CAP-8**
  - **intent:** O contador exporta um relatório do que precisa mudar no lote.
  - **success:** O arquivo exportado lista, por nota, os campos da reforma ausentes e os cClassTrib incompatíveis, separa entradas e saídas e traz um consolidado com quantas notas têm cada problema, respeitando os filtros ativos.
- **CAP-9**
  - **intent:** O contador filtra as notas pelo NCM dos itens.
  - **success:** Informar um NCM mostra só as NF-e e NFC-e com pelo menos um item daquele NCM, e resumo, painel, lista e relatório passam a considerar só essas notas.
- **CAP-10**
  - **intent:** O contador filtra as notas pelo CFOP dos itens (NF-e e NFC-e) ou da operação (CT-e).
  - **success:** Escolher um CFOP mostra só as notas com pelo menos um item ou operação daquele CFOP; NFS-e, que não tem CFOP, fica fora enquanto o filtro estiver ativo.

## Constraints

- Sem banco e sem histórico: cada ZIP é analisado na hora, só em memória, e substitui o anterior.
- A experiência precisa ser portável para o RT360 e adaptável ao design system dele; regras de análise não podem depender da camada visual.
- XMLs reais de clientes só ficam localmente em `dados-reais/`; o repositório é público (`AGENTS.md`).
- Um ZIP por vez, com o limite atual de 50 MB.
- Login, cadastro e administração de usuários continuam como estão.
- A tabela de cClassTrib em `backend/data/cclasstrib.json` é parcial (v1.31, 15 códigos) e só muda pelo `npm run importar:cclasstrib` com a planilha oficial; a validação não pode tratar código ausente dela como erro.

## Non-goals

- Integração por API com outros sistemas.
- Relatório com proposta de correção para o contador levar ao cliente; a v1 só aponta o que falta.
- Simulação de tributação anual (IVA, CBS, IS), aba Reforma e visão "Detalhado".
- Evolução mensal e transição de tributação no painel.
- Histórico de análises, persistência de lotes e envio de vários ZIPs juntos.
- Seleção manual de modelo ou de tipo de nota.

## Success signal

- O contador solta o ZIP real do mês de um cliente, com NF-e, NFS-e e CT-e misturadas, sem escolher nada, e em uma tela vê o percentual de entradas com os campos da reforma completos, a lista de notas com os campos que faltam e exporta esse relatório.

## Assumptions

- O CNPJ da empresa analisada é inferido como o mais recorrente entre emitentes e destinatários ou tomadores do lote; empate ou lote pequeno levam à escolha manual entre os CNPJs encontrados.
- O percentual do resumo conta só os campos da reforma; hoje o "X de Y" mistura campos atuais e da reforma.
- O relatório da v1 diagnostica o que falta; dizer como corrigir é a parte que ficou fora.
- As abas Transição e Regimes saem: a transição saiu do escopo e a composição por regime fica no painel.
- O Imposto Seletivo só conta como pendência quando o CST indicar incidência.
- Com o filtro de NCM ativo, NFS-e e CT-e ficam fora do resultado, porque não têm NCM.
- A organização das telas é proposta do Claude, pedida no briefing: ver `telas-v1.md`.

## Open Questions

- Quem baixa a planilha oficial de cClassTrib no Portal Nacional da NF-e para carregar a tabela completa antes de a v1 entrar em uso?
