import { parseStringPromise } from 'xml2js';
import { NFeDocument, NFeModel, DocumentType, RegimeTributario, Validacao, Divergencia } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { taxRulesService } from './taxRules';

export class NFEParserService {
  /**
   * O xml2js pode devolver um nó como objeto ou como array de objetos,
   * dependendo de repetição no XML. Estes três helpers normalizam o acesso —
   * sem eles, ora se lê `x` ora `x[0]`, que era a origem dos valores zerados.
   */
  private no(valor: any): any {
    return Array.isArray(valor) ? valor[0] : valor;
  }

  private texto(valor: any): string {
    const bruto = this.no(valor);
    if (bruto === null || bruto === undefined) return '';
    if (typeof bruto === 'object') return String(bruto._ ?? '');
    return String(bruto).trim();
  }

  private numero(valor: any): number {
    const texto = this.texto(valor);
    if (!texto) return 0;
    // Aceita "1.234,56" (formato brasileiro) e "1234.56" (padrão do XML)
    const normalizado = texto.includes(',')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto;
    const numero = parseFloat(normalizado);
    return Number.isFinite(numero) ? numero : 0;
  }

  private getAliquotaPorRegime(
    aliquotas: Record<string, number | string | undefined>,
    regime: RegimeTributario
  ): number {
    const mapeamento: Record<RegimeTributario, string> = {
      'Regime-Regular': 'regime-regular',
      'Simples-Nacional': 'simples',
      'Lucro-Real': 'lucro-real',
      'Lucro-Presumido': 'lucro-presumido',
    };

    const chave = mapeamento[regime];
    const valor = aliquotas[chave] ?? aliquotas[regime] ?? aliquotas[regime.toLowerCase()];
    return Number(valor ?? 0);
  }
  /**
   * Processa um XML de NF-e e extrai dados relevantes
   */
  async parseNFE(xmlContent: string, tipo: DocumentType, modelo: NFeModel): Promise<NFeDocument> {
    try {
      const result = await parseStringPromise(xmlContent, {
        strict: true,
        explicitArray: false,
        // Remove prefixos de namespace (ex.: <ns:infNFe> vira <infNFe>)
        tagNameProcessors: [(nome: string) => nome.replace(/^.*:/, '')],
      });

      // A nota autorizada pela SEFAZ vem embrulhada em <nfeProc>; a nota apenas
      // assinada vem direto em <NFe>. Aceitamos as duas formas.
      const raiz = result.nfeProc || result;
      const nfe = raiz.NFe?.infNFe || raiz.infNFe;

      if (!nfe) {
        throw new Error('Estrutura de XML inválida: não encontrado elemento infNFe');
      }

      // Extrair dados básicos
      const ide = this.no(nfe.ide);
      const emit = this.no(nfe.emit);
      const dest = this.no(nfe.dest);
      const total = this.no(this.no(nfe.total)?.ICMSTot) || {};

      // Validar modelo
      const modeloXml = parseInt(this.texto(ide?.mod), 10) as NFeModel;
      if (modeloXml !== modelo) {
        throw new Error(
          `Modelo declarado (${modelo}) não corresponde ao modelo do XML (${modeloXml})`
        );
      }

      // Extrair chave NF-e (atributo Id, no formato "NFe" + 44 dígitos)
      const chaveNFe = this.texto(nfe.$?.Id).replace('NFe', '') || 'N/A';

      // Extrair CNPJ e nome
      const cnpjEmitente = this.texto(emit?.CNPJ) || this.texto(emit?.CPF) || 'N/A';
      const nomeEmitente = this.texto(emit?.xNome) || 'N/A';
      const cnpjDestino = this.texto(dest?.CNPJ) || this.texto(dest?.CPF) || 'N/A';
      const nomeDestino = this.texto(dest?.xNome) || 'Consumidor Final';

      // Extrair valores
      const baseCalculo = this.numero(total.vBC);
      const icms = this.numero(total.vICMS);
      const icmsST = this.numero(total.vST);
      const ipi = this.numero(total.vIPI);
      const iss = this.numero(total.vISS ?? total.vISSQN);
      const pis = this.numero(total.vPIS);
      const cofins = this.numero(total.vCOFINS);
      const irrf = this.numero(total.vIRRF ?? total.vIR);
      const totalNota = this.numero(total.vNF);

      // Determinar regime tributário (heurística simples)
      const regimeTributario = this.inferirRegimeTributario(icms, iss, pis, cofins);

      // Extrair data de emissão (dhEmi na NF-e 4.0, dEmi nas versões antigas)
      const dataEmissaoBruta = this.texto(ide?.dhEmi) || this.texto(ide?.dEmi);
      const dataEmissao = dataEmissaoBruta
        ? new Date(dataEmissaoBruta).toISOString()
        : new Date().toISOString();

      // Validar valores contra reforma tributária
      const validacoes = await this.validarConformeReforma(
        {
          icms,
          iss,
          pis,
          cofins,
          irrf,
        },
        regimeTributario,
        new Date(dataEmissao).getFullYear()
      );

      // Calcular divergências
      const divergencias = await this.calcularDivergencias(
        {
          icms,
          iss,
          pis,
          cofins,
          irrf,
        },
        regimeTributario
      );

      const documento: NFeDocument = {
        id: uuidv4(),
        modelo,
        tipo,
        chaveNFe,
        dataEmissao,
        cnpjEmitente,
        nomeEmitente,
        cnpjDestino,
        nomeDestino,
        regimeTributario,
        values: {
          baseCalculo,
          icms,
          icmsST,
          ipi,
          iss,
          pis,
          cofins,
          irrf,
          aliquota: 0,
          cbs: 0,
          ibs: 0,
          total: totalNota,
          Icms: icms,
          ISS: iss,
          Pis: pis,
          Cofins: cofins,
          Irrf: irrf,
          Alíquota: 0,
          CBS: 0,
          IBS: 0,
          Total: totalNota,
        },
        validacoes,
        divergencias,
      };

      return documento;
    } catch (error: any) {
      throw new Error(`Erro ao processar NF-e: ${error.message}`);
    }
  }

