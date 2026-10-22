/**
 * Router de Dashboard
 * GET /api/v1/dashboard              - Análise completa
 * GET /api/v1/dashboard/resumo       - Resumo geral
 * GET /api/v1/dashboard/regimes      - Consolidado por regime tributário
 * GET /api/v1/dashboard/fornecedores - Top fornecedores
 * GET /api/v1/dashboard/documentos   - Documentos da sessão
 * GET /api/v1/dashboard/campos       - Conferência dos campos tributários
 * GET /api/v1/dashboard/filtros      - Opções de Entrada/Saída, CFOP e NCM do lote
 * GET /api/v1/dashboard/importacoes  - Importações incluídas no conjunto da empresa
 *
 * Todas, menos /filtros, aceitam ?sentido=&cfop=&ncm= e respondem só pelas
 * notas do recorte (ver utils/filtros.ts).
 *
 * Todas aceitam ?empresa=<cnpj>: em vez do lote da sessão, as notas vêm do
 * conjunto da empresa, a versão mais recente de cada competência salva
 * (ver services/conjuntoEmpresa.ts). Sem o parâmetro, vale o lote atual.
 * Empresa inválida responde 400; falha do armazenamento, 503 com a causa.
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import {
  DATA_DE_CORTE,
  conferirReforma,
  diaDaNota,
  resumoPorSentido,
  tabelaCarregada,
} from '../services/conferenciaReforma';
import { dashboardService } from '../services/dashboard';
import { DashboardData, NFeDocument } from '../types';
import { filtrarDocumentos, lerFiltros, opcoesDoLote } from '../utils/filtros';
import {
  lerEmpresa,
  origemDosDocumentos,
  responderFalhaDoConjunto,
  tabelaDeImportacoes,
} from '../services/conjuntoEmpresa';
import { armazenamentoAnalises, causaDaFalha } from '../services/analises';

const router = Router();

/**
 * Resolve a origem (lote da sessão ou conjunto da empresa), aplica os
 * filtros da query e devolve o dashboard calculado só sobre as notas do
 * recorte. Centraliza o que antes estava duplicado em cada rota.
 */
async function carregarDashboard(
  req: Request
): Promise<{ documentos: NFeDocument[]; dashboard: DashboardData | null; sessionId: string | null }> {
  // Empresa inválida é 400 mesmo sem sessão.
  lerEmpresa(req.query);
  const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined) || null;

  if (!sessionId) {
    return { documentos: [], dashboard: null, sessionId: null };
  }

  const { documentos: doLote } = await origemDosDocumentos(sessionId, req.query);

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

/** Empresa inválida: 400; falha ao carregar o conjunto: 503 com a causa; o resto, 500. */
function falha(res: Response, e: any, mensagemPadrao?: string) {
  if (responderFalhaDoConjunto(res, e)) return;
  return erro(res, 500, e?.message || mensagemPadrao || 'Erro interno');
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
    falha(res, error, 'Erro ao gerar dashboard');
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
    falha(res, error);
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
    falha(res, error);
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
    falha(res, error);
  }
});

/**
 * GET /api/v1/dashboard/documentos
 * Documentos da sessão, com paginação simples
 */
router.get('/documentos', authenticate, async (req: Request, res: Response) => {
  try {
    lerEmpresa(req.query);
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    const origem = await origemDosDocumentos(sessionId, req.query);
    const documentos = filtrarDocumentos(origem.documentos, lerFiltros(req.query));

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
    falha(res, error);
  }
});


/**
 * GET /api/v1/dashboard/campos
 *
 * Conferência de tributos nota a nota (ver services/conferenciaReforma.ts):
 * situação, resumo em uma frase, tipos de problema, pendências pelo nome do
 * campo, avisos, leiaute e código do serviço da NFS-e e, em `porSentido`, o
 * percentual de completas em entradas e saídas. Sem paginação: paginar
 * exigiria manter estado no servidor para um volume que cabe folgado numa
 * resposta só. Sem sessão, devolve o mesmo formato com tudo zerado.
 */
