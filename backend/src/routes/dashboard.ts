/**
 * Router de Dashboard
 * GET /api/v1/dashboard              - Análise completa
 * GET /api/v1/dashboard/resumo       - Resumo geral
 * GET /api/v1/dashboard/regimes      - Consolidado por regime tributário
 * GET /api/v1/dashboard/fornecedores - Top fornecedores
 * GET /api/v1/dashboard/transicao    - Transição 2024-2027
 * GET /api/v1/dashboard/documentos   - Documentos da sessão
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { sessionService } from '../services/session';
import { resumoDoPreenchimento } from '../services/camposTributarios';
import { dashboardService } from '../services/dashboard';
import { DashboardData, NFeDocument } from '../types';

const router = Router();

/**
 * Resolve a sessão e devolve o dashboard já calculado.
 * Centraliza o que antes estava duplicado em cada rota.
 */
async function carregarDashboard(
  req: Request
): Promise<{ documentos: NFeDocument[]; dashboard: DashboardData | null; sessionId: string | null }> {
  const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined) || null;

  if (!sessionId) {
    return { documentos: [], dashboard: null, sessionId: null };
  }

  const documentos = sessionService.obterDocumentos(sessionId);

  if (!documentos || documentos.length === 0) {
    return { documentos: [], dashboard: null, sessionId };
  }

  const dashboard = await dashboardService.generateDashboard(documentos);
  return { documentos, dashboard, sessionId };
}

function responder(res: Response, data: unknown) {
  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}

function erro(res: Response, status: number, mensagem: string) {
  res.status(status).json({
    success: false,
    error: mensagem,
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /api/v1/dashboard
 * Dashboard completo da sessão
 */
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { documentos, dashboard, sessionId } = await carregarDashboard(req);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    responder(res, {
      dashboard,
      totalDocumentos: documentos.length,
    });
  } catch (error: any) {
    console.error('Erro ao gerar dashboard:', error);
    erro(res, 500, error.message || 'Erro ao gerar dashboard');
  }
});

/**
 * GET /api/v1/dashboard/resumo
 * Resumo geral — o frontend lê `data` diretamente como ResumoGeral
 */
router.get('/resumo', authenticate, async (req: Request, res: Response) => {
  try {
    const { dashboard, sessionId } = await carregarDashboard(req);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    responder(res, dashboard ? dashboard.resumoGeral : null);
  } catch (error: any) {
    erro(res, 500, error.message);
  }
});

/**
 * GET /api/v1/dashboard/regimes
 * Consolidado por regime tributário — `data` é o array de RegimeDados
 */
router.get('/regimes', authenticate, async (req: Request, res: Response) => {
  try {
    const { dashboard, sessionId } = await carregarDashboard(req);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    responder(res, dashboard ? dashboard.porRegime : []);
  } catch (error: any) {
    erro(res, 500, error.message);
  }
});

/**
 * GET /api/v1/dashboard/fornecedores
 * Top fornecedores — `data` é o array de FornecedorDados
 */
router.get('/fornecedores', authenticate, async (req: Request, res: Response) => {
  try {
    const { dashboard, sessionId } = await carregarDashboard(req);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    responder(res, dashboard ? dashboard.porFornecedor : []);
  } catch (error: any) {
    erro(res, 500, error.message);
  }
});

/**
 * GET /api/v1/dashboard/transicao
 * Transição 2024-2027.
 * O serviço entrega colunas ({anos, tributos:{icms:[...]}}), mas o gráfico do
 * frontend precisa de linhas ([{ano, icms, iss, ...}]). A conversão é feita aqui
 * e o formato original vai junto, em `bruto`, para quem precisar dele.
 */
router.get('/transicao', authenticate, async (req: Request, res: Response) => {
  try {
    const { dashboard, sessionId } = await carregarDashboard(req);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    if (!dashboard) {
      return responder(res, { dados: [], bruto: null });
    }

    const { anos, tributos, projecoes } = dashboard.transicaoAnual;

    const dados = anos.map((ano, i) => ({
      ano,
      icms: tributos.icms[i] ?? 0,
      iss: tributos.iss[i] ?? 0,
      pis: tributos.pis[i] ?? 0,
      cofins: tributos.cofins[i] ?? 0,
      irrf: tributos.irrf[i] ?? 0,
      projecaoIcms: projecoes.icms[i] ?? 0,
      projecaoIss: projecoes.iss[i] ?? 0,
      projecaoPis: projecoes.pis[i] ?? 0,
      projecaoCofins: projecoes.cofins[i] ?? 0,
      projecaoIrrf: projecoes.irrf[i] ?? 0,
    }));

    responder(res, { dados, bruto: dashboard.transicaoAnual });
  } catch (error: any) {
    erro(res, 500, error.message);
  }
});

/**
 * GET /api/v1/dashboard/documentos
 * Documentos da sessão, com paginação simples
 */
router.get('/documentos', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    const documentos = sessionService.obterDocumentos(sessionId);

    const pagina = Math.max(1, parseInt(String(req.query.pagina || '1'), 10) || 1);
    const porPagina = Math.min(500, Math.max(1, parseInt(String(req.query.porPagina || '50'), 10) || 50));
    const inicio = (pagina - 1) * porPagina;

    responder(res, {
      documentos: documentos.slice(inicio, inicio + porPagina),
      total: documentos.length,
      pagina,
      porPagina,
    });
  } catch (error: any) {
    erro(res, 500, error.message);
  }
});


/**
 * GET /api/v1/dashboard/campos
 *
 * Conferência de preenchimento dos campos tributários, nota a nota. Resposta
 * enxuta de propósito: a tela lista as notas e só abre os campos da que o
 * usuário expandir, mas paginar aqui exigiria manter estado no servidor para
 * um volume que cabe folgado numa resposta só.
 */
router.get('/campos', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId!;
    const sessao = sessionService.obterSessao(sessionId);

    if (!sessao) {
      return responder(res, []);
    }

    const notas = sessao.documentos.map(doc => {
      const campos = doc.camposTributarios ?? [];
      const { preenchidos, total } = resumoDoPreenchimento(campos);

      return {
        id: doc.id,
        numero: doc.chaveNFe,
        modelo: doc.modelo,
        emitente: doc.nomeEmitente,
        cnpjEmitente: doc.cnpjEmitente,
        valor: doc.values.total,
        preenchidos,
        totalCampos: total,
        campos,
      };
    });

    responder(res, {
      notas,
      resumo: {
        total: notas.length,
        completas: notas.filter(n => n.preenchidos === n.totalCampos).length,
        incompletas: notas.filter(n => n.preenchidos < n.totalCampos).length,
      },
    });
  } catch (erro: any) {
    res.status(500).json({ success: false, error: erro.message });
  }
});

export default router;
