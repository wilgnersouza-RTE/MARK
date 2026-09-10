# XMLs de exemplo

Três NF-e modelo 55 usadas para validar o fluxo completo:

| Arquivo | Raiz | Característica |
| ------- | ---- | -------------- |
| `nota1.xml` | `<nfeProc>` | Nota autorizada, com ICMS/PIS/COFINS |
| `nota2.xml` | `<NFe>` | Nota assinada, só com ISS |
| `nota3.xml` | `<nfeProc>` | Valores altos, para conferir os totais |

`notas-exemplo.zip` contém as três, pronto para subir na tela de upload
(tipo: entrada, modelo: 55).

Valores esperados no resumo: 3 documentos, R$ 112.000,00 de valor total e
R$ 24.775,00 de tributos.

São arquivos sintéticos, feitos para teste — não são notas fiscais reais.
