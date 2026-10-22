import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { sessionService } from '../services/session';
import {
  ErroAnaliseInexistente,
  ErroZipDaAnalise,
  abrirNaSessao,
  armazenamentoAnalises,
  causaDaFalha,
  reprocessar,
  resumoDoLote,
  resumoPublico,
} from '../services/analises';
import { PAGINA_PADRAO, PASTA_SEM_EMPRESA } from '../services/armazenamentoAnalises';

/**
 * Análises salvas. Todo usuário autenticado vê e abre as análises de todos
 * os clientes. Nenhuma rota exclui análise nem ZIP.
 *
 * Códigos: 400 para parâmetro inválido ou ZIP guardado ilegível, 404 para
 * análise inexistente, 503 quando o armazenamento falha (com a causa).
 */
const router = Router();

const agora = () => new Date().toISOString();

/** Falha do armazenamento: 503, com a causa (pausado, sem espaço, chave). */
function falhaDoArmazenamento(res: Response, erro: any, acao: string) {
  console.error(`Erro ao ${acao}:`, erro);
  return res.status(503).json({
    success: false,
    error: `Não foi possível ${acao}: ${causaDaFalha(erro)}`,
    timestamp: agora(),
  });
}

/** Inteiro não negativo da query, o padrão se ausente, null se inválido. */
function inteiro(valor: unknown, padrao: number): number | null {
  if (valor === undefined || valor === '') return padrao;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * GET /api/v1/analises?empresa=<cnpj>&offset=0&limite=100
 * Análises salvas, mais recentes primeiro, em páginas de até 100.
 * `empresa` é um CNPJ (14 dígitos, com ou sem pontuação) ou `sem-empresa`,
 * para as que ficaram sem empresa definida; outro valor responde 400.
 */
router.get('/', authenticate, async (req: Request, res: Response) => {
  const bruto = typeof req.query.empresa === 'string' ? req.query.empresa.trim() : '';
  let empresa: string | undefined;
  if (bruto === PASTA_SEM_EMPRESA) {
    empresa = '';
  } else if (bruto !== '') {
    empresa = bruto.replace(/[.\-/\s]/g, '');
    if (!/^\d{14}$/.test(empresa)) {
      return res.status(400).json({
        success: false,
        error: `Empresa inválida: informe o CNPJ com 14 dígitos ou "${PASTA_SEM_EMPRESA}".`,
        timestamp: agora(),
      });
    }
  }

  const offset = inteiro(req.query.offset, 0);
  const limite = inteiro(req.query.limite, PAGINA_PADRAO);
  if (offset === null || limite === null || limite < 1) {
    return res.status(400).json({
      success: false,
      error: 'offset e limite precisam ser números inteiros, com limite maior que zero.',
      timestamp: agora(),
    });
  }

  try {
    const pagina = await armazenamentoAnalises().listar({ empresa, offset, limite });
    res.json({
      success: true,
      data: pagina.analises.map(resumoPublico),
      paginacao: { offset, limite: Math.min(limite, PAGINA_PADRAO), temMais: pagina.temMais },
      timestamp: agora(),
    });
  } catch (erro) {
    falhaDoArmazenamento(res, erro, 'listar as análises salvas');
  }
});

/** GET /api/v1/analises/empresas — empresas com análise salva. */
router.get('/empresas', authenticate, async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await armazenamentoAnalises().listarEmpresas(), timestamp: agora() });
  } catch (erro) {
    falhaDoArmazenamento(res, erro, 'listar as empresas');
  }
});

/** GET /api/v1/analises/uso — espaço ocupado e limites do plano gratuito. */
router.get('/uso', authenticate, async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await armazenamentoAnalises().uso(), timestamp: agora() });
  } catch (erro) {
    falhaDoArmazenamento(res, erro, 'medir o uso do armazenamento');
  }
});

/**
 * POST /api/v1/analises/:id/abrir
 * Carrega a análise na sessão, no lugar do lote vigente. Responde no mesmo
 * formato do upload, para a tela tratar os dois do mesmo jeito.
 */
router.post('/:id/abrir', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string);
    sessionService.criarOuRecuperarSessao(sessionId, req.user?.userId || 'desconhecido', req.user?.email || '');

    const { sessao, analise, erros } = await abrirNaSessao(req.params.id, sessionId);

    res.json({
      success: true,
      data: {
        importacao: {
          totalDocumentosSessao: sessao.documentos.length,
          documentosImportados: sessao.documentos.length,
          ...resumoDoLote(sessao),
          analise,
          analiseSalva: true,
        },
        erros: erros.length > 0 ? erros : undefined,
      },
      timestamp: agora(),
    });
  } catch (erro) {
    if (erro instanceof ErroAnaliseInexistente) {
      return res.status(404).json({ success: false, error: erro.message, timestamp: agora() });
    }
    falhaDoArmazenamento(res, erro, 'abrir a análise');
  }
});

/**
 * POST /api/v1/analises/:id/reprocessar
 * Gera a versão seguinte a partir do ZIP guardado, com parser, regras e
 * tabela atuais. A análise original fica intacta e a nova não é aberta.
 */
router.post('/:id/reprocessar', authenticate, async (req: Request, res: Response) => {
  try {
    const analise = await reprocessar(req.params.id, req.user?.email || req.user?.userId || 'desconhecido');
    res.json({ success: true, data: { analise }, timestamp: agora() });
  } catch (erro) {
    if (erro instanceof ErroAnaliseInexistente) {
      return res.status(404).json({ success: false, error: erro.message, timestamp: agora() });
    }
    if (erro instanceof ErroZipDaAnalise) {
      return res.status(400).json({ success: false, error: erro.message, timestamp: agora() });
    }
    falhaDoArmazenamento(res, erro, 'reprocessar a análise');
  }
});

export default router;
