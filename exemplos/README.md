# XMLs de exemplo

Três NF-e modelo 55 usadas para validar o fluxo completo:

| Arquivo | Raiz | Característica |
| ------- | ---- | -------------- |
| `nota1.xml` | `<nfeProc>` | Nota autorizada, com ICMS/PIS/COFINS |
| `nota2.xml` | `<NFe>` | Nota assinada, só com ISS |
| `nota3.xml` | `<nfeProc>` | Valores altos, para conferir os totais |

`notas-exemplo.zip` contém as três, pronto para subir na tela de upload
(sem escolher tipo nem modelo: as três entram como NF-e de entrada da
empresa 99.888.777/0001-66, identificada pelo lote).

Cada nota tem um item com NCM e CFOP, para testar os filtros da análise:
NCM 84713012 em nota1 e nota2, 85171231 em nota3; CFOP 5102 em nota1 e
nota3, 6102 em nota2.

Valores esperados no resumo: 3 documentos, R$ 112.000,00 de valor total e
R$ 24.775,00 de tributos.

São arquivos sintéticos, feitos para teste — não são notas fiscais reais.
