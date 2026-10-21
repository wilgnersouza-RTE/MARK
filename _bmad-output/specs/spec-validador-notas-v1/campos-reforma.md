# Campos da reforma conferidos

Campos que contam para "completa" em CAP-4 e para o percentual de CAP-5. Os sete são os mesmos para todos os tipos; muda onde cada um fica no XML. Campos da tributação atual (ICMS, IPI, PIS, COFINS, ISS e retenções) continuam visíveis na nota, mas não entram no percentual.

## Os sete campos

1. CST do IBS/CBS
2. cClassTrib
3. Base de cálculo do IBS/CBS
4. IBS estadual (UF)
5. IBS municipal
6. CBS
7. Imposto Seletivo

## Onde ficam por tipo de documento

- **NF-e (55) e NFC-e (65):** por item (`det`), em `imposto/IBSCBS` ou `gIBSCBS`: `CST`, `cClassTrib`, `vBC`, `gIBSUF`, `gIBSMun`, `gCBS`; Seletivo em `IS` ou `gIS`. Item sem o campo deixa a nota incompleta; a nota mostra quantos itens trazem cada campo.
- **CT-e (57) e CT-e OS (67):** na nota, em `imp/IBSCBS/gIBSCBS`: `gIBSUF`, `gIBSMun`, `gCBS`, `gIS`, além de `CST` e `cClassTrib`.
- **NFS-e (padrão nacional e leiautes municipais):** na nota, pelas tags `CST`, `cClassTrib` ou `ClassificacaoTributaria`, `BaseCalculoIBSCBS`, `IBS/Vlr`, `IBSMunicipal/Vlr`, `CBS/Vlr` e `IS/Vlr`.

## Período de exigência

- Conferência vale para notas com data de emissão a partir de 01/01/2026 (`dhEmi`, ou `dEmi` nas versões antigas). Notas anteriores aparecem como "fora do período de exigência", sem pendências, e não entram no percentual nem no relatório.

## Validação de CST x cClassTrib

- **Regra de vínculo, sempre aplicada:** os três primeiros dígitos do cClassTrib devem ser iguais ao CST do IBS/CBS. Divergência é pendência ("cClassTrib incompatível com o CST").
- **Existência na tabela:** código que não consta em `backend/data/cclasstrib.json` gera aviso ("não consta na tabela carregada, versão X"), não pendência, enquanto a tabela for parcial.
- Em NF-e e NFC-e a validação é por item.

## Valor zero

- Base de cálculo do IBS/CBS, IBS estadual, IBS municipal e CBS informados com zero são pendência "informado com valor zero" (decisão do usuário em 2026-10-21), exceto quando o CST do IBS/CBS não exige o grupo padrão (`exigeGrupoPadrao: false` na tabela, como imunidade e não incidência).
- IBS municipal zero não é pendência em notas de 2026: o art. 343 da LC 214/2025 só prevê alíquota estadual (0,1%) nesse ano; a municipal começa em 2027 (art. 344).

## Regra de completude

- Nota completa: os sete campos presentes (em NF-e e NFC-e, presentes em todos os itens) e nenhum cClassTrib incompatível com o CST.
- Imposto Seletivo ausente nunca é pendência na v1 (decisão do usuário em 2026-10-21): o XML lido não indica se o Seletivo incide sobre o item. Aparece como informativo "só exigido para itens sujeitos ao Seletivo". A nota é completa com os outros seis campos presentes e nenhum cClassTrib incompatível.
