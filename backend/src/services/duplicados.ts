import { NFeDocument } from '../types';
import { identidadesNota, motivoSemIdentidade } from '../utils/identidadeNota';
import { causaDaFalha } from './analises';
import { SEM_COMPETENCIA } from './armazenamentoAnalises';
import { ErroCargaEmpresa, carregarConjunto, formatarCnpj } from './conjuntoEmpresa';

/**
 * Bloqueio de XMLs duplicados na importação.
 *
 * Duas regras, nesta ordem:
 *   1. Repetido no ZIP: a primeira cópia entra, as seguintes são puladas.
 *   2. Já importada: a nota existe na versão mais recente de outra
 *      competência da mesma empresa. A competência do próprio lote fica de
 *      fora, porque reimportá-la gera uma versão completa nova. Nota emitida
 *      no mês da competência do lote nunca é bloqueada: se ela entrou por
 *      engano no lote de outro mês, a reimportação do mês certo não a perde
 *      (o conjunto da empresa a conta uma vez).
 *
 * Quem decide se duas notas são a mesma é utils/identidadeNota.ts. Nota sem
 * identidade confiável nunca é bloqueada: entra e gera aviso.
 *
 * Nada aqui grava ou altera análises salvas, e o Reprocessar não passa por
 * aqui.
 */

export const MOTIVO_REPETIDO_NO_ZIP = 'repetido no ZIP';
export const ERRO_TUDO_DUPLICADO = 'Todas as notas deste ZIP já foram importadas';

/** Análise salva onde a nota já está. */
export interface OrigemDuplicado {
  analiseId: string;
  empresaCnpj: string;
  empresaNome: string | null;
  competencia: string;
  versao: number;
}

export interface NotaDuplicada {
  nomeArquivo: string;
  chaveNFe: string;
  modelo: string;
  regra: 'zip' | 'analise';
  /** Texto para a tela e a planilha */
  motivo: string;
  /** Presente na regra 'analise' */
  origem?: OrigemDuplicado;
}

export interface NotaSemIdentidade {
  nomeArquivo: string;
  motivo: string;
}

/** Nome do arquivo de cada nota no ZIP (id da nota → caminho no ZIP). */
export type ArquivoDe = Record<string, string>;

function nomeDoArquivo(doc: NFeDocument, arquivoDe: ArquivoDe | undefined): string {
  return arquivoDe?.[doc.id] ?? `nota ${doc.chaveNFe || doc.id}`;
}

/** "2026-02" vira "02/2026". */
export function rotuloCompetencia(competencia: string): string {
  if (competencia === SEM_COMPETENCIA) return 'sem competência';
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  return m ? `${m[2]}/${m[1]}` : competencia;
}

export function motivoJaImportada(origem: OrigemDuplicado): string {
  const empresa = origem.empresaNome || formatarCnpj(origem.empresaCnpj);
  return `já importada em ${empresa} · ${rotuloCompetencia(origem.competencia)} · v${origem.versao}`;
}

function duplicada(
  doc: NFeDocument,
  arquivoDe: ArquivoDe | undefined,
  regra: NotaDuplicada['regra'],
  origem?: OrigemDuplicado
): NotaDuplicada {
  return {
    nomeArquivo: nomeDoArquivo(doc, arquivoDe),
    chaveNFe: doc.chaveNFe,
    modelo: String(doc.modelo),
    regra,
    motivo: origem ? motivoJaImportada(origem) : MOTIVO_REPETIDO_NO_ZIP,
    ...(origem ? { origem } : {}),
  };
}

// ==================== Regra 1: repetido no ZIP ====================

export interface SeparacaoNoZip {
  /** Notas que seguem, na ordem do ZIP */
  documentos: NFeDocument[];
  duplicados: NotaDuplicada[];
  semIdentidade: NotaSemIdentidade[];
}

/** A primeira cópia de cada nota entra; as seguintes viram duplicadas. */
export function separarRepetidasNoZip(documentos: NFeDocument[], arquivoDe?: ArquivoDe): SeparacaoNoZip {
  const vistas = new Set<string>();
  const resultado: SeparacaoNoZip = { documentos: [], duplicados: [], semIdentidade: [] };

  for (const doc of documentos) {
    const identidades = identidadesNota(doc);
    if (identidades.length === 0) {
      resultado.semIdentidade.push({ nomeArquivo: nomeDoArquivo(doc, arquivoDe), motivo: motivoSemIdentidade(doc) });
      resultado.documentos.push(doc);
      continue;
    }
    if (identidades.some(i => vistas.has(i))) {
      resultado.duplicados.push(duplicada(doc, arquivoDe, 'zip'));
      continue;
    }
    for (const i of identidades) vistas.add(i);
    resultado.documentos.push(doc);
  }

  return resultado;
}

/** Aviso das notas que entraram sem checagem; undefined se não houver. */
export function avisoSemIdentidade(lista: NotaSemIdentidade[]): string | undefined {
  if (lista.length === 0) return undefined;
  const motivos = Array.from(new Set(lista.map(n => n.motivo))).join('; ');
  const n = lista.length;
  return n === 1
    ? `1 nota sem identidade confiável (${motivos}) entrou sem a checagem de duplicidade: ${lista[0].nomeArquivo}.`
    : `${n} notas sem identidade confiável (${motivos}) entraram sem a checagem de duplicidade.`;
}

