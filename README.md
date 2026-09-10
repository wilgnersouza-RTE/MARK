# MARK-2📊 Validador de Notas Fiscais - Reforma Tributária 2027

Aplicativo web completo para validação, análise e auditoria de valores de tributos em notas fiscais (modelos 55 e 65) com suporte à reforma tributária brasileira 2027 e módulo de transição anual.

🎯 Funcionalidades Principais
✅ Upload de XMLs - Suporta ZIP com múltiplos arquivos XML (NF-e modelo 55 e 65)
📊 Dashboard Financeiro - Resumo por categoria, regime tributário e fornecedor
🔍 Validação Tributária - Comparação com tabelas da reforma tributária 2027
📈 Gráficos Interativos - Visualização de regimes, valores e divergências
📉 Módulo de Transição - Análise anual (2024-2027) com projeções
✨ Relatório de Divergências - Mostra valores atuais vs previstos
📥 Export Excel - Exporta análise completa com gráficos
🔐 Autenticação - JWT integrado + opção Auth0
🚫 Zero Persistência - Dados em memória por sessão
🏗️ Stack Técnico
Backend
Node.js 18+ com TypeScript
Express.js para rotas REST
xml2js para parsing de XML
jszip para processamento de ZIP
xlsx para geração de Excel
jsonwebtoken para autenticação JWT
Frontend
React 18+ com TypeScript
TailwindCSS para UI
Recharts para gráficos
Zustand para state management
Axios para requisições HTTP
🚀 Instalação Rápida
Pré-requisitos
bash
Node.js 18+
npm ou yarn
Git
1. Clonar Repositório
bash
git clone https://github.com/seu-usuario/nfe-validator.git
cd nfe-validator
2. Setup Backend
bash
cd backend
cp .env.example .env
# Editar .env com suas credenciais
npm install
npm run dev
# Servidor rodando em http://localhost:5000
3. Setup Frontend
bash
cd frontend
cp .env.example .env
npm install
npm start
# App rodando em http://localhost:3000
4. Com Docker (Opcional)
bash
docker-compose up -d
📖 Uso do Aplicativo
1. Autenticação
Faça login com sua conta (JWT ou Auth0)
Você receberá um token que permanece válido na sessão
2. Upload de Notas Fiscais
Clique em "Importar NF-e"
Escolha o tipo: Entrada ou Saída
Selecione o modelo: 55 ou 65
Faça upload de um ZIP contendo múltiplos XMLs
O sistema processa automaticamente
3. Análise e Validação
Dashboard mostra resumo financeiro por categoria
Aba Validação indica se valores estão conforme reforma
Relatório de Divergências lista diferenças (Atual vs Previsto)
4. Gráficos
Regime Tributário (Simples, Lucro Real, Lucro Presumido)
Distribuição por Fornecedor
Evolução de Tributos (2024-2027)
5. Exportar
Clique "Exportar Excel"
Arquivo com: dados, gráficos, análises e recomendações
📚 Estrutura de Dados - XML NF-e

O sistema espera XMLs padrão NF-e com estrutura:

xml
<NFe>
  <infNFe Id="...">
    <ide>
      <mod>55</mod> <!-- ou 65 -->
      <dhEmi>2024-01-15T10:30:00</dhEmi>
    </ide>
    <emit>
      <CNPJ>12345678000195</CNPJ>
      <xNome>Empresa XYZ</xNome>
    </emit>
    <dest>
      <CNPJ>87654321000176</CNPJ>
    </dest>
    <total>
      <ICMSTot>
        <vBC>1000.00</vBC>
        <vICMS>180.00</vICMS>
        <vPIS>65.00</vPIS>
        <vCOFINS>300.00</vCOFINS>
      </ICMSTot>
    </total>
  </infNFe>
</NFe>
🔧 Variáveis de Ambiente
Backend (.env)
env
PORT=5000
NODE_ENV=development
JWT_SECRET=sua_chave_secreta_super_segura_min_32_chars
JWT_EXPIRY=7d
AUTH0_DOMAIN=seu-dominio.auth0.com
AUTH0_CLIENT_ID=seu_client_id
CORS_ORIGIN=http://localhost:3000
Frontend (.env)
env
REACT_APP_API_URL=http://localhost:5000
REACT_APP_AUTH0_DOMAIN=seu-dominio.auth0.com
REACT_APP_AUTH0_CLIENT_ID=seu_client_id
📊 Tabelas da Reforma Tributária

Consultadas automaticamente do arquivo data/tax-rules.json:

ISS (Imposto sobre Serviços): Regra progressiva 2024-2027
ICMS (Imposto sobre Circulação): Redução gradual
PIS (Programa de Integração Social): Alíquota única
COFINS: Consolidação de tributos
IRRF (Imposto Retido na Fonte): Segmentado por serviço

Valores são carregados de arquivos, não hardcoded no código.

🛠️ Desenvolvimento
Rodar testes
bash
cd backend
npm test

cd ../frontend
npm test
Build para produção
bash
# Backend
cd backend
npm run build

# Frontend
cd frontend
npm run build
Deploy
Frontend: Vercel, Netlify ou GitHub Pages
Backend: Railway, Heroku, DigitalOcean ou AWS
📋 Roadmap
 Integração com NFe.io para busca automática
 Suporte a NFC-e (modelo 65 em detalhes)
 Dashboard de conformidade tributária
 Relatórios em PDF
 Integração com contador (exportar para sistema contábil)
 Análise de padrões de tributação
 ML para detecção de anomalias
🔐 Segurança
JWT com expiração automática
CORS configurável por ambiente
Validação de entrada em todas as rotas
Sem persistência de dados sensíveis
HTTPS recomendado em produção
📄 Licença

MIT - Veja LICENSE.md

👥 Contribuindo
Fork o projeto
Crie uma branch para sua feature (git checkout -b feature/AmazingFeature)
Commit suas mudanças (git commit -m 'Add some AmazingFeature')
Push para a branch (git push origin feature/AmazingFeature)
Abra um Pull Request