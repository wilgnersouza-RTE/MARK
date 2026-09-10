/**
 * Router da Reforma Tributária do Consumo (Informe Técnico 2025.002)
 * GET  /api/v1/rtc/metadados   - versão da tabela em uso
 * GET  /api/v1/rtc/opcoes      - listas dos seletores da tela de configuração
 * GET  /api/v1/rtc/cst         - tabela de CST
 * GET  /api/v1/rtc/cclasstrib  - cClassTrib, filtrável por ?cst=200
 * POST /api/v1/rtc/validar     - valida a combinação CST + cClassTrib
 */
import { Router, Request, Response } from 'express';
import { rtcService } from '../services/rtc';

const router = Router();

function responder(res: Response, data: unknown) {
  res.json({ success: true, data, timestamp: new Date().toISOString() });
}

function erro(res: Response, status: number, mensagem: string) {
  res.status(status).json({ success: false, error: mensagem, timestamp: new Date().toISOString() });
}

router.get('/metadados', (_req: Request, res: Response) => {
  try {
    responder(res, rtcService.obterMetadados());
  } catch (e: any) {
    erro(res, 500, e.message);
  }
});

router.get('/opcoes', (_req: Request, res: Response) => {
  try {
    responder(res, rtcService.obterOpcoes());
  } catch (e: any) {
    erro(res, 500, e.message);
  }
});

router.get('/cst', (_req: Request, res: Response) => {
  try {
    responder(res, rtcService.obterCST());
  } catch (e: any) {
    erro(res, 500, e.message);
  }
});

router.get('/cclasstrib', (req: Request, res: Response) => {
  try {
    const cst = req.query.cst ? String(req.query.cst) : undefined;
    const codigos = rtcService.obterCClassTrib(cst);

    responder(res, {
      cst: cst || 'todos',
      total: codigos.length,
      codigos,
    });
  } catch (e: any) {
    erro(res, 500, e.message);
  }
});

router.post('/validar', (req: Request, res: Response) => {
  try {
    const { cst, cClassTrib } = req.body as { cst?: string; cClassTrib?: string };

    if (!cst) {
      return erro(res, 400, 'CST é obrigatório');
    }

    responder(res, rtcService.validarCombinacao(cst, cClassTrib || ''));
  } catch (e: any) {
    erro(res, 500, e.message);
  }
});

export default router;
