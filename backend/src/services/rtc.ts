import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export interface CSTItem {
  codigo: string;
  descricao: string;
  grupo: string;
  exigeGrupoPadrao: boolean;
  exigeMonofasica: boolean;
  exigeTransfCred: boolean;
  exigeAjusteCompet: boolean;
}

export interface CClassTribItem {
  codigo: string;
  cst: string;
  descricao: string;
  baseLegal?: string;
  nomeReduzido?: string;
  inicioVigencia?: string;
  fimVigencia?: string;
}

export interface OpcaoSimples {
  codigo: string;
  descricao: string;
}

interface TabelaRTC {
  informeTecnico: string;
  versaoTabela: string;
  fonte: string;
  atencao?: string;
  regraDeVinculo: string;
  cst: CSTItem[];
  cClassTrib: CClassTribItem[];
  finalidadeNFe: OpcaoSimples[];
  tipoOperacao: OpcaoSimples[];
  crt: OpcaoSimples[];
  tipoNFeDebito: OpcaoSimples[];
  tipoNFeCredito: OpcaoSimples[];
  indicadorBemMovelUsado: OpcaoSimples[];
}

/**
 * Serviço das tabelas da Reforma Tributária do Consumo (Informe Técnico 2025.002).
 *
 * A tabela vem de arquivo JSON e não do código, porque a SEFAZ republica os
 * códigos a cada poucos meses. Para atualizar, baixe a planilha oficial e rode
 * `npm run importar:cclasstrib`.
 */
export class RTCService {
  private tabela: TabelaRTC | null = null;
  private caminho: string;

  constructor() {
    const nome = 'cclasstrib.json';
    const dir = fs.existsSync(path.join(config.dataDir, nome))
      ? config.dataDir
      : process.cwd();
    this.caminho = path.join(dir, nome);
  }

  private carregar(): TabelaRTC {
    if (this.tabela) return this.tabela;

    try {
      this.tabela = JSON.parse(fs.readFileSync(this.caminho, 'utf-8'));
      console.log(
        `✅ Tabela RTC carregada: ${this.tabela!.cClassTrib.length} cClassTrib, ` +
          `${this.tabela!.cst.length} CST (IT ${this.tabela!.informeTecnico} v${this.tabela!.versaoTabela})`
      );
      return this.tabela!;
    } catch (erro: any) {
      throw new Error(`Não foi possível carregar a tabela RTC: ${erro.message}`);
    }
  }

  /** Metadados da tabela em uso — versão, fonte e avisos */
  obterMetadados() {
    const t = this.carregar();
    return {
      informeTecnico: t.informeTecnico,
      versaoTabela: t.versaoTabela,
      fonte: t.fonte,
      atencao: t.atencao,
      regraDeVinculo: t.regraDeVinculo,
      totalCST: t.cst.length,
      totalCClassTrib: t.cClassTrib.length,
    };
  }

  obterCST(): CSTItem[] {
    return this.carregar().cst;
  }

  obterCSTPorCodigo(codigo: string): CSTItem | null {
    return this.carregar().cst.find(c => c.codigo === codigo) || null;
  }

  /**
   * cClassTrib válidos para um CST.
   *
   * O vínculo é estrutural: os três primeiros dígitos do cClassTrib são o
   * próprio CST. Sem informar o CST, devolve a tabela inteira.
   */
  obterCClassTrib(cst?: string): CClassTribItem[] {
    const todos = this.carregar().cClassTrib;
    if (!cst) return todos;
    return todos.filter(c => c.cst === cst || c.codigo.startsWith(cst));
  }

  obterCClassTribPorCodigo(codigo: string): CClassTribItem | null {
    return this.carregar().cClassTrib.find(c => c.codigo === codigo) || null;
  }

  /** Listas fixas dos seletores da tela de configuração */
  obterOpcoes() {
    const t = this.carregar();
    return {
      finalidadeNFe: t.finalidadeNFe,
      tipoOperacao: t.tipoOperacao,
      crt: t.crt,
      tipoNFeDebito: t.tipoNFeDebito,
      tipoNFeCredito: t.tipoNFeCredito,
      indicadorBemMovelUsado: t.indicadorBemMovelUsado,
    };
  }

  /**
   * Valida a combinação CST + cClassTrib e devolve o grupo de tributação
   * que deve ser preenchido no XML.
   */
  validarCombinacao(cst: string, cClassTrib: string) {
    const erros: string[] = [];
    const avisos: string[] = [];

    const cstItem = this.obterCSTPorCodigo(cst);
    if (!cstItem) {
      erros.push(`CST ${cst} não consta na tabela do Informe Técnico.`);
    }

    const classItem = this.obterCClassTribPorCodigo(cClassTrib);
    if (!classItem) {
      // Pode ser um código válido ausente do arquivo parcial — avisa em vez de reprovar
      avisos.push(
        `cClassTrib ${cClassTrib} não consta na tabela carregada. ` +
          `Verifique se a tabela oficial está atualizada.`
      );
    }

    if (cClassTrib && cst && !cClassTrib.startsWith(cst)) {
      erros.push(
        `cClassTrib ${cClassTrib} não pertence ao CST ${cst}: os três primeiros ` +
          `dígitos do cClassTrib devem ser iguais ao CST.`
      );
    }

    if (classItem?.fimVigencia) {
      const fim = new Date(classItem.fimVigencia);
      if (!Number.isNaN(fim.getTime()) && fim < new Date()) {
        erros.push(`cClassTrib ${cClassTrib} está fora de vigência desde ${classItem.fimVigencia}.`);
      }
    }

    return {
      valido: erros.length === 0,
      erros,
      avisos,
      cst: cstItem,
      cClassTrib: classItem,
      grupoExigido: cstItem
        ? cstItem.exigeMonofasica
          ? 'gIBSCBSMono'
          : cstItem.exigeTransfCred
            ? 'gTransfCred'
            : cstItem.exigeAjusteCompet
              ? 'gAjusteCompet'
              : cstItem.exigeGrupoPadrao
                ? 'gIBSCBS'
                : 'nenhum'
        : null,
    };
  }
}

export const rtcService = new RTCService();
