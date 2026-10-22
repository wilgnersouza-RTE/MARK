/**
 * Isola os testes de serviços externos.
 *
 * O config do backend carrega o backend/.env com dotenv, que não sobrescreve
 * variáveis já definidas. Zerar aqui, antes de qualquer import, garante que
 * os testes usem o armazenamento em memória mesmo quando o .env local aponta
 * para a Supabase real (sem isso, os testes gravavam análises de exemplo no
 * banco de produção).
 */
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';
