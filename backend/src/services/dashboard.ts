import {
  NFeDocument,
  DashboardData,
  ResumoGeral,
  CategoriaDados,
  RegimeDados,
  FornecedorDados,
} from '../types';

export class DashboardService {
  /**
   * Gera dados completos do dashboard baseado nos documentos
   */
  async generateDashboard(documentos: NFeDocument[]): Promise<DashboardData> {
    if (documentos.length === 0) {
      return this.emptyDashboard();
    }

    const resumoGeral = this.calcularResumoGeral(documentos);
    const porCategoria = this.calcularPorCategoria(documentos);
    const porRegime = await this.calcularPorRegime(documentos);
    const porFornecedor = this.calcularPorFornecedor(documentos);
    const divergencias = this.extrairDivergencias(documentos);

    return {
      resumoGeral,
      porCategoria,
      porRegime,
      porFornecedor,
      divergencias,
    };
  }

  /**
   * Calcula resumo geral
   */
  private calcularResumoGeral(documentos: NFeDocument[]): ResumoGeral {
    let totalValor = 0;
    let totalICMS = 0;
    let totalICMSST = 0;
    // Soma das parcelas retidas pelo tomador, em qualquer tributo.
    let totalRetidoTomador = 0;
    let totalIPI = 0;
    let totalISS = 0;
    let totalPIS = 0;
    let totalCOFINS = 0;
    let totalIRRF = 0;
    let documentosConformes = 0;

    for (const doc of documentos) {
      totalValor += doc.values.total;
      totalICMS += doc.values.icms;
      totalICMSST += doc.values.icmsST;

      const ret = doc.values.retido;
      if (ret) {
        totalRetidoTomador += ret.iss + ret.pis + ret.cofins + ret.irrf;
      }
      totalIPI += doc.values.ipi;
      totalISS += doc.values.iss;
      totalPIS += doc.values.pis;
      totalCOFINS += doc.values.cofins;
      totalIRRF += doc.values.irrf;

      const temDivergencias = doc.divergencias.length > 0;
      if (!temDivergencias) {
        documentosConformes++;
      }
    }

    // O total precisa somar tudo que está destacado na nota. Antes o IPI e o
    // ICMS-ST ficavam de fora, e por isso a aba Detalhado divergia do Painel.
    const totalTributos =
      totalICMS + totalICMSST + totalIPI + totalISS + totalPIS + totalCOFINS + totalIRRF;
    const percentualConformidade = (documentosConformes / documentos.length) * 100;

    return {
      totalDocumentos: documentos.length,
      totalValor,
      totalTributos,
      totalICMS,
      totalICMSST,
      totalIPI,
      totalISS,
      totalPIS,
      totalCOFINS,
      totalIRRF,
      totalRetidoTomador,
      // O que sobra é recolhido por quem emitiu a nota.
      totalDoPrestador: totalTributos - totalRetidoTomador,
      documentosConformes,
      documentosComDivergencias: documentos.length - documentosConformes,
      percentualConformidade,
    };
  }

  /**
   * Agrupa por categoria (modelo NF-e)
   */
  private calcularPorCategoria(documentos: NFeDocument[]): CategoriaDados[] {
    const categorias = new Map<string, CategoriaDados>();

    for (const doc of documentos) {
      const categoria =
        doc.modelo === 55
          ? 'NF-e Produto (55)'
          : 'NF-e Serviço (65)';

      if (!categorias.has(categoria)) {
        categorias.set(categoria, {
          categoria,
          quantidade: 0,
          valor: 0,
          tributos: 0,
          percentualTributos: 0,
        });
      }

      const cat = categorias.get(categoria)!;
      cat.quantidade++;
      cat.valor += doc.values.total;
      const tributos =
        doc.values.icms +
        doc.values.icmsST +
        doc.values.ipi +
        doc.values.iss +
        doc.values.pis +
        doc.values.cofins +
        doc.values.irrf;
      cat.tributos += tributos;
    }

    // Calcular percentual
    for (const cat of categorias.values()) {
      cat.percentualTributos = (cat.tributos / cat.valor) * 100;
    }

    return Array.from(categorias.values());
  }

