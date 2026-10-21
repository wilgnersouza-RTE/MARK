/**
 * Router de Dashboard
 * GET /api/v1/dashboard              - Análise completa
 * GET /api/v1/dashboard/resumo       - Resumo geral
 * GET /api/v1/dashboard/regimes      - Consolidado por regime tributário
 * GET /api/v1/dashboard/fornecedores - Top fornecedores
 * GET /api/v1/dashboard/documentos   - Documentos da sessão
 * GET /api/v1/dashboard/campos       - Conferência dos campos tributários
 * GET /api/v1/dashboard/filtros      - Opções de Entrada/Saída, CFOP e NCM do lote
 *
 * Todas, menos /filtros, aceitam ?sentido=&cfop=&ncm= e respondem só pelas
 * notas do recorte (ver utils/filtros.ts).
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { sessionService } from '../services/session';
import { resumoDoPreenchimento } from '../services/camposTributarios';
import { dashboardService } from '../services/dashboard';
import { DashboardData, NFeDocument } from '../types';
import { filtrarDocumentos, lerFiltros, opcoesDoLote } from '../utils/filtros';

const router = Router();

/**
 * Resolve a sessão, aplica os filtros da query e devolve o dashboard
 * calculado só sobre as notas do recorte.
 * Centraliza o que antes estava duplicado em cada rota.
 */
async function carregarDashboard(
  req: Request
): Promise<{ documentos: NFeDocument[]; dashboard: DashboardData | null; sessionId: string | null }> {
  const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined) || null;

  if (!sessionId) {
    return { documentos: [], dashboard: null, sessionId: null };
  }

  const doLote = sessionService.obterDocumentos(sessionId);

  if (!doLote || doLote.length === 0) {
    return { documentos: [], dashboard: null, sessionId };
  }

  // Com filtros sem nota em comum, o dashboard sai zerado (não nulo): a tela
  // distingue "lote vazio" de "recorte vazio".
  const documentos = filtrarDocumentos(doLote, lerFiltros(req.query));
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
 * GET /api/v1/dashboard/documentos
 * Documentos da sessão, com paginação simples
 */
router.get('/documentos', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    const documentos = filtrarDocumentos(sessionService.obterDocumentos(sessionId), lerFiltros(req.query));

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

    const notas = filtrarDocumentos(sessao.documentos, lerFiltros(req.query)).map(doc => {
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
  } catch (e: any) {
    erro(res, 500, e.message);
  }
});

/**
 * GET /api/v1/dashboard/filtros
 *
 * Opções dos filtros da análise. CFOPs e NCMs saem do lote inteiro, não do
 * recorte, para o contador poder trocar de código sem limpar os outros
 * filtros. `sentidoPadrao` diz onde o filtro Entrada/Saída abre: em
 * entradas quando há empresa analisada e ao menos uma nota de entrada; em
 * todas nos demais casos, para o painel não abrir vazio.
 */
router.get('/filtros', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    const sessao = sessionService.obterSessao(sessionId);
    const documentos = sessao?.documentos ?? [];
    const temEmpresa = !!sessao?.empresa;

    responder(res, {
      cfops: opcoesDoLote(documentos, 'cfops'),
      ncms: opcoesDoLote(documentos, 'ncms'),
      temEmpresa,
      sentidoPadrao: temEmpresa && documentos.some(d => d.tipo === 'entrada') ? 'entrada' : 'todas',
      totalDocumentos: documentos.length,
    });
  } catch (e: any) {
    erro(res, 500, e.message);
  }
});

export default router;
