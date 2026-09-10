import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

/**
 * Armazenamento do cadastro de usuários.
 *
 * Existem duas implementações porque as hospedagens gratuitas não oferecem
 * disco persistente: no plano free do Render o sistema de arquivos é apagado a
 * cada deploy e a cada hibernação, o que apagaria todos os usuários.
 *
 *   - ArmazenamentoArquivo: grava em JSON no disco. Padrão para uso local e
 *     para hosts com disco persistente.
 *   - ArmazenamentoRedis: usa a API REST de um Redis gerenciado (Upstash e
 *     compatíveis). Funciona em qualquer lugar, inclusive sem disco.
 *
 * A escolha é automática: se UPSTASH_REDIS_REST_URL estiver definida, usa
 * Redis; senão, arquivo.
 */
export interface ArmazenamentoUsuarios {
  ler(): Promise<string | null>;
  gravar(conteudo: string): Promise<void>;
  descricao(): string;
}

class ArmazenamentoArquivo implements ArmazenamentoUsuarios {
  private caminho: string;
  private avisado = false;

  constructor() {
    const dir = config.writableDir;

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.caminho = path.join(dir, 'usuarios.json');
    } catch (erro: any) {
      console.warn(`⚠️  Não foi possível usar ${dir} (${erro.message}). Usando ${process.cwd()}.`);
      this.caminho = path.join(process.cwd(), 'usuarios.json');
    }
  }

  async ler(): Promise<string | null> {
    if (!fs.existsSync(this.caminho)) return null;
    return fs.readFileSync(this.caminho, 'utf-8');
  }

  async gravar(conteudo: string): Promise<void> {
    fs.writeFileSync(this.caminho, conteudo, 'utf-8');

    // Em produção sem disco persistente, o arquivo desaparece no próximo deploy.
    // Avisa uma vez, para o problema não passar em silêncio.
    if (config.isProd && !process.env.WRITABLE_DIR && !this.avisado) {
      this.avisado = true;
      console.warn(
        '⚠️  Usuários gravados em disco efêmero. Sem WRITABLE_DIR apontando para ' +
          'um disco persistente, ou sem UPSTASH_REDIS_REST_URL configurada, os ' +
          'cadastros serão perdidos no próximo deploy.'
      );
    }
  }

  descricao(): string {
    return `arquivo (${this.caminho})`;
  }
}

class ArmazenamentoRedis implements ArmazenamentoUsuarios {
  private url: string;
  private token: string;
  private chave = 'nfe-validator:usuarios';

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  private get cabecalhos() {
    return { Authorization: `Bearer ${this.token}` };
  }

  async ler(): Promise<string | null> {
    const resposta = await fetch(`${this.url}/get/${encodeURIComponent(this.chave)}`, {
      headers: this.cabecalhos,
    });

    if (!resposta.ok) {
      throw new Error(`Redis respondeu ${resposta.status} na leitura dos usuários.`);
    }

    const dados = (await resposta.json()) as { result: string | null };
    return dados.result ?? null;
  }

  async gravar(conteudo: string): Promise<void> {
    const resposta = await fetch(`${this.url}/set/${encodeURIComponent(this.chave)}`, {
      method: 'POST',
      headers: { ...this.cabecalhos, 'Content-Type': 'text/plain' },
      body: conteudo,
    });

    if (!resposta.ok) {
      throw new Error(`Redis respondeu ${resposta.status} ao gravar os usuários.`);
    }
  }

  descricao(): string {
    return `Redis (${this.url})`;
  }
}

export function criarArmazenamento(): ArmazenamentoUsuarios {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    console.log(`✅ Usuários em Redis: ${url}`);
    return new ArmazenamentoRedis(url, token);
  }

  if (url && !token) {
    console.warn(
      '⚠️  UPSTASH_REDIS_REST_URL definida sem UPSTASH_REDIS_REST_TOKEN. Usando arquivo.'
    );
  }

  const arquivo = new ArmazenamentoArquivo();
  console.log(`✅ Usuários em ${arquivo.descricao()}`);
  return arquivo;
}
