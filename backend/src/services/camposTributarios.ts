import { CampoTributario, NFeModel } from '../types';

/**
 * Conferência de preenchimento dos campos tributários.
 *
 * Responde a uma pergunta diferente da apuração de valores: não é "o imposto
 * está certo", e sim "a nota traz os campos". Interessa durante a transição,
 * quando os grupos de IBS, CBS e Imposto Seletivo passam a ser exigidos por
 * cronograma e o contador precisa saber quais fornecedores já estão emitindo
 * preparados.
 *
 * Campo ausente não é erro por si só, e a tela diz isso. O serviço aqui só
 * relata o que encontrou.
 */

/** Um valor conta como preenchido quando existe e não é vazio. */
function presente(valor: unknown): boolean {
  if (valor === undefined || valor === null) return false;
  const texto = String(valor).trim();
  return texto !== '' && texto.toLowerCase() !== 'null';
}

/** Número formatado para exibição, ou undefined quando não há valor. */
function numeroExibido(valor: unknown, sufixo = ''): string | undefined {
  if (!presente(valor)) return undefined;
  const n = Number(String(valor).replace(',', '.'));
  if (Number.isNaN(n)) return String(valor);
  return (
    n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + sufixo
  );
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
  exibicao?: string
): CampoTributario {
  const ok = presente(valor);
  return {
    grupo,
    campo,
    situacao: ok ? 'preenchido' : 'ausente',
    valor: ok ? (exibicao ?? String(valor)) : undefined,
  };
}

// ==================== NFS-e ====================

export function conferirCamposNFSe(dados: {
  baseCalculo: number;
  aliquota: number;
  iss: number;
  issRetido: boolean;
  pis: number;
  cofins: number;
  irrf: number;
  csll: number;
  inss: number;
  cst?: string;
  cClassTrib?: string;
  baseIBSCBS?: number;
  ibsEstadual?: number;
  ibsMunicipal?: number;
  cbs?: number;
  impostoSeletivo?: number;
}): CampoTributario[] {
  // Em nota de serviço, zero é resposta válida para retenção — significa que
  // não houve. O que se confere aqui é se o campo existe no XML, e por isso
  // a ausência é representada por undefined, não por zero.
  const opcional = (v: number | undefined) => (v === undefined ? undefined : v);

  return [
    campoDaNota('atual', 'Base de cálculo', dados.baseCalculo || undefined, numeroExibido(dados.baseCalculo)),
    campoDaNota('atual', 'Alíquota do ISS', dados.aliquota || undefined, numeroExibido(dados.aliquota, '%')),
    campoDaNota('atual', 'Valor do ISS', dados.iss || undefined, numeroExibido(dados.iss)),
    campoDaNota('atual', 'ISS retido', dados.issRetido ? 'sim' : 'não', dados.issRetido ? 'sim' : 'não'),
    campoDaNota('atual', 'PIS retido', dados.pis || undefined, numeroExibido(dados.pis)),
    campoDaNota('atual', 'COFINS retido', dados.cofins || undefined, numeroExibido(dados.cofins)),
    campoDaNota('atual', 'IRRF retido', dados.irrf || undefined, numeroExibido(dados.irrf)),
    campoDaNota('atual', 'CSLL retida', dados.csll || undefined, numeroExibido(dados.csll)),
    campoDaNota('atual', 'INSS retido', dados.inss || undefined, numeroExibido(dados.inss)),

    campoDaNota('reforma', 'CST', dados.cst),
    campoDaNota('reforma', 'cClassTrib', dados.cClassTrib),
    campoDaNota('reforma', 'Base de cálculo IBS/CBS', opcional(dados.baseIBSCBS), numeroExibido(dados.baseIBSCBS)),
    campoDaNota('reforma', 'IBS estadual', opcional(dados.ibsEstadual), numeroExibido(dados.ibsEstadual)),
    campoDaNota('reforma', 'IBS municipal', opcional(dados.ibsMunicipal), numeroExibido(dados.ibsMunicipal)),
    campoDaNota('reforma', 'CBS', opcional(dados.cbs), numeroExibido(dados.cbs)),
    campoDaNota('reforma', 'Imposto Seletivo', opcional(dados.impostoSeletivo), numeroExibido(dados.impostoSeletivo)),
  ];
}

// ==================== NF-e e NFC-e ====================

/** Um item da nota, já normalizado pelo parser. */
export interface ItemConferido {
  cstICMS?: string;
  baseICMS?: unknown;
  aliquotaICMS?: unknown;
  valorICMS?: unknown;
  valorIPI?: unknown;
  cstPIS?: string;
  valorPIS?: unknown;
  cstCOFINS?: string;
  valorCOFINS?: unknown;
  /** Grupo da reforma, declarado por item */
  cstReforma?: string;
  cClassTrib?: string;
  baseIBSCBS?: unknown;
  ibsEstadual?: unknown;
  ibsMunicipal?: unknown;
  cbs?: unknown;
  impostoSeletivo?: unknown;
}

export function conferirCamposNFe(itens: ItemConferido[]): CampoTributario[] {
  const total = itens.length;

  const contar = (escolher: (i: ItemConferido) => unknown) =>
    itens.filter(i => presente(escolher(i))).length;

  const porItem = (
    grupo: CampoTributario['grupo'],
    campo: string,
    escolher: (i: ItemConferido) => unknown
  ): CampoTributario => {
    const com = contar(escolher);
    // Com o campo presente em todos os itens e valor igual, mostra o valor;
    // divergindo entre itens, mostrar um só enganaria.
    const valores = new Set(itens.map(i => String(escolher(i) ?? '')).filter(v => v !== ''));
    return {
      grupo,
      campo,
      situacao: situacaoPorItem(com, total),
      valor: valores.size === 1 ? [...valores][0] : undefined,
      itens: { com, total },
    };
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

/** Quantos campos estão preenchidos, para o resumo da linha da nota. */
export function resumoDoPreenchimento(campos: CampoTributario[]): {
  preenchidos: number;
  total: number;
} {
  return {
    preenchidos: campos.filter(c => c.situacao === 'preenchido').length,
    total: campos.length,
  };
}

/** Rótulo do documento, usado no cabeçalho da conferência. */
export function rotuloDoModelo(modelo: NFeModel): string {
  return modelo === 'NFSE' ? 'NFS-e' : `modelo ${modelo}`;
}
