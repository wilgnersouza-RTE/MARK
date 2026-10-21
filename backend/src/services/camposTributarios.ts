import { CampoTributario, NFeModel, ParReforma } from '../types';

/**
 * Conferência de preenchimento dos campos tributários.
 *
 * Responde a uma pergunta diferente da apuração de valores: não é "o imposto
 * está certo", e sim "a nota traz os campos". Interessa durante a transição,
 * quando os grupos de IBS, CBS e Imposto Seletivo passam a ser exigidos por
 * cronograma e o contador precisa saber quais fornecedores já estão emitindo
 * preparados.
 *
 * Além de presente ou ausente, cada campo de tributo guarda a alíquota, a
 * base e o valor como constam na nota, sem conversão de escala, e os campos
 * de valor da reforma dizem se vieram zerados: zero não é ausência, mas
 * também não é preenchimento (ver conferenciaReforma.ts).
 */

/** Campos de valor da reforma em que zero vira pendência, pelo nome usado aqui. */
export const CAMPOS_DE_VALOR_REFORMA: readonly string[] = [
  'Base de cálculo IBS/CBS',
  'IBS estadual',
  'IBS municipal',
  'CBS',
];

/** Alíquota, base e valor de um tributo, como constam na nota. */
export interface Medida {
  aliquota?: number;
  base?: number;
  valor?: number;
}

/** Um valor conta como preenchido quando existe e não é vazio. */
function presente(valor: unknown): boolean {
  if (valor === undefined || valor === null) return false;
  const texto = String(valor).trim();
  return texto !== '' && texto.toLowerCase() !== 'null';
}

/**
 * Número de um texto do XML: "1234.56", "1.234,56" ou "1,234.56". Texto que
 * não é número devolve undefined, nunca zero, para não gerar zero falso.
 */
