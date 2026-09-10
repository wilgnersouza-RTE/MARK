/**
 * Router de Export
 * GET /api/v1/export/excel - Exportar análise em Excel
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { sessionService } from '../services/session';
import { excelExportService } from '../services/export';
import { dashboardService } from '../services/dashboard';

const router = Router();

/**
 * GET /api/v1/export/excel
 * Exportar análise completa em arquivo Excel
 */
router.get('/excel', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID não encontrado',
        timestamp: new Date().toISOString(),
      });
    }

    const documentos = sessionService.obterDocumentos(sessionId);

    if (!documentos || documentos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum documento para exportar',
        timestamp: new Date().toISOString(),
      });
    }

    // Gerar dashboard para incluir no export
    const dashboard = await dashboardService.generateDashboard(documentos);

    // Exportar para Excel
    const buffer = excelExportService.exportarDados(documentos, dashboard);

    // Enviar arquivo
    const filename = `nfe-analise-${new Date().getTime()}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error: any) {
    console.error('Erro ao exportar Excel:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao exportar dados',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/export/json
 * Exportar documentos e análise em JSON
 */
router.get('/json', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID não encontrado',
        timestamp: new Date().toISOString(),
      });
    }

    const documentos = sessionService.obterDocumentos(sessionId);

    if (!documentos || documentos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum documento para exportar',
        timestamp: new Date().toISOString(),
      });
    }

    const dashboard = await dashboardService.generateDashboard(documentos);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nfe-analise-${new Date().getTime()}.json"`
    );
    res.send(JSON.stringify({ documentos, dashboard }, null, 2));
  } catch (error: any) {
    console.error('Erro ao exportar JSON:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao exportar dados',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/export/csv-divergencias
 * Exportar apenas as divergências em CSV
 */
router.get('/csv-divergencias', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string | undefined);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID não encontrado',
        timestamp: new Date().toISOString(),
      });
    }

    const documentos = sessionService.obterDocumentos(sessionId);

    if (!documentos || documentos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum documento para exportar',
        timestamp: new Date().toISOString(),
      });
    }

    const dashboard = await dashboardService.generateDashboard(documentos);

    // Ponto e vírgula como separador: é o que o Excel em pt-BR espera
    const escapar = (valor: unknown) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
    const cabecalho = ['tributo', 'ano', 'valorAtual', 'valorPrevisto', 'diferenca', 'percentual'];

    const linhas = dashboard.divergencias.map((d: any) =>
      cabecalho.map(coluna => escapar(d[coluna])).join(';')
    );

    // BOM para o Excel reconhecer o UTF-8 e não quebrar os acentos
    const csv = '\uFEFF' + [cabecalho.join(';'), ...linhas].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="divergencias-${new Date().getTime()}.csv"`
    );
    res.send(csv);
  } catch (error: any) {
    console.error('Erro ao exportar CSV:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao exportar dados',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
