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
   * Adiciona documentos à sessão e regenera dashboard
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

    // Adicionar documentos
    sessao.documentos.push(...documentos);

    // Registrar importação
    sessao.importacoes.push(importacao);

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
