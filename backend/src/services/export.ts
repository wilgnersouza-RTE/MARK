import * as XLSX from 'xlsx';
import { NFeDocument, DashboardData } from '../types';

export class ExcelExportService {
  /**
   * Exporta dados completos em arquivo Excel
   */
  exportarDados(
    documentos: NFeDocument[],
    dashboard: DashboardData,
    nomeArquivo: string = 'nfe-validator-export.xlsx'
  ): Buffer {
    const workbook = XLSX.utils.book_new();

    // Adicionar abas
    this.addResumoAba(workbook, dashboard);
    this.addDocumentosAba(workbook, documentos);
    this.addDivergenciasAba(workbook, dashboard.divergencias);
    this.addPorRegimeAba(workbook, dashboard.porRegime);
    this.addPorFornecedorAba(workbook, dashboard.porFornecedor);
    this.addTransicaoAba(workbook, dashboard.transicaoAnual);

    // Gerar buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
  }

  /**
   * Adiciona aba de resumo
   */
  private addResumoAba(workbook: XLSX.WorkBook, dashboard: DashboardData): void {
    const { resumoGeral } = dashboard;

    const data = [
      ['RESUMO GERAL - NFe Validator'],
      [],
      ['Total de Documentos', resumoGeral.totalDocumentos],
      ['Valor Total', `R$ ${resumoGeral.totalValor.toFixed(2)}`],
      ['Total de Tributos', `R$ ${resumoGeral.totalTributos.toFixed(2)}`],
      ['Percentual de Tributos', `${(resumoGeral.totalTributos / resumoGeral.totalValor * 100).toFixed(2)}%`],
      [],
      ['DISTRIBUIÇÃO DE TRIBUTOS'],
      ['ICMS', `R$ ${resumoGeral.totalICMS.toFixed(2)}`],
      ['ISS', `R$ ${resumoGeral.totalISS.toFixed(2)}`],
      ['PIS', `R$ ${resumoGeral.totalPIS.toFixed(2)}`],
      ['COFINS', `R$ ${resumoGeral.totalCOFINS.toFixed(2)}`],
      ['IRRF', `R$ ${resumoGeral.totalIRRF.toFixed(2)}`],
      [],
      ['CONFORMIDADE'],
      ['Documentos Conformes', resumoGeral.documentosConformes],
      ['Documentos com Divergências', resumoGeral.documentosComDivergencias],
      ['Percentual de Conformidade', `${resumoGeral.percentualConformidade.toFixed(2)}%`],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 30 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Resumo');
  }

  /**
   * Adiciona aba de documentos detalhados
   */
  private addDocumentosAba(workbook: XLSX.WorkBook, documentos: NFeDocument[]): void {
    const data = [
      [
        'ID',
        'Modelo',
        'Tipo',
        'Chave NF-e',
        'Data Emissão',
        'Fornecedor (CNPJ)',
        'Regime Tributário',
        'Base de Cálculo',
        'ICMS',
        'ISS',
        'PIS',
        'COFINS',
        'IRRF',
        'Valor Total',
        'Conforme?',
      ],
    ];

    for (const doc of documentos) {
      const conforme = doc.divergencias.length === 0 ? 'Sim' : 'Não';
      data.push([
        doc.id.substring(0, 8),
        String(doc.modelo),
        String(doc.tipo),
        doc.chaveNFe,
        new Date(doc.dataEmissao).toLocaleDateString('pt-BR'),
        `${doc.nomeEmitente} (${doc.cnpjEmitente})`,
        doc.regimeTributario,
        doc.values.baseCalculo.toFixed(2),
        doc.values.icms.toFixed(2),
        doc.values.iss.toFixed(2),
        doc.values.pis.toFixed(2),
        doc.values.cofins.toFixed(2),
        doc.values.irrf.toFixed(2),
        doc.values.total.toFixed(2),
        conforme,
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = Array(15).fill({ wch: 15 });
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Documentos');
  }

  /**
   * Adiciona aba de divergências
   */
  private addDivergenciasAba(workbook: XLSX.WorkBook, divergencias: any[]): void {
    const data = [
      ['DIVERGÊNCIAS ENCONTRADAS'],
      [],
      ['Tributo', 'Ano', 'Valor Atual', 'Valor Previsto', 'Diferença', 'Percentual', 'Fornecedor', 'CNPJ'],
    ];

    for (const div of divergencias) {
      data.push([
        div.tributo,
        div.ano,
        `R$ ${div.valorAtual.toFixed(2)}`,
        `R$ ${div.valorPrevisto.toFixed(2)}`,
        `R$ ${div.diferenca.toFixed(2)}`,
        `${div.percentual.toFixed(2)}%`,
        div.fornecedor,
        div.cnpj,
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [
      { wch: 12 },
      { wch: 8 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 12 },
      { wch: 25 },
      { wch: 15 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Divergências');
  }

  /**
   * Adiciona aba de análise por regime
   */
  private addPorRegimeAba(workbook: XLSX.WorkBook, porRegime: any[]): void {
    const data = [
      ['ANÁLISE POR REGIME TRIBUTÁRIO'],
      [],
      [
        'Regime',
        'Quantidade',
        'Valor Total',
        'Total Tributos',
        'ICMS',
        'ISS',
        'PIS',
        'COFINS',
        'IRRF',
        '% Tributos',
      ],
    ];

    for (const regime of porRegime) {
      data.push([
        regime.regime.toUpperCase(),
        regime.quantidade,
        `R$ ${regime.valor.toFixed(2)}`,
        `R$ ${regime.tributos.toFixed(2)}`,
        `R$ ${regime.distribuidorPorTributo.icms.toFixed(2)}`,
        `R$ ${regime.distribuidorPorTributo.iss.toFixed(2)}`,
        `R$ ${regime.distribuidorPorTributo.pis.toFixed(2)}`,
        `R$ ${regime.distribuidorPorTributo.cofins.toFixed(2)}`,
        `R$ ${regime.distribuidorPorTributo.irrf.toFixed(2)}`,
        `${(regime.tributos / regime.valor * 100).toFixed(2)}%`,
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = Array(10).fill({ wch: 15 });
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Por Regime');
  }

  /**
   * Adiciona aba de fornecedores
   */
  private addPorFornecedorAba(workbook: XLSX.WorkBook, porFornecedor: any[]): void {
    const data = [
      ['TOP FORNECEDORES - ANÁLISE DE CONFORMIDADE'],
      [],
      ['Fornecedor', 'CNPJ', 'Regime', 'Quantidade', 'Valor Total', 'Tributos', 'Conformidade'],
    ];

    for (const forn of porFornecedor) {
      data.push([
        forn.nome,
        forn.cnpj,
        forn.regime.toUpperCase(),
        forn.quantidade,
        `R$ ${forn.valor.toFixed(2)}`,
        `R$ ${forn.tributos.toFixed(2)}`,
        `${forn.conformidade.toFixed(2)}%`,
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Fornecedores');
  }

  /**
   * Adiciona aba de transição anual
   */
  private addTransicaoAba(workbook: XLSX.WorkBook, transicaoAnual: any): void {
    const data = [
      ['TRANSIÇÃO TRIBUTÁRIA 2024-2027'],
      [],
      ['Tributo', '2024', '2025', '2026', '2027', 'Variação'],
    ];

    const tributos = ['icms', 'iss', 'pis', 'cofins', 'irrf'];

    for (const tributo of tributos) {
      const valores = transicaoAnual.tributos[tributo];
      const projecoes = transicaoAnual.projecoes[tributo];
      const variacao = projecoes[3] - valores[0]; // 2027 - 2024

      data.push([
        tributo.toUpperCase(),
        `R$ ${valores[0].toFixed(2)}`,
        `R$ ${valores[1].toFixed(2)}`,
        `R$ ${valores[2].toFixed(2)}`,
        `R$ ${valores[3].toFixed(2)}`,
        `R$ ${variacao.toFixed(2)}`,
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transição 2024-2027');
  }
}

export const excelExportService = new ExcelExportService();
