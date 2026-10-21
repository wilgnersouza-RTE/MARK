<!-- bmad:context -->
<!-- Verificado em 2026-10-21 contra 0d9dd2f. Gerenciado por bmad-project-context; edições dentro deste bloco são substituídas na atualização. Mantenha fora dos marcadores o que quiser preservar. -->

## MARK (NFe Validator)

Análise tributária de documentos fiscais (NF-e 55, NFC-e 65, CT-e 57/67 e NFS-e) para a Reforma Tributária do Consumo. Backend Express + TypeScript em `backend/`, frontend React + Vite + Tailwind em `frontend/`. Backend no Render, frontend na Vercel (https://mark-six-navy.vercel.app). Use como referência só `COMO_RODAR.md` e `DEPLOY.md`; os demais `.md` da raiz estão desatualizados.

## Política

- Nunca faça push direto no `main`; trabalhe em branch e integre por pull request.
- Nunca edite à mão `tax-rules.json`, `cclasstrib.json` ou `reforma-transicao.json` em `backend/data/`. O `cclasstrib.json` muda só via `npm run importar:cclasstrib`; alíquotas e fatores de transição mudam só com a fonte legal citada e validação do time tributário.
- Use XMLs reais de clientes para testes e simulações só em `dados-reais/`, que o Git ignora; nunca os versione, porque o repositório é público. Fixtures versionadas vão em `exemplos/`, que contém só dados fictícios.
- Nunca versione `backend/data/usuarios.json`: contém hashes de senha e tokens de recuperação.
- Escreva commits em português, na 3ª pessoa do presente ("Adiciona", "Corrige"), com acentuação, descrevendo a mudança daquele commit; nunca reaproveite o título de um commit anterior.

## Onde ficam as coisas

- Rotas: registradas em `backend/src/server.ts`, um router por área em `backend/src/routes/`.
- Todo XML passa por `parseNFE` em `backend/src/services/nfeParser.ts`, que despacha NF-e, CT-e e NFS-e.
- O frontend não tem roteador: abas e páginas são estado em `frontend/src/App.tsx`.
- Descoberta da URL da API no frontend: `frontend/src/utils/api.ts`.

## Rodar e verificar

- Crie `backend/.env` a partir do `.env.example` antes de subir o backend; sem ele o backend usa a porta 3000 e colide com o Vite.
- Verifique o backend com `npx tsc --noEmit` e o frontend com `npm run build`; `npm test` e `npm run lint` não verificam nada, porque não há testes nem configuração de ESLint.
- Sessões e documentos importados vivem só na memória; depois de reiniciar o backend, reimporte o ZIP antes de testar dashboard ou export.

## Armadilhas conhecidas

- Ao mudar modelos de documento, altere juntos `frontend/src/utils/modelos.ts` (códigos em texto), `backend/src/utils/modelos.ts` (códigos numéricos) e o tipo `NFeModel` em `backend/src/types/index.ts`.
- Existem duas tabelas de transição: `/dashboard/transicao` lê `tax-rules.json` e `/reforma/*` lê `reforma-transicao.json`; alterar uma não atualiza a outra.
- Ao usar um método HTTP novo, inclua-o em `methods` no CORS de `backend/src/server.ts`; o navegador bloqueia o resto e o erro aparece só como falha de rede.

<!-- /bmad:context -->
