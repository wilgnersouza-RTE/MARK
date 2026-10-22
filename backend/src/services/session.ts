import { UserSession, NFeDocument, DashboardData, ImportacaoArquivo, EmpresaAnalisada } from '../types';
import { dashboardService } from './dashboard';
import { classificarSentido, identificarEmpresa, normalizarCnpj } from '../utils/sentidoImportacao';

/** CNPJ informado não aparece em nenhuma nota do lote vigente. */
export class ErroEmpresaForaDoLote extends Error {
  constructor(cnpj: string) {
    super(`O CNPJ ${cnpj || '(vazio)'} não aparece em nenhuma nota do lote importado.`);
    this.name = 'ErroEmpresaForaDoLote';
  }
}

/**
 * Gerencia sessões de usuário em memória
 * Cada sessão é perdida quando o app reinicia
 */
export class SessionService {
  private sessions: Map<string, UserSession> = new Map();
  private readonly SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 horas
  private contadorLotes = 0;

  /**
   * Cria ou recupera uma sessão
   */
  criarOuRecuperarSessao(sessionId: string, userId: string, email: string): UserSession {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    const sessao: UserSession = {
      sessionId,
      userId,
      email,
      documentos: [],
      dashboard: null,
      ultimaAtualizacao: new Date().toISOString(),
      importacoes: [],
    };

    this.sessions.set(sessionId, sessao);
    return sessao;
  }

  /**
   * Recupera uma sessão existente
   */
  obterSessao(sessionId: string): UserSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Sessão mais recente de um usuário que já tenha documentos importados.
   *
   * Usado quando um administrador assume a conta: criar uma sessão nova
   * entregaria um painel vazio, e o objetivo de assumir é justamente ver as
   * análises daquela pessoa. Sem documentos em nenhuma sessão dele, devolve
   * null e o chamador cria uma sessão limpa.
   */
  sessaoComDocumentosDoUsuario(userId: string): UserSession | null {
    const candidatas = Array.from(this.sessions.values())
      .filter(s => s.userId === userId && s.documentos.length > 0)
      .sort((a, b) => b.ultimaAtualizacao.localeCompare(a.ultimaAtualizacao));

    return candidatas[0] ?? null;
  }

  /**
   * Substitui os documentos da sessão e regenera o dashboard.
   *
   * Cada importação recomeça a análise: os documentos anteriores são
   * descartados. Acumular era perigoso — um segundo ZIP somava entradas com
   * saídas, ou março com abril, e todo indicador do painel passava a
   * responder por um conjunto que ninguém tinha pedido, sem aviso na tela.
   */
  async adicionarDocumentos(
    sessionId: string,
    documentos: NFeDocument[],
    importacao: ImportacaoArquivo,
    empresa: EmpresaAnalisada | null
  ): Promise<UserSession> {
    const sessao = this.sessions.get(sessionId);

    if (!sessao) {
      throw new Error('Sessão não encontrada');
    }

    const anteriores = sessao.documentos.length;

    // Troca, não soma. A empresa do lote anterior também sai: sem empresa,
    // as notas ficam com sentido indefinido até o contador escolher.
    sessao.empresa = empresa ?? undefined;
    sessao.documentos = classificarSentido(documentos, empresa?.cnpj);
    // O vínculo com a análise salva é de quem chamou: o lote novo ainda não tem.
    sessao.analiseId = undefined;
    sessao.analiseOrigem = undefined;
    sessao.loteId = `lote-${++this.contadorLotes}`;

    // O histórico guarda só a importação vigente, para o painel e a lista de
    // importações contarem a mesma história.
    sessao.importacoes = [{ ...importacao, documentos: sessao.documentos }];

    if (anteriores > 0) {
      console.log(
        `[sessao ${sessionId}] ${anteriores} documento(s) anterior(es) ` +
          `descartados; ${documentos.length} importado(s).`
      );
    }

    // Regenerar dashboard
    sessao.dashboard = await dashboardService.generateDashboard(sessao.documentos);
    sessao.ultimaAtualizacao = new Date().toISOString();

    return sessao;
  }

