import * as XLSX from 'xlsx';
import { NFeDocument, DashboardData, EmpresaAnalisada } from '../types';
import { rotuloSentido } from '../utils/sentidoImportacao';
import { rotuloModelo } from '../utils/modelos';
import { FiltrosAnalise } from '../utils/filtros';
import {
  ConferenciaReforma,
  DATA_DE_CORTE_EXIBIDA,
  ROTULO_PROBLEMA,
  TabelaReforma,
  conferirReforma,
  consolidadoPorCampo,
  diaDaNota,
  formatarDia,
  rotuloVersao,
  ehExigivel,
  resumoPorSentido,
  tabelaCarregada,
} from './conferenciaReforma';

/** Recorte e empresa da planilha, impressos no cabeçalho das abas da reforma. */
export interface ContextoExportacao {
  filtros?: FiltrosAnalise;
  empresa?: EmpresaAnalisada;
  /** Tabela de CST e cClassTrib; padrão, a carregada do arquivo */
  tabela?: TabelaReforma;
}

const ROTULO_SENTIDO_FILTRO: Record<string, string> = {
  entrada: 'Entradas',
  saida: 'Saídas',
  indefinido: 'Sem vínculo',
};

/** "12345678000190" vira "12.345.678/0001-90"; outros formatos ficam como estão. */
function formatarCNPJ(cnpj: string): string {
  const d = (cnpj ?? '').replace(/\D/g, '');
  return d.length === 14
    ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : cnpj;
}

/** Ordem das linhas no relatório: entradas, depois saídas, depois o resto. */
const ORDEM_SENTIDO: Record<string, number> = { entrada: 0, saida: 1, indefinido: 2 };

export class ExcelExportService {
  /**
   * Exporta dados completos em arquivo Excel
   */
  exportarDados(
    documentos: NFeDocument[],
    dashboard: DashboardData,
    /** false enquanto o contador não escolheu a empresa analisada */
    temEmpresa: boolean = true,
    contexto: ContextoExportacao = {}
  ): Buffer {
    const workbook = XLSX.utils.book_new();

    const tabela = contexto.tabela ?? tabelaCarregada();
    const conferidos = documentos.map(doc => ({
      doc,
      tipo: doc.tipo,
      conferencia: conferirReforma(doc, tabela),
    }));
    const cabecalho = this.cabecalhoReforma(contexto, tabela, temEmpresa);

    // Adicionar abas
    this.addResumoAba(workbook, dashboard);
    this.addPendenciasReformaAba(workbook, conferidos, cabecalho, temEmpresa);
    this.addConsolidadoAba(workbook, conferidos, cabecalho);
    this.addDocumentosAba(workbook, documentos, temEmpresa);
    this.addPorRegimeAba(workbook, dashboard.porRegime);
    this.addPorFornecedorAba(workbook, dashboard.porFornecedor);

    // Gerar buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
  }

  /** Linhas de identificação: empresa, filtros ativos e versão da tabela. */
  private cabecalhoReforma(
    contexto: ContextoExportacao,
    tabela: TabelaReforma,
    temEmpresa: boolean
  ): (string | number)[][] {
    const filtros = contexto.filtros ?? {};
    const empresa = contexto.empresa;
    return [
      [
        'Empresa analisada',
        temEmpresa && empresa ? `${empresa.nome} (${formatarCNPJ(empresa.cnpj)})` : 'Não identificada',
      ],
      ['Entrada/Saída', filtros.sentido ? ROTULO_SENTIDO_FILTRO[filtros.sentido] : 'Todas'],
      ['CFOP', filtros.cfop ?? 'Todos'],
      ['NCM', filtros.ncm ?? 'Todos'],
      ['Tabela de cClassTrib', rotuloVersao(tabela.versao)],
      ['Data de corte', `Notas emitidas a partir de ${DATA_DE_CORTE_EXIBIDA}`],
    ];
  }

