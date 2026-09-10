import { parseStringPromise } from 'xml2js';
import { NFeDocument, NFeModel, DocumentType, RegimeTributario, Validacao, Divergencia } from '../types';
import { rotuloModelo } from '../utils/modelos';
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
      const raiz = result.nfeProc || result.cteProc || result;
      const nfe = raiz.NFe?.infNFe || raiz.infNFe;

      // O ZIP pode misturar tipos de documento. Reconhecer o CT-e pela raiz
      // permite dizer ao usuário exatamente o que ele importou, em vez de
      // devolver "estrutura de XML inválida" para um arquivo perfeitamente
      // válido que só não é uma NF-e.
      if (!nfe) {
        const ehCTe = Boolean(raiz.CTe?.infCte || raiz.infCte);
        if (ehCTe) {
          throw new Error(
            `Este arquivo é um CT-e (57). Você selecionou ${rotuloModelo(modelo)}. ` +
              'O processamento de CT-e ainda não está disponível.'
          );
        }
        throw new Error(
          'Estrutura de XML inválida: não é uma NF-e nem uma NFC-e reconhecível.'
        );
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
          `Você selecionou ${rotuloModelo(modelo)}, mas este arquivo é ` +
            `${rotuloModelo(modeloXml)}.`
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
          icmsST,
          ipi,
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
   * Calcular divergências entre valores atuais e previstos na reforma.
   *
   * A lista abaixo define quais tributos são confrontados. O IPI e o ICMS-ST
   * já estão contemplados pelo motor, mas só entram no resultado quando a
   * alíquota esperada existir em data/tax-rules.json — sem regra cadastrada
   * não há com o que comparar, e inventar um número aqui produziria
   * divergência falsa na tela.
   */
  private async calcularDivergencias(
    tributos: {
      icms: number;
      icmsST: number;
      ipi: number;
      iss: number;
      pis: number;
      cofins: number;
      irrf: number;
    },
    regime: RegimeTributario
  ): Promise<Divergencia[]> {
    const divergencias: Divergencia[] = [];
    const anos = [2024, 2025, 2026, 2027];

    /** rotulo exibido, chave no arquivo de regras, valor da nota, tolerância */
    const confrontos: Array<{
      rotulo: string;
      chave: string;
      atual: number;
      tolerancia: number;
      /** o ICMS é cadastrado em fração e precisa virar percentual */
      emFracao?: boolean;
    }> = [
      { rotulo: 'ICMS', chave: 'icms', atual: tributos.icms, tolerancia: 1, emFracao: true },
      { rotulo: 'ICMS-ST', chave: 'icmsST', atual: tributos.icmsST, tolerancia: 1, emFracao: true },
      { rotulo: 'IPI', chave: 'ipi', atual: tributos.ipi, tolerancia: 0.5 },
      { rotulo: 'ISS', chave: 'iss', atual: tributos.iss, tolerancia: 1 },
      { rotulo: 'PIS', chave: 'pis', atual: tributos.pis, tolerancia: 0.1 },
      { rotulo: 'COFINS', chave: 'cofins', atual: tributos.cofins, tolerancia: 0.1 },
    ];

    for (const ano of anos) {
      const regras = await taxRulesService.getRegrasPorAno(ano);
      if (!regras) continue;

      for (const c of confrontos) {
        if (c.atual <= 0) continue;

        const regra = (regras as unknown as Record<string, unknown>)[c.chave];
        if (!regra || typeof regra !== 'object') continue;

        const base = this.getAliquotaPorRegime(
          regra as Record<string, number | string | undefined>,
          regime
        );
        const previsto = c.emFracao ? base * 100 : base;
        const diferenca = previsto - c.atual;

        if (Math.abs(diferenca) > c.tolerancia) {
          divergencias.push({
            tributo: c.rotulo,
            ano,
            valorAtual: c.atual,
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
