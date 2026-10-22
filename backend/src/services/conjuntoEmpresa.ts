import { Response } from 'express';
import { EmpresaAnalisada, NFeDocument } from '../types';
import { FiltrosAnalise, filtrarDocumentos } from '../utils/filtros';
import { armazenamentoAnalises, causaDaFalha, geracaoAnalises, resumoPublico, AnalisePublica } from './analises';
import { AnaliseSalva, SEM_COMPETENCIA } from './armazenamentoAnalises';
import { sessionService } from './session';
import { identidadesNota } from '../utils/identidadeNota';

/**
 * Conjunto da empresa: todas as importações salvas de um cliente, para o
 * painel deixar de olhar só o lote aberto na sessão.
 *
 * Regras:
 *   - Entra só a versão mais recente de cada competência; versões antigas
 *     continuam salvas e ficam fora. As análises "sem competência" (nenhuma
 *     nota com data) entram todas, porque não são versões umas das outras.
 *   - Se a versão mais recente sumiu ou mudou de empresa/competência entre a
 *     listagem e a leitura, vale a próxima versão listada da competência.
 *   - A mesma nota (identidade de utils/identidadeNota.ts) em duas importações
 *     conta uma vez, na importação mais recente (por data de gravação).
 *
 * Tudo aqui é leitura: escolher a empresa não mexe no lote da sessão nem nas
 * análises salvas.
 *
 * Cache por sessão (LRU, 10 minutos, até 200 mil notas no total): a carga
 * das notas é reaproveitada enquanto a lista de análises da empresa não
 * mudar. A listagem (só metadados) que decide isso é compartilhada pelas
 * chamadas simultâneas e reaproveitada por 5 segundos, ou até este servidor
 * gravar, alterar ou excluir uma análise.
 */

/** Aviso do conjunto vazio. */
export const AVISO_SEM_ANALISES = 'Nenhuma análise salva desta empresa';

export const TTL_CONJUNTO_MS = 10 * 60 * 1000;
export const MAXIMO_NOTAS_EM_CACHE = 200_000;
export const JANELA_LISTAGEM_MS = 5_000;
const LEITURAS_SIMULTANEAS = 4;

/** Relógio trocável nos testes. */
let agora = () => Date.now();
export function definirRelogio(relogio: () => number): void {
  agora = relogio;
}

/** "12345678000190" vira "12.345.678/0001-90". */
export function formatarCnpj(cnpj: string): string {
  return /^\d{14}$/.test(cnpj) ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : cnpj;
}

/** Parâmetro `empresa` fora do formato (CNPJ de 14 dígitos). */
export class ErroEmpresaInvalida extends Error {
  constructor() {
    super('Empresa inválida: informe o CNPJ com 14 dígitos.');
    this.name = 'ErroEmpresaInvalida';
  }
}

/** O armazenamento falhou ao carregar o conjunto. `message` traz a causa para a tela. */
export class ErroCargaEmpresa extends Error {
  constructor(public causa: unknown) {
    super(`Não foi possível carregar as análises da empresa: ${causaDaFalha(causa)}`);
    this.name = 'ErroCargaEmpresa';
  }
}

/**
 * Resposta das rotas para os erros do conjunto: 400 para empresa inválida,
 * 503 com a causa para falha do armazenamento. Devolve false para outros
 * erros, que ficam com quem chamou.
 */
export function responderFalhaDoConjunto(res: Response, e: unknown): boolean {
  if (e instanceof ErroEmpresaInvalida) {
    res.status(400).json({ success: false, error: e.message, timestamp: new Date().toISOString() });
    return true;
  }
  if (e instanceof ErroCargaEmpresa) {
    console.error('Erro ao carregar o conjunto da empresa:', e.causa);
    res.status(503).json({ success: false, error: e.message, timestamp: new Date().toISOString() });
    return true;
  }
  return false;
}

/**
 * Lê `?empresa=` da query. Ausente ou vazio: null ("Lote atual").
 * Aceita o CNPJ com ou sem pontuação; outro valor lança ErroEmpresaInvalida.
 */
export function lerEmpresa(query: Record<string, unknown> | undefined | null): string | null {
  const bruto = query?.empresa;
  const valor = (Array.isArray(bruto) ? bruto[0] : bruto) as unknown;
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ErroEmpresaInvalida();
  const texto = valor.trim();
  if (texto === '') return null;
  const cnpj = texto.replace(/[.\-/\s]/g, '');
  if (!/^\d{14}$/.test(cnpj)) throw new ErroEmpresaInvalida();
  return cnpj;
}

