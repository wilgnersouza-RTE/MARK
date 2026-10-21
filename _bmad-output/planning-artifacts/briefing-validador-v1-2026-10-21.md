# Briefing do validador de notas v1

Recebido de Wilgner em 2026-10-21, com base na reunião RTE · NFS de 20/10.

## Contexto

O protótipo do validador de notas (feito a pedido do Davi) vai virar a especificação. No melhor cenário, o nosso trabalho depois é só portar pra estrutura do RT360 e adaptar ao design system, mantendo a experiência.

O desafio: com tudo que a gente conversou na reunião RTE · NFS de 20/10, como esse app seria se fosse seu?

## Objetivo da v1

Receber o lote de notas do mês, verificar se os campos novos da reforma tributária estão preenchidos e apontar o que o cliente precisa ajustar no sistema emissor (ex.: Nibo). A entrada é um lote de notas; a saída é uma análise inicial e um relatório do que precisa mudar.

## O que muda no protótipo

- Upload: um ZIP por vez, arrastar e soltar. O sistema identifica sozinho o tipo de nota (NFS-e, NF-e, CT-e) e se é entrada ou saída (tomador x emitente). Sem filtro manual por modelo.
- Sem banco nem histórico por enquanto: cada ZIP é analisado na hora.
- Sai a simulação de tributação anual (IVA, CBS, IS).
- Sai a visão "detalhado". Fica o resumo, a partir do percentual.
- O que hoje está como "configurações" vira filtro: básicos por padrão e um botão de avançado.
- Painel inicial: saem a evolução mensal e a transição de tributação. Ficam participação por tributo, fornecedores por valor total e composição por regime tributário do lote.
- Telas: resumo com entradas e saídas, com foco da v1 na análise de entradas. Painel único com filtros ou painéis separados fica como proposta sua.

## Fora da v1

- Integração por API com outros sistemas.
- Relatório com proposta de correção pro contador levar ao cliente.
