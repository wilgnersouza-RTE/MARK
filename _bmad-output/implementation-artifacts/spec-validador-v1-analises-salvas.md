---
title: 'Análises salvas na Supabase, com versões e filtro por empresa'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '14eb612e116fc53ec38198de71362d332110fe46'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-validador-notas-v1/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Cada análise vive só na memória do servidor e some a cada reinício ou novo upload; o time não consegue voltar a uma análise de um cliente nem reprocessá-la quando regras ou a tabela de cClassTrib mudam (CAP-11 da SPEC v1, decisões do usuário em 2026-10-22).

**Approach:** Cada importação passa a ser salva como uma análise (resultado por nota e ZIP original) num projeto Supabase gratuito na região São Paulo, numerada por versão dentro de empresa + competência. Uma área "Análises salvas" filtra por empresa, lista as análises e permite abrir ou reprocessar qualquer uma; abrir carrega a análise na sessão, e o painel, a conferência, os filtros e o Excel continuam como hoje.

## Boundaries & Constraints

**Always:** todo usuário autenticado vê e abre as análises de todos os clientes; reimportar a mesma empresa e competência cria a versão seguinte e mantém as anteriores; competência é o mês (AAAA-MM) com mais notas pelo `diaEmissao`, ou "sem competência" se nenhuma nota tiver data; o ZIP é guardado como chegou, num bucket privado, em `<cnpj>/<competência>/<id da análise>.zip`; trocar a empresa de um lote atualiza a análise salva (empresa, classificação das notas e, se mudar, competência e versão); reprocessar lê o ZIP guardado, aplica parser, regras e tabela atuais e grava uma versão nova; credenciais só no backend (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), nunca no frontend nem no repositório; sem as variáveis, o armazenamento é em memória e o app funciona como hoje; se a Supabase falhar ou estiver pausada, a importação continua só na sessão e a tela avisa que não foi salva, com a orientação de reativar o projeto no painel da Supabase.

**Never:** excluir análises ou ZIPs; expor link público dos ZIPs; acrescentar dependência para falar com a Supabase (usar `fetch` nas APIs REST, como `armazenamentoUsuarios.ts`); mexer em login e cadastro; versionar XML real ou chave.

## I/O & Edge-Case Matrix

| Cenário | Entrada / Estado | Resultado esperado | Erros |
|----------|--------------|---------------------------|----------------|
| Primeira importação | Lote da empresa X, notas de 03/2026 | Análise X / 2026-03 / versão 1 salva; ZIP no bucket | N/A |
| Reimportação | Novo lote de X em 03/2026 | Versão 2; versão 1 intacta | N/A |
| Meses misturados | 30 notas de 03/2026 e 5 de 02/2026 | Competência 2026-03 | N/A |
| Empresa escolhida depois | Upload sem empresa, depois `POST /upload/empresa` | Análise salva sem empresa e atualizada com a escolha | N/A |
| Filtro por empresa | `GET /analises?empresa=<cnpj>` | Só análises da empresa, mais recentes primeiro | N/A |
| Abrir | `POST /analises/:id/abrir` | Notas e empresa carregadas na sessão; dashboard igual ao do upload | 404 se não existir |
| Reprocessar | `POST /analises/:id/reprocessar` | Nova versão gerada do ZIP guardado com as regras atuais | 404; erro do ZIP vira 400 |
| Supabase indisponível | Erro de rede ou projeto pausado no upload | Upload responde 200 com `analiseSalva: false` e aviso | Não derruba o upload |
| Sem configuração | Variáveis ausentes | Armazenamento em memória; tudo funciona | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/services/armazenamentoUsuarios.ts` -- padrão a seguir: interface com implementação em arquivo e em Redis via `fetch`, escolhida pelas variáveis de ambiente.
- `backend/src/services/session.ts` -- `adicionarDocumentos` (substitui o lote da sessão), `definirEmpresa`; abrir uma análise carrega notas e empresa por aqui.
- `backend/src/routes/upload.ts` -- `POST /nfe` (l. 71) e `POST /empresa` (l. 233): salvar e atualizar a análise; resposta ganha `analise` (id, competência, versão) e `analiseSalva`.
- `backend/src/utils/sentidoImportacao.ts` -- `identificarEmpresa`, `classificarSentido` para reprocessar.
- `backend/src/services/conferenciaReforma.ts` -- `conferirReforma`, `tabelaCarregada` (versão da tabela gravada na análise).
- `backend/src/config/index.ts` -- ler `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` (padrão `lotes`).
- `backend/src/server.ts` -- registrar o router novo `/api/v1/analises`.
- `frontend/src/App.tsx` -- nova área "Análises salvas" acima do painel; `onUploadSuccess` / `refreshDashboard` reaproveitados ao abrir uma análise.
- `render.yaml`, `DEPLOY.md`, `COMO_RODAR.md`, `backend/.env.example` -- variáveis novas e o passo único de criar as tabelas.

## Tasks & Acceptance

**Execution:**
- [x] `backend/supabase/schema.sql` -- tabelas `analises` (id, empresa_cnpj, empresa_nome, competencia, versao, criado_por, criado_em, total_notas, resumo jsonb, versao_tabela, zip_path, zip_bytes; único em empresa_cnpj + competencia + versao) e `analise_notas` (analise_id, documento jsonb completo), índices por empresa e competência, RLS ligado sem políticas públicas; bucket privado `lotes`.
- [x] `backend/src/services/armazenamentoAnalises.ts` -- interface (`salvar`, `atualizarEmpresa`, `listar`, `listarEmpresas`, `obter`, `baixarZip`, `uso`) com implementação em memória e na Supabase (PostgREST e Storage via `fetch`, chave `service_role`), escolhida pelas variáveis.
- [x] `backend/src/services/analises.ts` -- competência, próxima versão, salvar após upload, atualizar após troca de empresa, abrir na sessão, reprocessar a partir do ZIP.
- [x] `backend/src/routes/analises.ts`, `backend/src/server.ts` -- `GET /analises?empresa=`, `GET /analises/empresas`, `GET /analises/uso`, `POST /analises/:id/abrir`, `POST /analises/:id/reprocessar`.
- [x] `backend/src/routes/upload.ts` -- salvar e atualizar sem derrubar o upload em caso de falha.
- [x] `frontend/src/components/AnalisesSalvas.tsx`, `frontend/src/App.tsx` -- filtro EMPRESA, lista (competência, versão, data, quem importou, notas), Abrir, Reprocessar, aviso de não salva e uso do espaço gratuito.
- [x] `backend/src/services/analises.test.ts`, `backend/src/routes/analises.test.ts` -- matriz com o armazenamento em memória.
- [x] `render.yaml`, `DEPLOY.md`, `COMO_RODAR.md`, `backend/.env.example` -- variáveis e criação das tabelas.

**Acceptance Criteria:**
- Given o backend reiniciado, when o contador abre "Análises salvas", then as análises anteriores continuam listadas e abrem com os mesmos números.
- Given uma análise aberta, when o contador usa painel, conferência, filtros ou Excel, then tudo funciona como logo após o upload.
- Given a chave da Supabase, when alguém inspeciona o frontend publicado, then a chave não aparece.

## Verification

**Commands:**
- `cd backend && npx tsc --noEmit` -- sem erros
- `cd backend && npx jest --runInBand` -- todos os testes passam
- `cd frontend && npm run build` -- build sem erros

**Manual checks:**
- Com o projeto Supabase criado: importar o lote real, reiniciar o backend, abrir a análise salva e reprocessá-la; conferir a versão 2 e o ZIP no bucket.