export interface ImportacaoDoConjunto {
  analise: AnalisePublica;
  /** Notas que ficaram nesta importação depois de tirar as repetidas */
  documentos: NFeDocument[];
  /** Todas as notas gravadas nesta importação, com as repetidas (bloqueio de duplicados) */
  todas: NFeDocument[];
}

export interface ConjuntoEmpresa {
  cnpj: string;
  /** Nome da análise mais recente; sem nenhum, o CNPJ formatado */
  nome: string;
  /** Competência mais recente primeiro; "sem competência" no fim */
  importacoes: ImportacaoDoConjunto[];
  /** Notas de todas as importações incluídas, sem repetição */
  documentos: NFeDocument[];
}

// ==================== Listagem ====================

/** Todas as análises completas da empresa, sem repetir id entre páginas. */
export async function todasAsAnalises(cnpj: string): Promise<AnaliseSalva[]> {
  const loja = armazenamentoAnalises();
  const porId = new Map<string, AnaliseSalva>();
  for (let offset = 0; ; ) {
    const pagina = await loja.listar({ empresa: cnpj, offset });
    for (const a of pagina.analises) if (!porId.has(a.id)) porId.set(a.id, a);
    if (!pagina.temMais || pagina.analises.length === 0) break;
    offset += pagina.analises.length;
  }
  return Array.from(porId.values());
}

interface ListagemGuardada {
  geracao: number;
  em: number;
  analises: Promise<AnaliseSalva[]>;
}

const listagens = new Map<string, ListagemGuardada>();

/** Uma listagem por sessão + empresa para as chamadas simultâneas e os próximos 5 s. */
function listarCompartilhado(sessionId: string, cnpj: string): Promise<AnaliseSalva[]> {
  const chave = `${sessionId}|${cnpj}`;
  const geracao = geracaoAnalises();
  const guardada = listagens.get(chave);
  if (guardada && guardada.geracao === geracao && agora() - guardada.em < JANELA_LISTAGEM_MS) {
    return guardada.analises;
  }
  const analises = todasAsAnalises(cnpj).catch(erro => {
    if (listagens.get(chave)?.analises === analises) listagens.delete(chave);
    throw erro;
  });
  listagens.set(chave, { geracao, em: agora(), analises });
  // Só as da janela atual ficam guardadas.
  for (const [k, l] of listagens) if (agora() - l.em >= JANELA_LISTAGEM_MS) listagens.delete(k);
  return analises;
}

// ==================== Escolha das versões ====================

/**
 * Candidatas de cada vaga do conjunto, na ordem de preferência: uma vaga por
 * competência (versões da maior para a menor) e uma por análise sem
 * competência.
 */
export function vagasDoConjunto(analises: AnaliseSalva[]): AnaliseSalva[][] {
  const porCompetencia = new Map<string, AnaliseSalva[]>();
  const vagas: AnaliseSalva[][] = [];
  for (const a of analises) {
    if (a.competencia === SEM_COMPETENCIA) {
      vagas.push([a]);
      continue;
    }
    const lista = porCompetencia.get(a.competencia) ?? [];
    lista.push(a);
    porCompetencia.set(a.competencia, lista);
  }
  for (const lista of porCompetencia.values()) vagas.push(lista.sort((a, b) => b.versao - a.versao));
  return vagas;
}

/** Versão mais recente (maior número) de cada competência. */
export function versoesMaisRecentes(analises: AnaliseSalva[]): AnaliseSalva[] {
  return vagasDoConjunto(analises).map(v => v[0]);
}

/**
 * Assinatura da lista de análises da empresa: muda quando entra, sai ou é
 * alterada qualquer análise dela, inclusive na troca de empresa no lugar.
 */
function assinaturaDe(analises: AnaliseSalva[]): string {
  return analises
    .map(a =>
      JSON.stringify([a.id, a.competencia, a.versao, a.totalNotas, a.empresaNome, a.criadoEm, a.resumo?.porSentido ?? null])
    )
    .sort()
    .join('|');
}

/** Executa `tarefa` em cada item com no máximo `limite` ao mesmo tempo, mantendo a ordem. */
async function emParalelo<T, R>(itens: T[], limite: number, tarefa: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await tarefa(itens[i]);
    }
  });
  await Promise.all(trabalhadores);
  return resultados;
}

const ordemDaCompetencia = (c: string) => (c === SEM_COMPETENCIA ? '' : c);

/**
 * Chaves para tirar repetidas do conjunto: as identidades da nota e, sem
 * identidade, a chave de antes (modelo + emitente + chave, quando houver).
 * O recurso vale só aqui; o bloqueio da importação nunca o usa.
 */
