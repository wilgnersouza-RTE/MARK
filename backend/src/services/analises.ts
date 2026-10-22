import JSZip from 'jszip';
import { v4 as uuidv4 } from 'uuid';
import { EmpresaAnalisada, ErroProcessamento, ImportacaoArquivo, NFeDocument, UserSession } from '../types';
import { MODELOS_DOCUMENTO, rotuloModelo } from '../utils/modelos';
import { classificarSentido, contarPorSentido, identificarEmpresa, normalizarCnpj } from '../utils/sentidoImportacao';
import { nfeParserService } from './nfeParser';
import { sessionService } from './session';
import { diaDaNota, tabelaCarregada } from './conferenciaReforma';
import {
  AnaliseSalva,
  ArmazenamentoAnalises,
  ErroSupabase,
  ErroVersaoOcupada,
  ResumoAnaliseSalva,
  SEM_COMPETENCIA,
  caminhoDoZip,
  criarArmazenamentoAnalises,
} from './armazenamentoAnalises';

/**
 * Análises salvas: cada importação vira uma análise numerada por versão
 * dentro de empresa + competência, que pode ser aberta ou reprocessada.
 *
 * Salvar nunca derruba a importação: se o armazenamento falhar, o lote
 * segue só na sessão e a resposta avisa que não foi salvo, e por quê.
 *
 * Versões salvas não são reescritas por quem as abriu: só a análise criada
 * pela própria sessão é atualizada no lugar quando a empresa muda.
 */

let armazenamento: ArmazenamentoAnalises | null = null;

export function armazenamentoAnalises(): ArmazenamentoAnalises {
  if (!armazenamento) armazenamento = criarArmazenamentoAnalises();
  return armazenamento;
}

/** Troca o armazenamento (testes). */
export function definirArmazenamentoAnalises(novo: ArmazenamentoAnalises): void {
  armazenamento = novo;
  geracao++;
}

/**
 * Sobe a cada gravação, alteração ou exclusão feita por este servidor:
 * quem guarda listagens (conjuntoEmpresa.ts) sabe que precisa reler.
 */
let geracao = 0;

export function geracaoAnalises(): number {
  return geracao;
}

/** Quantos arquivos recusados guardar no resumo da análise. */
const MAXIMO_ERROS_GUARDADOS = 500;

/** Tentativas de achar a próxima versão quando duas gravações concorrem. */
const TENTATIVAS_VERSAO = 3;

// ==================== Avisos ====================

export const AVISO_MEMORIA =
  'Análise guardada só na memória do servidor: a Supabase não está configurada (SUPABASE_URL e ' +
  'SUPABASE_SERVICE_ROLE_KEY), então as análises salvas somem quando o servidor reiniciar.';

const CAUSA_INDISPONIVEL =
  'a Supabase não respondeu. Se o projeto estiver pausado por inatividade, reative-o no painel da ' +
  'Supabase (supabase.com/dashboard, botão "Restore project") e tente de novo.';

const CAUSA_ESPACO =
  'o espaço gratuito da Supabase acabou (1 GB de ZIPs ou 500 MB de banco). Libere espaço em "Análises salvas": ' +
  'baixe o ZIP das análises que quiser guardar e exclua as antigas. Ou peça ao administrador para mudar o plano.';

const CAUSA_CHAVE =
  'a Supabase recusou a chave do servidor. Confira se SUPABASE_SERVICE_ROLE_KEY é a chave service_role ' +
  '(ou secret) do projeto de SUPABASE_URL.';

/** Motivo da falha do armazenamento, em texto para a tela. */
export function causaDaFalha(erro: unknown): string {
  if (erro instanceof ErroSupabase) {
    const { status } = erro;
    if (status === 401 || status === 403) return CAUSA_CHAVE;
    if (status === 413 || /quota|exceed|too large|read-only|25006|53100|disk full/i.test(erro.message)) {
      return CAUSA_ESPACO;
    }
    if (status === undefined || status >= 500) return CAUSA_INDISPONIVEL;
    return `a Supabase recusou a gravação (HTTP ${status}).`;
  }
  return `o armazenamento das análises falhou (${(erro as any)?.message ?? erro}).`;
}