  /**
   * Troca a empresa analisada e reclassifica as notas já importadas.
   *
   * Só aceita CNPJ presente no lote, como emitente ou destinatário ou
   * tomador: escolher uma empresa que não aparece em nota nenhuma deixaria
   * todas sem vínculo.
   */
  async definirEmpresa(sessionId: string, cnpj: string): Promise<UserSession> {
    const sessao = this.sessions.get(sessionId);

    if (!sessao) {
      throw new Error('Sessão não encontrada');
    }

    const alvo = normalizarCnpj(cnpj);
    const candidato = alvo
      ? identificarEmpresa(sessao.documentos).todos.find(c => c.cnpj === alvo)
      : undefined;

    if (!candidato) {
      throw new ErroEmpresaForaDoLote(cnpj);
    }

    sessao.empresa = { cnpj: candidato.cnpj, nome: candidato.nome, inferida: false };
    sessao.documentos = classificarSentido(sessao.documentos, candidato.cnpj);
    sessao.importacoes = sessao.importacoes.map(i => ({ ...i, documentos: sessao.documentos }));
    sessao.dashboard = await dashboardService.generateDashboard(sessao.documentos);
    sessao.ultimaAtualizacao = new Date().toISOString();

    return sessao;
  }

  /**
   * Liga o lote vigente da sessão à análise salva que o guarda, só se o
   * lote ainda for `loteId`: outro upload ou abertura no meio do caminho
   * não pode herdar a análise de um lote que já saiu da sessão.
   * Sem `analiseId`, desfaz o vínculo. Devolve se ligou.
   */
  vincularAnalise(
    sessionId: string,
    loteId: string | undefined,
    analiseId: string | undefined,
    origem: 'upload' | 'aberta' = 'upload'
  ): boolean {
    const sessao = this.sessions.get(sessionId);
    if (!sessao || !loteId || sessao.loteId !== loteId) return false;
    sessao.analiseId = analiseId;
    sessao.analiseOrigem = analiseId ? origem : undefined;
    return true;
  }

  /**
   * Limpa os dados da sessão (novo upload, recomeça)
   */
  async limparSessao(sessionId: string): Promise<UserSession> {
    const sessao = this.sessions.get(sessionId);

    if (!sessao) {
      throw new Error('Sessão não encontrada');
    }

    sessao.documentos = [];
    sessao.empresa = undefined;
    sessao.analiseId = undefined;
    sessao.analiseOrigem = undefined;
    sessao.loteId = undefined;
    sessao.dashboard = null;
    sessao.importacoes = [];
    sessao.ultimaAtualizacao = new Date().toISOString();

    return sessao;
  }

  /**
   * Obtém o dashboard atual
   */
  obterDashboard(sessionId: string): DashboardData | null {
    const sessao = this.sessions.get(sessionId);

    if (!sessao) {
      return null;
    }

    return sessao.dashboard;
  }

  /**
   * Obtém todos os documentos da sessão
   */
  obterDocumentos(sessionId: string): NFeDocument[] {
    const sessao = this.sessions.get(sessionId);

    if (!sessao) {
      return [];
    }

    return sessao.documentos;
  }

  /**
   * Deleta uma sessão completamente
   */
  deletarSessao(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Limpa sessões expiradas (cleanup)
   */
  limparSessoesExpiradas(): number {
    let deletadas = 0;
    const agora = Date.now();

    for (const [sessionId, sessao] of this.sessions.entries()) {
      const idade = agora - new Date(sessao.ultimaAtualizacao).getTime();

      if (idade > this.SESSION_TIMEOUT) {
        this.sessions.delete(sessionId);
        deletadas++;
      }
    }

    console.log(`🧹 Limpeza de sessões: ${deletadas} sessão(ões) expirada(s)`);
    return deletadas;
  }

  /**
   * Obtém estatísticas de sessões ativas
   */
  obterEstatisticas() {
    let totalDocumentos = 0;
    let totalSessoes = this.sessions.size;

    for (const sessao of this.sessions.values()) {
      totalDocumentos += sessao.documentos.length;
    }

    return {
      sessoes_ativas: totalSessoes,
      total_documentos: totalDocumentos,
      memoria_aproximada: `${Math.round(totalDocumentos * 2 / 1024)} KB`,
    };
  }
}

export const sessionService = new SessionService();

// Limpeza automática a cada 6 horas
// unref: a limpeza não deve, sozinha, manter o processo vivo (testes e
// encerramento do servidor).
setInterval(() => {
  sessionService.limparSessoesExpiradas();
}, 6 * 60 * 60 * 1000).unref();
