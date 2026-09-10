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
 * Mensagem de erro útil para falha de rede, citando a URL que foi tentada e o
 * que costuma ser a causa em ambiente remoto.
 */
export function mensagemDeFalhaDeRede(): string {
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
