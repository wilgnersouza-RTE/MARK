import { CampoTributario, DocumentType, NFeDocument } from '../types';
import { rtcService } from './rtc';

/**
 * Conferência da reforma por nota (CAP-4 e CAP-5 da SPEC v1).
 *
 * Responde, para cada nota exigível, se os campos da reforma estão no XML e
 * se o cClassTrib combina com o CST do IBS/CBS. As regras estão em
 * `_bmad-output/specs/spec-validador-notas-v1/campos-reforma.md`:
 *
 * - só notas emitidas a partir de 01/01/2026 são conferidas;
 * - pendência é campo ausente (em NF-e e NFC-e, ausente em algum item),
 *   campo de valor informado com zero (salvo quando o CST está na tabela e
 *   não exige o grupo padrão, como imunidade e não incidência) ou cClassTrib
 *   cujos três primeiros dígitos diferem do CST;
 * - código fora da tabela carregada é aviso, nunca pendência, porque a
 *   tabela em `backend/data/cclasstrib.json` pode ser parcial;
 * - Imposto Seletivo ausente é só informativo na v1.
 *
 * Funções puras: a tabela entra por parâmetro, o resultado não é guardado.
 */

export type SituacaoReforma = 'completa' | 'com pendência' | 'fora do período' | 'sem data';

/**
 * Tipo de problema de uma pendência: campo ausente, informado com zero,
 * presente só em parte dos itens (NF-e e NFC-e) ou cClassTrib incompatível
 * com o CST.
 */
export type TipoProblema = 'ausente' | 'zerado' | 'parcial' | 'incompativel';

/** Ordem única dos tipos: selos, resumo, relatório e consolidado. */
export const ORDEM_PROBLEMAS: TipoProblema[] = ['ausente', 'parcial', 'zerado', 'incompativel'];

/** Rótulo de cada tipo, para selos e relatório. */
export const ROTULO_PROBLEMA: Record<TipoProblema, string> = {
  ausente: 'ausente',
  zerado: 'zerado',
  parcial: 'parcial',
  incompativel: 'incompatível',
};

export interface PendenciaReforma {
  /** Nome do campo, como o contador o conhece */
  campo: string;
  problema: TipoProblema;
  /** Texto exibido na tela e no relatório */
  texto: string;
  /** Códigos envolvidos, quando ajudam a localizar o problema */
  detalhe?: string;
  /** Em NF-e com zero em parte dos itens: "2 de 3 itens" */
  contagem?: string;
  /**
   * Outros tipos do mesmo campo, quando a pendência junta dois: campo em
   * parte dos itens e zerado em alguns deles vira uma pendência só.
   */
  tambem?: TipoProblema[];
}

export interface ConferenciaReforma {
  situacao: SituacaoReforma;
  pendencias: PendenciaReforma[];
  avisos: string[];
  informativos: string[];
  /** Tipos de problema presentes nas pendências, sem repetição */
  tipos: TipoProblema[];
  /** Situação da nota numa frase, para a tela e o relatório */
  resumo: string;
  /**
   * Campos (pelo nome de camposTributarios) que vieram com zero e em que
   * todo zero foi aceito: CST sem grupo padrão ou IBS municipal em 2026.
   */
  zerosAceitos: string[];
}

/** O que a conferência precisa saber da tabela de CST e cClassTrib. */
export interface TabelaReforma {
  versao: string;
  temCST(codigo: string): boolean;
  obterCClassTrib(codigo: string): { fimVigencia?: string } | null;
  /**
   * Se o CST exige o grupo padrão de IBS/CBS; null quando o CST não está na
   * tabela. Sem a função, todo CST conta como fora da tabela.
   */
  exigeGrupoPadrao?(codigo: string): boolean | null;
}

/** Data de corte da exigência dos campos da reforma. */
export const DATA_DE_CORTE = '2026-01-01';

/**
 * Primeiro dia em que o IBS municipal zerado volta a ser pendência. Em 2026
 * só há alíquota estadual de teste (LC 214/2025, art. 343), e o IBS
 * municipal informado com zero é o esperado. Ausente continua pendência.
 */
export const INICIO_IBS_MUNICIPAL = '2027-01-01';

export const TEXTO_INCOMPATIVEL = 'cClassTrib incompatível com o CST';
export const AVISO_SEM_DATA =
  'XML sem data de emissão válida: a nota não entra no percentual da reforma.';
