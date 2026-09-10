import { Router, Request, Response } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { authenticate } from '../middleware/auth';
import { nfeParserService } from '../services/nfeParser';
import { sessionService } from '../services/session';
import { ImportacaoArquivo, ErroProcessamento } from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Configurar multer para upload de arquivos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      cb(new Error('Apenas arquivos ZIP são permitidos'));
    } else {
      cb(null, true);
    }
  },
});

/**
 * POST /api/v1/upload/nfe
 * Processa arquivo ZIP contendo múltiplos XMLs de NF-e
 */
router.post('/nfe', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  let arquivosProcessados = 0;
  let arquivosComErro = 0;
  const erros: ErroProcessamento[] = [];

  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string);
    const { tipo, modelo } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID é obrigatório no header x-session-id',
        timestamp: new Date().toISOString(),
      });
    }

    if (!tipo || !modelo) {
      return res.status(400).json({
        success: false,
        error: 'Tipo (entrada/saida) e modelo (55/65) são obrigatórios',
        timestamp: new Date().toISOString(),
      });
    }

    const tipoNormalizado = String(tipo).toLowerCase();
    const tipoDoc = (tipoNormalizado === 'entrada' ? 'Entrada' : 'Saída') as ImportacaoArquivo['tipo'];
    const modeloDoc = parseInt(modelo, 10) as 55 | 65;

    // Validar tipo
    if (tipoNormalizado !== 'entrada' && tipoNormalizado !== 'saida') {
      return res.status(400).json({
        success: false,
        error: 'Tipo deve ser "entrada" ou "saida"',
        timestamp: new Date().toISOString(),
      });
    }

    // Validar modelo
    if (modeloDoc !== 55 && modeloDoc !== 65) {
      return res.status(400).json({
        success: false,
        error: 'Modelo deve ser 55 ou 65',
        timestamp: new Date().toISOString(),
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum arquivo foi enviado',
        timestamp: new Date().toISOString(),
      });
    }

    // Obter ou criar sessão. O token é a fonte de verdade: se ele é válido mas a
    // sessão sumiu (servidor reiniciado — o store é em memória), recriamos vazia
    // em vez de devolver 401 para um usuário legitimamente autenticado.
    const sessao = sessionService.criarOuRecuperarSessao(
      sessionId,
      req.user?.userId || 'desconhecido',
      req.user?.email || ''
    );

    // Processar ZIP
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(req.file.buffer);

    const documentos = [];

    // Iterar sobre arquivos do ZIP
    for (const [nomeArquivo, file] of Object.entries(zipContent.files)) {
      // Pular pastas
      if (file.dir) continue;

      // Processar apenas XMLs
      if (!nomeArquivo.toLowerCase().endsWith('.xml')) {
        continue;
      }

      try {
        const conteudoXML = await file.async('text');

        // Verificar se XML contém conteúdo relevante (tags de valor)
        if (
          !conteudoXML.includes('vBC') &&
          !conteudoXML.includes('vICMS') &&
          !conteudoXML.includes('vNF')
        ) {
          erros.push({
            nomeArquivo,
            erro: 'XML não contém valores de nota fiscal',
          });
          arquivosComErro++;
          continue;
        }

        const documento = await nfeParserService.parseNFE(conteudoXML, tipoDoc, modeloDoc);

        documentos.push(documento);
        arquivosProcessados++;
      } catch (erro: any) {
        erros.push({
          nomeArquivo,
          erro: erro.message,
        });
        arquivosComErro++;
      }
    }

    if (documentos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum XML válido foi encontrado no ZIP',
        details: erros,
        timestamp: new Date().toISOString(),
      });
    }

    // Criar registro de importação
    const importacao: ImportacaoArquivo = {
      sessionId,
      tipo: tipoDoc,
      modelo: modeloDoc,
      quantidadeArquivos: Object.keys(zipContent.files).length,
      arquivosProcessados,
      arquivosComErro,
      erros,
      documentos,
      timestamp: new Date().toISOString(),
    };

    // Adicionar à sessão
    await sessionService.adicionarDocumentos(sessionId, documentos, importacao);

    res.json({
      success: true,
      data: {
        importacao: {
          id: uuidv4(),
          dataUpload: new Date().toISOString(),
          arquivosProcessados,
          arquivosComErro,
          documentosImportados: documentos.length,
          totalDocumentosSessao: sessao.documentos.length,
        },
        erros: erros.length > 0 ? erros : undefined,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Erro ao processar upload:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao processar arquivo ZIP',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/v1/upload/clear-session
 * Limpa dados da sessão (começa nova análise)
 */
router.post('/clear-session', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID é obrigatório',
        timestamp: new Date().toISOString(),
      });
    }

    sessionService.criarOuRecuperarSessao(
      sessionId,
      req.user?.userId || 'desconhecido',
      req.user?.email || ''
    );
    await sessionService.limparSessao(sessionId);

    res.json({
      success: true,
      data: {
        mensagem: 'Sessão foi limpa. Pronto para nova importação.',
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
 * GET /api/v1/upload/session-stats
 * Obtém estatísticas da sessão
 */
router.get('/session-stats', authenticate, (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID é obrigatório',
        timestamp: new Date().toISOString(),
      });
    }

    const sessao = sessionService.obterSessao(sessionId);

    if (!sessao) {
      return res.status(404).json({
        success: false,
        error: 'Sessão não encontrada',
        timestamp: new Date().toISOString(),
      });
    }

    const dashboard = sessao.dashboard;

    res.json({
      success: true,
      data: {
        sessionId,
        totalDocumentos: sessao.documentos.length,
        totalImportacoes: sessao.importacoes.length,
        ultimaAtualizacao: sessao.ultimaAtualizacao,
        dashboard: dashboard
          ? {
              totalValor: dashboard.resumoGeral.totalValor,
              totalTributos: dashboard.resumoGeral.totalTributos,
              documentosConformes: dashboard.resumoGeral.documentosConformes,
              percentualConformidade: dashboard.resumoGeral.percentualConformidade,
            }
          : null,
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

export default router;
