import {
  NFeDocument,
  DashboardData,
  ResumoGeral,
  CategoriaDados,
  RegimeDados,
  FornecedorDados,
  TransicaoAnual,
} from '../types';
import { taxRulesService } from './taxRules';

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
    const transicaoAnual = await this.calcularTransicaoAnual(documentos);

    return {
      resumoGeral,
      porCategoria,
      porRegime,
      porFornecedor,
      divergencias,
      transicaoAnual,
    };
  }

  /**
   * Calcula resumo geral
   */
  private calcularResumoGeral(documentos: NFeDocument[]): ResumoGeral {
    let totalValor = 0;
    let totalICMS = 0;
    let totalISS = 0;
    let totalPIS = 0;
    let totalCOFINS = 0;
    let totalIRRF = 0;
    let documentosConformes = 0;

    for (const doc of documentos) {
      totalValor += doc.values.total;
      totalICMS += doc.values.icms;
      totalISS += doc.values.iss;
      totalPIS += doc.values.pis;
      totalCOFINS += doc.values.cofins;
      totalIRRF += doc.values.irrf;

      const temDivergencias = doc.divergencias.length > 0;
      if (!temDivergencias) {
        documentosConformes++;
      }
    }

    const totalTributos = totalICMS + totalISS + totalPIS + totalCOFINS + totalIRRF;
    const percentualConformidade = (documentosConformes / documentos.length) * 100;

    return {
      totalDocumentos: documentos.length,
      totalValor,
      totalTributos,
      totalICMS,
      totalISS,
      totalPIS,
      totalCOFINS,
      totalIRRF,
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
        doc.values.iss +
        doc.values.pis +
        doc.values.cofins +
        doc.values.irrf;
      reg.distribuidorPorTributo.icms += doc.values.icms;
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
   * Calcula transição anual (2024-2027)
   */
  private async calcularTransicaoAnual(documentos: NFeDocument[]): Promise<TransicaoAnual> {
    const anos = [2024, 2025, 2026, 2027];
    const tributos = {
      icms: Array(anos.length).fill(0),
      iss: Array(anos.length).fill(0),
      pis: Array(anos.length).fill(0),
      cofins: Array(anos.length).fill(0),
      irrf: Array(anos.length).fill(0),
    };

    const projecoes = {
      icms: Array(anos.length).fill(0),
      iss: Array(anos.length).fill(0),
      pis: Array(anos.length).fill(0),
      cofins: Array(anos.length).fill(0),
      irrf: Array(anos.length).fill(0),
    };

    // Agregar dados por ano
    for (const doc of documentos) {
      const anoIndex = anos.indexOf(new Date(doc.dataEmissao).getFullYear());

      if (anoIndex !== -1) {
        tributos.icms[anoIndex] += doc.values.icms;
        tributos.iss[anoIndex] += doc.values.iss;
        tributos.pis[anoIndex] += doc.values.pis;
        tributos.cofins[anoIndex] += doc.values.cofins;
        tributos.irrf[anoIndex] += doc.values.irrf;
      }
    }

    // Carregar projeções da reforma
    for (let i = 0; i < anos.length; i++) {
      const regras = await taxRulesService.getRegrasPorAno(anos[i]);

      if (regras) {
        const baseCalculoMedio = documentos.length > 0 ? documentos.reduce((acc, doc) => acc + doc.values.baseCalculo, 0) / documentos.length : 0;
        const lucroRealIcms = Number(regras.icms['lucro-real'] ?? regras.icms.LucroReal ?? 0);
        const lucroRealIss = Number(regras.iss['lucro-real'] ?? regras.iss.LucroReal ?? 0);
        const lucroRealPis = Number(regras.pis['lucro-real'] ?? regras.pis.LucroReal ?? 0);
        const lucroRealCofins = Number(regras.cofins['lucro-real'] ?? regras.cofins.LucroReal ?? 0);
        const lucroRealIrrf = Number(regras.irrf['lucro-real'] ?? regras.irrf.LucroReal ?? 0);

        projecoes.icms[i] = (baseCalculoMedio * lucroRealIcms) / 100;
        projecoes.iss[i] = lucroRealIss;
        projecoes.pis[i] = (baseCalculoMedio * lucroRealPis) / 100;
        projecoes.cofins[i] = (baseCalculoMedio * lucroRealCofins) / 100;
        projecoes.irrf[i] = lucroRealIrrf;
      }
    }

    return {
      anos,
      tributos,
      projecoes,
    };
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
        totalISS: 0,
        totalPIS: 0,
        totalCOFINS: 0,
        totalIRRF: 0,
        documentosConformes: 0,
        documentosComDivergencias: 0,
        percentualConformidade: 0,
      },
      porCategoria: [],
      porRegime: [],
      porFornecedor: [],
      divergencias: [],
      transicaoAnual: {
        anos: [2024, 2025, 2026, 2027],
        tributos: {
          icms: [0, 0, 0, 0],
          iss: [0, 0, 0, 0],
          pis: [0, 0, 0, 0],
          cofins: [0, 0, 0, 0],
          irrf: [0, 0, 0, 0],
        },
        projecoes: {
          icms: [0, 0, 0, 0],
          iss: [0, 0, 0, 0],
          pis: [0, 0, 0, 0],
          cofins: [0, 0, 0, 0],
          irrf: [0, 0, 0, 0],
        },
      },
    };
  }
}

export const dashboardService = new DashboardService();
