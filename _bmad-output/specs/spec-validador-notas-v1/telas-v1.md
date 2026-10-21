# Proposta de telas da v1

Proposta do Claude, pedida no briefing ("painel único com filtros ou painéis separados fica como proposta sua"). Escolhido o painel único: um lote por vez cabe numa tela, e separar entradas e saídas em painéis duplicaria os mesmos blocos.

## Fluxo

1. **Upload:** área de arrastar e soltar com o botão "Escolher arquivo ZIP". Sem seletores. Ao terminar, mostra quantos XMLs foram lidos por tipo e os recusados, com o motivo (arquivo corrompido, XML sem nota fiscal), exportáveis como hoje.
2. **Confirmação da empresa (só quando necessário):** se o CNPJ da empresa não puder ser inferido, lista os CNPJs encontrados para o contador escolher.
3. **Painel único:**
   - Filtros básicos no topo: Sentido (Entradas | Saídas | Todas, abrindo em Entradas), Tipo de documento, Situação dos campos (Todas | Com pendência | Completas | Fora do período) e NCM. Botão "Avançado" abre CST, cClassTrib, finalidade, CRT, regime e fornecedor.
   - Resumo: dois cartões lado a lado, Entradas e Saídas, cada um com total de notas, completas e percentual de completude dos campos da reforma.
   - Painel do lote: participação por tributo, fornecedores por valor total e composição por regime.
   - Notas com pendência: lista por nota (número, emitente, valor, tipo, sentido) com os campos da reforma que faltam; ao expandir, os campos atuais e da reforma lado a lado.
   - Botão "Exportar relatório": Excel com a lista por nota e o consolidado por campo, respeitando os filtros.

## O que sai da navegação

- Abas Detalhado, Regimes, Transição e Reforma 2027-2033.
- Página Configurações (vira filtros avançados).
- Evolução mensal e heatmap de transição no painel.