  /**
   * Inferir regime tributário baseado nos tributos
   */
  private inferirRegimeTributario(
    icms: number,
    iss: number,
    pis: number,
    cofins: number
  ): RegimeTributario {
    // Lógica simplificada - pode ser aprimorada
    if (pis === 0 && cofins === 0) {
      return 'Simples-Nacional';
    }

    if (icms > 0 && iss === 0) {
      return 'Lucro-Real';
    }

    if (iss > 0) {
      return 'Lucro-Presumido';
    }

    return 'Lucro-Real';
  }

  /**
   * Validar valores contra as regras da reforma tributária
   */
  private async validarConformeReforma(
    tributos: {
      icms: number;
      iss: number;
      pis: number;
      cofins: number;
      irrf: number;
    },
    regime: RegimeTributario,
    ano: number
  ): Promise<Validacao[]> {
    const validacoes: Validacao[] = [];
    const regras = await taxRulesService.getRegrasPorAno(ano);

    if (!regras) {
      return validacoes;
    }

    if (tributos.icms > 0) {
      const aliquotaEsperada = this.getAliquotaPorRegime(regras.icms as Record<string, number | string | undefined>, regime);
      const variacao = aliquotaEsperada === 0 ? 0 : Math.abs((tributos.icms / 100 - aliquotaEsperada) / aliquotaEsperada);

      validacoes.push({
        tipo: 'icms',
        conforme: variacao < 0.1,
        mensagem: `ICMS: ${(aliquotaEsperada * 100).toFixed(2)}% esperado vs atual`,
        ano,
      });
    }

    if (tributos.iss > 0) {
      const aliquotaEsperada = this.getAliquotaPorRegime(regras.iss as Record<string, number | string | undefined>, regime);
      validacoes.push({
        tipo: 'iss',
        conforme: Math.abs(tributos.iss - aliquotaEsperada) < 1,
        mensagem: `ISS: ${aliquotaEsperada.toFixed(2)} esperado vs ${tributos.iss.toFixed(2)} atual`,
        ano,
      });
    }

    if (tributos.pis > 0) {
      const aliquotaEsperada = this.getAliquotaPorRegime(regras.pis as Record<string, number | string | undefined>, regime);
      validacoes.push({
        tipo: 'pis',
        conforme: Math.abs(tributos.pis - aliquotaEsperada) < 0.5,
        mensagem: `PIS conforme`,
        ano,
      });
    }

    if (tributos.cofins > 0) {
      const aliquotaEsperada = this.getAliquotaPorRegime(regras.cofins as Record<string, number | string | undefined>, regime);
      validacoes.push({
        tipo: 'cofins',
        conforme: Math.abs(tributos.cofins - aliquotaEsperada) < 1,
        mensagem: `COFINS conforme`,
        ano,
      });
    }

    return validacoes;
  }

