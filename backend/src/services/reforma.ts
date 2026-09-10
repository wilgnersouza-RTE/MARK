import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { NFeDocument } from '../types';

export interface ParametrosSimulacao {
  /** Alíquota total do IVA (IBS + CBS) em % — referência, não fixada em lei */
  aliquotaIVA: number;
  /** Parcela do IVA correspondente à CBS em % */
  aliquotaCBS: number;
  /** Alíquota do Imposto Seletivo em % */
  aliquotaImpostoSeletivo: number;
  /** Regime do fornecedor, que define se há transferência de crédito */
  regimeFornecedor: string;
  /** Se o item está sujeito ao Imposto Seletivo (bebidas, fumo, etc.) */
  sujeitoImpostoSeletivo: boolean;
}

export const PARAMETROS_PADRAO: ParametrosSimulacao = {
  aliquotaIVA: 28.0,
  aliquotaCBS: 8.8,
  aliquotaImpostoSeletivo: 55.0,
  regimeFornecedor: 'regime-regular',
  sujeitoImpostoSeletivo: false,
};

interface RegraAno {
  ano: number;
  titulo: string;
  resumo: string;
  pisCofins: { vigente: boolean; fator: number };
  ipi: { vigente: boolean; fator: number; excecaoZFM?: boolean };
  icms: { vigente: boolean; fator: number };
  iss: { vigente: boolean; fator: number };
  cbs: { modo: string; aliquota?: number; fator?: number; reducaoPontosPercentuais?: number };
  ibs: {
    modo: string;
    aliquota?: number;
    fator?: number;
    proporcaoEstadual: number;
    proporcaoMunicipal: number;
  };
  impostoSeletivo: { vigente: boolean };
  compensavel: boolean;
}

interface TabelaTransicao {
  descricao: string;
  baseLegal: string;
  atencao: string;
  revisadoPor: string | null;
  revisadoEm: string | null;
  parametrosPadrao: any;
  anos: RegraAno[];
  regimesFornecedor: Array<{
    codigo: string;
    nome: string;
    geraCredito: boolean;
    observacao: string;
  }>;
}

/**
 * Simula a carga tributária de cada ano da transição da Reforma Tributária.
 *
 * Os FATORES de transição (redução de ICMS/ISS, avanço do IBS) vêm da
 * legislação e estão em data/reforma-transicao.json. Já as ALÍQUOTAS de
 * referência do IVA dependem de resolução do Senado e por isso são parâmetro
 * de entrada, não constante do sistema.
 */
export class ReformaService {
  private tabela: TabelaTransicao | null = null;
  private caminho: string;

  constructor() {
    const nome = 'reforma-transicao.json';
    const dir = fs.existsSync(path.join(config.dataDir, nome)) ? config.dataDir : process.cwd();
    this.caminho = path.join(dir, nome);
  }

  private carregar(): TabelaTransicao {
    if (this.tabela) return this.tabela;
    this.tabela = JSON.parse(fs.readFileSync(this.caminho, 'utf-8'));
    console.log(
      `✅ Tabela de transição carregada: ${this.tabela!.anos.length} anos (${this.tabela!.anos[0].ano}-${
        this.tabela!.anos[this.tabela!.anos.length - 1].ano
      })`
    );
    return this.tabela!;
  }

  obterMetadados() {
    const t = this.carregar();
    return {
      descricao: t.descricao,
      baseLegal: t.baseLegal,
      atencao: t.atencao,
      revisadoPor: t.revisadoPor,
      revisadoEm: t.revisadoEm,
      parametrosPadrao: t.parametrosPadrao,
      regimesFornecedor: t.regimesFornecedor,
      anosDisponiveis: t.anos.map(a => ({ ano: a.ano, titulo: a.titulo, resumo: a.resumo })),
    };
  }

  obterRegra(ano: number): RegraAno | null {
    return this.carregar().anos.find(a => a.ano === ano) || null;
  }

  /**
   * Alíquotas efetivas de IBS e CBS para um ano, dado o IVA de referência.
   *
   * Em 2026-2028 o IBS é uma alíquota fixa em lei (0,1%), não uma fração do
   * IVA — por isso os dois modos de cálculo.
   */
  private aliquotasEfetivas(regra: RegraAno, p: ParametrosSimulacao) {
    let cbs = 0;
    if (regra.cbs.modo === 'fixa') {
      cbs = regra.cbs.aliquota ?? 0;
    } else {
      cbs = p.aliquotaCBS * (regra.cbs.fator ?? 1) - (regra.cbs.reducaoPontosPercentuais ?? 0);
    }

    const ibsPleno = Math.max(0, p.aliquotaIVA - p.aliquotaCBS);
    let ibs = 0;
    if (regra.ibs.modo === 'fixa') {
      ibs = regra.ibs.aliquota ?? 0;
    } else {
      ibs = ibsPleno * (regra.ibs.fator ?? 0);
    }

    return {
      cbs: Math.max(0, cbs),
      ibs: Math.max(0, ibs),
      ibsEstadual: Math.max(0, ibs * regra.ibs.proporcaoEstadual),
      ibsMunicipal: Math.max(0, ibs * regra.ibs.proporcaoMunicipal),
      ibsPleno,
    };
  }

