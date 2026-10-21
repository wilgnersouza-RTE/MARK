/**
 * Filtros da análise: Entrada/Saída, CFOP e NCM.
 *
 * Regra única para todas as rotas que leem os documentos da sessão
 * (dashboard, conferência de campos e exportação). Os filtros chegam como
 * query string — `?sentido=entrada|saida|indefinido&cfop=1102&ncm=84713012` —
 * e valor ausente ou inválido equivale a "todos".
 */
import { DocumentType, NFeDocument } from '../types';

export interface FiltrosAnalise {
  sentido?: DocumentType;
  cfop?: string;
  ncm?: string;
}

export interface OpcaoFiltro {
  codigo: string;
  /** Quantidade de notas do lote com o código */
  quantidade: number;
}

const SENTIDOS: DocumentType[] = ['entrada', 'saida', 'indefinido'];

/** Primeiro valor de um parâmetro de query, já sem espaços. */
function valorDe(bruto: unknown): string {
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  return typeof valor === 'string' ? valor.trim() : '';
}

/** Só dígitos; CFOP e NCM são códigos numéricos e podem vir com pontuação. */
function codigoDe(bruto: unknown): string | undefined {
  const digitos = valorDe(bruto).replace(/\D/g, '');
  return digitos || undefined;
}

export function lerFiltros(query: Record<string, unknown> | undefined | null): FiltrosAnalise {
  const q = query ?? {};
  const filtros: FiltrosAnalise = {};

  const sentido = valorDe(q.sentido) as DocumentType;
  if (SENTIDOS.includes(sentido)) filtros.sentido = sentido;

  const cfop = codigoDe(q.cfop);
  if (cfop) filtros.cfop = cfop;

  const ncm = codigoDe(q.ncm);
  if (ncm) filtros.ncm = ncm;

  return filtros;
}

/** Filtros combinam entre si (E lógico). */
export function filtrarDocumentos(docs: NFeDocument[], filtros: FiltrosAnalise): NFeDocument[] {
  return docs.filter(doc => {
    if (filtros.sentido && doc.tipo !== filtros.sentido) return false;
    if (filtros.cfop && !(doc.cfops ?? []).includes(filtros.cfop)) return false;
    if (filtros.ncm && !(doc.ncms ?? []).includes(filtros.ncm)) return false;
    return true;
  });
}

/**
 * Códigos presentes no lote, cada um com a quantidade de notas que o têm,
 * em ordem crescente de código.
 */
export function opcoesDoLote(docs: NFeDocument[], campo: 'cfops' | 'ncms'): OpcaoFiltro[] {
  const contagem = new Map<string, number>();
  for (const doc of docs) {
    for (const codigo of new Set(doc[campo] ?? [])) {
      contagem.set(codigo, (contagem.get(codigo) ?? 0) + 1);
    }
  }
  return Array.from(contagem, ([codigo, quantidade]) => ({ codigo, quantidade })).sort((a, b) =>
    a.codigo.localeCompare(b.codigo)
  );
}
