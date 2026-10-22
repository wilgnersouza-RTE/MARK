import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { sessionService, ErroEmpresaForaDoLote } from '../services/session';
import { ImportacaoArquivo } from '../types';
import { identificarEmpresa, normalizarCnpj } from '../utils/sentidoImportacao';
import {
  ErroZipInvalido,
  LoteLido,
  atualizarAposTrocaEmpresa,
  calcularCompetencia,
  lerLoteZip,
  resumoDoLote,
  salvarAposUpload,
} from '../services/analises';
import {
  ERRO_TUDO_DUPLICADO,
  NotaDuplicada,
  avisoDuplicados,
  avisoSemIdentidade,
  separarJaImportadas,
  separarRepetidasNoZip,
} from '../services/duplicados';
import { v4 as uuidv4 } from 'uuid';

const LOTE_MUDOU = 'O lote mudou; escolha a empresa de novo.';

/** Avisos da checagem de duplicados, num texto só; undefined se nenhum. */
function juntarAvisos(...avisos: Array<string | undefined>): string | undefined {
  const lista = avisos.filter((a): a is string => !!a);
  return lista.length ? lista.join(' ') : undefined;
}

/** Só o que a tela e a planilha usam de cada duplicada. */
function paraTela(duplicados: NotaDuplicada[]) {
  return duplicados.map(d => ({
    nomeArquivo: d.nomeArquivo,
    chaveNFe: d.chaveNFe,
    modelo: d.modelo,
    regra: d.regra,
    motivo: d.motivo,
    ...(d.origem ? { origem: d.origem } : {}),
  }));
}

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
 * Processa um ZIP com XMLs de NF-e, NFC-e, CT-e, CT-e OS e NFS-e misturados.
 *
 * Só recebe o arquivo. O modelo de cada nota sai da estrutura do XML e o
 * sentido sai da empresa analisada, identificada pelo próprio lote.
 */
router.post('/nfe', authenticate, upload.single('file'), async (req: Request, res: Response) => {
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

    // Processar ZIP: cada XML pelo parser; o que não é nota vai para erros.
    let lote: LoteLido;
    try {
      lote = await lerLoteZip(req.file.buffer);
    } catch (erro: any) {
      return res.status(400).json({
        success: false,
        error: erro instanceof ErroZipInvalido ? erro.message : 'Erro ao processar arquivo ZIP',
        timestamp: new Date().toISOString(),
      });
    }

    const { erros, arquivosProcessados, arquivosComErro, quantidadeArquivos, arquivoDe } = lote;

    if (lote.documentos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhuma nota fiscal reconhecida no ZIP',
        details: erros,
        timestamp: new Date().toISOString(),
      });
    }

    // Duplicados, regra 1: a mesma nota repetida no ZIP entra uma vez.
    const noZip = separarRepetidasNoZip(lote.documentos, arquivoDe);

    // Empresa analisada: identificada pelo lote quando é clara; senão fica
    // em aberto e a tela pede a escolha entre os candidatos.
    const identificacao = identificarEmpresa(noZip.documentos);
    const empresa = identificacao.empresa
      ? { cnpj: identificacao.empresa.cnpj, nome: identificacao.empresa.nome, inferida: true }
      : null;

    // Competência do lote, uma vez, antes de tirar as já importadas: é a
    // que exclui comparações e a que a análise salva recebe.
    const competencia = calcularCompetencia(noZip.documentos);

    // Duplicados, regra 2: nota que a empresa já tem em outra competência.
    // Sem empresa identificada, fica para quando ela for escolhida.
    const jaImportadas = await separarJaImportadas(noZip.documentos, {
      sessionId,
      empresaCnpj: empresa?.cnpj,
      competenciaDoLote: competencia,
      arquivoDe,
    });
    const documentos = jaImportadas.documentos;
    const duplicados = paraTela([...noZip.duplicados, ...jaImportadas.duplicados]);
    const semIdentidade = avisoSemIdentidade(noZip.semIdentidade);
    const avisoDuplicidade = juntarAvisos(avisoDuplicados(duplicados), semIdentidade, jaImportadas.aviso);

    if (documentos.length === 0) {
      return res.status(400).json({
        success: false,
        error: ERRO_TUDO_DUPLICADO,
        details: erros,
        duplicados,
        timestamp: new Date().toISOString(),
      });
    }

    // Criar registro de importação
    const importacao: ImportacaoArquivo = {
      sessionId,
      quantidadeArquivos,
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
      empresa,
      // A escolha de empresa recomeça das notas originais do lote.
      { originais: noZip.documentos, arquivoDe }
    );

    // Salva a análise (resultado por nota e ZIP). Falha não derruba o
    // upload: o lote segue na sessão e a tela avisa que não foi salvo.
    const salvamento = await salvarAposUpload(atualizada, {
      zip: req.file.buffer,
      criadoPor: req.user?.email || req.user?.userId || 'desconhecido',
      lote: { erros, arquivosProcessados, arquivosComErro, quantidadeArquivos },
      nomeArquivo: req.file.originalname,
      competencia,
      duplicados,
    });

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
          ...salvamento,
          duplicados,
          ...(avisoDuplicidade ? { avisoDuplicidade } : {}),
          // Separado: a tela o repete quando a empresa é escolhida depois.
          ...(semIdentidade ? { avisoSemIdentidade: semIdentidade } : {}),
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

    // Cada escolha recomeça do lote original: as notas que uma empresa
    // anterior tirou voltam, e só saem as que a empresa escolhida já tem em
    // outra competência. O CNPJ é validado contra o lote original.
    const originais = sessao.documentosOriginais ?? sessao.documentos;
    const alvo = normalizarCnpj(cnpj);
    if (!alvo || !identificarEmpresa(originais).todos.some(c => c.cnpj === alvo)) {
      throw new ErroEmpresaForaDoLote(cnpj);
    }

    const { loteId, analiseId } = sessao;
    const competencia = calcularCompetencia(originais);
    const jaImportadas = await separarJaImportadas(originais, {
      sessionId,
      empresaCnpj: alvo,
      competenciaDoLote: competencia,
      arquivoDe: sessao.arquivoDe,
      ignorarAnalise: analiseId,
    });
    const duplicados = paraTela(jaImportadas.duplicados);

    if (sessionService.obterSessao(sessionId)?.loteId !== loteId) {
      return res.status(409).json({ success: false, error: LOTE_MUDOU, timestamp: new Date().toISOString() });
    }

    if (jaImportadas.documentos.length === 0) {
      return res.status(400).json({
        success: false,
        error: `${ERRO_TUDO_DUPLICADO} nesta empresa, em outras competências. A empresa não foi trocada.`,
        duplicados,
        timestamp: new Date().toISOString(),
      });
    }

    const atualizada = await sessionService.aplicarEmpresa(sessionId, loteId, cnpj, jaImportadas.documentos);
    if (!atualizada) {
      return res.status(409).json({ success: false, error: LOTE_MUDOU, timestamp: new Date().toISOString() });
    }

    // Leva a escolha para a análise salva, sem derrubar a troca se falhar.
    const salvamento = await atualizarAposTrocaEmpresa(atualizada, req.user?.email || req.user?.userId, {
      duplicados,
      competencia,
    });
    const avisoDuplicidade = juntarAvisos(avisoDuplicados(jaImportadas.duplicados), jaImportadas.aviso);

    res.json({
      success: true,
      data: {
        importacao: {
          totalDocumentosSessao: atualizada.documentos.length,
          ...resumoDoLote(atualizada),
          ...salvamento,
          duplicados,
          ...(avisoDuplicidade ? { avisoDuplicidade } : {}),
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