function avisoNaoSalva(erro: unknown): string {
  return `A análise não foi salva e vale só nesta sessão (some quando o servidor reiniciar): ${causaDaFalha(erro)}`;
}

function avisoEmpresaNaoSalva(erro: unknown): string {
  return `A troca de empresa vale nesta sessão, mas não foi gravada nas análises salvas: ${causaDaFalha(erro)}`;
}

/** Aviso de quando deu certo, mas só em memória. */
function avisoDoModo(): string | undefined {
  return armazenamentoAnalises().tipo === 'memoria' ? AVISO_MEMORIA : undefined;
}

// ==================== Leitura do ZIP ====================

/** Tags de valor que indicam um XML de nota fiscal. */
const MARCAS_DE_VALOR = [
  'vBC', 'vICMS', 'vNF',
  'ValorServicos', 'ValoresNFSe', 'vServ', 'ValorLiquidoNfse', 'ValorIss', 'ValorISS',
  // CT-e: o valor do frete vive em <vPrest>.
  'vTPrest', 'vPrest',
];

export interface LoteLido {
  documentos: NFeDocument[];
  erros: ErroProcessamento[];
  quantidadeArquivos: number;
  arquivosProcessados: number;
  arquivosComErro: number;
  /** Caminho no ZIP de cada nota lida (id da nota → arquivo) */
  arquivoDe?: Record<string, string>;
}

/** O conteúdo não é um ZIP legível. */
export class ErroZipInvalido extends Error {
  constructor(motivo: string) {
    super(`O ZIP não pôde ser lido: ${motivo}`);
    this.name = 'ErroZipInvalido';
  }
}

/**
 * Lê todos os XMLs do ZIP com o parser atual. Arquivo que não é nota fica
 * em `erros`, com o motivo; o lote segue com os demais.
 */