function chavesDoConjunto(doc: NFeDocument): string[] {
  const identidades = identidadesNota(doc);
  if (identidades.length > 0) return identidades;
  const chave = (doc.chaveNFe ?? '').trim();
  if (!chave || chave.toUpperCase() === 'N/A') return [];
  return [`${doc.modelo}|${doc.cnpjEmitente ?? ''}|${chave}`];
}

async function montarConjunto(cnpj: string, analises: AnaliseSalva[]): Promise<ConjuntoEmpresa> {
  const loja = armazenamentoAnalises();

  // Cada vaga lê as candidatas em ordem até achar uma que ainda exista e
  // ainda seja desta empresa e desta competência.
  const lidas = await emParalelo(vagasDoConjunto(analises), LEITURAS_SIMULTANEAS, async candidatas => {
    for (const candidata of candidatas) {
      const registro = await loja.obter(candidata.id);
      if (!registro) continue;
      const { analise } = registro;
      if (analise.empresaCnpj !== cnpj || analise.competencia !== candidata.competencia) continue;
      return registro;
    }
    return null;
  });
  const registros = lidas.filter((r): r is NonNullable<typeof r> => r !== null);

  // Repetidas ficam na importação gravada por último.
  const vistas = new Set<string>();
  const porRecencia = [...registros].sort(
    (a, b) => b.analise.criadoEm.localeCompare(a.analise.criadoEm) || b.analise.versao - a.analise.versao
  );
  const importacoes: ImportacaoDoConjunto[] = porRecencia.map(({ analise, documentos }) => ({
    analise: resumoPublico(analise),
    todas: documentos,
    documentos: documentos.filter(doc => {
      const chaves = chavesDoConjunto(doc);
      if (chaves.length === 0) return true;
      if (chaves.some(c => vistas.has(c))) return false;
      for (const c of chaves) vistas.add(c);
      return true;
    }),
  }));

  importacoes.sort(
    (a, b) =>
      ordemDaCompetencia(b.analise.competencia).localeCompare(ordemDaCompetencia(a.analise.competencia)) ||
      b.analise.criadoEm.localeCompare(a.analise.criadoEm)
  );

  const nome = porRecencia.find(r => r.analise.empresaNome)?.analise.empresaNome ?? formatarCnpj(cnpj);
  return { cnpj, nome, importacoes, documentos: importacoes.flatMap(i => i.documentos) };
}

// ==================== Cache ====================

interface EntradaCache {
  cnpj: string;
  assinatura: string;
  criadoEm: number;
  /** Notas guardadas; 0 até a carga terminar */
  notas: number;
  conjunto: Promise<ConjuntoEmpresa>;
}

/** Um conjunto por sessão, em ordem de uso (o último usado no fim). */
const cache = new Map<string, EntradaCache>();

/** Esvazia o cache e as listagens guardadas (testes). */
export function limparCacheConjuntos(): void {
  cache.clear();
  listagens.clear();
}

/** Descarta o que a sessão tinha guardado. */
export function descartarSessao(sessionId: string): void {
  cache.delete(sessionId);
  for (const chave of listagens.keys()) if (chave.startsWith(`${sessionId}|`)) listagens.delete(chave);
}

sessionService.aoEncerrarSessao(descartarSessao);

/** Sessões em cache, da menos para a mais usada (testes e diagnóstico). */
export function sessoesEmCache(): string[] {
  return Array.from(cache.keys());
}

/** Tira as vencidas e, se as notas passarem do limite, as menos usadas (nunca a atual). */
function aparar(atual: string): void {
  const instante = agora();
  for (const [id, e] of cache) if (instante - e.criadoEm >= TTL_CONJUNTO_MS) cache.delete(id);
  let total = 0;
  for (const e of cache.values()) total += e.notas;
  for (const [id, e] of cache) {
    if (total <= MAXIMO_NOTAS_EM_CACHE) break;
    if (id === atual) continue;
    cache.delete(id);
    total -= e.notas;
  }
}

/**
 * Conjunto da empresa para a sessão, do cache quando a lista de análises
 * não mudou. Falha do armazenamento vira ErroCargaEmpresa.
 */
