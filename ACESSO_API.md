# 🌐 Acesso à API - NFe Validador

## ✅ Status do Servidor
- **Status**: 🟢 ONLINE
- **URL Base**: `http://localhost:3000`
- **Ambiente**: Development
- **Data**: 2026-08-18

---

## 📍 Links para Acesso Rápido

### 🏥 Health Check
```
http://localhost:3000/health
```

### 📊 Regras Tributárias (Público)
```
http://localhost:3000/api/v1/tax/rules
```

### 🔐 Autenticação (POST)
```
POST http://localhost:3000/api/v1/auth/login
Content-Type: application/json

{
  "email": "teste@teste.com",
  "password": "123456"
}
```

---

## 🚀 Como Acessar

### Opção 1: Abrir no VS Code (Recomendado)
1. Pressione `Ctrl+Shift+P` (ou `Cmd+Shift+P` no Mac)
2. Digite: `Ports: Open Browser on Port`
3. Selecione porta **3000**
4. Um navegador abrirá com acesso automático

### Opção 2: Abrir Link Direto
Clique em um dos links abaixo (funciona se VS Code está aberto):
- 🏥 Health: [http://localhost:3000/health](http://localhost:3000/health)
- 📊 Regras: [http://localhost:3000/api/v1/tax/rules](http://localhost:3000/api/v1/tax/rules)

### Opção 3: Terminal / cURL
```bash
# Verificar saúde
curl -s http://localhost:3000/health | jq .

# Obter regras tributárias
curl -s http://localhost:3000/api/v1/tax/rules | jq .

# Fazer login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@teste.com","password":"123456"}'
```

---

## 📡 Endpoints Disponíveis

### 🔐 Autenticação
| Método | Rota | Descrição | Autenticação |
|--------|------|-----------|--------------|
| POST | `/api/v1/auth/login` | Fazer login | ❌ Pública |
| POST | `/api/v1/auth/register` | Registrar usuário | ❌ Pública |
| GET | `/api/v1/auth/verify` | Verificar token | ✅ Requer JWT |
| GET | `/api/v1/auth/session-info` | Info da sessão | ✅ Requer JWT |

### 📊 Dashboard
| Método | Rota | Descrição | Autenticação |
|--------|------|-----------|--------------|
| GET | `/api/v1/dashboard/summary` | Resumo do dashboard | ✅ Requer JWT |

### 💰 Tributação
| Método | Rota | Descrição | Autenticação |
|--------|------|-----------|--------------|
| GET | `/api/v1/tax/rules` | Todas as regras | ❌ Pública |
| GET | `/api/v1/tax/rules/:ano` | Regras por ano | ❌ Pública |
| GET | `/api/v1/tax/aliquota` | Alíquota específica | ❌ Pública |
| GET | `/api/v1/tax/comparison/:tributo` | Comparação de tributos | ❌ Pública |
| GET | `/api/v1/tax/status` | Status do serviço | ❌ Pública |

### 📤 Upload
| Método | Rota | Descrição | Autenticação |
|--------|------|-----------|--------------|
| POST | `/api/v1/upload/nfe` | Upload de NF-e | Requer Session ID |
| POST | `/api/v1/upload/clear-session` | Limpar sessão | Requer Session ID |
| GET | `/api/v1/upload/session-stats` | Stats da sessão | Requer Session ID |

### 📥 Exportação
| Método | Rota | Descrição | Autenticação |
|--------|------|-----------|--------------|
| GET | `/api/v1/export/excel` | Exportar Excel | ✅ Requer JWT |

---

## 🔑 Obter Token de Acesso

### 1. Fazer Login
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@teste.com",
    "password": "123456"
  }'
```

### 2. Salvar o Token
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "userId": "teste",
      "email": "teste@teste.com"
    },
    "expiresIn": "24h"
  }
}
```

### 3. Usar em Requisições
```bash
curl http://localhost:3000/api/v1/dashboard/summary \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

---

## 📦 Estructura do Projeto

```
/workspaces/MARK-2.0/
├── server.ts              # Servidor principal
├── config.ts              # Configurações
├── auth.ts                # Autenticação JWT
├── authRouter.ts          # Rotas de autenticação
├── dashboard.ts           # Lógica do dashboard
├── dashboardRouter.ts     # Rotas do dashboard
├── tax.ts                 # Rotas de tributação
├── taxRules.ts            # Serviço de regras
├── tax-rules.json         # Dados de regras tributárias
├── upload.ts              # Rotas de upload
├── export.ts              # Serviço de exportação
├── exportRouter.ts        # Rotas de exportação
├── nfeParser.ts           # Parser de NF-e XML
├── session.ts             # Gerenciador de sessões
├── index.ts               # Tipos TypeScript
├── tsconfig.json          # Configuração TypeScript
├── package.json           # Dependências
└── dist/                  # Arquivos compilados
    └── server.js          # Servidor compilado
```

---

## ✅ Validação da Estrutura

| Componente | Status | Detalhes |
|-----------|--------|----------|
| Build TypeScript | ✅ OK | Sem erros de compilação |
| Servidor | ✅ OK | Rodando na porta 3000 |
| Health Check | ✅ OK | Respondendo |
| Regras Tributárias | ✅ OK | 4 anos carregados (2024-2027) |
| Autenticação | ✅ OK | JWT funcionando |
| Rotas | ✅ OK | Todas montadas corretamente |

---

## 🐛 Se Encontrar Erros

1. Verifique se o servidor está rodando:
   ```bash
   npm start
   ```

2. Limpe o cache e rebuild:
   ```bash
   rm -rf dist
   npm run build
   npm start
   ```

3. Verifique logs:
   ```bash
   curl -s http://localhost:3000/health
   ```

---

## 📞 Suporte
- **Porta**: 3000
- **Host**: localhost
- **Protocolo**: HTTP (development)

**Gerado em**: 2026-08-18T13:36:56.062Z