export async function lerLoteZip(conteudo: Buffer): Promise<LoteLido> {
  let zip: JSZip;
  try {
    zip = await new JSZip().loadAsync(conteudo);
  } catch (erro: any) {
    throw new ErroZipInvalido(erro?.message ?? String(erro));
  }

  const documentos: NFeDocument[] = [];
  const erros: ErroProcessamento[] = [];
  const arquivoDe: Record<string, string> = {};

  for (const [nomeArquivo, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (!nomeArquivo.toLowerCase().endsWith('.xml')) continue;

    try {
      const conteudoXML = await file.async('text');

      // Cada município nomeia a tag de valor da NFS-e de um jeito; sem elas
      // aqui a nota de serviço era barrada antes de chegar ao parser.
      if (!MARCAS_DE_VALOR.some(m => conteudoXML.includes(m))) {
        erros.push({ nomeArquivo, erro: 'XML não contém valores de nota fiscal' });
        continue;
      }

      const documento = await nfeParserService.parseNFE(conteudoXML);
      arquivoDe[documento.id] = nomeArquivo;
      documentos.push(documento);
    } catch (erro: any) {
      erros.push({ nomeArquivo, erro: erro.message });
    }
  }

  return {
    documentos,
    erros,
    quantidadeArquivos: Object.keys(zip.files).length,
    arquivosProcessados: documentos.length,
    arquivosComErro: erros.length,
    arquivoDe,
  };
}

// ==================== Resumo do lote ====================

/** Quantidade de notas por modelo, só dos modelos presentes. */
export function contarPorModelo(documentos: NFeDocument[]) {
  return MODELOS_DOCUMENTO.map(m => ({
    modelo: String(m.codigo),
    rotulo: rotuloModelo(m.codigo),
    quantidade: documentos.filter(d => String(d.modelo) === String(m.codigo)).length,
  })).filter(m => m.quantidade > 0);
}

/**
 * Resumo do lote vigente da sessão: contagem por modelo e por sentido,
 * empresa analisada e CNPJs que o contador pode escolher. Upload, troca de
 * empresa e abertura de análise devolvem sempre este formato.
 */
export function resumoDoLote(sessao: UserSession) {
  const documentos = sessao.documentos;
  const { candidatos } = identificarEmpresa(documentos);

  return {
    porModelo: contarPorModelo(documentos),
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

// ==================== Competência e versão ====================

/**
 * Competência do lote: o mês (AAAA-MM) com mais notas pelo dia de emissão
 * do XML. Empate fica com o mês mais recente; sem nenhuma data,
 * SEM_COMPETENCIA.
 */
export function calcularCompetencia(documentos: NFeDocument[]): string {
  const contagem = new Map<string, number>();
  for (const doc of documentos) {
    const dia = diaDaNota(doc);
    if (!dia) continue;
    const mes = dia.slice(0, 7);
    contagem.set(mes, (contagem.get(mes) ?? 0) + 1);
  }

  let melhor: string | null = null;
  let maior = 0;
  for (const [mes, quantidade] of contagem) {
    if (quantidade > maior || (quantidade === maior && melhor !== null && mes > melhor)) {
      melhor = mes;
      maior = quantidade;
    }
  }

  return melhor ?? SEM_COMPETENCIA;
}

/** Reserva a próxima versão; números já usados, mesmo de análises excluídas, não voltam. */
export async function proximaVersao(empresaCnpj: string, competencia: string): Promise<number> {
  return armazenamentoAnalises().reservarVersao(empresaCnpj, competencia);
}

/** Dados da análise que a tela mostra. */
export function resumoPublico(analise: AnaliseSalva) {
  return {
    id: analise.id,
    empresaCnpj: analise.empresaCnpj,
    empresaNome: analise.empresaNome,
    competencia: analise.competencia,
    versao: analise.versao,
    criadoPor: analise.criadoPor,
    criadoEm: analise.criadoEm,
    totalNotas: analise.totalNotas,
    versaoTabela: analise.versaoTabela,
    zipBytes: analise.zipBytes,
    nomeArquivo: analise.resumo.nomeArquivo ?? null,
    porSentido: analise.resumo.porSentido ?? null,
    reprocessadaDe: analise.resumo.reprocessadaDe ?? null,
    derivadaDe: analise.resumo.derivadaDe ?? null,
  };
}

export type AnalisePublica = ReturnType<typeof resumoPublico>;

// ==================== Salvar ====================

interface DadosNovaAnalise {
  documentos: NFeDocument[];
  empresa: EmpresaAnalisada | null;
  zip: Buffer;
  criadoPor: string;
  lote: Omit<LoteLido, 'documentos'>;
  nomeArquivo?: string;
  reprocessadaDe?: string;
  derivadaDe?: string;
  /** Competência do lote, calculada antes de tirar as duplicadas; sem ela, a das notas */
  competencia?: string;
  /** Notas duplicadas puladas na importação */
  duplicados?: DuplicadasDoLote;
}

/** Duplicada guardada no resumo da análise. */
export interface DuplicadoResumo {
  nomeArquivo: string;
  motivo: string;
  regra?: 'zip' | 'analise';
}

/** Duplicadas de um lote: as repetidas no ZIP (e quantas eram) e as que a empresa já tinha. */
interface DuplicadasDoLote {
  noZip: DuplicadoResumo[];
  totalNoZip: number;
  daEmpresa: DuplicadoResumo[];
}

/**
 * Campos do resumo sobre as duplicadas: a lista (até o teto dos recusados)
 * e as contagens explícitas, para notas salvas + puladas fecharem com os
 * XMLs lidos.
 */
function camposDuplicados(d: DuplicadasDoLote) {
  return {
    duplicados: [...d.noZip, ...d.daEmpresa]
      .slice(0, MAXIMO_ERROS_GUARDADOS)
      .map(x => ({ nomeArquivo: x.nomeArquivo, motivo: x.motivo, ...(x.regra ? { regra: x.regra } : {}) })),
    duplicadosNoZip: d.totalNoZip,
    duplicadosPulados: d.totalNoZip + d.daEmpresa.length,
  };
}

/** As repetidas no ZIP que o resumo de uma análise guardou. */
function noZipDoResumo(resumo: ResumoAnaliseSalva): { noZip: DuplicadoResumo[]; totalNoZip: number } {
  const noZip = (resumo.duplicados ?? []).filter(d => d.regra !== 'analise');
  return { noZip, totalNoZip: resumo.duplicadosNoZip ?? noZip.length };
}

function montarResumo(dados: DadosNovaAnalise): ResumoAnaliseSalva {
  return {
    nomeArquivo: dados.nomeArquivo,
    quantidadeArquivos: dados.lote.quantidadeArquivos,
    arquivosProcessados: dados.lote.arquivosProcessados,
    arquivosComErro: dados.lote.arquivosComErro,
    erros: dados.lote.erros.slice(0, MAXIMO_ERROS_GUARDADOS).map(e => ({ nomeArquivo: e.nomeArquivo, erro: e.erro })),
    porModelo: contarPorModelo(dados.documentos),
    porSentido: contarPorSentido(dados.documentos),
    empresaInferida: dados.empresa?.inferida,
    ...(dados.reprocessadaDe ? { reprocessadaDe: dados.reprocessadaDe } : {}),
    ...(dados.derivadaDe ? { derivadaDe: dados.derivadaDe } : {}),
    ...(dados.duplicados && dados.duplicados.totalNoZip + dados.duplicados.daEmpresa.length > 0
      ? camposDuplicados(dados.duplicados)
      : {}),
  };
}

/**
 * Grava a análise com a próxima versão livre. Cada tentativa usa um id
 * novo, para não colidir com o que uma tentativa anterior deixou gravado.
 * Lança o erro do armazenamento; quem chama decide se derruba ou avisa.
 */
async function gravarNovaAnalise(dados: DadosNovaAnalise): Promise<AnaliseSalva> {
  const empresaCnpj = normalizarCnpj(dados.empresa?.cnpj);
  const competencia = dados.competencia ?? calcularCompetencia(dados.documentos);
  let versaoTabela: string | null = null;
  try {
    versaoTabela = tabelaCarregada().versao;
  } catch {
    versaoTabela = null;
  }

  for (let tentativa = 1; ; tentativa++) {
    const id = uuidv4();
    const analise: AnaliseSalva = {
      id,
      empresaCnpj,
      empresaNome: dados.empresa?.nome ?? null,
      competencia,
      versao: await proximaVersao(empresaCnpj, competencia),
      criadoPor: dados.criadoPor,
      criadoEm: new Date().toISOString(),
      totalNotas: dados.documentos.length,
      resumo: montarResumo(dados),
      versaoTabela,
      zipPath: caminhoDoZip(empresaCnpj, competencia, id),
      zipBytes: dados.zip.length,
    };

    try {
      await armazenamentoAnalises().salvar(analise, dados.documentos, dados.zip);
      geracao++;
      return analise;
    } catch (erro) {
      if (!(erro instanceof ErroVersaoOcupada) || tentativa >= TENTATIVAS_VERSAO) throw erro;
    }
  }
}

export interface ResultadoSalvar {
  analise: AnalisePublica | null;
  analiseSalva: boolean;
  avisoAnalise?: string;
}

function salva(analise: AnaliseSalva): ResultadoSalvar {
  const aviso = avisoDoModo();
  return { analise: resumoPublico(analise), analiseSalva: true, ...(aviso ? { avisoAnalise: aviso } : {}) };
}

/**
 * Salva o lote recém-importado e liga a sessão à análise. Nunca lança:
 * falha vira `analiseSalva: false` com o aviso para a tela.
 *
 * Lote e empresa são lidos antes de qualquer await, e a sessão só é ligada
 * se ainda estiver com o mesmo lote.
 */
export async function salvarAposUpload(
  sessao: UserSession,
  dados: {
    zip: Buffer;
    criadoPor: string;
    lote: Omit<LoteLido, 'documentos'>;
    nomeArquivo?: string;
    /** Competência do lote antes de tirar as duplicadas */
    competencia?: string;
    duplicados?: DuplicadoResumo[];
  }
): Promise<ResultadoSalvar> {
  const { sessionId, loteId } = sessao;
  const documentos = sessao.documentos;
  const empresa = sessao.empresa ?? null;

  try {
    const analise = await gravarNovaAnalise({
      documentos,
      empresa,
      zip: dados.zip,
      criadoPor: dados.criadoPor,
      lote: dados.lote,
      nomeArquivo: dados.nomeArquivo,
      competencia: dados.competencia,
      duplicados: {
        noZip: (dados.duplicados ?? []).filter(d => d.regra !== 'analise'),
        totalNoZip: (dados.duplicados ?? []).filter(d => d.regra !== 'analise').length,
        daEmpresa: (dados.duplicados ?? []).filter(d => d.regra === 'analise'),
      },
    });
    sessionService.vincularAnalise(sessionId, loteId, analise.id, 'upload');
    return salva(analise);
  } catch (erro: any) {
    console.error(`Análise não salva (${armazenamentoAnalises().descricao()}): ${erro?.message ?? erro}`);
    return { analise: null, analiseSalva: false, avisoAnalise: avisoNaoSalva(erro) };
  }
}

/**
 * Leva a troca de empresa para as análises salvas. Nunca lança.
 *
 *   - Análise criada por esta sessão: atualizada no lugar (empresa,
 *     classificação das notas e, se mudar, competência e versão).
 *   - Análise aberta da lista: não é reescrita. A troca gera uma versão
 *     nova, com o mesmo ZIP, e a sessão passa a apontar para ela.
 *
 * `duplicados` são as notas que a empresa escolhida já tinha em outra
 * competência (já fora do lote): substituem as da escolha anterior, e as
 * repetidas no ZIP continuam. `competencia` é a do lote antes de tirá-las.
 */
export async function atualizarAposTrocaEmpresa(
  sessao: UserSession,
  criadoPor?: string,
  opcoes: { duplicados?: DuplicadoResumo[]; competencia?: string } = {}
): Promise<ResultadoSalvar> {
  const daEmpresa = opcoes.duplicados ?? [];
  const { sessionId, analiseId, analiseOrigem, loteId } = sessao;
  const documentos = sessao.documentos;
  const empresa = sessao.empresa ?? null;

  if (!analiseId) {
    return { analise: null, analiseSalva: false };
  }

  try {
    const loja = armazenamentoAnalises();
    const existente = await loja.obter(analiseId);
    if (!existente) {
      sessionService.vincularAnalise(sessionId, loteId, undefined);
      return {
        analise: null,
        analiseSalva: false,
        avisoAnalise: 'A troca de empresa vale nesta sessão, mas a análise salva deste lote não foi encontrada.',
      };
    }

    const atual = existente.analise;

    if (analiseOrigem === 'aberta') {
      const zip = await loja.baixarZip(atual);
      if (!zip) {
        return {
          analise: null,
          analiseSalva: false,
          avisoAnalise:
            'A troca de empresa vale nesta sessão, mas não foi salva: o ZIP original da análise aberta não foi encontrado.',
        };
      }
      const resumo = atual.resumo;
      const nova = await gravarNovaAnalise({
        documentos,
        empresa,
        zip,
        criadoPor: criadoPor || sessao.email || 'desconhecido',
        lote: {
          erros: resumo.erros ?? [],
          quantidadeArquivos: resumo.quantidadeArquivos ?? documentos.length,
          arquivosProcessados: resumo.arquivosProcessados ?? documentos.length,
          arquivosComErro: resumo.arquivosComErro ?? 0,
        },
        nomeArquivo: resumo.nomeArquivo,
        derivadaDe: atual.id,
        competencia: opcoes.competencia,
        duplicados: { ...noZipDoResumo(resumo), daEmpresa },
      });
      sessionService.vincularAnalise(sessionId, loteId, nova.id, 'upload');
      return salva(nova);
    }

    const empresaCnpj = normalizarCnpj(empresa?.cnpj);
    const competencia = opcoes.competencia ?? calcularCompetencia(documentos);
    const mudouChave = empresaCnpj !== atual.empresaCnpj || competencia !== atual.competencia;

    for (let tentativa = 1; ; tentativa++) {
      const versao = mudouChave ? await proximaVersao(empresaCnpj, competencia) : atual.versao;
      try {
        const atualizada = await loja.atualizarEmpresa(
          atual.id,
          {
            empresaCnpj,
            empresaNome: empresa?.nome ?? null,
            competencia,
            versao,
            resumo: {
              ...atual.resumo,
              porSentido: contarPorSentido(documentos),
              empresaInferida: empresa?.inferida,
              porModelo: contarPorModelo(documentos),
              ...camposDuplicados({ ...noZipDoResumo(atual.resumo), daEmpresa }),
            },
            zipPath: atual.zipPath ? caminhoDoZip(empresaCnpj, competencia, atual.id) : null,
          },
          documentos
        );
        geracao++;
        return salva(atualizada);
      } catch (erro) {
        if (!(erro instanceof ErroVersaoOcupada) || tentativa >= TENTATIVAS_VERSAO) throw erro;
      }
    }
  } catch (erro: any) {
    console.error(`Troca de empresa não gravada (análise ${analiseId}): ${erro?.message ?? erro}`);
    return { analise: null, analiseSalva: false, avisoAnalise: avisoEmpresaNaoSalva(erro) };
  }
}

// ==================== Abrir e reprocessar ====================

/** A análise pedida não existe. */
export class ErroAnaliseInexistente extends Error {
  constructor(id: string) {
    super(`Análise ${id} não encontrada.`);
    this.name = 'ErroAnaliseInexistente';
  }
}

/** O ZIP guardado da análise não existe mais ou não pôde ser lido. */
export class ErroZipDaAnalise extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroZipDaAnalise';
  }
}

function empresaDaAnalise(analise: AnaliseSalva): EmpresaAnalisada | null {
  if (!analise.empresaCnpj) return null;
  return {
    cnpj: analise.empresaCnpj,
    nome: analise.empresaNome ?? 'Nome não informado',
    inferida: analise.resumo.empresaInferida ?? false,
  };
}

/**
 * Carrega a análise na sessão como se o lote tivesse acabado de ser
 * importado: notas, empresa e painel. Substitui o lote vigente.
 */
export async function abrirNaSessao(id: string, sessionId: string) {
  const registro = await armazenamentoAnalises().obter(id);
  if (!registro) throw new ErroAnaliseInexistente(id);

  const { analise, documentos } = registro;
  const resumo = analise.resumo;
  const importacao: ImportacaoArquivo = {
    sessionId,
    quantidadeArquivos: resumo.quantidadeArquivos ?? documentos.length,
    arquivosProcessados: resumo.arquivosProcessados ?? documentos.length,
    arquivosComErro: resumo.arquivosComErro ?? 0,
    erros: resumo.erros ?? [],
    documentos,
    timestamp: analise.criadoEm,
  };

  const sessao = await sessionService.adicionarDocumentos(sessionId, documentos, importacao, empresaDaAnalise(analise));
  sessionService.vincularAnalise(sessionId, sessao.loteId, analise.id, 'aberta');

  return { sessao, analise: resumoPublico(analise), erros: importacao.erros };
}

/**
 * Gera uma versão nova a partir do ZIP guardado, com o parser, as regras e
 * a tabela de cClassTrib atuais. A empresa da análise original é mantida
 * quando ainda aparece no lote; senão, o lote a identifica de novo.
 */
export async function reprocessar(
  id: string,
  criadoPor: string
): Promise<AnalisePublica & { avisoReprocessamento?: string }> {
  const loja = armazenamentoAnalises();
  const registro = await loja.obter(id);
  if (!registro) throw new ErroAnaliseInexistente(id);

  const zip = await loja.baixarZip(registro.analise);
  if (!zip) throw new ErroZipDaAnalise('O ZIP original desta análise não foi encontrado no armazenamento.');

  let lote: LoteLido;
  try {
    lote = await lerLoteZip(zip);
  } catch (erro: any) {
    throw new ErroZipDaAnalise(erro.message);
  }
  if (lote.documentos.length === 0) {
    throw new ErroZipDaAnalise('Nenhuma nota fiscal reconhecida no ZIP guardado.');
  }

  const identificacao = identificarEmpresa(lote.documentos);
  const original = empresaDaAnalise(registro.analise);
  const originalNoLote = original ? identificacao.todos.find(c => c.cnpj === original.cnpj) : undefined;

  let empresa: EmpresaAnalisada | null = null;
  if (original && originalNoLote) {
    empresa = { ...original, nome: originalNoLote.nome || original.nome };
  } else if (identificacao.empresa) {
    empresa = { cnpj: identificacao.empresa.cnpj, nome: identificacao.empresa.nome, inferida: true };
  }

  const { documentos, ...resto } = lote;
  const analise = await gravarNovaAnalise({
    documentos: classificarSentido(documentos, empresa?.cnpj),
    empresa,
    zip,
    criadoPor,
    lote: resto,
    nomeArquivo: registro.analise.resumo.nomeArquivo,
    reprocessadaDe: registro.analise.id,
  });

  // O reprocessamento não aplica o bloqueio de duplicados (decisão do
  // usuário): as notas puladas na importação voltam, e a tela avisa.
  const resumoOriginal = registro.analise.resumo;
  const puladas = resumoOriginal.duplicadosPulados ?? resumoOriginal.duplicados?.length ?? 0;
  const avisoReprocessamento =
    puladas === 0
      ? undefined
      : puladas === 1
        ? 'A nota pulada na importação por duplicidade volta no reprocessamento.'
        : `As ${puladas} notas puladas na importação por duplicidade voltam no reprocessamento.`;

  return { ...resumoPublico(analise), ...(avisoReprocessamento ? { avisoReprocessamento } : {}) };
}

// ==================== Excluir ====================

/** Máximo de análises por pedido de exclusão em lote. */
export const MAXIMO_EXCLUSAO_LOTE = 100;

export interface ResultadoExclusao {
  /** Ids excluídos, na ordem do pedido */
  excluidas: string[];
  /** Ids pedidos que não existiam */
  naoEncontradas: string[];
  /** Bytes de ZIP apagados do armazenamento */
  bytesLiberados: number;
  /** ZIPs ausentes ou que não puderam ser apagados */
  avisos: string[];
  /** Sessões que estavam com uma das análises aberta e perderam o vínculo */
  sessoesDesvinculadas: number;
}

/**
 * O armazenamento falhou no meio do lote. `parcial` diz o que já tinha
 * sido excluído antes da falha, para a tela não esconder nada.
 */
export class ErroExclusaoInterrompida extends Error {
  constructor(public parcial: ResultadoExclusao, public causa: unknown) {
    super(`Exclusão interrompida: ${(causa as any)?.message ?? causa}`);
    this.name = 'ErroExclusaoInterrompida';
  }
}

/**
 * Exclui as análises pedidas: notas, linha da análise e ZIP. Versões que
 * ficam não são renumeradas. Sessões ligadas a uma análise excluída perdem
 * o vínculo e seguem com as notas em memória. Cada exclusão vai para o log
 * com quem pediu, empresa, competência, versão e momento.
 *
 * Ids repetidos contam uma vez. A validação (quantidade, formato) é da rota.
 */
export async function excluirAnalises(
  ids: string[],
  excluidoPor: string,
  assumidoPor?: { email?: string; userId?: string }
): Promise<ResultadoExclusao> {
  const loja = armazenamentoAnalises();
  const resultado: ResultadoExclusao = {
    excluidas: [],
    naoEncontradas: [],
    bytesLiberados: 0,
    avisos: [],
    sessoesDesvinculadas: 0,
  };
  // Administrador agindo pela conta de outro usuário fica no log também.
  const quem = assumidoPor
    ? `${excluidoPor} (assumido por ${assumidoPor.email || assumidoPor.userId || 'administrador'})`
    : excluidoPor;

  // Ids em minúsculas: o mesmo uuid em maiúsculas conta uma vez e casa com a sessão.
  for (const id of Array.from(new Set(ids.map(i => i.toLowerCase())))) {
    // O vínculo sai antes: uma troca de empresa simultânea não regrava a análise.
    const desvinculadas = sessionService.desvincularAnaliseExcluida(id);

    let removida;
    try {
      removida = await loja.excluir(id);
      geracao++;
    } catch (erro: any) {
      geracao++;
      console.error(
        `[análises] Exclusão pedida por ${quem} interrompida em ${id} ` +
          `(${resultado.excluidas.length} já excluída(s)): ${erro?.message ?? erro}`
      );
      throw new ErroExclusaoInterrompida(resultado, erro);
    }

    if (!removida) {
      resultado.naoEncontradas.push(id);
      continue;
    }

    const { analise, zipRemovido, avisoZip } = removida;
    resultado.excluidas.push(id);
    if (zipRemovido) resultado.bytesLiberados += analise.zipBytes;
    resultado.sessoesDesvinculadas += desvinculadas;

    console.log(
      `[análises] ${new Date().toISOString()} ${quem} excluiu a análise ${id} ` +
        `(empresa ${analise.empresaCnpj || 'sem empresa'}, competência ${analise.competencia}, versão ${analise.versao})`
    );
    if (avisoZip) {
      console.warn(`[análises] ${avisoZip}`);
      resultado.avisos.push(avisoZip);
    }
  }

  return resultado;
}