  /**
   * Calcular divergências entre valores atuais e previstos na reforma
   */
  private async calcularDivergencias(
    tributos: {
      icms: number;
      iss: number;
      pis: number;
      cofins: number;
      irrf: number;
    },
    regime: RegimeTributario
  ): Promise<Divergencia[]> {
    const divergencias: Divergencia[] = [];
    const anos = [2024, 2025, 2026, 2027];

    for (const ano of anos) {
      const regras = await taxRulesService.getRegrasPorAno(ano);

      if (!regras) continue;

      if (tributos.icms > 0) {
        const previsto = this.getAliquotaPorRegime(regras.icms as Record<string, number | string | undefined>, regime) * 100;
        const diferenca = previsto - tributos.icms;

        if (Math.abs(diferenca) > 1) {
          divergencias.push({
            tributo: 'ICMS',
            ano,
            valorAtual: tributos.icms,
            valorPrevisto: previsto,
            diferenca,
            percentual: previsto === 0 ? 0 : (diferenca / previsto) * 100,
          });
        }
      }

      if (tributos.iss > 0) {
        const previsto = this.getAliquotaPorRegime(regras.iss as Record<string, number | string | undefined>, regime);
        const diferenca = previsto - tributos.iss;

        if (Math.abs(diferenca) > 0.1) {
          divergencias.push({
            tributo: 'ISS',
            ano,
            valorAtual: tributos.iss,
            valorPrevisto: previsto,
            diferenca,
            percentual: previsto === 0 ? 0 : (diferenca / previsto) * 100,
          });
        }
      }

      if (tributos.pis > 0) {
        const previsto = this.getAliquotaPorRegime(regras.pis as Record<string, number | string | undefined>, regime);
        const diferenca = previsto - tributos.pis;

        if (Math.abs(diferenca) > 0.01) {
          divergencias.push({
            tributo: 'PIS',
            ano,
            valorAtual: tributos.pis,
            valorPrevisto: previsto,
            diferenca,
            percentual: previsto === 0 ? 0 : (diferenca / previsto) * 100,
          });
        }
      }

      if (tributos.cofins > 0) {
        const previsto = this.getAliquotaPorRegime(regras.cofins as Record<string, number | string | undefined>, regime);
        const diferenca = previsto - tributos.cofins;

        if (Math.abs(diferenca) > 0.1) {
          divergencias.push({
            tributo: 'COFINS',
            ano,
            valorAtual: tributos.cofins,
            valorPrevisto: previsto,
            diferenca,
            percentual: previsto === 0 ? 0 : (diferenca / previsto) * 100,
          });
        }
      }
    }

    return divergencias;
  }
}

export const nfeParserService = new NFEParserService();