  /**
   * Agrupa por regime tributário
   */
  private async calcularPorRegime(documentos: NFeDocument[]): Promise<RegimeDados[]> {
    const regimes = new Map<string, RegimeDados>();
    // CNPJs distintos por regime — 'quantidade' conta notas, não fornecedores,
    // e um mesmo fornecedor costuma emitir várias notas.
    const cnpjsPorRegime = new Map<string, Set<string>>();

    for (const doc of documentos) {
      const regime = doc.regimeTributario;

      if (!cnpjsPorRegime.has(regime)) {
        cnpjsPorRegime.set(regime, new Set());
      }
      if (doc.cnpjEmitente && doc.cnpjEmitente !== 'N/A') {
        cnpjsPorRegime.get(regime)!.add(doc.cnpjEmitente);
      }

      if (!regimes.has(regime)) {
        regimes.set(regime, {
          regime: regime as any,
          quantidade: 0,
          quantidadeFornecedores: 0,
          valor: 0,
          tributos: 0,
          distribuidorPorTributo: {
            icms: 0,
            icmsST: 0,
            ipi: 0,
            iss: 0,
            pis: 0,
            cofins: 0,
            irrf: 0,
          },
        });
      }

      const reg = regimes.get(regime)!;
      reg.quantidade++;
      reg.valor += doc.values.total;
      reg.tributos +=
        doc.values.icms +
        doc.values.icmsST +
        doc.values.ipi +
        doc.values.iss +
        doc.values.pis +
        doc.values.cofins +
        doc.values.irrf;
      reg.distribuidorPorTributo.icms += doc.values.icms;
      reg.distribuidorPorTributo.icmsST += doc.values.icmsST;
      reg.distribuidorPorTributo.ipi += doc.values.ipi;
      reg.distribuidorPorTributo.iss += doc.values.iss;
      reg.distribuidorPorTributo.pis += doc.values.pis;
      reg.distribuidorPorTributo.cofins += doc.values.cofins;
      reg.distribuidorPorTributo.irrf += doc.values.irrf;
    }

    for (const [regime, dados] of regimes.entries()) {
      dados.quantidadeFornecedores = cnpjsPorRegime.get(regime)?.size ?? 0;
    }

    // Maior valor primeiro, para o gráfico sair ordenado
    return Array.from(regimes.values()).sort((a, b) => b.valor - a.valor);
  }

  /**
   * Agrupa por fornecedor
   */
  private calcularPorFornecedor(documentos: NFeDocument[]): FornecedorDados[] {
    const fornecedores = new Map<string, FornecedorDados>();

    for (const doc of documentos) {
      const key = doc.cnpjEmitente;

      if (!fornecedores.has(key)) {
        fornecedores.set(key, {
          cnpj: doc.cnpjEmitente,
          nome: doc.nomeEmitente,
          regime: doc.regimeTributario,
          quantidade: 0,
          valor: 0,
          tributos: 0,
          conformidade: 0,
        });
      }

      const forn = fornecedores.get(key)!;
      forn.quantidade++;
      forn.valor += doc.values.total;
      forn.tributos +=
        doc.values.icms +
        doc.values.icmsST +
        doc.values.ipi +
        doc.values.iss +
        doc.values.pis +
        doc.values.cofins +
        doc.values.irrf;

      if (doc.divergencias.length === 0) {
        forn.conformidade++;
      }
    }

    // Calcular percentual de conformidade
    for (const forn of fornecedores.values()) {
      forn.conformidade = (forn.conformidade / forn.quantidade) * 100;
    }

    return Array.from(fornecedores.values())
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 20); // Top 20
  }

  /**
   * Extrai divergências encontradas
   */
  private extrairDivergencias(documentos: NFeDocument[]): any[] {
    const divergencias: any[] = [];

    for (const doc of documentos) {
      for (const div of doc.divergencias) {
        divergencias.push({
          ...div,
          documentoId: doc.id,
          cnpj: doc.cnpjEmitente,
          fornecedor: doc.nomeEmitente,
        });
      }
    }

    return divergencias.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
  }

  /**
   * Dashboard vazio
   */
  private emptyDashboard(): DashboardData {
    return {
      resumoGeral: {
        totalDocumentos: 0,
        totalValor: 0,
        totalTributos: 0,
        totalICMS: 0,
        totalICMSST: 0,
        totalIPI: 0,
        totalISS: 0,
        totalPIS: 0,
        totalCOFINS: 0,
        totalIRRF: 0,
        totalRetidoTomador: 0,
        totalDoPrestador: 0,
        documentosConformes: 0,
        documentosComDivergencias: 0,
        percentualConformidade: 0,
      },
      porCategoria: [],
      porRegime: [],
      porFornecedor: [],
      divergencias: [],
    };
  }
}

export const dashboardService = new DashboardService();