  /**
   * Simulação consolidada de um ano sobre o conjunto de documentos.
   */
  simularAno(documentos: NFeDocument[], ano: number, parametros: Partial<ParametrosSimulacao> = {}) {
    const p: ParametrosSimulacao = { ...PARAMETROS_PADRAO, ...parametros };
    const regra = this.obterRegra(ano);

    if (!regra) {
      throw new Error(`Ano ${ano} não consta na tabela de transição.`);
    }

    const aliq = this.aliquotasEfetivas(regra, p);
    const regime = this.carregar().regimesFornecedor.find(r => r.codigo === p.regimeFornecedor);

    // ---------- Situação atual (o que está destacado nas notas) ----------
    let baseTotal = 0;
    let precoTotal = 0;
    const atual = { icms: 0, icmsST: 0, ipi: 0, pis: 0, cofins: 0, iss: 0, irrf: 0 };

    for (const doc of documentos) {
      const v = doc.values;
      // Sem base de cálculo destacada, o total da nota é a melhor aproximação
      baseTotal += v.baseCalculo > 0 ? v.baseCalculo : v.total;
      precoTotal += v.total;

      atual.icms += v.icms;
      atual.icmsST += v.icmsST ?? 0;
      atual.ipi += v.ipi ?? 0;
      atual.pis += v.pis;
      atual.cofins += v.cofins;
      atual.iss += v.iss;
      atual.irrf += v.irrf;
    }

    const totalAtual =
      atual.icms + atual.icmsST + atual.ipi + atual.pis + atual.cofins + atual.iss + atual.irrf;

    // ---------- Situação no ano simulado ----------
    // Tributos antigos sobrevivem proporcionalmente ao fator do ano
    const futuro = {
      icms: atual.icms * regra.icms.fator,
      icmsST: atual.icmsST * regra.icms.fator,
      ipi: atual.ipi * regra.ipi.fator,
      pis: atual.pis * regra.pisCofins.fator,
      cofins: atual.cofins * regra.pisCofins.fator,
      iss: atual.iss * regra.iss.fator,
      irrf: atual.irrf, // IRRF não faz parte da reforma do consumo
      ibsEstadual: (baseTotal * aliq.ibsEstadual) / 100,
      ibsMunicipal: (baseTotal * aliq.ibsMunicipal) / 100,
      cbs: (baseTotal * aliq.cbs) / 100,
      impostoSeletivo:
        regra.impostoSeletivo.vigente && p.sujeitoImpostoSeletivo
          ? (baseTotal * p.aliquotaImpostoSeletivo) / 100
          : 0,
    };

    const ibsTotal = futuro.ibsEstadual + futuro.ibsMunicipal;
    const totalFuturo =
      futuro.icms +
      futuro.icmsST +
      futuro.ipi +
      futuro.pis +
      futuro.cofins +
      futuro.iss +
      futuro.irrf +
      ibsTotal +
      futuro.cbs +
      futuro.impostoSeletivo;

    // Crédito: fornecedor fora do regime regular não transfere IBS/CBS
    const creditoIBSCBS = regime?.geraCredito ? ibsTotal + futuro.cbs : 0;

    const diferenca = totalFuturo - totalAtual;
    const variacaoPercentual = totalAtual > 0 ? (diferenca / totalAtual) * 100 : 0;

    // Preço: retira a carga atual e aplica a nova sobre a mesma base
    const precoNovo = precoTotal - totalAtual + totalFuturo;

    return {
      ano,
      titulo: regra.titulo,
      resumo: regra.resumo,
      totalDocumentos: documentos.length,

      parametros: p,
      aliquotasEfetivas: {
        ibs: aliq.ibs,
        ibsEstadual: aliq.ibsEstadual,
        ibsMunicipal: aliq.ibsMunicipal,
        cbs: aliq.cbs,
        impostoSeletivo: regra.impostoSeletivo.vigente ? p.aliquotaImpostoSeletivo : 0,
        ivaPleno: p.aliquotaIVA,
      },
      fatoresDoAno: {
        icms: regra.icms.fator,
        iss: regra.iss.fator,
        ipi: regra.ipi.fator,
        pisCofins: regra.pisCofins.fator,
        ibs: regra.ibs.fator ?? null,
      },

      baseCalculo: baseTotal,
      precoAtual: precoTotal,
      precoNovo,

      totalAtual,
      totalFuturo,
      diferenca,
      variacaoPercentual,
      creditoIBSCBS,
      regimeFornecedor: regime || null,

      // Formato de linhas para a tabela comparativa da tela
      detalhamento: [
        { tributo: 'ICMS', atual: atual.icms, futuro: futuro.icms },
        { tributo: 'ICMS-ST', atual: atual.icmsST, futuro: futuro.icmsST },
        { tributo: 'IPI', atual: atual.ipi, futuro: futuro.ipi },
        { tributo: 'PIS', atual: atual.pis, futuro: futuro.pis },
        { tributo: 'COFINS', atual: atual.cofins, futuro: futuro.cofins },
        { tributo: 'ISS', atual: atual.iss, futuro: futuro.iss },
        { tributo: 'IBS Estadual', atual: 0, futuro: futuro.ibsEstadual },
        { tributo: 'IBS Municipal', atual: 0, futuro: futuro.ibsMunicipal },
        { tributo: 'CBS', atual: 0, futuro: futuro.cbs },
        { tributo: 'Imposto Seletivo', atual: 0, futuro: futuro.impostoSeletivo },
      ],

      /**
       * Tributos embutidos na cadeia (resíduo tributário) exigem a matriz
       * insumo-produto por CNAE, que o XML da NF-e não fornece. Declarado
       * como indisponível em vez de estimado, para não gerar número sem lastro.
       */
      tributosEmCadeia: {
        disponivel: false,
        motivo:
          'Cálculo de tributos em cadeia requer dados de CNAE e matriz insumo-produto, ausentes no XML da NF-e.',
      },
    };
  }

