/**
 * Configuração da aplicação
 *
 * O dotenv é carregado AQUI, e não no server.ts. Este módulo lê process.env no
 * momento em que é importado, e o import acontece antes da primeira linha do
 * server.ts executar — então chamar dotenv.config() lá deixava o .env inteiro
 * sem efeito (a porta e o JWT_SECRET caíam silenciosamente no valor padrão).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const projectRoot = process.cwd();

export const config = {
  // Autenticação JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'sua-chave-secreta-padrao-INSEGURA-MUDAR-EM-PRODUCAO',
    expiry: process.env.JWT_EXPIRY || '24h',
  },
  
  // Servidor
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  
  // CORS
  cors: {
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
  },
  
  // Diretórios
  dataDir: process.env.DATA_DIR || path.join(projectRoot, 'data'),

  /**
   * Diretório para dados GRAVADOS em execução (usuários, por enquanto).
   *
   * Precisa ser separado do dataDir: as tabelas fiscais são versionadas junto
   * com o código e vêm do repositório, enquanto os usuários precisam de um
   * disco persistente que sobreviva a novos deploys. Apontar os dois para o
   * mesmo lugar faria uma das duas coisas quebrar — ou o disco persistente
   * viria vazio, sem as tabelas, ou os usuários se perderiam a cada deploy.
   *
   * Sem WRITABLE_DIR definido, cai no dataDir, que é o comportamento local.
   */
  writableDir: process.env.WRITABLE_DIR || process.env.DATA_DIR || path.join(projectRoot, 'data'),
  
  // Upload
  upload: {
    maxSize: parseInt(process.env.MAX_UPLOAD_SIZE || '52428800', 10), // 50MB
    allowedMimes: ['application/xml', 'application/zip'],
  },
  
  // Auth0 (opcional)
  auth0: {
    domain: process.env.AUTH0_DOMAIN,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
  },
};

/**
 * Validar configuração essencial
 */
export function validateConfig() {
  const required = ['JWT_SECRET'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    if (config.isProd) {
      // Em produção, subir com a chave padrão significa que qualquer pessoa que
      // leia o repositório consegue forjar um token. Melhor não subir.
      throw new Error(
        `Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}. ` +
          `Defina-as antes de iniciar em produção.`
      );
    }
    console.warn(`⚠️  Variáveis de ambiente ausentes (usando padrões de desenvolvimento): ${missing.join(', ')}`);
  }

  console.log(`✅ Configuração carregada - Ambiente: ${config.nodeEnv} | Porta: ${config.port}`);
}