export function numeroOuNada(valor: unknown): number | undefined {
  if (!presente(valor)) return undefined;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : undefined;
  const texto = String(valor).trim();
  if (!/^[-+]?[\d.,]+$/.test(texto) || !/\d/.test(texto)) return undefined;
  // O último separador é o decimal; o outro, de milhar.
  const decimalVirgula = texto.lastIndexOf(',') > texto.lastIndexOf('.');
  const normalizado = decimalVirgula
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto.replace(/,/g, '');
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Tributo informado com zero: o valor é 0 ou, sem valor, a alíquota é 0.
 * A base só decide no próprio campo de base (`porBase`). Medida vazia não
 * é zero.
 */
export function ehZero(medida: Medida | undefined, porBase = false): boolean {
  if (!medida) return false;
  if (porBase) return medida.base === 0;
  if (medida.valor !== undefined) return medida.valor === 0;
  if (medida.aliquota !== undefined) return medida.aliquota === 0;
  return false;
}

const CAMPO_BASE_REFORMA = 'Base de cálculo IBS/CBS';

/** Número formatado para exibição, ou undefined quando não há valor. */
function numeroExibido(valor: unknown, sufixo = ''): string | undefined {
  if (!presente(valor)) return undefined;
  const n = Number(String(valor).replace(',', '.'));
  if (Number.isNaN(n)) return String(valor);
  return (
    n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + sufixo
  );
}

/** Texto de exibição de uma medida: o valor, ou a alíquota quando só ela veio. */
function exibirMedida(m: Medida | undefined): string | undefined {
  if (!m) return undefined;
  if (m.valor !== undefined) return numeroExibido(m.valor);
  if (m.aliquota !== undefined) {
    return `alíquota ${m.aliquota.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}`;
  }
  if (m.base !== undefined) return numeroExibido(m.base);
  return 'informado';
}

const ehCampoDeValorReforma = (grupo: CampoTributario['grupo'], campo: string) =>
  grupo === 'reforma' && CAMPOS_DE_VALOR_REFORMA.includes(campo);

/** Acrescenta ao campo os números da medida, sem chaves vazias. */
function comMedida(campo: CampoTributario, m: Medida | undefined): CampoTributario {
  if (!m || campo.situacao === 'ausente') return campo;
  if (m.aliquota !== undefined) campo.aliquota = m.aliquota;
  if (m.base !== undefined) campo.base = m.base;
  if (m.valor !== undefined) campo.valorNumerico = m.valor;
  if (ehCampoDeValorReforma(campo.grupo, campo.campo) && ehZero(m, campo.campo === CAMPO_BASE_REFORMA)) {
    campo.zerado = true;
  }
  return campo;
}

/**
 * Situação de um campo que vive no item, e não na nota.
 *
 * Em NF-e o grupo de IBS/CBS é declarado produto a produto. Uma nota com
 * cinco itens pode trazer o grupo em três: nem preenchida, nem ausente.
 */
function situacaoPorItem(com: number, total: number): CampoTributario['situacao'] {
  if (total === 0 || com === 0) return 'ausente';
  return com === total ? 'preenchido' : 'parcial';
}

/** Campo simples, existente no nível da nota. */
function campoDaNota(
  grupo: CampoTributario['grupo'],
  campo: string,
  valor: unknown,
  exibicao?: string,
  medida?: Medida
): CampoTributario {
  const ok = presente(valor);
  return comMedida(
    {
      grupo,
      campo,
      situacao: ok ? 'preenchido' : 'ausente',
      valor: ok ? (exibicao ?? String(valor)) : undefined,
    },
    medida
  );
}

/**
 * Campo da reforma lido como medida: presente só quando traz alíquota ou
 * valor. Grupo vazio no XML (<CBS/>) conta como ausente.
 */
function campoDeMedida(campo: string, m: Medida | undefined): CampoTributario {
  const informado = !!m && (m.aliquota !== undefined || m.valor !== undefined);
  return campoDaNota('reforma', campo, informado ? 'informado' : undefined, exibirMedida(m), m);
}

/**
 * Nomes dos campos de valor da reforma que vieram zerados, a partir dos
 * campos já conferidos de uma nota sem itens (NFS-e e CT-e).
 */
export function zeradosDosCampos(campos: CampoTributario[]): string[] | undefined {
  const nomes = campos
    .filter(c => c.zerado && c.situacao !== 'ausente' && ehCampoDeValorReforma(c.grupo, c.campo))
    .map(c => c.campo);
  return nomes.length > 0 ? nomes : undefined;
}

// ==================== NFS-e ====================

export function conferirCamposNFSe(dados: {
  baseCalculo: number;
  aliquota: number;
  /** Alíquota do ISS como consta na nota, quando declarada */
  aliquotaDeclarada?: number;
  iss: number;
  /** true quando o XML declara a tag do valor do ISS, mesmo com 0 */
  issDeclarado?: boolean;
  issRetido: boolean;
  pis: number;
  cofins: number;
  irrf: number;
  csll: number;
  inss: number;
  cst?: string;
  cClassTrib?: string;
  baseIBSCBS?: number;
  ibsEstadual?: Medida;
  ibsMunicipal?: Medida;
  cbs?: Medida;
  impostoSeletivo?: Medida;
}): CampoTributario[] {
  // Em nota de serviço, zero é resposta válida para retenção — significa que
  // não houve. O que se confere aqui é se o campo existe no XML, e por isso
  // a ausência é representada por undefined, não por zero.
  return [
    // A base do ISS sempre existe: declarada (inclusive 0) ou calculada.
    campoDaNota('atual', 'Base de cálculo', dados.baseCalculo, numeroExibido(dados.baseCalculo), {
      base: dados.baseCalculo,
    }),
    campoDaNota('atual', 'Alíquota do ISS', dados.aliquota || undefined, numeroExibido(dados.aliquota, '%')),
    campoDaNota('atual', 'Valor do ISS', dados.issDeclarado || dados.iss ? dados.iss : undefined, numeroExibido(dados.iss), {
      aliquota: dados.aliquotaDeclarada,
      base: dados.baseCalculo,
      valor: dados.iss,
    }),
    campoDaNota('atual', 'ISS retido', dados.issRetido ? 'sim' : 'não', dados.issRetido ? 'sim' : 'não'),
    campoDaNota('atual', 'PIS retido', dados.pis || undefined, numeroExibido(dados.pis), { valor: dados.pis }),
    campoDaNota('atual', 'COFINS retido', dados.cofins || undefined, numeroExibido(dados.cofins), { valor: dados.cofins }),
    campoDaNota('atual', 'IRRF retido', dados.irrf || undefined, numeroExibido(dados.irrf), { valor: dados.irrf }),
    campoDaNota('atual', 'CSLL retida', dados.csll || undefined, numeroExibido(dados.csll), { valor: dados.csll }),
    campoDaNota('atual', 'INSS retido', dados.inss || undefined, numeroExibido(dados.inss), { valor: dados.inss }),

    campoDaNota('reforma', 'CST', dados.cst),
    campoDaNota('reforma', 'cClassTrib', dados.cClassTrib),
    campoDaNota(
      'reforma',
      'Base de cálculo IBS/CBS',
      dados.baseIBSCBS,
      numeroExibido(dados.baseIBSCBS),
      dados.baseIBSCBS === undefined ? undefined : { base: dados.baseIBSCBS }
    ),
    campoDeMedida('IBS estadual', dados.ibsEstadual),
    campoDeMedida('IBS municipal', dados.ibsMunicipal),
    campoDeMedida('CBS', dados.cbs),
    campoDeMedida('Imposto Seletivo', dados.impostoSeletivo),
  ];
}

// ==================== NF-e e NFC-e ====================

/** Um item da nota, já normalizado pelo parser. */
export interface ItemConferido {
  cstICMS?: string;
  baseICMS?: unknown;
  aliquotaICMS?: unknown;
  valorICMS?: unknown;
  baseIPI?: unknown;
  aliquotaIPI?: unknown;
  valorIPI?: unknown;
  cstPIS?: string;
  basePIS?: unknown;
  aliquotaPIS?: unknown;
  valorPIS?: unknown;
  cstCOFINS?: string;
  baseCOFINS?: unknown;
  aliquotaCOFINS?: unknown;
  valorCOFINS?: unknown;
  /** Grupo da reforma, declarado por item */
  cstReforma?: string;
  cClassTrib?: string;
  baseIBSCBS?: unknown;
  /** Presença de cada grupo: o valor ou, na falta dele, a alíquota */
  ibsEstadual?: unknown;
  ibsMunicipal?: unknown;
  cbs?: unknown;
  impostoSeletivo?: unknown;
  /** Alíquota e valor de cada grupo, quando o parser os separa */
  aliquotaIBSUF?: unknown;
  valorIBSUF?: unknown;
  aliquotaIBSMun?: unknown;
  valorIBSMun?: unknown;
  aliquotaCBS?: unknown;
  valorCBS?: unknown;
  aliquotaIS?: unknown;
  valorIS?: unknown;
}

/**
 * Medida de um grupo da reforma no item. Sem alíquota e valor separados, o
 * próprio texto do campo vale como valor.
 */
function medidaDoGrupo(
  item: ItemConferido,
  presenca: unknown,
  aliquota: unknown,
  valor: unknown
): Medida | undefined {
  if (!presente(presenca) && !presente(aliquota) && !presente(valor)) return undefined;
  const a = numeroOuNada(aliquota);
  const v = numeroOuNada(valor) ?? (a === undefined ? numeroOuNada(presenca) : undefined);
  return { aliquota: a, base: numeroOuNada(item.baseIBSCBS), valor: v };
}

const medidaSimples = (aliquota: unknown, base: unknown, valor: unknown): Medida => ({
  aliquota: numeroOuNada(aliquota),
  base: numeroOuNada(base),
  valor: numeroOuNada(valor),
});

/** Medida de cada campo de tributo de um item, pelo nome do campo. */
const MEDIDAS_DO_ITEM: Record<string, (i: ItemConferido) => Medida | undefined> = {
  'Valor do ICMS': i => medidaSimples(i.aliquotaICMS, i.baseICMS, i.valorICMS),
  IPI: i => medidaSimples(i.aliquotaIPI, i.baseIPI, i.valorIPI),
  'Valor do PIS': i => medidaSimples(i.aliquotaPIS, i.basePIS, i.valorPIS),
  'Valor da COFINS': i => medidaSimples(i.aliquotaCOFINS, i.baseCOFINS, i.valorCOFINS),
  'Base de cálculo IBS/CBS': i =>
    presente(i.baseIBSCBS) ? { base: numeroOuNada(i.baseIBSCBS) } : undefined,
  'IBS estadual': i => medidaDoGrupo(i, i.ibsEstadual, i.aliquotaIBSUF, i.valorIBSUF),
  'IBS municipal': i => medidaDoGrupo(i, i.ibsMunicipal, i.aliquotaIBSMun, i.valorIBSMun),
  CBS: i => medidaDoGrupo(i, i.cbs, i.aliquotaCBS, i.valorCBS),
  'Imposto Seletivo': i => medidaDoGrupo(i, i.impostoSeletivo, i.aliquotaIS, i.valorIS),
};

/** Presença de cada campo de valor da reforma no item. */
const PRESENCA_REFORMA: Record<string, (i: ItemConferido) => unknown> = {
  'Base de cálculo IBS/CBS': i => i.baseIBSCBS,
  'IBS estadual': i => i.ibsEstadual,
  'IBS municipal': i => i.ibsMunicipal,
  CBS: i => i.cbs,
};

/** Campos de valor da reforma que o item traz com zero. */
export function zeradosDoItem(item: ItemConferido): string[] | undefined {
  const nomes = CAMPOS_DE_VALOR_REFORMA.filter(
    nome =>
      presente(PRESENCA_REFORMA[nome](item)) &&
      ehZero(MEDIDAS_DO_ITEM[nome](item), nome === CAMPO_BASE_REFORMA)
  );
  return nomes.length > 0 ? nomes : undefined;
}

/** Par CST x cClassTrib do item, com os campos que vieram zerados. */
export function parDoItem(item: ItemConferido): ParReforma {
  const par: ParReforma = { cst: item.cstReforma, cClassTrib: item.cClassTrib };
  const zerados = zeradosDoItem(item);
  if (zerados) par.zerados = zerados;
  return par;
}

const arredondar = (n: number) => Math.round(n * 100) / 100;

export function conferirCamposNFe(itens: ItemConferido[]): CampoTributario[] {
  const total = itens.length;

  const porItem = (
    grupo: CampoTributario['grupo'],
    campo: string,
    escolher: (i: ItemConferido) => unknown
  ): CampoTributario => {
    const comCampo = itens.filter(i => presente(escolher(i)));
    const com = comCampo.length;
    // Com o campo presente em todos os itens e valor igual, mostra o valor;
    // divergindo entre itens, mostrar um só enganaria.
    const valores = new Set(itens.map(i => String(escolher(i) ?? '')).filter(v => v !== ''));
    const resultado: CampoTributario = {
      grupo,
      campo,
      situacao: situacaoPorItem(com, total),
      valor: valores.size === 1 ? [...valores][0] : undefined,
      itens: { com, total },
    };

    const medir = MEDIDAS_DO_ITEM[campo];
    if (!medir || com === 0) return resultado;

    // Base e valor somam os itens; a alíquota só aparece se for a mesma em
    // todos os itens que trazem o campo.
    const medidas = comCampo.map(i => medir(i) ?? {});
    const aliquotas = new Set(medidas.map(m => m.aliquota));
    const aliquota = aliquotas.size === 1 ? [...aliquotas][0] : undefined;
    const bases = medidas.map(m => m.base).filter((n): n is number => n !== undefined);
    const somaValores = medidas.map(m => m.valor).filter((n): n is number => n !== undefined);
    if (aliquota !== undefined) resultado.aliquota = aliquota;
    if (bases.length > 0) resultado.base = arredondar(bases.reduce((a, b) => a + b, 0));
    if (somaValores.length > 0) {
      resultado.valorNumerico = arredondar(somaValores.reduce((a, b) => a + b, 0));
    }

    if (ehCampoDeValorReforma(grupo, campo)) {
      const zerados = medidas.filter(m => ehZero(m, campo === CAMPO_BASE_REFORMA)).length;
      resultado.itens = { com, total, zerados };
      if (zerados === com) resultado.zerado = true;
    }
    return resultado;
  };

  return [
    porItem('atual', 'CST do ICMS', i => i.cstICMS),
    porItem('atual', 'Base de cálculo do ICMS', i => i.baseICMS),
    porItem('atual', 'Alíquota do ICMS', i => i.aliquotaICMS),
    porItem('atual', 'Valor do ICMS', i => i.valorICMS),
    porItem('atual', 'IPI', i => i.valorIPI),
    porItem('atual', 'CST do PIS', i => i.cstPIS),
    porItem('atual', 'Valor do PIS', i => i.valorPIS),
    porItem('atual', 'CST da COFINS', i => i.cstCOFINS),
    porItem('atual', 'Valor da COFINS', i => i.valorCOFINS),

    porItem('reforma', 'CST', i => i.cstReforma),
    porItem('reforma', 'cClassTrib', i => i.cClassTrib),
    porItem('reforma', 'Base de cálculo IBS/CBS', i => i.baseIBSCBS),
    porItem('reforma', 'IBS estadual', i => i.ibsEstadual),
    porItem('reforma', 'IBS municipal', i => i.ibsMunicipal),
    porItem('reforma', 'CBS', i => i.cbs),
    porItem('reforma', 'Imposto Seletivo', i => i.impostoSeletivo),
  ];
}

/** Rótulo do documento, usado no cabeçalho da conferência. */
export function rotuloDoModelo(modelo: NFeModel): string {
  return modelo === 'NFSE' ? 'NFS-e' : `modelo ${modelo}`;
}

// ==================== CT-e ====================

/**
 * Conferência dos campos de um CT-e.
 *
 * O conhecimento de transporte não tem itens: os tributos são declarados uma
 * vez, no nível do documento. Também não traz PIS e COFINS destacados, então
 * cobrá-los aqui produziria uma lista de ausências sem significado — a lista
 * abaixo é a do que o leiaute do CT-e de fato prevê.
 */
export function conferirCamposCTe(dados: {
  cstICMS?: string;
  baseICMS?: unknown;
  aliquotaICMS?: unknown;
  valorICMS?: unknown;
  valorTotalServico?: unknown;
  valorAReceber?: unknown;
  totalTributos?: unknown;
  /** Só existe no CT-e OS, no bloco infTribFed */
  inss?: unknown;
  cstReforma?: string;
  cClassTrib?: string;
  baseIBSCBS?: unknown;
  ibsEstadual?: unknown;
  ibsMunicipal?: unknown;
  cbs?: unknown;
  impostoSeletivo?: unknown;
  /** Alíquotas dos grupos da reforma, como constam no XML */
  aliquotaIBSUF?: unknown;
  aliquotaIBSMun?: unknown;
  aliquotaCBS?: unknown;
  aliquotaIS?: unknown;
}): CampoTributario[] {
  const base = numeroOuNada(dados.baseIBSCBS);
  const medidaCTe = (valor: unknown, aliquota: unknown): Medida | undefined =>
    presente(valor) || presente(aliquota)
      ? { aliquota: numeroOuNada(aliquota), valor: numeroOuNada(valor) }
      : undefined;

  return [
    campoDaNota('atual', 'CST do ICMS', dados.cstICMS),
    campoDaNota('atual', 'Base de cálculo do ICMS', dados.baseICMS, numeroExibido(dados.baseICMS)),
    campoDaNota('atual', 'Alíquota do ICMS', dados.aliquotaICMS, numeroExibido(dados.aliquotaICMS, '%')),
    campoDaNota(
      'atual',
      'Valor do ICMS',
      dados.valorICMS,
      numeroExibido(dados.valorICMS),
      medidaSimples(dados.aliquotaICMS, dados.baseICMS, dados.valorICMS)
    ),
    campoDaNota('atual', 'Valor total do serviço', dados.valorTotalServico, numeroExibido(dados.valorTotalServico)),
    campoDaNota('atual', 'Valor a receber', dados.valorAReceber, numeroExibido(dados.valorAReceber)),
    campoDaNota('atual', 'Total de tributos', dados.totalTributos, numeroExibido(dados.totalTributos)),
    campoDaNota('atual', 'INSS', dados.inss, numeroExibido(dados.inss)),

    campoDaNota('reforma', 'CST', dados.cstReforma),
    campoDaNota('reforma', 'cClassTrib', dados.cClassTrib),
    campoDaNota('reforma', 'Base de cálculo IBS/CBS', dados.baseIBSCBS, numeroExibido(dados.baseIBSCBS), { base }),
    // Como na NF-e, o grupo conta como presente pelo valor ou pela alíquota.
    campoDeMedida('IBS estadual', medidaCTe(dados.ibsEstadual, dados.aliquotaIBSUF)),
    campoDeMedida('IBS municipal', medidaCTe(dados.ibsMunicipal, dados.aliquotaIBSMun)),
    campoDeMedida('CBS', medidaCTe(dados.cbs, dados.aliquotaCBS)),
    campoDeMedida('Imposto Seletivo', medidaCTe(dados.impostoSeletivo, dados.aliquotaIS)),
  ];
}