  /** Série completa de 2026 a 2033, para gráficos de evolução */
  simularSerie(documentos: NFeDocument[], parametros: Partial<ParametrosSimulacao> = {}) {
    const t = this.carregar();

    const serie = t.anos.map(a => {
      const s = this.simularAno(documentos, a.ano, parametros);
      return {
        ano: a.ano,
        titulo: a.titulo,
        icms: s.detalhamento.find(d => d.tributo === 'ICMS')!.futuro,
        icmsST: s.detalhamento.find(d => d.tributo === 'ICMS-ST')!.futuro,
        ipi: s.detalhamento.find(d => d.tributo === 'IPI')!.futuro,
        pis: s.detalhamento.find(d => d.tributo === 'PIS')!.futuro,
        cofins: s.detalhamento.find(d => d.tributo === 'COFINS')!.futuro,
        iss: s.detalhamento.find(d => d.tributo === 'ISS')!.futuro,
        ibs:
          s.detalhamento.find(d => d.tributo === 'IBS Estadual')!.futuro +
          s.detalhamento.find(d => d.tributo === 'IBS Municipal')!.futuro,
        cbs: s.detalhamento.find(d => d.tributo === 'CBS')!.futuro,
        impostoSeletivo: s.detalhamento.find(d => d.tributo === 'Imposto Seletivo')!.futuro,
        total: s.totalFuturo,
        precoNovo: s.precoNovo,
        variacaoPercentual: s.variacaoPercentual,
      };
    });

    return {
      serie,
      totalAtual: serie.length > 0 ? this.simularAno(documentos, 2026, parametros).totalAtual : 0,
      atencao: t.atencao,
    };
  }

  /**
   * Divergências recalculadas para um ano da transição.
   *
   * Compara o que a nota destacou hoje com o que seria devido sob as regras
   * daquele ano — é o que permite navegar entre 2027 e 2033 na tela.
   */
  divergenciasPorAno(
    documentos: NFeDocument[],
    ano: number,
    parametros: Partial<ParametrosSimulacao> = {}
  ) {
    const p: ParametrosSimulacao = { ...PARAMETROS_PADRAO, ...parametros };
    const regra = this.obterRegra(ano);
    if (!regra) throw new Error(`Ano ${ano} não consta na tabela de transição.`);

    const aliq = this.aliquotasEfetivas(regra, p);
    const divergencias: any[] = [];

    for (const doc of documentos) {
      const v = doc.values;
      const base = v.baseCalculo > 0 ? v.baseCalculo : v.total;

      const comparar = (tributo: string, atual: number, previsto: number) => {
        const diferenca = previsto - atual;
        if (Math.abs(diferenca) < 0.01) return;

        divergencias.push({
          tributo,
          ano,
          valorAtual: atual,
          valorPrevisto: previsto,
          diferenca,
          percentual: previsto !== 0 ? (diferenca / previsto) * 100 : -100,
          fornecedor: doc.nomeEmitente,
          cnpj: doc.cnpjEmitente,
          chaveNFe: doc.chaveNFe,
        });
      };

      comparar('ICMS', v.icms, v.icms * regra.icms.fator);
      comparar('ISS', v.iss, v.iss * regra.iss.fator);
      comparar('IPI', v.ipi ?? 0, (v.ipi ?? 0) * regra.ipi.fator);
      comparar('PIS', v.pis, v.pis * regra.pisCofins.fator);
      comparar('COFINS', v.cofins, v.cofins * regra.pisCofins.fator);
      comparar('IBS', 0, (base * aliq.ibs) / 100);
      comparar('CBS', 0, (base * aliq.cbs) / 100);
    }

    return {
      ano,
      titulo: regra.titulo,
      resumo: regra.resumo,
      total: divergencias.length,
      divergencias,
    };
  }
}

export const reformaService = new ReformaService();
