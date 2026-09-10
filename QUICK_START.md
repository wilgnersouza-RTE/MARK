# 🚀 Guia de Início Rápido - NFe Validator

## ⚡ Setup em 5 minutos

### Opção 1: Com Docker (Recomendado)

```bash
# 1. Clonar repositório
git clone https://github.com/seu-usuario/nfe-validator.git
cd nfe-validator

# 2. Criar arquivo .env
cp backend/.env.example backend/.env

# 3. Iniciar containers
docker-compose up -d

# 4. Acessar a aplicação
# Frontend: http://localhost:3000
# Backend: http://localhost:5000
# Health Check: http://localhost:5000/health
```

### Opção 2: Setup Local

#### Backend

```bash
# 1. Entrar na pasta backend
cd backend

# 2. Instalar dependências
npm install

# 3. Criar arquivo .env
cp .env.example .env

# 4. Editar .env se necessário
# nano .env

# 5. Iniciar servidor
npm run dev

# ✅ Backend rodando em http://localhost:5000
```

#### Frontend (Em outro terminal)

```bash
# 1. Entrar na pasta frontend
cd frontend

# 2. Instalar dependências
npm install

# 3. Iniciar aplicação
npm start

# ✅ Frontend rodando em http://localhost:3000
```

## 🧪 Teste a Aplicação

### 1. Login com credenciais de teste
- Email: `teste@example.com`
- Senha: `123456`

### 2. Prepare um arquivo ZIP de teste

Crie um arquivo ZIP contendo XMLs de NF-e modelo 55 ou 65. Se não tiver:

```bash
# Criar estrutura de teste
mkdir test-nfe
cd test-nfe

# Criar um XML de exemplo (modelo 55)
cat > nfe-exemplo.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<NFe>
  <infNFe Id="NFe35240101234567000167550010000000011234567890">
    <ide>
      <mod>55</mod>
      <dhEmi>2024-08-13T14:30:00</dhEmi>
    </ide>
    <emit>
      <CNPJ>12345678000195</CNPJ>
      <xNome>Empresa Teste LTDA</xNome>
    </emit>
    <dest>
      <CNPJ>87654321000176</CNPJ>
      <xNome>Cliente Teste</xNome>
    </dest>
    <total>
      <ICMSTot>
        <vBC>1000.00</vBC>
        <vICMS>180.00</vICMS>
        <vISS>35.00</vISS>
        <vPIS>65.00</vPIS>
        <vCOFINS>300.00</vCOFINS>
        <vIRRF>0.00</vIRRF>
        <vNF>1500.00</vNF>
      </ICMSTot>
    </total>
  </infNFe>
</NFe>
EOF

# Compactar em ZIP
zip nfe-test.zip nfe-exemplo.xml
```

### 3. Upload no aplicativo

1. Clique em "Importar NF-e"
2. Escolha tipo: **Entrada** ou **Saída**
3. Escolha modelo: **55** (Produto)
4. Selecione o arquivo `nfe-test.zip`
5. Clique em enviar

### 4. Explore o Dashboard

- 📊 Veja o resumo de documentos
- ⚠️ Analise divergências encontradas
- 🏢 Visualize dados por regime tributário
- 📈 Veja a transição de tributos 2024-2027

### 5. Exporte dados

- Clique em **"Exportar Excel"** para baixar análise completa

## 📚 Estrutura de Pastas

```
nfe-validator/
├── backend/
│   ├── src/
│   │   ├── server.ts           # Servidor Express
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── routes/             # Rotas API
│   │   ├── services/           # Lógica de negócio
│   │   ├── types/              # Tipos TypeScript
│   ├── data/
│   │   └── tax-rules.json      # Regras tributárias
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Componente principal
│   │   └── index.css           # Estilos Tailwind
│   ├── public/
│   │   └── index.html
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## 🔧 Variáveis de Ambiente

### Backend

```env
# Servidor
PORT=5000
NODE_ENV=development

# JWT
JWT_SECRET=sua_chave_secreta_super_segura_minimo_32_caracteres
JWT_EXPIRY=7d