export const INFORMATIVO_SELETIVO =
  'Imposto Seletivo: só exigido para itens sujeitos ao Seletivo';

/**
 * Os seis campos que decidem a completude, na ordem de `campos-reforma.md`.
 * `campo` é o nome usado em camposTributarios; `nome`, o exibido.
 */
const CAMPOS_EXIGIDOS: Array<{ campo: string; nome: string; deValor?: true; feminino?: true }> = [
  { campo: 'CST', nome: 'CST do IBS/CBS' },
  { campo: 'cClassTrib', nome: 'cClassTrib' },
  { campo: 'Base de cálculo IBS/CBS', nome: 'Base de cálculo do IBS/CBS', deValor: true, feminino: true },
  { campo: 'IBS estadual', nome: 'IBS estadual (UF)', deValor: true },
  { campo: 'IBS municipal', nome: 'IBS municipal', deValor: true },
  { campo: 'CBS', nome: 'CBS', deValor: true, feminino: true },
];

const NOMES_FEMININOS = new Set(CAMPOS_EXIGIDOS.filter(c => c.feminino).map(c => c.nome));

/** "CBS informada com valor zero", "IBS municipal informado com valor zero". */
function textoZerado(nome: string, feminino?: boolean): string {
  return `${nome} ${feminino ? 'informada' : 'informado'} com valor zero`;
}

const CAMPO_SELETIVO = 'Imposto Seletivo';

/** Versão exibida quando a tabela não pôde ser lida. */
export const VERSAO_INDISPONIVEL = 'indisponível';

/** "1.31" vira "v1.31"; a tabela indisponível fica por extenso. */
export function rotuloVersao(versao: string): string {
  return versao === VERSAO_INDISPONIVEL ? 'tabela indisponível' : `v${versao}`;
}

/** Tabela vazia: todo código vira aviso, nenhum vira pendência. */
const TABELA_VAZIA: TabelaReforma = {
  versao: VERSAO_INDISPONIVEL,
  temCST: () => false,
  obterCClassTrib: () => null,
  exigeGrupoPadrao: () => null,
};

/**
 * Tabela carregada de `backend/data/cclasstrib.json`. Arquivo ausente ou
 * ilegível não derruba a conferência: segue com a tabela vazia.
 */
export function tabelaCarregada(): TabelaReforma {
  try {
    return {
      versao: rtcService.obterMetadados().versaoTabela,
      temCST: codigo => rtcService.obterCSTPorCodigo(codigo) !== null,
      obterCClassTrib: codigo => rtcService.obterCClassTribPorCodigo(codigo),
      exigeGrupoPadrao: codigo => rtcService.obterCSTPorCodigo(codigo)?.exigeGrupoPadrao ?? null,
    };
  } catch (e: any) {
    console.error(`Tabela de cClassTrib indisponível: ${e?.message ?? e}`);
    return TABELA_VAZIA;
  }
}

