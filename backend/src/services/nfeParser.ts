import { parseStringPromise } from 'xml2js';
import { NFeDocument, NFeModel, DocumentType, RegimeTributario, Validacao, Divergencia } from '../types';
import { rotuloModelo } from '../utils/modelos';
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
        regimeTributario,
        baseCalculo
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

    // Só o ISS entra no confronto de divergências: as retenções federais não
    // são tributo do prestador, e sim antecipação recolhida pelo tomador.
    const divergencias = await this.calcularDivergencias(
      { icms: 0, icmsST: 0, ipi: 0, iss, pis: 0, cofins: 0, irrf: 0 },
      regimeTributario,
      baseCalculo
    );

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
    regime: RegimeTributario,
    /** Base sobre a qual a alíquota esperada é aplicada. */
    baseCalculo: number
  ): Promise<Divergencia[]> {
    const divergencias: Divergencia[] = [];
    const anos = [2024, 2025, 2026, 2027];

    /** rotulo exibido, chave no arquivo de regras, valor da nota, tolerância */
    const confrontos: Array<{
      rotulo: string;
      chave: string;
      atual: number;
    }> = [
      { rotulo: 'ICMS', chave: 'icms', atual: tributos.icms },
      { rotulo: 'ICMS-ST', chave: 'icmsST', atual: tributos.icmsST },
      { rotulo: 'IPI', chave: 'ipi', atual: tributos.ipi },
      { rotulo: 'ISS', chave: 'iss', atual: tributos.iss },
      { rotulo: 'PIS', chave: 'pis', atual: tributos.pis },
      { rotulo: 'COFINS', chave: 'cofins', atual: tributos.cofins },
    ];

    // Diferença abaixo de um real é arredondamento, não divergência.
    const TOLERANCIA_EM_REAIS = 1;

    for (const ano of anos) {
      const regras = await taxRulesService.getRegrasPorAno(ano);
      if (!regras) continue;

      for (const c of confrontos) {
        if (c.atual <= 0) continue;

        const regra = (regras as unknown as Record<string, unknown>)[c.chave];
        if (!regra || typeof regra !== 'object') continue;

        // Todas as alíquotas de tax-rules.json estão em percentual
        // (ICMS 18.0, PIS 1.65). Um comentário antigo no código dizia que o
        // ICMS vinha em fração e o multiplicava por cem, o que gerava
        // alíquota de 1800% — o previsto saía cem vezes maior que o devido.
        const aliquota = this.getAliquotaPorRegime(
          regra as Record<string, number | string | undefined>,
          regime
        );

        // O previsto é um VALOR, não uma alíquota. Comparar o imposto
        // destacado contra o percentual esperado produzia diferenças
        // absurdas — R$ 8.600 contra 3,75, com percentual na casa das
        // centenas de milhares.
        const previsto = (baseCalculo * aliquota) / 100;
        const diferenca = previsto - c.atual;

        if (previsto > 0 && Math.abs(diferenca) > TOLERANCIA_EM_REAIS) {
          divergencias.push({
            tributo: c.rotulo,
            ano,
            valorAtual: c.atual,
            valorPrevisto: previsto,
            diferenca,
            percentual: (diferenca / previsto) * 100,
          });
        }
      }
    }

    // ---------- IPI e ICMS-ST ----------
    // Estes dois não têm alíquota esperada em tax-rules.json, mas a tabela
    // de transição da reforma (data/reforma-transicao.json, com base legal
    // declarada no próprio arquivo) traz o fator de cada ano: o IPI vai a
    // zero em 2027, com exceção da Zona Franca, e o ICMS-ST acompanha o
    // fator do ICMS. O previsto sai daí, sem número arbitrado.
    for (const ano of [2027, 2028, 2029, 2030, 2031, 2032, 2033]) {
      const regraAno = reformaService.obterRegra(ano);
      if (!regraAno) continue;

      const porFator: Array<{ rotulo: string; atual: number; fator: number }> = [
        { rotulo: 'IPI', atual: tributos.ipi, fator: regraAno.ipi?.fator ?? 1 },
        { rotulo: 'ICMS-ST', atual: tributos.icmsST, fator: regraAno.icms?.fator ?? 1 },
      ];

      for (const t of porFator) {
        if (t.atual <= 0) continue;

        const previsto = t.atual * t.fator;
        const diferenca = previsto - t.atual;
        if (Math.abs(diferenca) < 0.01) continue;

        divergencias.push({
          tributo: t.rotulo,
          ano,
          valorAtual: t.atual,
          valorPrevisto: previsto,
          diferenca,
          percentual: t.atual === 0 ? 0 : (diferenca / t.atual) * 100,
        });
      }
    }

    return divergencias;
  }
}

export const nfeParserService = new NFEParserService();