# CORS
CORS_ORIGIN=http://localhost:3000

# Auth0 (opcional)
AUTH0_DOMAIN=seu-dominio.auth0.com
AUTH0_CLIENT_ID=seu_client_id
AUTH0_CLIENT_SECRET=seu_client_secret

# Logs
LOG_LEVEL=info
```

### Frontend

```env
REACT_APP_API_URL=http://localhost:5000
REACT_APP_APP_NAME=NFe Validator
REACT_APP_AUTH_TYPE=jwt
```

## 🐛 Troubleshooting

### Erro: CORS não permitido
→ Verifique se `CORS_ORIGIN` no backend está configurado para `http://localhost:3000`

### Erro: JWT_SECRET inválido
→ Gere uma string aleatória com pelo menos 32 caracteres

### Porta 5000/3000 já em uso
→ Mude a porta no arquivo `.env` ou `.env.example`

### Docker não encontrado
→ Instale Docker Desktop: https://www.docker.com/products/docker-desktop

### Erro ao fazer upload de ZIP
→ Verifique se o ZIP contém apenas arquivos XML válidos de NF-e

## 📖 API Endpoints

### Autenticação
- `POST /api/v1/auth/login` - Fazer login
- `POST /api/v1/auth/register` - Registrar novo usuário
- `POST /api/v1/auth/verify` - Verificar token
- `GET /api/v1/auth/session-info` - Info da sessão

### Upload
- `POST /api/v1/upload/nfe` - Upload de ZIP com XMLs
- `GET /api/v1/upload/session-stats` - Estatísticas da sessão
- `POST /api/v1/upload/clear-session` - Limpar dados

### Dashboard
- `GET /api/v1/dashboard` - Dashboard completo
- `GET /api/v1/dashboard/resumo` - Resumo geral
- `GET /api/v1/dashboard/divergencias` - Divergências
- `GET /api/v1/dashboard/regimes` - Análise por regime
- `GET /api/v1/dashboard/fornecedores` - Top fornecedores
- `GET /api/v1/dashboard/transicao` - Transição 2024-2027
- `GET /api/v1/dashboard/documentos` - Documentos processados

### Export
- `GET /api/v1/export/excel` - Exportar em Excel
- `GET /api/v1/export/json` - Exportar em JSON
- `GET /api/v1/export/csv-divergencias` - CSV de divergências

### Tributação
- `GET /api/v1/tax/rules` - Todas as regras
- `GET /api/v1/tax/rules/:ano` - Regras de um ano
- `GET /api/v1/tax/aliquota` - Alíquota específica
- `GET /api/v1/tax/comparison/:tributo` - Comparar tributos
- `GET /api/v1/tax/status` - Status do serviço

## 📝 Exemplo de Request

```bash
# Login
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "teste@example.com", "password": "123456"}'

# Upload (precisa do sessionId)
curl -X POST http://localhost:5000/api/v1/upload/nfe \
  -H "x-session-id: seu-session-id" \
  -F "file=@nfe-test.zip" \
  -F "tipo=entrada" \
  -F "modelo=55"

# Dashboard
curl -X GET http://localhost:5000/api/v1/dashboard \
  -H "x-session-id: seu-session-id" \
  -H "Authorization: Bearer seu-token"
```

## 🚀 Deploy para Produção

### Heroku

```bash
# 1. Instalar CLI do Heroku
npm install -g heroku

# 2. Fazer login
heroku login

# 3. Criar aplicação
heroku create seu-app-name

# 4. Definir variáveis
heroku config:set JWT_SECRET="sua-chave-super-segura"

# 5. Deploy
git push heroku main
```

### AWS/DigitalOcean

1. Fazer build dos Dockerfiles
2. Fazer push para registry (Docker Hub, ECR, etc)
3. Fazer deploy com docker-compose ou Kubernetes

## 📞 Suporte

- Issues: https://github.com/seu-usuario/nfe-validator/issues
- Email: seu@email.com
- Documentação: Veja README.md

## 📄 Licença

MIT - Veja LICENSE.md

---

**Desenvolvido com ❤️ para a comunidade tributária brasileira**