// ==================== Regra 2: já importada na empresa ====================

/** Teto da leitura das análises salvas; passou, a checagem não é feita. */
let tempoChecagemMs = 20_000;

/** Troca o teto da leitura (testes). */
export function definirTempoChecagem(ms: number): void {
  tempoChecagemMs = ms;
}

class ErroTempoChecagem extends Error {
  constructor(ms: number) {
    super(`a leitura das análises salvas passou de ${Math.round(ms / 1000)} s.`);
    this.name = 'ErroTempoChecagem';
  }
}

/** Datadas primeiro, da mais recente para a mais antiga; "sem competência" no fim. */
const ordemDaCompetencia = (a: string, b: string) =>
  (a === SEM_COMPETENCIA ? 1 : 0) - (b === SEM_COMPETENCIA ? 1 : 0) || b.localeCompare(a);

/**
 * Identidades das notas salvas da empresa: versão mais recente de cada
 * competência (o mesmo conjunto do filtro por empresa, lido com no máximo
 * 4 leituras simultâneas e reaproveitado do cache da sessão), menos a
 * competência do lote e a análise `ignorar` (a do próprio lote). A
 * competência mais recente ganha quando a mesma nota aparece em duas.
 */
async function identidadesSalvas(
  sessionId: string,
  empresaCnpj: string,
  competenciaDoLote: string,
  ignorar?: string
): Promise<Map<string, OrigemDuplicado>> {
  let relogio: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new ErroTempoChecagem(tempoChecagemMs)), tempoChecagemMs);
  });
  let conjunto;
  try {
    conjunto = await Promise.race([carregarConjunto(sessionId, empresaCnpj), limite]);
  } finally {
    clearTimeout(relogio);
  }

  const importacoes = conjunto.importacoes
    .filter(i => i.analise.competencia !== competenciaDoLote && i.analise.id !== ignorar)
    .sort((a, b) => ordemDaCompetencia(a.analise.competencia, b.analise.competencia));

  const mapa = new Map<string, OrigemDuplicado>();
  for (const { analise, todas } of importacoes) {
    const origem: OrigemDuplicado = {
      analiseId: analise.id,
      empresaCnpj: analise.empresaCnpj,
      empresaNome: analise.empresaNome,
      competencia: analise.competencia,
      versao: analise.versao,
    };
    for (const doc of todas) {
      for (const identidade of identidadesNota(doc)) {
        if (!mapa.has(identidade)) mapa.set(identidade, origem);
      }
    }
  }
  return mapa;
}

export interface SeparacaoJaImportadas {
  documentos: NFeDocument[];
  duplicados: NotaDuplicada[];
  /** A checagem não pôde ser feita (armazenamento fora ou lento) */
  aviso?: string;
}

/**
 * Tira do lote as notas que a empresa já tem em outra competência. Sem
 * empresa, não compara. Nota emitida no mês da competência do lote nunca
 * sai. Falha ou demora do armazenamento não derruba a importação: o lote
 * segue inteiro, com aviso.
 */
export async function separarJaImportadas(
  documentos: NFeDocument[],
  dados: {
    sessionId: string;
    empresaCnpj: string | null | undefined;
    competenciaDoLote: string;
    arquivoDe?: ArquivoDe;
    ignorarAnalise?: string;
  }
): Promise<SeparacaoJaImportadas> {
  const empresaCnpj = (dados.empresaCnpj ?? '').replace(/\D/g, '');
  if (!empresaCnpj || documentos.length === 0) return { documentos, duplicados: [] };

  let salvas: Map<string, OrigemDuplicado>;
  try {
    salvas = await identidadesSalvas(dados.sessionId, empresaCnpj, dados.competenciaDoLote, dados.ignorarAnalise);
  } catch (erro: any) {
    const causa = erro instanceof ErroCargaEmpresa ? erro.causa : erro;
    console.error(`Checagem de notas já importadas não feita (${empresaCnpj}): ${causa?.message ?? causa}`);
    return {
      documentos,
      duplicados: [],
      aviso:
        'A checagem de notas já importadas em outras competências desta empresa não foi feita: ' +
        (causa instanceof ErroTempoChecagem ? causa.message : causaDaFalha(causa)),
    };
  }

  const resultado: SeparacaoJaImportadas = { documentos: [], duplicados: [] };
  for (const doc of documentos) {
    const doMes = !!doc.diaEmissao && doc.diaEmissao.slice(0, 7) === dados.competenciaDoLote;
    const origem = doMes
      ? undefined
      : identidadesNota(doc)
          .map(i => salvas.get(i))
          .find(o => o !== undefined);
    if (origem) resultado.duplicados.push(duplicada(doc, dados.arquivoDe, 'analise', origem));
    else resultado.documentos.push(doc);
  }
  return resultado;
}

/** Aviso de resumo das notas puladas; undefined se nenhuma. */
export function avisoDuplicados(duplicados: NotaDuplicada[]): string | undefined {
  const n = duplicados.length;
  if (n === 0) return undefined;
  return n === 1
    ? '1 nota duplicada foi pulada e não entrou na análise.'
    : `${n} notas duplicadas foram puladas e não entraram na análise.`;
}