export async function carregarConjunto(sessionId: string, cnpj: string): Promise<ConjuntoEmpresa> {
  let analises: AnaliseSalva[];
  try {
    analises = await listarCompartilhado(sessionId, cnpj);
  } catch (erro) {
    throw new ErroCargaEmpresa(erro);
  }

  const assinatura = assinaturaDe(analises);
  const guardado = cache.get(sessionId);
  if (
    guardado &&
    guardado.cnpj === cnpj &&
    guardado.assinatura === assinatura &&
    agora() - guardado.criadoEm < TTL_CONJUNTO_MS
  ) {
    // Mais recente no fim: é o que torna o cache LRU.
    cache.delete(sessionId);
    cache.set(sessionId, guardado);
    return guardado.conjunto;
  }

  // A promessa vai para o cache antes de resolver: as rotas que o painel
  // chama ao mesmo tempo esperam a mesma carga, em vez de repeti-la.
  const entrada: EntradaCache = { cnpj, assinatura, criadoEm: agora(), notas: 0, conjunto: null as any };
  entrada.conjunto = montarConjunto(cnpj, analises).then(
    conjunto => {
      entrada.notas = conjunto.documentos.length;
      if (cache.get(sessionId) === entrada) aparar(sessionId);
      return conjunto;
    },
    erro => {
      if (cache.get(sessionId) === entrada) cache.delete(sessionId);
      throw new ErroCargaEmpresa(erro);
    }
  );
  cache.delete(sessionId);
  cache.set(sessionId, entrada);
  aparar(sessionId);
  return entrada.conjunto;
}

// ==================== Origem dos documentos ====================

export interface OrigemDocumentos {
  /** Notas do lote da sessão ou do conjunto da empresa, sem filtros */
  documentos: NFeDocument[];
  /** Empresa que classificou as notas em entrada e saída */
  empresa: EmpresaAnalisada | null;
  /** Presente quando a empresa foi escolhida */
  conjunto?: ConjuntoEmpresa;
  /** Aviso para a tela (empresa sem análises) */
  aviso?: string;
}

/**
 * De onde as rotas de leitura tiram as notas: o lote da sessão ("Lote
 * atual") ou, com `?empresa=`, o conjunto da empresa. Lança
 * ErroEmpresaInvalida e ErroCargaEmpresa.
 */
export async function origemDosDocumentos(
  sessionId: string,
  query: Record<string, unknown> | undefined | null
): Promise<OrigemDocumentos> {
  const cnpj = lerEmpresa(query);

  if (!cnpj) {
    const sessao = sessionService.obterSessao(sessionId);
    return { documentos: sessao?.documentos ?? [], empresa: sessao?.empresa ?? null };
  }

  const conjunto = await carregarConjunto(sessionId, cnpj);
  return {
    documentos: conjunto.documentos,
    empresa: { cnpj, nome: conjunto.nome, inferida: false },
    conjunto,
    ...(conjunto.importacoes.length === 0 ? { aviso: AVISO_SEM_ANALISES } : {}),
  };
}

// ==================== Importações do cliente ====================

/** Mesma soma do "Total Tributos" do painel (services/dashboard.ts). */
function tributosDaNota(doc: NFeDocument): number {
  const v = doc.values;
  return v.icms + v.icmsST + v.ipi + v.iss + v.pis + v.cofins + v.irrf;
}

export interface LinhaImportacao {
  id: string;
  competencia: string;
  versao: number;
  criadoEm: string;
  criadoPor: string;
  nomeArquivo: string | null;
  notas: number;
  valorTotal: number;
  tributos: number;
}

export interface TabelaImportacoes {
  empresa: { cnpj: string; nome: string };
  importacoes: LinhaImportacao[];
  total: { notas: number; valorTotal: number; tributos: number };
  aviso?: string;
}

/**
 * Uma linha por importação incluída no conjunto, com notas (já sem as
 * repetidas), valor e tributos do recorte (Entrada/Saída, CFOP e NCM), e o
 * total geral.
 */
export function tabelaDeImportacoes(conjunto: ConjuntoEmpresa, filtros: FiltrosAnalise): TabelaImportacoes {
  const importacoes = conjunto.importacoes.map(({ analise, documentos }) => {
    const notas = filtrarDocumentos(documentos, filtros);
    return {
      id: analise.id,
      competencia: analise.competencia,
      versao: analise.versao,
      criadoEm: analise.criadoEm,
      criadoPor: analise.criadoPor,
      nomeArquivo: analise.nomeArquivo,
      notas: notas.length,
      valorTotal: notas.reduce((soma, d) => soma + d.values.total, 0),
      tributos: notas.reduce((soma, d) => soma + tributosDaNota(d), 0),
    };
  });

  const total = importacoes.reduce(
    (t, l) => ({ notas: t.notas + l.notas, valorTotal: t.valorTotal + l.valorTotal, tributos: t.tributos + l.tributos }),
    { notas: 0, valorTotal: 0, tributos: 0 }
  );

  return {
    empresa: { cnpj: conjunto.cnpj, nome: conjunto.nome },
    importacoes,
    total,
    ...(conjunto.importacoes.length === 0 ? { aviso: AVISO_SEM_ANALISES } : {}),
  };
}