router.get('/campos', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId!;
    const origem = await origemDosDocumentos(sessionId, req.query);
    const tabela = tabelaCarregada();
    const filtros = lerFiltros(req.query);
    const documentos = origem.documentos;

    // Os cartões Entradas e Saídas são a própria divisão por sentido: ignoram
    // esse filtro e respeitam CFOP e NCM. Confere-se uma vez o recorte sem
    // sentido; a lista aplica o sentido depois.
    const conferidas = filtrarDocumentos(documentos, { ...filtros, sentido: undefined }).map(
      doc => ({ doc, conferencia: conferirReforma(doc, tabela) })
    );
    const porSentido = resumoPorSentido(
      conferidas.map(({ doc, conferencia }) => ({ tipo: doc.tipo, situacao: conferencia.situacao }))
    );

    const notas = conferidas
      .filter(({ doc }) => !filtros.sentido || doc.tipo === filtros.sentido)
      .map(({ doc, conferencia }) => ({
        id: doc.id,
        numero: doc.chaveNFe,
        modelo: doc.modelo,
        sentido: doc.tipo,
        diaEmissao: diaDaNota(doc),
        emitente: doc.nomeEmitente,
        cnpjEmitente: doc.cnpjEmitente,
        valor: doc.values.total,
        situacao: conferencia.situacao,
        resumo: conferencia.resumo,
        tipos: conferencia.tipos,
        leiaute: doc.leiaute,
        codigoServico: doc.codigoServico,
        tipoCodigoServico: doc.tipoCodigoServico,
        pendencias: conferencia.pendencias,
        avisos: conferencia.avisos,
        informativos: conferencia.informativos,
        // Marca o campo cujo zero a conferência aceitou (CST sem grupo padrão
        // ou IBS municipal em 2026), para a tela não alertar à toa.
        campos: (doc.camposTributarios ?? []).map(c =>
          c.grupo === 'reforma' && conferencia.zerosAceitos.includes(c.campo) ? { ...c, zeroAceito: true } : c
        ),
      }));

    const contar = (situacao: string) => notas.filter(n => n.situacao === situacao).length;

    responder(res, {
      notas,
      resumo: {
        total: notas.length,
        completas: contar('completa'),
        comPendencia: contar('com pendência'),
        foraDoPeriodo: contar('fora do período'),
        semData: contar('sem data'),
      },
      porSentido,
      temEmpresa: !!origem.empresa,
      versaoTabela: tabela.versao,
      dataDeCorte: DATA_DE_CORTE,
    });
  } catch (e: any) {
    falha(res, e);
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
 *
 * Com ?empresa=, opções e sentido padrão saem do conjunto da empresa.
 * `empresas` lista as empresas com análise salva, para a lista EMPRESA; se
 * o armazenamento falhar, vem vazia com `avisoEmpresas`, e o lote atual
 * continua respondendo.
 */
router.get('/filtros', authenticate, async (req: Request, res: Response) => {
  try {
    // Valida antes de qualquer leitura: empresa inválida não lista nada.
    const cnpj = lerEmpresa(req.query);
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined);

    if (!sessionId) {
      return erro(res, 400, 'Session ID não encontrado');
    }

    let empresas: Array<{ cnpj: string; nome: string | null; quantidade: number }> = [];
    let avisoEmpresas: string | undefined;
    try {
      // Só empresas de fato: análises sem empresa não formam conjunto.
      empresas = (await armazenamentoAnalises().listarEmpresas()).filter(e => e.cnpj);
    } catch (e) {
      avisoEmpresas = `Não foi possível listar as empresas com análise salva: ${causaDaFalha(e)}`;
    }

    const origem = await origemDosDocumentos(sessionId, req.query);
    const documentos = origem.documentos;
    const temEmpresa = !!origem.empresa;

    responder(res, {
      cfops: opcoesDoLote(documentos, 'cfops'),
      ncms: opcoesDoLote(documentos, 'ncms'),
      temEmpresa,
      sentidoPadrao: temEmpresa && documentos.some(d => d.tipo === 'entrada') ? 'entrada' : 'todas',
      totalDocumentos: documentos.length,
      empresa: cnpj,
      empresas,
      ...(avisoEmpresas ? { avisoEmpresas } : {}),
      ...(origem.aviso ? { aviso: origem.aviso } : {}),
    });
  } catch (e: any) {
    falha(res, e);
  }
});

/**
 * GET /api/v1/dashboard/importacoes?empresa=<cnpj>
 *
 * Importações incluídas no conjunto da empresa (a versão mais recente de
 * cada competência), uma linha cada com notas, valor total e tributos do
 * recorte (?sentido=&cfop=&ncm=), e o total geral. Sem empresa: 400.
 */
router.get('/importacoes', authenticate, async (req: Request, res: Response) => {
  try {
    if (!lerEmpresa(req.query)) {
      return erro(res, 400, 'Informe a empresa (CNPJ com 14 dígitos) em ?empresa=.');
    }
    const origem = await origemDosDocumentos(req.sessionId!, req.query);
    responder(res, tabelaDeImportacoes(origem.conjunto!, lerFiltros(req.query)));
  } catch (e: any) {
    falha(res, e);
  }
});

export default router;