  /**
   * Uma linha por nota exigível com pendência ou aviso, entradas antes das
   * saídas. Notas fora do período ou sem data não entram.
   */
  private addPendenciasReformaAba(
    workbook: XLSX.WorkBook,
    conferidos: Array<{ doc: NFeDocument; conferencia: ConferenciaReforma }>,
    cabecalho: (string | number)[][],
    temEmpresa: boolean
  ): void {
    const linhas = conferidos
      .filter(
        ({ conferencia: c }) =>
          ehExigivel(c.situacao) && (c.pendencias.length > 0 || c.avisos.length > 0)
      )
      .sort((a, b) => (ORDEM_SENTIDO[a.doc.tipo] ?? 9) - (ORDEM_SENTIDO[b.doc.tipo] ?? 9));

    const data: (string | number)[][] = [
      ['PENDÊNCIAS DE TRIBUTOS POR NOTA'],
      [],
      ...cabecalho,
      [],
      [
        'Sentido',
        'Tipo',
        'Número / chave',
        'Data de emissão',
        'Emitente',
        'CNPJ do emitente',
        'Destinatário / tomador',
        'Leiaute',
        'Código do serviço',
        'Situação',
        'Tipo de problema',
        'Resumo',
        'Pendências',
        'Avisos',
      ],
    ];

    for (const { doc, conferencia } of linhas) {
      data.push([
        rotuloSentido(doc.tipo, temEmpresa),
        rotuloModelo(doc.modelo),
        doc.chaveNFe,
        formatarDia(diaDaNota(doc)),
        doc.nomeEmitente,
        doc.cnpjEmitente,
        doc.nomeDestino,
        doc.leiaute ?? '',
        doc.codigoServico
          ? `${doc.codigoServico}${doc.tipoCodigoServico ? ` (${doc.tipoCodigoServico})` : ''}`
          : '',
        conferencia.situacao,
        conferencia.tipos.map(t => ROTULO_PROBLEMA[t]).join(', '),
        conferencia.resumo,
        conferencia.pendencias
          .map(p => {
            const texto = p.detalhe ? `${p.texto}: ${p.detalhe}` : p.texto;
            const tipos = [p.problema, ...(p.tambem ?? [])].map(t => ROTULO_PROBLEMA[t]);
            return `${texto} [${tipos.join(', ')}]`;
          })
          .join('; '),
        conferencia.avisos.join('; '),
      ]);
    }

    if (linhas.length === 0) {
      data.push(['Nenhuma nota exigível com pendência ou aviso neste recorte.']);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [
      { wch: 22 }, { wch: 12 }, { wch: 46 }, { wch: 14 }, { wch: 30 },
      { wch: 18 }, { wch: 30 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
      { wch: 80 }, { wch: 70 }, { wch: 60 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pendências de tributos');
  }

  /** Quantas notas têm cada problema, separado em entradas e saídas. */
  private addConsolidadoAba(
    workbook: XLSX.WorkBook,
    conferidos: Array<{ tipo: NFeDocument['tipo']; conferencia: ConferenciaReforma }>,
    cabecalho: (string | number)[][]
  ): void {
    const exigiveis = conferidos.filter(c => ehExigivel(c.conferencia.situacao));
    const resumo = resumoPorSentido(
      exigiveis.map(c => ({ tipo: c.tipo, situacao: c.conferencia.situacao }))
    );
    const consolidado = consolidadoPorCampo(exigiveis);
    const contar = (situacao: string) =>
      conferidos.filter(c => c.conferencia.situacao === situacao).length;

    const { entrada, saida, semVinculo, total } = resumo;
    const colunas = ['Entradas', 'Saídas', 'Sem vínculo', 'Total do recorte'];

    const data: (string | number)[][] = [
      ['CONSOLIDADO POR CAMPO'],
      [],
      ...cabecalho,
      [],
      ['', ...colunas],
      ['Notas exigíveis', entrada.total, saida.total, semVinculo.total, total.total],
      ['Notas completas', entrada.completas, saida.completas, semVinculo.completas, total.completas],
      [
        'Percentual de completas',
        ...[entrada, saida, semVinculo, total].map(r => `${r.percentual}%`),
      ],
      [`Fora do período (antes de ${DATA_DE_CORTE_EXIBIDA})`, '', '', '', contar('fora do período')],
      ['Sem data de emissão', '', '', '', contar('sem data')],
      [],
      ['Problema', ...colunas],
      ...consolidado.map(l => [l.problema, l.entradas, l.saidas, l.semVinculo, l.total]),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Consolidado por campo');
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
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 30 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Resumo');
  }

  /**
   * Adiciona aba de documentos detalhados
   */
  private addDocumentosAba(workbook: XLSX.WorkBook, documentos: NFeDocument[], temEmpresa: boolean): void {
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
      ],
    ];

    for (const doc of documentos) {
      data.push([
        doc.id.substring(0, 8),
        String(doc.modelo),
        rotuloSentido(doc.tipo, temEmpresa),
        doc.chaveNFe,
        formatarDia(diaDaNota(doc)),
        `${doc.nomeEmitente} (${doc.cnpjEmitente})`,
        doc.regimeTributario,
        doc.values.baseCalculo.toFixed(2),
        doc.values.icms.toFixed(2),
        doc.values.iss.toFixed(2),
        doc.values.pis.toFixed(2),
        doc.values.cofins.toFixed(2),
        doc.values.irrf.toFixed(2),
        doc.values.total.toFixed(2),
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = Array(15).fill({ wch: 15 });
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Documentos');
  }

  /**
   * Adiciona aba de divergências
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
      ['TOP FORNECEDORES'],
      [],
      ['Fornecedor', 'CNPJ', 'Regime', 'Quantidade', 'Valor Total', 'Tributos'],
    ];

    for (const forn of porFornecedor) {
      data.push([
        forn.nome,
        forn.cnpj,
        forn.regime.toUpperCase(),
        forn.quantidade,
        `R$ ${forn.valor.toFixed(2)}`,
        `R$ ${forn.tributos.toFixed(2)}`,
      ]);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    worksheet['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Fornecedores');
  }
}

export const excelExportService = new ExcelExportService();
