import { Router, Request, Response } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { authenticate } from '../middleware/auth';
import { nfeParserService } from '../services/nfeParser';
import { sessionService } from '../services/session';
import { ImportacaoArquivo, ErroProcessamento, NFeModel } from '../types';
import { CODIGOS_MODELO, rotuloModelo } from '../utils/modelos';
import { inferirSentido } from '../utils/sentidoImportacao';
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
        error: 'Tipo (entrada/saída) e modelo (55, 65 ou 57) são obrigatórios',
        timestamp: new Date().toISOString(),
      });
    }

    const tipoNormalizado = String(tipo).toLowerCase();
    const tipoDoc = (tipoNormalizado === 'entrada' ? 'Entrada' : 'Saída') as ImportacaoArquivo['tipo'];
    const modeloDoc = parseInt(modelo, 10) as NFeModel;

    // Validar tipo
    if (tipoNormalizado !== 'entrada' && tipoNormalizado !== 'saida') {
      return res.status(400).json({
        success: false,
        error: 'Tipo deve ser "entrada" ou "saida"',
        timestamp: new Date().toISOString(),
      });
    }

    // Validar modelo
    if (!CODIGOS_MODELO.includes(modeloDoc as (typeof CODIGOS_MODELO)[number])) {
      return res.status(400).json({
        success: false,
        error: 'Modelo deve ser NF-e (55), NFC-e (65) ou CT-e (57)',
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
        error:
          `Nenhum arquivo do ZIP corresponde a ${rotuloModelo(modeloDoc)}. ` +
          'Confira o modelo selecionado antes de importar.',
        details: erros,
        timestamp: new Date().toISOString(),
      });
    }

    // ---------- Validação do sentido declarado ----------
    // O modelo já foi conferido arquivo por arquivo no parser. Aqui sobra o
    // tipo: se o lote diz uma coisa e o usuário marcou outra, a importação é
    // recusada por inteiro, porque misturar entradas com saídas na mesma
    // sessão inverte o sinal de toda a análise.
    const sentido = inferirSentido(documentos);

    // O tipo é gravado como 'Entrada'/'Saída' e a inferência devolve
    // 'entrada'/'saida'. Comparar sem normalizar dava erro em toda
    // importação, inclusive nas corretas.
    const declaradoNormalizado = tipoNormalizado === 'entrada' ? 'entrada' : 'saida';

    if (sentido.sentido && sentido.sentido !== declaradoNormalizado) {
      const declarado = declaradoNormalizado === 'entrada' ? 'Entrada' : 'Saída';
      const detectado = sentido.sentido === 'entrada' ? 'entrada' : 'saída';

      return res.status(400).json({
        success: false,
        error:
          `Você selecionou ${declarado}, mas este ZIP é de ${detectado}. ` +
          sentido.justificativa,
        details: erros,
        sentidoDetectado: sentido,
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
          // A tela precisa saber o que ficou de fora. Antes esta lista só
          // existia quando a importação falhava por inteiro.
          erros,
          // Quando o lote é pequeno ou heterogêneo, o sentido não pode ser
          // conferido. A tela avisa em vez de dar a validação por feita.
          sentidoNaoVerificado: sentido.sentido ? null : sentido.justificativa,
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
