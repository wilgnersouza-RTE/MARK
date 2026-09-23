import { parseStringPromise } from 'xml2js';
import { NFeDocument, NFeModel, DocumentType, RegimeTributario, Validacao, Divergencia } from '../types';
import { rotuloModelo } from '../utils/modelos';
import {
  conferirCamposNFe,
  conferirCamposNFSe,
  type ItemConferido,
} from './camposTributarios';
import { v4 as uuidv4 } from 'uuid';
import { taxRulesService } from './taxRules';
import { reformaService } from './reforma';

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

      // NFS-e de qualquer município: estrutura própria, parser próprio.
      const ehNFSe = this.ehNotaDeServico(raiz);
      if (ehNFSe) {
        if (modelo !== 'NFSE') {
          throw new Error(
            `Este arquivo é uma NFS-e. Você selecionou ${rotuloModelo(modelo)}.`
          );
        }
        return this.parseNFSe(raiz, tipo);
      }

      if (modelo === 'NFSE') {
        throw new Error(
          'Você selecionou NFS-e, mas este arquivo não é uma nota de serviço.'
        );
      }

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
      // A análise de divergências foi retirada do produto. O campo
      // permanece na estrutura, sempre vazio, para não quebrar quem a
      // consome.
      const divergencias: Divergencia[] = [];

      // Conferência de preenchimento: percorre os itens, onde vivem o CST e
      // o grupo de IBS/CBS.
      const camposTributarios = conferirCamposNFe(this.lerItens(nfe));

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
        camposTributarios,
      };

      return documento;
    } catch (error: any) {
      // As validações acima já produzem mensagens em português explicando o
      // que houve. Prefixar tudo com "Erro ao processar NF-e" só empurrava a
      // informação útil para o fim da linha na lista de arquivos recusados.
      if (error instanceof Error) throw error;
      throw new Error(`Não foi possível ler o arquivo: ${error?.message ?? error}`);
    }
  }

  /**
   * Inferir regime tributário baseado nos tributos
   */

  /**
   * Procura uma tag em qualquer profundidade do XML já convertido.
   *
   * A NFS-e não tem um leiaute só. Cada município publica o seu, e um mesmo
   * ZIP pode trazer vários: no lote de teste vieram o formato de Belo
   * Horizonte (raiz NFSe, com ValoresNFSe e Servicos) e o de São Paulo (raiz
   * NFe, com ChaveNFe e ValorISS). Amarrar o parser a um caminho fixo
   * quebraria a cada município novo.
   *
   * A comparação ignora maiúsculas porque os leiautes divergem até nisso
   * (ValorIss contra ValorISS, CpfCnpjPrestador contra CPFCNPJPrestador).
   */
  private buscar(no: any, nomes: string[], profundidade = 0): any {
    if (!no || typeof no !== 'object' || profundidade > 8) return undefined;

    const alvos = nomes.map(n => n.toLowerCase());

    for (const [chave, valor] of Object.entries(no)) {
      if (alvos.includes(chave.toLowerCase())) return valor;
    }

    for (const valor of Object.values(no)) {
      const achado = this.buscar(valor, nomes, profundidade + 1);
      if (achado !== undefined) return achado;
    }

    return undefined;
  }

  /** Texto de uma tag procurada em qualquer nível. */
  private textoDe(no: any, nomes: string[]): string {
    return this.texto(this.buscar(no, nomes));
  }

  /** Número de uma tag procurada em qualquer nível. */
  private numeroDe(no: any, nomes: string[]): number {
    return this.numero(this.buscar(no, nomes));
  }

  /**
   * Primeiro valor maior que zero entre várias tags candidatas.
   *
   * Necessário porque a tag existir não significa que ela tenha valor: São
   * Paulo grava ValorLiquidoNfse igual a 0,00 nas notas com ISS retido ou
   * imunidade, e o valor do serviço fica só na BaseCalculo. Pegar a primeira
   * tag presente descartaria a nota inteira.
   */
  private primeiroNumeroDe(no: any, nomes: string[]): number {
    for (const nome of nomes) {
      const valor = this.numero(this.buscar(no, [nome]));
      if (valor > 0) return valor;
    }
    return 0;
  }

  /**
   * CNPJ do prestador ou do tomador.
   *
   * Em São Paulo o documento vem aninhado (<CPFCNPJPrestador><CNPJ>), em Belo
   * Horizonte vem direto no texto da tag. Os dois casos caem aqui.
   */
  private documentoDe(no: any, nomes: string[]): string {
    const bruto = this.buscar(no, nomes);
    if (!bruto) return 'N/A';
    if (typeof bruto === 'string') return bruto.replace(/\D/g, '') || 'N/A';
    const aninhado = this.texto(this.no(bruto)?.CNPJ) || this.texto(this.no(bruto)?.CPF);
    return aninhado.replace(/\D/g, '') || 'N/A';
  }

  /**
   * Reconhece se o XML é uma NFS-e, qualquer que seja o município.
   *
   * O formato de São Paulo usa <NFe> como raiz, o mesmo nome da nota de
   * mercadoria. A distinção é feita pela presença de marcas que só existem em
   * nota de serviço e pela ausência de infNFe.
   */
  private ehNotaDeServico(raiz: any): boolean {
    if (raiz.NFSe || raiz.infNFSe || raiz.CompNfse || raiz.Nfse) return true;
    if (raiz.NFe?.infNFe || raiz.infNFe) return false;

    const marcas = ['ValorServicos', 'ValoresNFSe', 'Servicos', 'CodigoServico', 'ChaveNFe'];
    return marcas.some(m => this.buscar(raiz, [m]) !== undefined);
  }

  /**
   * NFS-e municipal ou do padrão nacional.
   *
   * Os valores são lidos por nome de tag, aceitando as variações conhecidas.
   * A alíquota é recalculada a partir do ISS e da base sempre que possível,
   * em vez de confiar na declarada: São Paulo grava 0.02 para dois por cento
   * e Belo Horizonte grava 3.5 para três e meio. Dividir o imposto pela base
   * resolve os dois sem precisar adivinhar a escala.
   */
  private async parseNFSe(raiz: any, tipo: DocumentType): Promise<NFeDocument> {
    const total = this.primeiroNumeroDe(raiz, [
      'ValorServicos',
      'vServ',
      'ValorLiquidoNfse',
      'vLiq',
      // Último recurso: em nota com ISS retido ou imunidade, é a única tag
      // que carrega o valor do serviço.
      'BaseCalculo',
    ]);

    if (total <= 0) {
      throw new Error(
        'NFS-e sem valor de serviço reconhecível. O leiaute deste município ' +
          'ainda não é suportado.'
      );
    }

    const iss = this.primeiroNumeroDe(raiz, ['ValorIss', 'ValorISS', 'vISSQN', 'vISS']);
    const deducoes = this.numeroDe(raiz, ['ValorDeducoes']);
    const baseDeclarada = this.primeiroNumeroDe(raiz, ['BaseCalculo', 'vBC']);
    const baseCalculo = baseDeclarada > 0 ? baseDeclarada : Math.max(total - deducoes, 0);

    // Alíquota efetiva, imune à diferença de escala entre municípios.
    const aliquotaDeclarada = this.primeiroNumeroDe(raiz, [
      'AliquotaServicos', 'Aliquota', 'pAliq',
    ]);
    const aliquota =
      baseCalculo > 0 && iss > 0
        ? (iss / baseCalculo) * 100
        : aliquotaDeclarada <= 1
          ? aliquotaDeclarada * 100
          : aliquotaDeclarada;

    // Retenções feitas pelo tomador.
    const pis = this.numeroDe(raiz, ['ValorPis', 'ValorPIS', 'vRetPIS']);
    const cofins = this.numeroDe(raiz, ['ValorCofins', 'ValorCOFINS', 'vRetCOFINS']);
    const irrf = this.numeroDe(raiz, ['ValorIr', 'ValorIR', 'ValorIRRF', 'vRetIRRF']);
    const csll = this.numeroDe(raiz, ['ValorCsll', 'ValorCSLL', 'vRetCSLL']);
    const inss = this.numeroDe(raiz, ['ValorInss', 'ValorINSS', 'vRetCP']);

    const cnpjEmitente = this.documentoDe(raiz, [
      'CpfCnpjPrestador', 'CPFCNPJPrestador', 'CnpjPrestador',
    ]);
    const cnpjDestino = this.documentoDe(raiz, [
      'CpfCnpjTomador', 'CPFCNPJTomador', 'CnpjTomador',
    ]);

    const dataEmissao =
      this.textoDe(raiz, ['DataEmissaoNfse', 'DataEmissaoNFe', 'dhProc', 'dhEmi']) ||
      new Date().toISOString();

    const regimeTributario = this.regimeDaNFSe(raiz);

    // Na NFS-e as retenções federais são sempre do tomador. O ISS só entra
    // aqui quando a nota declara IssRetido.
    const marcaIssRetido = this.textoDe(raiz, ['IssRetido', 'ISSRetido']).toLowerCase();
    const issEhRetido = marcaIssRetido === '1' || marcaIssRetido === 'true';

    const valoresDoc = {
      baseCalculo,
      icms: 0,
      icmsST: 0,
      ipi: 0,
      iss,
      pis,
      cofins,
      irrf,
      aliquota,
      cbs: this.numeroDe(this.buscar(raiz, ['CBS']) ?? {}, ['Vlr']),
      ibs: this.numeroDe(this.buscar(raiz, ['IBS']) ?? {}, ['Vlr']),
      total,
      retido: {
        iss: issEhRetido ? iss : 0,
        pis,
        cofins,
        irrf,
      },
    };

    const validacoes = await this.validarConformeReforma(
      valoresDoc,
      regimeTributario,
      new Date(dataEmissao).getFullYear()
    );

    const divergencias: Divergencia[] = [];

    if (issEhRetido) {
      validacoes.push({
        campo: 'ISS',
        situacao: 'informativo',
        mensagem:
          'ISS retido na fonte: o recolhimento é do tomador, não do prestador.',
      } as any);
    }

    if (csll > 0 || inss > 0) {
      validacoes.push({
        campo: 'Retenções',
        situacao: 'informativo',
        mensagem:
          `CSLL retida de ${csll.toFixed(2)} e INSS retido de ${inss.toFixed(2)} ` +
          'identificados. Não entram no total de tributos, que considera ISS e ' +
          'as retenções de PIS, COFINS e IRRF.',
      } as any);
    }

    const camposTributarios = conferirCamposNFSe({
      baseCalculo,
      aliquota,
      iss,
      issRetido: issEhRetido,
      pis,
      cofins,
      irrf,
      csll,
      inss,
      cst: this.textoDe(raiz, ['CST']) || undefined,
      cClassTrib: this.textoDe(raiz, ['cClassTrib', 'ClassificacaoTributaria']) || undefined,
      baseIBSCBS: this.buscar(raiz, ['BaseCalculoIBSCBS']) !== undefined
        ? this.numeroDe(raiz, ['BaseCalculoIBSCBS'])
        : undefined,
      ibsEstadual: this.buscar(raiz, ['IBS']) !== undefined
        ? this.numeroDe(this.buscar(raiz, ['IBS']) ?? {}, ['Vlr'])
        : undefined,
      ibsMunicipal: this.buscar(raiz, ['IBSMunicipal']) !== undefined
        ? this.numeroDe(this.buscar(raiz, ['IBSMunicipal']) ?? {}, ['Vlr'])
        : undefined,
      cbs: this.buscar(raiz, ['CBS']) !== undefined
        ? this.numeroDe(this.buscar(raiz, ['CBS']) ?? {}, ['Vlr'])
        : undefined,
      impostoSeletivo: this.buscar(raiz, ['IS']) !== undefined
        ? this.numeroDe(this.buscar(raiz, ['IS']) ?? {}, ['Vlr'])
        : undefined,
    });

    return {
      id: uuidv4(),
      modelo: 'NFSE',
      tipo,
      chaveNFe:
        this.textoDe(raiz, ['CodigoVerificacao', 'chNFSe']) ||
        this.textoDe(raiz, ['NumeroNfse', 'NumeroNFe', 'nNFSe']) ||
        'N/A',
      dataEmissao,
      cnpjEmitente,
      nomeEmitente: this.textoDe(raiz, ['RazaoSocialPrestador', 'xNome']) || 'N/A',
      cnpjDestino,
      nomeDestino:
        this.textoDe(raiz, ['RazaoSocialTomador']) || 'Tomador não identificado',
      regimeTributario,
      values: valoresDoc,
      validacoes,
      divergencias,
      camposTributarios,
    };
  }

  /**
   * Regime do prestador na NFS-e.
   *
   * Alguns leiautes declaram explicitamente (opSimpNac no padrão nacional,
   * OpcaoSimples em São Paulo). Sem declaração, a alíquota de ISS não permite
   * distinguir regime, então fica o presumido, que é a hipótese mais comum
   * para prestador de serviço fora do Simples.
   */
  private regimeDaNFSe(raiz: any): RegimeTributario {
    const opSimpNac = this.textoDe(raiz, ['opSimpNac']);
    if (opSimpNac === '2' || opSimpNac === '3') return 'Simples-Nacional';

    const opcaoSimples = this.textoDe(raiz, ['OpcaoSimples']);
    if (opcaoSimples === '1') return 'Simples-Nacional';

    return 'Lucro-Presumido';
  }


  /**
   * Percorre os itens da nota para conferir os campos tributários.
   *
   * O restante do parser trabalha com os totais em <ICMSTot>, que bastam para
   * apurar valores. Os campos da reforma, porém, são declarados por produto:
   * o grupo <IBSCBS> vive dentro de <imposto> de cada <det>, com o CST, o
   * cClassTrib e os subgrupos de IBS estadual, IBS municipal e CBS.
   *
   * Os nomes das tags são buscados em variações porque o leiaute evoluiu
   * entre as notas técnicas, e há emissores gravando <gIBSCBS> e outros
   * <IBSCBS>.
   */
  private lerItens(nfe: any): ItemConferido[] {
    const brutos = nfe.det;
    if (!brutos) return [];

    const lista = Array.isArray(brutos) ? brutos : [brutos];

    return lista.map((det: any) => {
      const imposto = this.no(det?.imposto) || {};

      // O CST do ICMS fica dentro de um filho cujo nome varia com a
      // tributação (ICMS00, ICMS20, ICMSSN101...). Pega-se o primeiro.
      const icmsPai = this.no(imposto.ICMS) || {};
      const icms = this.no(Object.values(icmsPai)[0]) || {};

      const ipi = this.no(this.no(imposto.IPI)?.IPITrib) || {};
      const pisPai = this.no(imposto.PIS) || {};
      const pis = this.no(Object.values(pisPai)[0]) || {};
      const cofinsPai = this.no(imposto.COFINS) || {};
      const cofins = this.no(Object.values(cofinsPai)[0]) || {};

      // Grupo da reforma
      const reforma = this.no(imposto.IBSCBS || imposto.gIBSCBS) || {};
      const ibsUF = this.no(reforma.gIBSUF || reforma.IBSUF) || {};
      const ibsMun = this.no(reforma.gIBSMun || reforma.IBSMun) || {};
      const cbsGrupo = this.no(reforma.gCBS || reforma.CBS) || {};
      const seletivo = this.no(imposto.IS || imposto.gIS) || {};

      return {
        cstICMS: this.texto(icms.CST) || this.texto(icms.CSOSN) || undefined,
        baseICMS: this.texto(icms.vBC) || undefined,
        aliquotaICMS: this.texto(icms.pICMS) || undefined,
        valorICMS: this.texto(icms.vICMS) || undefined,
        valorIPI: this.texto(ipi.vIPI) || undefined,
        cstPIS: this.texto(pis.CST) || undefined,
        valorPIS: this.texto(pis.vPIS) || undefined,
        cstCOFINS: this.texto(cofins.CST) || undefined,
        valorCOFINS: this.texto(cofins.vCOFINS) || undefined,

        cstReforma: this.texto(reforma.CST) || undefined,
        cClassTrib: this.texto(reforma.cClassTrib) || undefined,
        baseIBSCBS: this.texto(reforma.vBC) || undefined,
        ibsEstadual: this.texto(ibsUF.vIBSUF) || this.texto(ibsUF.pIBSUF) || undefined,
        ibsMunicipal: this.texto(ibsMun.vIBSMun) || this.texto(ibsMun.pIBSMun) || undefined,
        cbs: this.texto(cbsGrupo.vCBS) || this.texto(cbsGrupo.pCBS) || undefined,
        impostoSeletivo: this.texto(seletivo.vIS) || this.texto(seletivo.pIS) || undefined,
      };
    });
  }

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

}

export const nfeParserService = new NFEParserService();
