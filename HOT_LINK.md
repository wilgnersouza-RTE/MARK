# 🔥 HOT LINK - Acesso Rápido à API

## 🎯 Links de Acesso Direto (Clique para Abrir)

### ✅ Verificar Saúde (Health Check)
```
http://localhost:3000/health
```
**Status**: 🟢 Online
**Resposta esperada**: `{"status":"ok","timestamp":"...","environment":"development"}`

---

### 📊 Ver Regras Tributárias (2024-2027)
```
http://localhost:3000/api/v1/tax/rules
```
**Status**: 🟢 Online
**Resposta**: JSON com 4 anos de regras tributárias

---

## 🚀 Como Usar (Passo a Passo)

### **Método 1: Abrir no Navegador Automaticamente (RECOMENDADO)**

#### No VS Code:
1. Pressione `Ctrl+Shift+P` (Windows/Linux) ou `Cmd+Shift+P` (Mac)
2. Digite: `Ports: Open Browser on Port`
3. Selecione porta **3000**
4. ✅ Um navegador abrirá automaticamente com redirecionamento

#### Resultado:
```
http://localhost:3000/health
```

---

### **Método 2: Usar cURL (Terminal)**

```bash
# Verificar saúde
curl http://localhost:3000/health

# Ver regras tributárias
curl http://localhost:3000/api/v1/tax/rules

# Fazer login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@teste.com","password":"123"}'
```

---

### **Método 3: Usar Postman/Insomnia**

**Base URL:**
```
http://localhost:3000
```

**Rotas Públicas:**
- `GET /health`
- `GET /api/v1/tax/rules`
- `GET /api/v1/tax/rules/:ano`
- `POST /api/v1/auth/login`

**Rotas Protegidas (Requer Token):**
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/export/excel`

---

## 🔑 Autenticação

### 1️⃣ Fazer Login (obter token)
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@teste.com",
    "password": "123456"
  }'
```

### 2️⃣ Resposta (cópia seu token)
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

### 3️⃣ Usar token em requisições
```bash
curl http://localhost:3000/api/v1/dashboard/summary \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## 📱 Links Rápidos para Testes

| Recurso | GET | Status |
|---------|-----|--------|
| Health | [http://localhost:3000/health](http://localhost:3000/health) | ✅ |
| Regras 2024 | [http://localhost:3000/api/v1/tax/rules/2024](http://localhost:3000/api/v1/tax/rules/2024) | ✅ |
| Regras 2025 | [http://localhost:3000/api/v1/tax/rules/2025](http://localhost:3000/api/v1/tax/rules/2025) | ✅ |
| Regras 2026 | [http://localhost:3000/api/v1/tax/rules/2026](http://localhost:3000/api/v1/tax/rules/2026) | ✅ |
| Regras 2027 | [http://localhost:3000/api/v1/tax/rules/2027](http://localhost:3000/api/v1/tax/rules/2027) | ✅ |

---

## ⚙️ Detalhes do Servidor

| Propriedade | Valor |
|------------|-------|
| **URL Base** | `http://localhost:3000` |
| **Porta** | `3000` |
| **Host** | `localhost` |
| **Protocolo** | HTTP |
| **Ambiente** | Development |
| **Status** | 🟢 Online |

---

## ✅ Status de Validação

```
✅ Build TypeScript: OK (sem erros)
✅ Servidor: OK (rodando)
✅ Health Check: OK (respondendo)
✅ Regras Tributárias: OK (4 anos carregados)
✅ Autenticação: OK (JWT funcional)
✅ Rotas: OK (todas montadas)
✅ Estrutura: OK (completa)
```

---

## 🆘 Troubleshooting

### Problema: "Connection refused" ou "Can't reach localhost:3000"

**Solução:**
```bash
# 1. Verifique se o servidor está rodando
ps aux | grep "node"

# 2. Se não estiver rodando, inicie
npm start

# 3. Teste a conexão
curl http://localhost:3000/health
```

### Problema: "404 Not Found"

**Verifique:**
- ✅ URL está correta? (http://localhost:3000/health)
- ✅ Método HTTP está correto? (GET vs POST)
- ✅ Servidor está rodando?

### Problema: "401 Unauthorized"

**Solução:**
- ✅ Você precisa de um token JWT para essa rota
- ✅ Faça login primeiro em `/api/v1/auth/login`
- ✅ Use o token no header: `Authorization: Bearer SEU_TOKEN`

---

## 📋 Endpoints Rápidos

```bash
# Saúde (Public)
GET http://localhost:3000/health

# Regras Tributárias (Public)
GET http://localhost:3000/api/v1/tax/rules

# Login (Public)
POST http://localhost:3000/api/v1/auth/login

# Dashboard (Protected - Requer token)
GET http://localhost:3000/api/v1/dashboard/summary

# Exportar (Protected - Requer token)
GET http://localhost:3000/api/v1/export/excel
```

---

## 🎓 Dica: Testar com One-Liner

```bash
# Teste rápido completo
curl -s http://localhost:3000/health | jq . && \
curl -s http://localhost:3000/api/v1/tax/rules | jq '.data.anos'
```

---

**Última Atualização**: 2026-08-18 13:36:56 UTC  
**Servidor**: 🟢 Online e pronto para testes
