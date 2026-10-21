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
 * - pendência é campo ausente (em NF-e e NFC-e, ausente em algum item) ou
 *   cClassTrib cujos três primeiros dígitos diferem do CST;
 * - código fora da tabela carregada é aviso, nunca pendência, porque a
 *   tabela em `backend/data/cclasstrib.json` pode ser parcial;
 * - Imposto Seletivo ausente é só informativo na v1.
 *
 * Funções puras: a tabela entra por parâmetro, o resultado não é guardado.
 */

export type SituacaoReforma = 'completa' | 'com pendência' | 'fora do período' | 'sem data';

export interface PendenciaReforma {
  /** Nome do campo, como o contador o conhece */
  campo: string;
  problema: 'ausente' | 'incompativel';
  /** Texto exibido na tela e no relatório */
  texto: string;
  /** Códigos envolvidos, quando ajudam a localizar o problema */
  detalhe?: string;
}

export interface ConferenciaReforma {
  situacao: SituacaoReforma;
  pendencias: PendenciaReforma[];
  avisos: string[];
  informativos: string[];
}

/** O que a conferência precisa saber da tabela de CST e cClassTrib. */
export interface TabelaReforma {
  versao: string;
  temCST(codigo: string): boolean;
  obterCClassTrib(codigo: string): { fimVigencia?: string } | null;
}

/** Data de corte da exigência dos campos da reforma. */
export const DATA_DE_CORTE = '2026-01-01';

export const TEXTO_INCOMPATIVEL = 'cClassTrib incompatível com o CST';
export const AVISO_SEM_DATA =
  'XML sem data de emissão válida: a nota não entra no percentual da reforma.';
export const INFORMATIVO_SELETIVO =
  'Imposto Seletivo: só exigido para itens sujeitos ao Seletivo';

/**
 * Os seis campos que decidem a completude, na ordem de `campos-reforma.md`.
 * `campo` é o nome usado em camposTributarios; `nome`, o exibido.
 */
const CAMPOS_EXIGIDOS: Array<{ campo: string; nome: string }> = [
  { campo: 'CST', nome: 'CST do IBS/CBS' },
  { campo: 'cClassTrib', nome: 'cClassTrib' },
  { campo: 'Base de cálculo IBS/CBS', nome: 'Base de cálculo do IBS/CBS' },
  { campo: 'IBS estadual', nome: 'IBS estadual (UF)' },
  { campo: 'IBS municipal', nome: 'IBS municipal' },
  { campo: 'CBS', nome: 'CBS' },
];

const CAMPO_SELETIVO = 'Imposto Seletivo';

/** Nomes dos problemas possíveis, na ordem do consolidado. */
export const PROBLEMAS_POSSIVEIS: string[] = [
  ...CAMPOS_EXIGIDOS.map(c => c.nome),
  TEXTO_INCOMPATIVEL,
];

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
  const texto =
    campo?.situacao === 'parcial' && itens
      ? `${nome} (${itens.com} de ${itens.total} itens)`
      : nome;
  return { campo: nome, problema: 'ausente', texto };
}

export function conferirReforma(doc: NFeDocument, tabela: TabelaReforma): ConferenciaReforma {
  const dia = diaDaNota(doc);

  if (!dia) {
    return {
      situacao: 'sem data',
      pendencias: [],
      avisos: [AVISO_SEM_DATA],
      informativos: [],
    };
  }

  if (dia < DATA_DE_CORTE) {
    return { situacao: 'fora do período', pendencias: [], avisos: [], informativos: [] };
  }

  const campos = doc.camposTributarios ?? [];
  const pendencias: PendenciaReforma[] = [];
  const avisos: string[] = [];
  const informativos: string[] = [];

  for (const { campo, nome } of CAMPOS_EXIGIDOS) {
    const pendencia = pendenciaDeAusencia(campoDe(campos, campo), nome);
    if (pendencia) pendencias.push(pendencia);
  }

  // Regra de vínculo, item a item: os três primeiros dígitos do cClassTrib
  // são o próprio CST. Só se compara quando os dois estão no item; a falta
  // de um deles já virou pendência acima.
  const pares = doc.reformaItens ?? [];
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

  return {
    situacao: pendencias.length > 0 ? 'com pendência' : 'completa',
    pendencias,
    avisos: Array.from(new Set(avisos)),
    informativos,
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
  problema: string;
  entradas: number;
  saidas: number;
  semVinculo: number;
  /** entradas + saídas + sem vínculo */
  total: number;
}

/**
 * Quantas notas têm cada problema. Campo presente só em parte dos itens
 * conta como ausente daquele campo.
 */
export function consolidadoPorCampo(
  docs: Array<{ tipo: DocumentType; conferencia: ConferenciaReforma }>
): LinhaConsolidado[] {
  return PROBLEMAS_POSSIVEIS.map(problema => {
    const com = docs.filter(d => d.conferencia.pendencias.some(p => p.campo === problema));
    return {
      problema,
      entradas: com.filter(d => d.tipo === 'entrada').length,
      saidas: com.filter(d => d.tipo === 'saida').length,
      semVinculo: com.filter(d => d.tipo === 'indefinido').length,
      total: com.length,
    };
  });
}
