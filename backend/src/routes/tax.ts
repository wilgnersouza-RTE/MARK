import { Router, Request, Response } from 'express';
import { taxRulesService } from '../services/taxRules';

const router = Router();

/**
 * GET /api/v1/tax/rules
 * Obtém todas as regras tributárias
 */
router.get('/rules', async (req: Request, res: Response) => {
  try {
    const rules = await taxRulesService.getTodosRegras();

    res.json({
      success: true,
      data: {
        total: rules.length,
        anos: rules.map(r => r.ano),
        regras: rules,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/tax/rules/:ano
 * Obtém regras para um ano específico
 */
router.get('/rules/:ano', async (req: Request, res: Response) => {
  try {
    const ano = parseInt(req.params.ano, 10);

    if (isNaN(ano)) {
      return res.status(400).json({
        success: false,
        error: 'Ano deve ser um número válido',
        timestamp: new Date().toISOString(),
      });
    }

    const rules = await taxRulesService.getRegrasPorAno(ano);

    if (!rules) {
      return res.status(404).json({
        success: false,
        error: `Regras não encontradas para o ano ${ano}`,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      data: rules,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/tax/aliquota
 * Obtém alíquota específica
 * Query params: ano, tributo (icms|iss|pis|cofins|irrf), regime (simples|lucro-real|lucro-presumido)
 */
router.get('/aliquota', async (req: Request, res: Response) => {
  try {
    const { ano, tributo, regime } = req.query;

    if (!ano || !tributo || !regime) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetros obrigatórios: ano, tributo, regime',
        timestamp: new Date().toISOString(),
      });
    }

    const anoNum = parseInt(ano as string, 10);
    const tributoStr = (tributo as string).toLowerCase();
    const regimeStr = (regime as string).toLowerCase();

    const aliquota = await taxRulesService.getAliquota(
      anoNum,
      tributoStr as any,
      regimeStr as any
    );

    if (aliquota === null) {
      return res.status(404).json({
        success: false,
        error: 'Alíquota não encontrada com os parâmetros fornecidos',
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      data: {
        ano: anoNum,
        tributo: tributoStr,
        regime: regimeStr,
        aliquota,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/tax/comparison/:tributo
 * Compara alíquotas de um tributo ao longo dos anos
 */
router.get('/comparison/:tributo', async (req: Request, res: Response) => {
  try {
    const { tributo } = req.params;
    const tributoStr = tributo.toLowerCase();

    const rules = await taxRulesService.getTodosRegras();

    if (rules.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Nenhuma regra tributária disponível',
        timestamp: new Date().toISOString(),
      });
    }

    const comparison = {
      tributo: tributoStr,
      dados: [] as any[],
    };

    for (const rule of rules) {
      const tributoData = (rule as any)[tributoStr];

      if (tributoData) {
        comparison.dados.push({
          ano: rule.ano,
          simples: tributoData.simples,
          lucroReal: tributoData['lucro-real'],
          lucroPresumido: tributoData['lucro-presumido'],
        });
      }
    }

    if (comparison.dados.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Tributo "${tributoStr}" não encontrado`,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      data: comparison,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/tax/status
 * Obtém status do serviço de tributação
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const stats = sessionService?.obterEstatisticas?.() || {
      sessoes_ativas: 0,
      total_documentos: 0,
    };

    const rules = await taxRulesService.getTodosRegras();

    res.json({
      success: true,
      data: {
        status: 'operational',
        anosDisponiveis: rules.map(r => r.ano),
        totalRegrasCarregadas: rules.length,
        sessoes: stats,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Importar sessionService apenas se disponível
let sessionService: any = null;
try {
  const session = require('./session');
  sessionService = session.sessionService || session.default;
} catch (e) {
  // Silenciosamente falha se o serviço não estiver disponível
}

export default router;
