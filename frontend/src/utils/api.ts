import axios from 'axios';
/**
 * Descobre a URL do backend.
 *
 * Ordem de decisão:
 *   1. VITE_API_URL, quando definido no .env — sempre vence.
 *   2. Detecção automática do GitHub Codespaces.
 *   3. localhost:5000, para desenvolvimento local.
 *
 * O caso do Codespaces existe porque o frontend roda no NAVEGADOR do usuário,
 * enquanto o backend roda dentro do container. Para o navegador,
 * "localhost:5000" é a máquina do próprio usuário — onde não há servidor
 * nenhum. A URL correta é a porta 5000 encaminhada pelo Codespaces, que segue
 * o mesmo padrão da URL do frontend, trocando apenas o número da porta.
 */

const PORTA_BACKEND = 5000;

function resolverURL(): string {
  const configurada = import.meta.env.VITE_API_URL;

  // String vazia é intencional: significa "usar caminhos relativos" e deixar o
  // proxy do Vite encaminhar /api para o backend.
  if (configurada !== undefined && configurada !== null && configurada !== '') {
    return String(configurada).replace(/\/$/, '');
  }
  if (configurada === '') {
    return '';
  }

  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;

    // Ex.: verbose-space-doodle-abc123-3000.app.github.dev
    //   -> verbose-space-doodle-abc123-5000.app.github.dev
    const codespaces = hostname.match(/^(.*)-(\d+)\.(app\.github\.dev|githubpreview\.dev)$/);
    if (codespaces) {
      const [, prefixo, , dominio] = codespaces;
      return `${protocol}//${prefixo}-${PORTA_BACKEND}.${dominio}`;
    }

    // Gitpod: 3000-workspace.ws-xx.gitpod.io -> 5000-workspace.ws-xx.gitpod.io
    const gitpod = hostname.match(/^(\d+)-(.+\.gitpod\.io)$/);
    if (gitpod) {
      return `${protocol}//${PORTA_BACKEND}-${gitpod[2]}`;
    }
  }

  return `http://localhost:${PORTA_BACKEND}`;
}

export const API_URL = resolverURL();

/**
 * Timeout generoso por causa da hibernação de planos gratuitos (Render, Fly).
 * O serviço "acorda" na primeira requisição e pode levar ~30s para responder.
 * Sem isso o axios desistiria antes e mostraria erro de rede num servidor que
 * estava apenas iniciando.
 */
axios.defaults.timeout = 60_000;

/**
 * App rodando na máquina do desenvolvedor (localhost) ou num ambiente de
 * desenvolvimento remoto (Codespaces, Gitpod). Fora disso é produção, onde as
 * instruções de "npm run dev" não fazem sentido para quem usa o sistema.
 */
export function ehAmbienteDeDesenvolvimento(): boolean {
  if (typeof window === 'undefined') return true;
  const { hostname } = window.location;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /app\.github\.dev|githubpreview\.dev|gitpod\.io/.test(hostname)
  );
}

/** Responde se o backend está de pé, sem lançar erro. */
export async function servidorResponde(limiteMs = 5_000): Promise<boolean> {
  try {
    const r = await axios.get(`${API_URL}/health`, { timeout: limiteMs });
    return r.status === 200;
  } catch {
    return false;
  }
}

/**
 * Espera o backend acordar. No plano gratuito do Render o serviço hiberna após
 * ~15 minutos sem uso e o primeiro acesso leva de 30 s a 1 min: em vez de
 * mostrar erro, tenta de novo a cada `intervaloMs` até `limiteMs`.
 */
export async function aguardarServidor(
  limiteMs = 90_000,
  intervaloMs = 3_000
): Promise<boolean> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (await servidorResponde(Math.min(10_000, fim - Date.now()))) return true;
    await new Promise(resolve => setTimeout(resolve, intervaloMs));
  }
  return false;
}

/** A falha foi de rede (sem resposta do servidor), e não um erro devolvido por ele. */
export function ehFalhaDeRede(e: any): boolean {
  return e?.code === 'ERR_NETWORK' || e?.code === 'ECONNABORTED' || !e?.response;
}

/**
 * Mensagem de erro útil para falha de rede, citando a URL que foi tentada e o
 * que costuma ser a causa em cada ambiente.
 */
export function mensagemDeFalhaDeRede(): string {
  if (!ehAmbienteDeDesenvolvimento()) {
    return (
      'O servidor não respondeu. Ele pode estar iniciando após um período sem uso, ' +
      'o que leva até 1 minuto. Aguarde alguns instantes e tente de novo.'
    );
  }

  const emCodespaces =
    typeof window !== 'undefined' && /app\.github\.dev|gitpod\.io/.test(window.location.hostname);

  if (emCodespaces) {
    return (
      `Não foi possível falar com o servidor em ${API_URL}. ` +
      `Confira na aba "Portas" se a porta ${PORTA_BACKEND} está encaminhada e com ` +
      `visibilidade Pública, e se o backend está rodando (npm run dev na pasta backend).`
    );
  }

  return (
    `Não foi possível falar com o servidor em ${API_URL}. ` +
    `Verifique se o backend está rodando (npm run dev na pasta backend) e se as ` +
    `dependências foram instaladas (npm install).`
  );
}
