# Ponto de partida no protótipo

Levantado em 2026-10-21 contra `5121ff7`. O que muda em relação ao código atual e as dependências que quebram se ignoradas.

## Upload e identificação (CAP-1 a CAP-3)

- Tipo e modelo são escolhidos em seletores em `frontend/src/App.tsx` e exigidos por `backend/src/routes/upload.ts` (400 sem eles).
- `parseNFE` em `backend/src/services/nfeParser.ts` já detecta o tipo pela estrutura do XML, mas recusa o arquivo quando difere do modelo escolhido. `parseNFSe` grava sempre `modelo: 'NFSE'`.
- O mesmo ZIP traz entradas e saídas juntas, então a classificação passa a ser por nota, não por lote.
- `backend/src/utils/sentidoImportacao.ts` infere o sentido do lote inteiro pela repetição de CNPJ (80%, mínimo 3 notas) e recusa o lote quando contradiz o tipo escolhido. Calcula `cnpjEmpresa`, mas descarta. Não existe CNPJ da empresa salvo em lugar nenhum.
- Emitente e destinatário ou tomador já são lidos por tipo: NF-e `emit`/`dest`; NFS-e `CpfCnpjPrestador`/`CpfCnpjTomador` e variações; CT-e `emit` e tomador por `toma`, `toma3` ou `toma4`.
- Não há arrastar e soltar: só `<input type="file">`.

## Conferência de campos (CAP-4, CAP-5)

- `backend/src/services/camposTributarios.ts` confere presença por tipo e devolve preenchido, parcial ou ausente.
- O "X de Y" soma campos atuais e da reforma; não há percentual do lote. `percentualConformidade` existe, mas é sempre 100% porque `divergencias` é sempre vazio.
- Em NFS-e, "ISS retido" sempre conta como preenchido.
- A conferência não usa a tabela oficial de CST e cClassTrib (`rtcService` só atende `routes/rtc.ts`). A validação de CAP-4 deve reaproveitar `rtcService`, que já aplica a regra de vínculo em `POST /rtc/validar`.
- NCM não é lido em lugar nenhum: incluir `det/prod/NCM` na leitura dos itens de NF-e e NFC-e em `nfeParser.ts` (CAP-9).
- A data de emissão cai silenciosamente na data atual quando falta `dhEmi` e `dEmi`; com a data de corte de 2026 isso classificaria nota sem data como exigível. Tratar ausência de data como aviso.
- O componente `frontend/src/components/CamposTributarios.tsx` fica no fim do Painel, lendo `GET /api/v1/dashboard/campos`. Nada disso entra no Excel.

## Painel e filtros (CAP-6, CAP-7)

- `frontend/src/components/PainelExecutivo.tsx` calcula tudo no navegador a partir de `/dashboard/documentos`. A transição (heatmap) chama `/reforma/serie`: remover a aba Reforma sem tirar essa chamada quebra o painel.
- Fornecedores são agrupados por `cnpjEmitente`; num lote de saída isso lista a própria empresa.
- O regime de NF-e é heurístico e ignora o CRT do XML.
- `frontend/src/components/ConfiguracoesImportacao.tsx` envia `configuracao` no upload, mas o backend ignora; nada é salvo.

## Remoções (Non-goals)

- Frontend: `AbaReforma.tsx`, abas Detalhado, Regimes e Transição em `App.tsx`, página `config`, `AbaDivergencias.tsx` (já órfão e chama rota inexistente).
- Backend: `routes/reforma.ts`, `services/reforma.ts`, `/dashboard/transicao` e `calcularTransicaoAnual`; import sem uso de `reformaService` em `nfeParser.ts`.
- As tabelas em `backend/data` (`tax-rules.json`, `reforma-transicao.json`) não são editadas à mão (`AGENTS.md`); decidir na implementação se ficam sem uso ou saem com seus leitores.
- Excel: aba "Transição 2024-2027".

## Exportação (CAP-8)

- `GET /export/excel` gera 5 abas (Resumo, Documentos, Por Regime, Fornecedores, Transição) sem campos da reforma nem destinatário ou tomador.
- `POST /export/erros-importacao` gera a planilha de arquivos recusados e continua útil no upload.
