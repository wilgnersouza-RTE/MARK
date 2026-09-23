import { UserSession, NFeDocument, DashboardData, ImportacaoArquivo } from '../types';
import { dashboardService } from './dashboard';

/**
 * Gerencia sessões de usuário em memória
 * Cada sessão é perdida quando o app reinicia
 */
export class SessionService {
  private sessions: Map<string, UserSession> = new Map();
  private readonly SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 horas

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
    importacao: ImportacaoArquivo
  ): Promise<UserSession> {
    const sessao = this.sessions.get(sessionId);

    if (!sessao) {
      throw new Error('Sessão não encontrada');
    }

    const anteriores = sessao.documentos.length;

    // Troca, não soma.
    sessao.documentos = [...documentos];

    // O histórico guarda só a importação vigente, para o painel e a lista de
    // importações contarem a mesma história.
    sessao.importacoes = [importacao];

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
   * Limpa os dados da sessão (novo upload, recomeça)
   */
  async limparSessao(sessionId: string): Promise<UserSession> {
    const sessao = this.sessions.get(sessionId);

    if (!sessao) {
      throw new Error('Sessão não encontrada');
    }

    sessao.documentos = [];
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
setInterval(() => {
  sessionService.limparSessoesExpiradas();
}, 6 * 60 * 60 * 1000);
