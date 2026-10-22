import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { sessionService } from '../services/session';
import {
  ErroAnaliseInexistente,
  ErroExclusaoInterrompida,
  ErroZipDaAnalise,
  MAXIMO_EXCLUSAO_LOTE,
  abrirNaSessao,
  armazenamentoAnalises,
  causaDaFalha,
  excluirAnalises,
  reprocessar,
  resumoDoLote,
  resumoPublico,
} from '../services/analises';
import {
  AnaliseSalva,
  ErroExclusaoParcial,
  PAGINA_PADRAO,
  PASTA_SEM_EMPRESA,
} from '../services/armazenamentoAnalises';

/**
 * Análises salvas. Todo usuário autenticado vê e abre as análises de todos
 * os clientes e pode excluí-las (a tela pede confirmação antes); a
 * exclusão apaga notas, análise e ZIP, e vai para o log.
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
    const { avisoReprocessamento, ...analise } = await reprocessar(
      req.params.id,
      req.user?.email || req.user?.userId || 'desconhecido'
    );
    res.json({
      success: true,
      data: { analise, ...(avisoReprocessamento ? { avisoReprocessamento } : {}) },
      timestamp: agora(),
    });
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

// ==================== Excluir ====================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const quemPediu = (req: Request) => req.user?.email || req.user?.userId || 'desconhecido';

/** Falha no meio da exclusão: 503 com a causa e o que já tinha saído. */
function falhaNaExclusao(res: Response, erro: ErroExclusaoInterrompida) {
  const ja = erro.parcial.excluidas.length;
  const parcial =
    erro.causa instanceof ErroExclusaoParcial
      ? ` A análise ${erro.causa.analiseId} ficou excluída pela metade: as notas saíram, mas ela continua ` +
        'gravada, oculta da lista. Tente excluí-la de novo mais tarde.'
      : '';
  return res.status(503).json({
    success: false,
    error:
      `Não foi possível excluir: ${causaDaFalha(erro.causa)}` +
      parcial +
      (ja > 0 ? ` ${ja} análise${ja === 1 ? ' já tinha sido excluída' : 's já tinham sido excluídas'} antes da falha.` : ''),
    data: erro.parcial,
    timestamp: agora(),
  });
}

/** Nome do ZIP para o download: o original, se conhecido. */
function nomeDoZip(analise: AnaliseSalva): string {
  const original = analise.resumo.nomeArquivo?.split(/[\\/]/).pop();
  if (original) return original.toLowerCase().endsWith('.zip') ? original : `${original}.zip`;
  return `analise-${analise.empresaCnpj || 'sem-empresa'}-${analise.competencia}-v${analise.versao}.zip`;
}

/**
 * GET /api/v1/analises/:id/zip
 * Baixa o ZIP guardado, para o usuário ficar com uma cópia antes de excluir.
 */
router.get('/:id/zip', authenticate, async (req: Request, res: Response) => {
  const id = req.params.id.toLowerCase();
  if (!UUID.test(id)) {
    return res.status(400).json({ success: false, error: 'Id de análise inválido.', timestamp: agora() });
  }

  try {
    const loja = armazenamentoAnalises();
    const registro = await loja.obter(id);
    if (!registro) {
      return res.status(404).json({ success: false, error: `Análise ${id} não encontrada.`, timestamp: agora() });
    }
    const zip = await loja.baixarZip(registro.analise);
    if (!zip) {
      return res.status(404).json({
        success: false,
        error: 'O ZIP original desta análise não foi encontrado no armazenamento.',
        timestamp: agora(),
      });
    }

    const nome = nomeDoZip(registro.analise);
    const ascii = nome.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'analise.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader('Content-Length', String(zip.length));
    res.end(zip);
  } catch (erro) {
    falhaDoArmazenamento(res, erro, 'baixar o ZIP da análise');
  }
});

/**
 * DELETE /api/v1/analises/:id
 * Exclui a análise, as notas e o ZIP. A confirmação é da tela.
 */
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const id = req.params.id.toLowerCase();
  if (!UUID.test(id)) {
    return res.status(400).json({ success: false, error: 'Id de análise inválido.', timestamp: agora() });
  }

  try {
    const resultado = await excluirAnalises([id], quemPediu(req), req.user?.assumidoPor);
    if (resultado.excluidas.length === 0) {
      return res.status(404).json({ success: false, error: `Análise ${id} não encontrada.`, timestamp: agora() });
    }
    res.json({ success: true, data: resultado, timestamp: agora() });
  } catch (erro) {
    if (erro instanceof ErroExclusaoInterrompida) return falhaNaExclusao(res, erro);
    falhaDoArmazenamento(res, erro, 'excluir a análise');
  }
});

/**
 * POST /api/v1/analises/excluir  { ids: [...] }
 * Exclui de 1 a 100 análises. Ids inexistentes voltam em `naoEncontradas`
 * e não impedem as demais.
 */
router.post('/excluir', authenticate, async (req: Request, res: Response) => {
  const ids = req.body?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAXIMO_EXCLUSAO_LOTE ||
    !ids.every(id => typeof id === 'string' && UUID.test(id))
  ) {
    return res.status(400).json({
      success: false,
      error: `Informe em "ids" de 1 a ${MAXIMO_EXCLUSAO_LOTE} ids de análise válidos.`,
      timestamp: agora(),
    });
  }

  try {
    const minusculos = (ids as string[]).map(id => id.toLowerCase());
    res.json({
      success: true,
      data: await excluirAnalises(minusculos, quemPediu(req), req.user?.assumidoPor),
      timestamp: agora(),
    });
  } catch (erro) {
    if (erro instanceof ErroExclusaoInterrompida) return falhaNaExclusao(res, erro);
    falhaDoArmazenamento(res, erro, 'excluir as análises');
  }
});

export default router;
