<!-- bmad:context -->
<!-- Verificado em 2026-10-21 contra e7e8bfe. Gerenciado por bmad-project-context; edições dentro deste bloco são substituídas na atualização. Mantenha fora dos marcadores o que quiser preservar. -->

## MARK (NFe Validator)

Análise tributária de documentos fiscais (NF-e 55, NFC-e 65, CT-e 57/67 e NFS-e) para a Reforma Tributária do Consumo. Backend Express + TypeScript em `backend/`, frontend React + Vite + Tailwind em `frontend/`. Backend no Render, frontend na Vercel (https://mark-six-navy.vercel.app). Use como referência só `COMO_RODAR.md` e `DEPLOY.md`; os demais `.md` da raiz estão desatualizados.

## Política

- Nunca faça push direto no `main`; trabalhe em branch e integre por pull request.
- Nunca edite à mão `tax-rules.json` ou `cclasstrib.json` em `backend/data/`. O `cclasstrib.json` muda só via `npm run importar:cclasstrib`; alíquotas mudam só com a fonte legal citada e validação do time tributário.
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
- Verifique o backend com `npx tsc --noEmit` e `npx jest --runInBand` e o frontend com `npm run build`; `npm run lint` não verifica nada, porque não há configuração de ESLint.
- Sessões e documentos importados vivem só na memória; depois de reiniciar o backend, reimporte o ZIP antes de testar dashboard ou export.
- Ao importar a tabela de cClassTrib, mantenha o nome original do arquivo oficial (a versão vem dele) e reinicie o backend para ele ler a tabela nova.

## Convenções que diferem do padrão

- O CFOP gravado é o do emitente, como consta no XML; não converta para CFOP de entrada.

## Armadilhas conhecidas

- Ao mudar modelos de documento, altere juntos `frontend/src/utils/modelos.ts` (códigos em texto), `backend/src/utils/modelos.ts` (códigos numéricos) e o tipo `NFeModel` em `backend/src/types/index.ts`.
- Use `diaEmissao` (o dia local do XML) para data de corte, vigência e exibição; nunca `new Date(dataEmissao)`, que desloca o dia.
- Ao usar um método HTTP novo, inclua-o em `methods` no CORS de `backend/src/server.ts`; o navegador bloqueia o resto e o erro aparece só como falha de rede.

<!-- /bmad:context -->