/** AAAA-MM-DD do dia de corte para exibição: DD/MM/AAAA. */
export function formatarDia(dia: string | null | undefined): string {
  if (!dia) return '';
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** Data de corte por extenso, para cabeçalhos e textos. */
export const DATA_DE_CORTE_EXIBIDA = formatarDia(DATA_DE_CORTE);

/**
 * Dia local (AAAA-MM-DD) de uma data como vem no texto do XML.
 *
 * O dia vale no fuso do próprio emitente: para texto ISO são os dez
 * primeiros caracteres, sem converter fuso. Uma nota de Manaus emitida às
 * 23h30 de 31/12/2025 (-04:00) é de 31/12/2025, ainda que em UTC já seja
 * 2026. Aceita DD/MM/AAAA de leiautes municipais e planilhas. Data
 * impossível (mês 13, 31/02) devolve null.
 */
export function diaLocal(bruto: string | undefined | null): string | null {
  const texto = (bruto ?? '').trim();
  let partes: RegExpMatchArray | null;
  let ano: number, mes: number, dia: number;

  if ((partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
    [ano, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  } else if ((partes = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/))) {
    [ano, mes, dia] = [Number(partes[3]), Number(partes[2]), Number(partes[1])];
  } else {
    return null;
  }

  if (mes < 1 || mes > 12) return null;
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia < 1 || dia > diasNoMes) return null;

  const dois = (n: number) => String(n).padStart(2, '0');
  return `${ano}-${dois(mes)}-${dois(dia)}`;
}

/**
 * Dia de emissão da nota, ou null quando ela não tem data válida.
 * Documentos sem `diaEmissao` (anteriores a este campo) caem nos dez
 * primeiros caracteres de dataEmissao.
 */
export function diaDaNota(doc: NFeDocument): string | null {
  if (doc.semDataEmissao) return null;
  return doc.diaEmissao ?? diaLocal(doc.dataEmissao);
}

const presente = (v: string | undefined): v is string => !!v && v.trim() !== '';

function campoDe(campos: CampoTributario[], nome: string): CampoTributario | undefined {
  return campos.find(c => c.grupo === 'reforma' && c.campo === nome);
}

/** Pendência de campo ausente ou presente só em parte dos itens. */
function pendenciaDeAusencia(campo: CampoTributario | undefined, nome: string): PendenciaReforma | null {
  if (campo?.situacao === 'preenchido') return null;
  const itens = campo?.itens;
  if (campo?.situacao === 'parcial' && itens) {
    return { campo: nome, problema: 'parcial', texto: `${nome} (${itens.com} de ${itens.total} itens)` };
  }
  return { campo: nome, problema: 'ausente', texto: nome };
}

/** Lista em português: "a", "a e b", "a, b e c". */
function emLista(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** Tipos de uma pendência: o principal e os que ela junta. */
const tiposDa = (p: PendenciaReforma): TipoProblema[] => [p.problema, ...(p.tambem ?? [])];

/**
 * A nota numa frase, como o contador diria, na ordem de ORDEM_PROBLEMAS:
 * o que falta, o que está em parte dos itens, o que veio zerado e o que
 * não combina. Contagens por item e códigos incompatíveis são mantidos.
 */
function resumirPendencias(pendencias: PendenciaReforma[], avisos: string[]): string {
  if (pendencias.length === 0) {
    const base = 'Campos da reforma completos e cClassTrib compatível com o CST';
    return avisos.length > 0
      ? `${base}, com ${avisos.length} aviso${avisos.length === 1 ? '' : 's'} sobre a tabela.`
      : `${base}.`;
  }
  const doTipo = (tipo: TipoProblema) => pendencias.filter(p => p.problema === tipo);
  const partes: Record<TipoProblema, string | null> = {
    ausente: null,
    parcial: null,
    zerado: null,
    incompativel: null,
  };

  const ausentes = doTipo('ausente').map(p => p.campo);
  if (ausentes.length > 0) {
    partes.ausente = `${ausentes.length === 1 ? 'falta' : 'faltam'} ${emLista(ausentes)}`;
  }
  const parciais = doTipo('parcial').map(p => p.texto);
  if (parciais.length > 0) partes.parcial = `só em parte dos itens: ${emLista(parciais)}`;

  const zerados = doTipo('zerado');
  if (zerados.length === 1) {
    partes.zerado = zerados[0].texto;
  } else if (zerados.length > 1) {
    const femininos = zerados.every(p => NOMES_FEMININOS.has(p.campo));
    const nomes = zerados.map(p => (p.contagem ? `${p.campo} (${p.contagem})` : p.campo));
    partes.zerado = `${emLista(nomes)} ${femininos ? 'informadas' : 'informados'} com valor zero`;
  }
  const incompativel = doTipo('incompativel')[0];
  if (incompativel) {
    partes.incompativel = incompativel.detalhe
      ? `${incompativel.texto}: ${incompativel.detalhe}`
      : incompativel.texto;
  }

  const frase = ORDEM_PROBLEMAS.map(t => partes[t]).filter(Boolean).join('; ');
  const total = pendencias.length;
  return `${total} pendência${total === 1 ? '' : 's'}: ${frase}.`;
}

const RESUMO_FORA_DO_PERIODO = `Emitida antes de ${DATA_DE_CORTE_EXIBIDA}: fora do período de exigência, sem conferência.`;
const RESUMO_SEM_DATA = 'XML sem data de emissão válida: a nota não é conferida.';

export function conferirReforma(doc: NFeDocument, tabela: TabelaReforma): ConferenciaReforma {
  const dia = diaDaNota(doc);

  if (!dia) {
    return {
      situacao: 'sem data',
      pendencias: [],
      avisos: [AVISO_SEM_DATA],
      informativos: [],
      tipos: [],
      resumo: RESUMO_SEM_DATA,
      zerosAceitos: [],
    };
  }

  if (dia < DATA_DE_CORTE) {
    return {
      situacao: 'fora do período',
      pendencias: [],
      avisos: [],
      informativos: [],
      tipos: [],
      resumo: RESUMO_FORA_DO_PERIODO,
      zerosAceitos: [],
    };
  }

  const campos = doc.camposTributarios ?? [];
  const pendencias: PendenciaReforma[] = [];
  const avisos: string[] = [];
  const informativos: string[] = [];
  const zerosAceitos: string[] = [];

  const pares = doc.reformaItens ?? [];

  // Zero aceito: CST do item na tabela sem exigir o grupo padrão
  // (imunidade, não incidência...), ou IBS municipal antes de 2027. CST
  // ausente ou fora da tabela não livra o zero.
  const zeroAceito = (campo: string, cst: string | undefined) =>
    (campo === 'IBS municipal' && dia < INICIO_IBS_MUNICIPAL) ||
    (presente(cst) && tabela.exigeGrupoPadrao?.(cst.trim()) === false);

  for (const { campo, nome, deValor, feminino } of CAMPOS_EXIGIDOS) {
    const conferido = campoDe(campos, campo);
    const ausencia = pendenciaDeAusencia(conferido, nome);

    // Informado com zero, item a item. Conta sobre todos os itens da nota.
    let zerados = 0;
    if (deValor && conferido && conferido.situacao !== 'ausente') {
      const comZero = pares.filter(p => p.zerados?.includes(campo));
      zerados = comZero.filter(p => !zeroAceito(campo, p.cst)).length;
      if (comZero.length > 0 && zerados === 0) zerosAceitos.push(campo);
    }

    if (zerados === 0) {
      if (ausencia) pendencias.push(ausencia);
      continue;
    }

    const contagem = pares.length > 1 && zerados < pares.length ? `${zerados} de ${pares.length} itens` : undefined;
    if (ausencia?.problema === 'parcial') {
      // Uma pendência só para o campo, com as duas contagens.
      const itens = conferido!.itens!;
      pendencias.push({
        ...ausencia,
        texto: `${nome} (${itens.com} de ${itens.total} itens; ${feminino ? 'informada' : 'informado'} com valor zero em ${zerados})`,
        tambem: ['zerado'],
      });
      continue;
    }
    const texto = textoZerado(nome, feminino);
    pendencias.push({
      campo: nome,
      problema: 'zerado',
      texto: contagem ? `${texto} (${contagem})` : texto,
      ...(contagem ? { contagem } : {}),
    });
  }

  // Regra de vínculo, item a item: os três primeiros dígitos do cClassTrib
  // são o próprio CST. Só se compara quando os dois estão no item; a falta
  // de um deles já virou pendência acima.
  const incompativeis = pares.filter(
    p => presente(p.cst) && presente(p.cClassTrib) && p.cClassTrib.trim().slice(0, 3) !== p.cst.trim()
  );
  if (incompativeis.length > 0) {
    const combinacoes = Array.from(
      new Set(incompativeis.map(p => `${p.cClassTrib} com CST ${p.cst}`))
    );
    pendencias.push({
      campo: TEXTO_INCOMPATIVEL,
      problema: 'incompativel',
      texto:
        pares.length > 1
          ? `${TEXTO_INCOMPATIVEL} (${incompativeis.length} de ${pares.length} itens)`
          : TEXTO_INCOMPATIVEL,
      detalhe: combinacoes.join('; '),
    });
  }

  // Existência na tabela e vigência: só avisos, porque a tabela carregada
  // pode ser parcial. A vigência vale na data de emissão, não hoje.
  const versao = rotuloVersao(tabela.versao);
  for (const par of pares) {
    if (presente(par.cst) && !tabela.temCST(par.cst.trim())) {
      avisos.push(`CST ${par.cst.trim()} não consta na tabela carregada (${versao})`);
    }
    if (presente(par.cClassTrib)) {
      const codigo = par.cClassTrib.trim();
      const item = tabela.obterCClassTrib(codigo);
      if (!item) {
        avisos.push(`cClassTrib ${codigo} não consta na tabela carregada (${versao})`);
      } else if (item.fimVigencia) {
        const fim = diaLocal(item.fimVigencia);
        if (fim && fim < dia) {
          avisos.push(
            `cClassTrib ${codigo} fora de vigência na data de emissão (vigente até ${item.fimVigencia}, tabela ${versao})`
          );
        }
      }
    }
  }

  if (campoDe(campos, CAMPO_SELETIVO)?.situacao !== 'preenchido') {
    informativos.push(INFORMATIVO_SELETIVO);
  }

  const avisosUnicos = Array.from(new Set(avisos));
  return {
    situacao: pendencias.length > 0 ? 'com pendência' : 'completa',
    pendencias,
    avisos: avisosUnicos,
    informativos,
    tipos: ORDEM_PROBLEMAS.filter(t => pendencias.some(p => tiposDa(p).includes(t))),
    resumo: resumirPendencias(pendencias, avisosUnicos),
    zerosAceitos,
  };
}

/** Só completa e com pendência entram no percentual. */
export function ehExigivel(situacao: SituacaoReforma): boolean {
  return situacao === 'completa' || situacao === 'com pendência';
}

export interface ResumoSentido {
  /** Notas exigíveis (completas + com pendência) */
  total: number;
  completas: number;
  /** Percentual de completas entre as exigíveis, com uma casa decimal */
  percentual: number;
}

export interface ResumoPorSentido {
  entrada: ResumoSentido;
  saida: ResumoSentido;
  /** Notas exigíveis em que a empresa não é emitente nem destinatária */
  semVinculo: ResumoSentido;
  /** Todas as exigíveis do recorte, qualquer que seja o sentido */
  total: ResumoSentido;
}

function resumir(docs: Array<{ situacao: SituacaoReforma }>): ResumoSentido {
  const exigiveis = docs.filter(d => ehExigivel(d.situacao));
  const completas = exigiveis.filter(d => d.situacao === 'completa').length;
  const total = exigiveis.length;
  return {
    total,
    completas,
    percentual: total > 0 ? Math.round((completas / total) * 1000) / 10 : 0,
  };
}

export function resumoPorSentido(
  docs: Array<{ tipo: DocumentType; situacao: SituacaoReforma }>
): ResumoPorSentido {
  const doSentido = (tipo: DocumentType) => resumir(docs.filter(d => d.tipo === tipo));
  return {
    entrada: doSentido('entrada'),
    saida: doSentido('saida'),
    semVinculo: doSentido('indefinido'),
    total: resumir(docs),
  };
}

export interface LinhaConsolidado {
  /** Rótulo da linha: "CBS: zerado", ou o próprio problema na incompatibilidade */
  problema: string;
  /** Campo, como o contador o conhece */
  campo: string;
  tipo: TipoProblema;
  entradas: number;
  saidas: number;
  semVinculo: number;
  /** entradas + saídas + sem vínculo */
  total: number;
}

/** Tipos de problema possíveis em cada campo, na ordem de ORDEM_PROBLEMAS. */
function tiposDoCampo(campo: { deValor?: true }): TipoProblema[] {
  return campo.deValor ? ['ausente', 'parcial', 'zerado'] : ['ausente', 'parcial'];
}

/**
 * Quantas notas têm cada problema, uma linha por campo e tipo: ausente,
 * parcial (NF-e e NFC-e) e zerado contam separados. Uma pendência que junta
 * parcial e zerado conta nas duas linhas.
 */
export function consolidadoPorCampo(
  docs: Array<{ tipo: DocumentType; conferencia: ConferenciaReforma }>
): LinhaConsolidado[] {
  const linhas: Array<{ problema: string; campo: string; tipo: TipoProblema }> = [
    ...CAMPOS_EXIGIDOS.flatMap(c =>
      tiposDoCampo(c).map(tipo => ({ problema: `${c.nome}: ${ROTULO_PROBLEMA[tipo]}`, campo: c.nome, tipo }))
    ),
    { problema: TEXTO_INCOMPATIVEL, campo: TEXTO_INCOMPATIVEL, tipo: 'incompativel' },
  ];
  return linhas.map(({ problema, campo, tipo }) => {
    const com = docs.filter(d =>
      d.conferencia.pendencias.some(p => p.campo === campo && tiposDa(p).includes(tipo))
    );
    return {
      problema,
      campo,
      tipo,
      entradas: com.filter(d => d.tipo === 'entrada').length,
      saidas: com.filter(d => d.tipo === 'saida').length,
      semVinculo: com.filter(d => d.tipo === 'indefinido').length,
      total: com.length,
    };
  });
}
