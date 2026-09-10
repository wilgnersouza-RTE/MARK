import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
// O .env é carregado dentro de ./config, que precisa ser importado antes de
// qualquer módulo que leia process.env.
import { config, validateConfig } from './config';

// Importar rotas
import authRouter from './routes/auth';
import uploadRouter from './routes/upload';
import dashboardRouter from './routes/dashboard';
import exportRouter from './routes/export';
import taxRouter from './routes/tax';
import rtcRouter from './routes/rtc';
import reformaRouter from './routes/reforma';

validateConfig();

/**
 * Decide quais origens o navegador pode usar para chamar esta API.
 *
 * Além do que estiver em CORS_ORIGIN, aceita automaticamente os domínios de
 * ambientes de desenvolvimento remoto. Sem isso, no Codespaces o frontend é
 * servido em `https://algo-3000.app.github.dev` e o navegador bloqueia a
 * resposta antes de o código do app enxergá-la — o erro aparece como falha de
 * rede, sem nenhuma pista de que a causa é CORS.
 *
 * Em produção (NODE_ENV=production) apenas a lista de CORS_ORIGIN vale.
 */
const origensConfiguradas = String(config.cors.origin || '')
  .split(',')
  .map(o => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

const PADROES_DESENVOLVIMENTO = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/.+\.app\.github\.dev$/,
  /^https:\/\/.+\.githubpreview\.dev$/,
  /^https:\/\/.+\.gitpod\.io$/,
  // Hospedagens de preview, para testar um frontend publicado contra um
  // backend ainda local. Vale somente fora de produção.
  /^https:\/\/.+\.vercel\.app$/,
  /^https:\/\/.+\.netlify\.app$/,
];

function origemPermitida(
  origem: string | undefined,
  callback: (erro: Error | null, permitido?: boolean) => void
) {
  // Requisições sem Origin (curl, Postman, health check) passam
  if (!origem) return callback(null, true);

  const limpa = origem.replace(/\/$/, '');

  if (origensConfiguradas.includes(limpa) || origensConfiguradas.includes('*')) {
    return callback(null, true);
  }

  if (!config.isProd && PADROES_DESENVOLVIMENTO.some(p => p.test(limpa))) {
    return callback(null, true);
  }

  console.warn(`⚠️  CORS bloqueou a origem: ${origem}`);
  return callback(null, false);
}

const app = express();

// ==================== Middleware ====================

// Segurança
app.use(helmet());

// CORS
app.use(
  cors({
    origin: origemPermitida,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
    exposedHeaders: ['Content-Disposition'],
  })
);

// Parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// ==================== Rotas ====================

// API v1
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/upload', uploadRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/export', exportRouter);
app.use('/api/v1/tax', taxRouter);
app.use('/api/v1/rtc', rtcRouter);
app.use('/api/v1/reforma', reformaRouter);

// ==================== 404 Handler ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Rota não encontrada',
    timestamp: new Date().toISOString(),
  });
});

// ==================== Error Handler ====================
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Erro:', err);

  const status = err.status || 500;
  const message = err.message || 'Erro interno do servidor';

  res.status(status).json({
    success: false,
    error: message,
    details: config.isDev ? err.stack : undefined,
    timestamp: new Date().toISOString(),
  });
});

// ==================== Start Server ====================
const PORT = config.port;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║    NFe Validator - Servidor Iniciado      ║
╠════════════════════════════════════════════╣
║ 🌐 http://localhost:${PORT}
║ 📡 Modo: ${config.nodeEnv.toUpperCase()}
║ ✅ Health Check: http://localhost:${PORT}/health
╚════════════════════════════════════════════╝
  `);
});

export default app;
