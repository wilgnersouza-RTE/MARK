import { Router, Request, Response } from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { authenticate } from '../middleware/auth';
import { nfeParserService } from '../services/nfeParser';
import { sessionService, ErroEmpresaForaDoLote } from '../services/session';
import { ImportacaoArquivo, ErroProcessamento, NFeDocument, UserSession } from '../types';
import { MODELOS_DOCUMENTO, rotuloModelo } from '../utils/modelos';
import { contarPorSentido, identificarEmpresa } from '../utils/sentidoImportacao';
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
 * Resumo do lote vigente da sessão: contagem por modelo e por sentido,
 * empresa analisada e CNPJs que o contador pode escolher.
 *
 * Usado pelo upload e pela troca de empresa, para a tela receber sempre o
 * mesmo formato.
 */
function resumoDoLote(sessao: UserSession) {
  const documentos = sessao.documentos;

  const porModelo = MODELOS_DOCUMENTO.map(m => ({
    modelo: String(m.codigo),
    rotulo: rotuloModelo(m.codigo),
    quantidade: documentos.filter(d => String(d.modelo) === String(m.codigo)).length,
  })).filter(m => m.quantidade > 0);

  const { candidatos } = identificarEmpresa(documentos);

  return {
    porModelo,
    porSentido: contarPorSentido(documentos),
    empresa: sessao.empresa ?? null,
    candidatosEmpresa: candidatos,
    precisaEscolherEmpresa: !sessao.empresa,
    documentos: documentos.map((d: NFeDocument) => ({
      id: d.id,
      modelo: d.modelo,
      tipo: d.tipo,
      chaveNFe: d.chaveNFe,
      cnpjEmitente: d.cnpjEmitente,
      cnpjDestino: d.cnpjDestino,
    })),
  };
}

/**
 * POST /api/v1/upload/nfe
 * Processa um ZIP com XMLs de NF-e, NFC-e, CT-e, CT-e OS e NFS-e misturados.
 *
 * Só recebe o arquivo. O modelo de cada nota sai da estrutura do XML e o
 * sentido sai da empresa analisada, identificada pelo próprio lote.
 */
router.post('/nfe', authenticate, upload.single('file'), async (req: Request, res: Response) => {
  let arquivosProcessados = 0;
  let arquivosComErro = 0;
  const erros: ErroProcessamento[] = [];

  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string);

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID é obrigatório no header x-session-id',
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

    const documentos: NFeDocument[] = [];

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

        // Verificar se o XML contém alguma tag de valor reconhecível.
        // As três primeiras são da NF-e; as demais, das notas de serviço —
        // cada município nomeia a sua de um jeito, e sem elas aqui a NFS-e
        // era barrada antes mesmo de chegar ao parser.
        const marcasDeValor = [
          'vBC', 'vICMS', 'vNF',
          'ValorServicos', 'ValoresNFSe', 'vServ', 'ValorLiquidoNfse', 'ValorIss', 'ValorISS',
          // CT-e: o valor do frete vive em <vPrest>.
          'vTPrest', 'vPrest',
        ];

        if (!marcasDeValor.some(m => conteudoXML.includes(m))) {
          erros.push({
            nomeArquivo,
            erro: 'XML não contém valores de nota fiscal',
          });
          arquivosComErro++;
          continue;
        }

        const documento = await nfeParserService.parseNFE(conteudoXML);

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
        error: 'Nenhuma nota fiscal reconhecida no ZIP',
        details: erros,
        timestamp: new Date().toISOString(),
      });
    }

    // Empresa analisada: identificada pelo lote quando é clara; senão fica
    // em aberto e a tela pede a escolha entre os candidatos.
    const identificacao = identificarEmpresa(documentos);
    const empresa = identificacao.empresa
      ? { cnpj: identificacao.empresa.cnpj, nome: identificacao.empresa.nome, inferida: true }
      : null;

    // Criar registro de importação
    const importacao: ImportacaoArquivo = {
      sessionId,
      quantidadeArquivos: Object.keys(zipContent.files).length,
      arquivosProcessados,
      arquivosComErro,
      erros,
      documentos,
      timestamp: new Date().toISOString(),
    };

    // Quantos documentos existiam antes, para a tela poder avisar que a
    // análise anterior foi substituída.
    const documentosAnteriores = sessao.documentos.length;

    // Substitui os documentos da sessão: cada importação recomeça a análise.
    const atualizada = await sessionService.adicionarDocumentos(
      sessionId,
      documentos,
      importacao,
      empresa
    );

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
          documentosImportados: documentos.length,
          totalDocumentosSessao: atualizada.documentos.length,
          /** Quantidade descartada da importação anterior, se houver */
          documentosSubstituidos: documentosAnteriores,
          ...resumoDoLote(atualizada),
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
 * POST /api/v1/upload/empresa
 * Define a empresa analisada e reclassifica as notas já importadas.
 *
 * Corpo: { cnpj }. O CNPJ precisa aparecer em alguma nota do lote.
 */
router.post('/empresa', authenticate, async (req: Request, res: Response) => {
  try {
    const sessionId = req.sessionId || (req.headers['x-session-id'] as string);
    const cnpj = String(req.body?.cnpj ?? '');

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID é obrigatório no header x-session-id',
        timestamp: new Date().toISOString(),
      });
    }

    const sessao = sessionService.obterSessao(sessionId);

    if (!sessao || sessao.documentos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum lote importado nesta sessão. Importe um ZIP antes de escolher a empresa.',
        timestamp: new Date().toISOString(),
      });
    }

    const atualizada = await sessionService.definirEmpresa(sessionId, cnpj);

    res.json({
      success: true,
      data: {
        importacao: {
          totalDocumentosSessao: atualizada.documentos.length,
          ...resumoDoLote(atualizada),
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    if (error instanceof ErroEmpresaForaDoLote) {
      return res.status(400).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    console.error('Erro ao definir a empresa analisada:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao definir a empresa analisada',
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
