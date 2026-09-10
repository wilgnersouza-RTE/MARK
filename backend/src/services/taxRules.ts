import { RegrasTributarias } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

/**
 * Serviço que carrega regras tributárias de arquivo JSON
 * Permitindo desacoplamento entre legislação e código
 */
export class TaxRulesService {
  private cache: Map<number, RegrasTributarias> = new Map();
  private rulesPath: string;

  constructor() {
    const dataDir = fs.existsSync(path.join(config.dataDir, 'tax-rules.json'))
      ? config.dataDir
      : process.cwd();

    this.rulesPath = path.join(dataDir, 'tax-rules.json');
  }

  /**
   * Carrega as regras tributárias do arquivo JSON
   */
  async loadRules(): Promise<Map<number, RegrasTributarias>> {
    if (this.cache.size > 0) {
      return this.cache;
    }

    try {
      const data = fs.readFileSync(this.rulesPath, 'utf-8');
      const rulesData = JSON.parse(data);

      for (const rule of rulesData.anos) {
        this.cache.set(rule.ano, rule);
      }

      console.log(`✅ Regras tributárias carregadas para ${this.cache.size} ano(s)`);
      return this.cache;
    } catch (error: any) {
      console.error('❌ Erro ao carregar regras tributárias:', error.message);
      throw new Error('Não foi possível carregar as regras tributárias');
    }
  }

  /**
   * Obtém as regras para um ano específico
   */
  async getRegrasPorAno(ano: number): Promise<RegrasTributarias | null> {
    await this.loadRules();
    return this.cache.get(ano) || null;
  }

  /**
   * Obtém todas as regras carregadas
   */
  async getTodosRegras(): Promise<RegrasTributarias[]> {
    await this.loadRules();
    return Array.from(this.cache.values()).sort((a, b) => a.ano - b.ano);
  }

  /**
   * Atualiza as regras (para desenvolvimento/testes)
   */
  async updateRules(rules: RegrasTributarias[]): Promise<void> {
    if (config.isProd) {
      throw new Error('Atualização de regras não permitida em produção');
    }

    const data = {
      descricao: 'Regras tributárias brasileiras - Reforma Tributária 2027',
      ultima_atualizacao: new Date().toISOString(),
      anos: rules,
    };

    fs.writeFileSync(this.rulesPath, JSON.stringify(data, null, 2));
    this.cache.clear();
    await this.loadRules();
  }

  /**
   * Obtém a alíquota de um tributo para um regime específico
   */
  async getAliquota(
    ano: number,
    tributo: 'icms' | 'iss' | 'pis' | 'cofins' | 'irrf',
    regime: 'Regime-Regular' | 'Simples-Nacional' | 'Lucro-Real' | 'Lucro-Presumido'
  ): Promise<number | null> {
    const regras = await this.getRegrasPorAno(ano);

    if (!regras) {
      return null;
    }

    const tributoData = regras[tributo as keyof RegrasTributarias] as Record<string, number | string | undefined> | undefined;

    if (!tributoData) {
      return null;
    }

    const chave = regime
      .toLowerCase()
      .replace(/[^a-z-]/g, '')
      .replace('regime', 'regime-');

    const aliquota = tributoData[chave] ?? tributoData[regime as keyof typeof tributoData];
    const numero = typeof aliquota === 'number' ? aliquota : Number(aliquota ?? 0);
    return Number.isFinite(numero) ? numero : null;
  }
}

export const taxRulesService = new TaxRulesService();
