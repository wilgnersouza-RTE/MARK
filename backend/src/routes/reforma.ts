/**
 * Router da Reforma Tributária — simulação da transição 2026-2033
 * GET /api/v1/reforma/metadados          - anos, regimes e avisos da tabela
 * GET /api/v1/reforma/simulacao?ano=2033 - simulação de um ano
 * GET /api/v1/reforma/serie              - série completa para gráficos
 * GET /api/v1/reforma/divergencias?ano=  - divergências recalculadas por ano
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { sessionService } from '../services/session';
import { reformaService, ParametrosSimulacao } from '../services/reforma';

const router = Router();

function responder(res: Response, data: unknown) {
  res.json({ success: true, data, timestamp: new Date().toISOString() });
}

function erro(res: Response, status: number, mensagem: string) {
  res.status(status).json({ success: false, error: mensagem, timestamp: new Date().toISOString() });
}

/** Lê os parâmetros de simulação da query string */
function lerParametros(req: Request): Partial<ParametrosSimulacao> {
  const num = (v: any) => {
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
  };

  const p: Partial<ParametrosSimulacao> = {};
  if (req.query.iva !== undefined) p.aliquotaIVA = num(req.query.iva);
  if (req.query.cbs !== undefined) p.aliquotaCBS = num(req.query.cbs);
  if (req.query.is !== undefined) p.aliquotaImpostoSeletivo = num(req.query.is);
  if (req.query.regime !== undefined) p.regimeFornecedor = String(req.query.regime);
  if (req.query.sujeitoIS !== undefined) p.sujeitoImpostoSeletivo = req.query.sujeitoIS === 'true';

  // Remove chaves que vieram inválidas, para não sobrescrever o padrão com undefined
  Object.keys(p).forEach(k => {
    if ((p as any)[k] === undefined) delete (p as any)[k];
  });

  return p;
}

function documentosDaSessao(req: Request) {
  const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined);
  if (!sessionId) return null;
  return sessionService.obterDocumentos(sessionId) || [];
}

router.get('/metadados', (_req: Request, res: Response) => {
  try {
    responder(res, reformaService.obterMetadados());
  } catch (e: any) {
    erro(res, 500, e.message);
  }
});

router.get('/simulacao', authenticate, (req: Request, res: Response) => {
  try {
    const documentos = documentosDaSessao(req);
    if (documentos === null) return erro(res, 400, 'Session ID não encontrado');

    const ano = parseInt(String(req.query.ano || '2033'), 10);
    responder(res, reformaService.simularAno(documentos, ano, lerParametros(req)));
  } catch (e: any) {
    erro(res, 400, e.message);
  }
});

router.get('/serie', authenticate, (req: Request, res: Response) => {
  try {
    const documentos = documentosDaSessao(req);
    if (documentos === null) return erro(res, 400, 'Session ID não encontrado');

    responder(res, reformaService.simularSerie(documentos, lerParametros(req)));
  } catch (e: any) {
    erro(res, 400, e.message);
  }
});

router.get('/divergencias', authenticate, (req: Request, res: Response) => {
  try {
    const documentos = documentosDaSessao(req);
    if (documentos === null) return erro(res, 400, 'Session ID não encontrado');

    const ano = parseInt(String(req.query.ano || '2027'), 10);
    responder(res, reformaService.divergenciasPorAno(documentos, ano, lerParametros(req)));
  } catch (e: any) {
    erro(res, 400, e.message);
  }
});

export default router;
