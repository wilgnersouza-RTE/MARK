import { config } from '../config';
import { NFeDocument } from '../types';

/**
 * Armazenamento das análises salvas: o resultado por nota e o ZIP original.
 *
 * Duas implementações, no mesmo molde de `armazenamentoUsuarios.ts`:
 *
 *   - ArmazenamentoAnalisesMemoria: guarda no processo. Padrão sem
 *     configuração; as análises somem quando o backend reinicia.
 *   - ArmazenamentoAnalisesSupabase: Postgres (PostgREST) e Storage da
 *     Supabase, via `fetch`, com a chave service_role. Ela só existe no
 *     backend; o frontend nunca fala com a Supabase.
 *
 * A escolha é automática: com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY,
 * Supabase; senão, memória. `excluir` é o único caminho que apaga análise,
 * notas e ZIP, e só é chamado depois da confirmação na tela.
 *
 * Na Supabase, a gravação não é atômica (são várias requisições). Por isso
 * a análise nasce com `completa = false` e só passa a `true` depois que
 * todas as notas foram gravadas; leitura, listagem e numeração de versão
 * consideram só as completas. Uma gravação interrompida fica invisível.
 */

/** Competência das análises sem nenhuma nota com data. */
export const SEM_COMPETENCIA = 'sem-competencia';

/** Pasta do bucket para análises sem empresa definida. */
export const PASTA_SEM_EMPRESA = 'sem-empresa';

/** Bucket privado dos ZIPs, criado por `backend/supabase/schema.sql`. */
export const BUCKET_ZIPS = 'lotes';

/** Nome do índice único de empresa + competência + versão (schema.sql). */
export const RESTRICAO_VERSAO = 'analises_empresa_competencia_versao_unica';

/** Tamanho padrão e máximo da página da listagem. */
export const PAGINA_PADRAO = 100;

export interface ResumoAnaliseSalva {
  nomeArquivo?: string;
  quantidadeArquivos?: number;
  arquivosProcessados?: number;
  arquivosComErro?: number;
  /** Primeiros arquivos recusados, para a tela e a planilha de erros */
  erros?: { nomeArquivo: string; erro: string }[];
  porModelo?: { modelo: string; rotulo: string; quantidade: number }[];
  porSentido?: { entrada: number; saida: number; indefinido: number };
  /** true quando a empresa foi identificada pelo lote, false quando escolhida */
  empresaInferida?: boolean;
  /** Análise de onde esta saiu por reprocessamento */
  reprocessadaDe?: string;
  /** Análise aberta de onde esta saiu por troca de empresa */
  derivadaDe?: string;
}

export interface AnaliseSalva {
  id: string;
  /** Só dígitos; '' quando o lote ficou sem empresa */
  empresaCnpj: string;
  empresaNome: string | null;
  /** AAAA-MM, ou SEM_COMPETENCIA */
  competencia: string;
  versao: number;
  criadoPor: string;
  criadoEm: string;
  totalNotas: number;
  resumo: ResumoAnaliseSalva;
  versaoTabela: string | null;
  zipPath: string | null;
  zipBytes: number;
}

/** Campos que mudam quando o contador troca a empresa do lote. */
export interface AlteracaoEmpresa {
  empresaCnpj: string;
  empresaNome: string | null;
  competencia: string;
  versao: number;
  resumo: ResumoAnaliseSalva;
  zipPath: string | null;
}

export interface EmpresaComAnalises {
  cnpj: string;
  nome: string | null;
  quantidade: number;
}

export interface PaginaAnalises {
  analises: AnaliseSalva[];
  /** true quando há mais análises depois desta página */
  temMais: boolean;
}

export interface UsoArmazenamento {
  tipo: 'memoria' | 'supabase';
  analises: number;
  bytesZips: number;
  /** Tamanho do banco, quando o provedor informa */
  bytesBanco: number | null;
  /** Limites do plano gratuito da Supabase; null na memória */
  limiteBytesZips: number | null;
  limiteBytesBanco: number | null;
}

/** Já existe análise com esta empresa, competência e versão. */
export class ErroVersaoOcupada extends Error {
  constructor() {
    super('Já existe uma análise com esta empresa, competência e versão.');
    this.name = 'ErroVersaoOcupada';
  }
}

/** Falha de comunicação com a Supabase (rede, projeto pausado, erro HTTP). */
export class ErroSupabase extends Error {
  constructor(mensagem: string, public status?: number) {
    super(mensagem);
    this.name = 'ErroSupabase';
  }
}

/** As notas saíram, mas a linha da análise não: ela fica oculta e sem notas. */
export class ErroExclusaoParcial extends ErroSupabase {
  constructor(public analiseId: string, causa: any) {
    super(
      `A análise ${analiseId} foi excluída pela metade: as notas saíram, mas a análise não ` +
        `(ficou oculta; exclua de novo). ${causa?.message ?? causa}`,
      causa?.status
    );
    this.name = 'ErroExclusaoParcial';
  }
}

/** O que a exclusão de uma análise removeu. */
export interface ResultadoExclusaoArmazenada {
  /** Dados da análise removida, para o log e o espaço liberado */
  analise: AnaliseSalva;
  /** true quando o ZIP foi apagado agora */
  zipRemovido: boolean;
  /** Por que o ZIP não foi apagado (ausente ou falha); a análise saiu mesmo assim */
  avisoZip?: string;
}

export interface ArmazenamentoAnalises {
  readonly tipo: 'memoria' | 'supabase';
  salvar(analise: AnaliseSalva, documentos: NFeDocument[], zip: Buffer): Promise<void>;
  atualizarEmpresa(id: string, alteracao: AlteracaoEmpresa, documentos: NFeDocument[]): Promise<AnaliseSalva>;
  /** Mais recentes primeiro, em páginas. */
  listar(filtro?: { empresa?: string; offset?: number; limite?: number }): Promise<PaginaAnalises>;
  /** Maior versão já usada pela empresa na competência; 0 se nenhuma. */
  maiorVersao(empresa: string, competencia: string): Promise<number>;
  /**
   * Reserva a próxima versão da empresa na competência. Números de análises
   * excluídas ou de gravações que falharam nunca voltam a ser usados.
   */
  reservarVersao(empresa: string, competencia: string): Promise<number>;
  listarEmpresas(): Promise<EmpresaComAnalises[]>;
  obter(id: string): Promise<{ analise: AnaliseSalva; documentos: NFeDocument[] } | null>;
  baixarZip(analise: AnaliseSalva): Promise<Buffer | null>;
  uso(): Promise<UsoArmazenamento>;
  /**
   * Apaga as notas, a análise e o ZIP. Devolve null se a análise não
   * existe. Falha ao apagar o ZIP não impede a exclusão: vira `avisoZip`.
   */
  excluir(id: string): Promise<ResultadoExclusaoArmazenada | null>;
  descricao(): string;
}

/** Caminho do ZIP no bucket: <cnpj>/<competência>/<id>.zip. */
export function caminhoDoZip(empresaCnpj: string, competencia: string, id: string): string {
  return `${empresaCnpj || PASTA_SEM_EMPRESA}/${competencia}/${id}.zip`;
}

function limitesDaPagina(filtro: { offset?: number; limite?: number }) {
  const offset = Math.max(0, Math.floor(filtro.offset ?? 0));
  const limite = Math.min(PAGINA_PADRAO, Math.max(1, Math.floor(filtro.limite ?? PAGINA_PADRAO)));
  return { offset, limite };
}

const ordenarRecentes = (a: AnaliseSalva, b: AnaliseSalva) =>
  b.criadoEm.localeCompare(a.criadoEm) || b.versao - a.versao;

/** Cópia profunda: o que sai do armazenamento não pode alterar o guardado. */
const copia = <T>(valor: T): T => JSON.parse(JSON.stringify(valor));

const avisoZipAusente = (caminho: string) =>
  `O ZIP da análise (${caminho}) já não existia no armazenamento; a análise foi excluída mesmo assim.`;

const avisoZipNaoRemovido = (caminho: string, motivo: string) =>
  `A análise foi excluída, mas o ZIP (${caminho}) não foi apagado do armazenamento (${motivo}). ` +
  'Apague-o no painel da Supabase (Storage, bucket lotes) para liberar o espaço.';

// ==================== Memória ====================

export class ArmazenamentoAnalisesMemoria implements ArmazenamentoAnalises {
  readonly tipo = 'memoria' as const;
  private analises = new Map<string, { analise: AnaliseSalva; documentos: NFeDocument[] }>();
  private zips = new Map<string, Buffer>();
  /** Maior versão já usada por empresa + competência; sobrevive às exclusões. */
  private ultimasVersoes = new Map<string, number>();

  private registrarVersao(empresa: string, competencia: string, versao: number) {
    const chave = `${empresa}|${competencia}`;
    this.ultimasVersoes.set(chave, Math.max(this.ultimasVersoes.get(chave) ?? 0, versao));
  }

  async reservarVersao(empresa: string, competencia: string): Promise<number> {
    const chave = `${empresa}|${competencia}`;
    // Sem await até gravar: duas reservas simultâneas não pegam o mesmo número.
    let maior = this.ultimasVersoes.get(chave) ?? 0;
    for (const { analise: a } of this.analises.values()) {
      if (a.empresaCnpj === empresa && a.competencia === competencia) maior = Math.max(maior, a.versao);
    }
    const proxima = maior + 1;
    this.ultimasVersoes.set(chave, proxima);
    return proxima;
  }

  private ocupada(empresa: string, competencia: string, versao: number, ignorarId?: string) {
    return Array.from(this.analises.values()).some(
      ({ analise: a }) =>
        a.id !== ignorarId && a.empresaCnpj === empresa && a.competencia === competencia && a.versao === versao
    );
  }

  async salvar(analise: AnaliseSalva, documentos: NFeDocument[], zip: Buffer): Promise<void> {
    if (this.ocupada(analise.empresaCnpj, analise.competencia, analise.versao)) throw new ErroVersaoOcupada();

    if (analise.zipPath) this.zips.set(analise.zipPath, Buffer.from(zip));
    this.analises.set(analise.id, { analise: copia(analise), documentos: copia(documentos) });
    this.registrarVersao(analise.empresaCnpj, analise.competencia, analise.versao);
  }

  async atualizarEmpresa(id: string, alteracao: AlteracaoEmpresa, documentos: NFeDocument[]): Promise<AnaliseSalva> {
    const registro = this.analises.get(id);
    if (!registro) throw new ErroSupabase(`Análise ${id} não encontrada.`, 404);

    if (this.ocupada(alteracao.empresaCnpj, alteracao.competencia, alteracao.versao, id)) {
      throw new ErroVersaoOcupada();
    }

    // Como na Supabase: o caminho só muda se o ZIP foi de fato movido.
    let zipPath = registro.analise.zipPath;
    if (zipPath && alteracao.zipPath && zipPath !== alteracao.zipPath) {
      const zip = this.zips.get(zipPath);
      if (zip) {
        this.zips.set(alteracao.zipPath, zip);
        this.zips.delete(zipPath);
        zipPath = alteracao.zipPath;
      }
    }

    registro.analise = copia({ ...registro.analise, ...alteracao, zipPath });
    this.registrarVersao(alteracao.empresaCnpj, alteracao.competencia, alteracao.versao);
    registro.documentos = copia(documentos);
    return copia(registro.analise);
  }

  async listar(filtro: { empresa?: string; offset?: number; limite?: number } = {}): Promise<PaginaAnalises> {
    const { offset, limite } = limitesDaPagina(filtro);
    const todas = Array.from(this.analises.values())
      .map(r => r.analise)
      .filter(a => filtro.empresa === undefined || a.empresaCnpj === filtro.empresa)
      .sort(ordenarRecentes);
    return { analises: todas.slice(offset, offset + limite).map(copia), temMais: todas.length > offset + limite };
  }

  async maiorVersao(empresa: string, competencia: string): Promise<number> {
    return Array.from(this.analises.values())
      .map(r => r.analise)
      .filter(a => a.empresaCnpj === empresa && a.competencia === competencia)
      .reduce((maior, a) => Math.max(maior, a.versao), 0);
  }

  async listarEmpresas(): Promise<EmpresaComAnalises[]> {
    const mapa = new Map<string, EmpresaComAnalises & { em: string }>();
    for (const { analise: a } of this.analises.values()) {
      const atual = mapa.get(a.empresaCnpj) ?? { cnpj: a.empresaCnpj, nome: null, quantidade: 0, em: '' };
      atual.quantidade++;
      if (a.empresaNome && a.criadoEm >= atual.em) {
        atual.nome = a.empresaNome;
        atual.em = a.criadoEm;
      }
      mapa.set(a.empresaCnpj, atual);
    }
    return Array.from(mapa.values())
      .map(({ em, ...e }) => e)
      .sort((a, b) => (a.nome ?? '￿').localeCompare(b.nome ?? '￿') || a.cnpj.localeCompare(b.cnpj));
  }

  async obter(id: string) {
    const registro = this.analises.get(id);
    return registro ? copia(registro) : null;
  }

  async baixarZip(analise: AnaliseSalva): Promise<Buffer | null> {
    const zip = analise.zipPath ? this.zips.get(analise.zipPath) : undefined;
    return zip ? Buffer.from(zip) : null;
  }

  async uso(): Promise<UsoArmazenamento> {
    let bytesZips = 0;
    for (const zip of this.zips.values()) bytesZips += zip.length;
    return {
      tipo: 'memoria',
      analises: this.analises.size,
      bytesZips,
      bytesBanco: null,
      limiteBytesZips: null,
      limiteBytesBanco: null,
    };
  }

  async excluir(id: string): Promise<ResultadoExclusaoArmazenada | null> {
    const registro = this.analises.get(id);
    if (!registro) return null;
    this.analises.delete(id);

    const analise = copia(registro.analise);
    if (!analise.zipPath) return { analise, zipRemovido: false };
    if (!this.zips.delete(analise.zipPath)) {
      return { analise, zipRemovido: false, avisoZip: avisoZipAusente(analise.zipPath) };
    }
    return { analise, zipRemovido: true };
  }

  descricao(): string {
    return 'memória (as análises somem quando o backend reinicia)';
  }
}

// ==================== Supabase ====================

/** Limites do plano gratuito da Supabase (banco e Storage). */
export const LIMITE_GRATUITO_BANCO = 500 * 1024 * 1024;
export const LIMITE_GRATUITO_STORAGE = 1024 * 1024 * 1024;

/** Notas por requisição: lotes grandes passariam do limite de corpo. */
const NOTAS_POR_LOTE = 200;
/** Linhas por página na leitura (o PostgREST da Supabase corta em 1.000). */
const LINHAS_POR_PAGINA = 1000;

/** Tempo máximo de cada requisição REST e de cada envio ou download de ZIP. */
export const TEMPO_REST_MS = 30_000;
export const TEMPO_ZIP_MS = 180_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LinhaAnalise {
  id: string;
  empresa_cnpj: string;
  empresa_nome: string | null;
  competencia: string;
  versao: number;
  criado_por: string;
  criado_em: string;
  total_notas: number;
  resumo: ResumoAnaliseSalva | null;
  versao_tabela: string | null;
  zip_path: string | null;
  zip_bytes: number | string | null;
  completa?: boolean;
}

function deLinha(l: LinhaAnalise): AnaliseSalva {
  return {
    id: l.id,
    empresaCnpj: l.empresa_cnpj ?? '',
    empresaNome: l.empresa_nome,
    competencia: l.competencia,
    versao: l.versao,
    criadoPor: l.criado_por,
    criadoEm: l.criado_em,
    totalNotas: l.total_notas,
    resumo: l.resumo ?? {},
    versaoTabela: l.versao_tabela,
    zipPath: l.zip_path,
    zipBytes: Number(l.zip_bytes ?? 0),
  };
}

function paraLinha(a: AnaliseSalva): LinhaAnalise {
  return {
    id: a.id,
    empresa_cnpj: a.empresaCnpj,
    empresa_nome: a.empresaNome,
    competencia: a.competencia,
    versao: a.versao,
    criado_por: a.criadoPor,
    criado_em: a.criadoEm,
    total_notas: a.totalNotas,
    resumo: a.resumo,
    versao_tabela: a.versaoTabela,
    zip_path: a.zipPath,
    zip_bytes: a.zipBytes,
  };
}

export class ArmazenamentoAnalisesSupabase implements ArmazenamentoAnalises {
  readonly tipo = 'supabase' as const;
  private url: string;

  constructor(url: string, private chave: string, private bucket: string = BUCKET_ZIPS) {
    this.url = url.replace(/\/$/, '');
  }

  /**
   * Cabeçalhos de autenticação. A chave legada (JWT) vai também no
   * Authorization; a chave secreta nova (sb_secret_...) só no apikey,
   * porque não é JWT e seria recusada ali.
   */
  private get autenticacao(): Record<string, string> {
    const cabecalhos: Record<string, string> = { apikey: this.chave };
    if (this.chave.startsWith('eyJ')) cabecalhos.Authorization = `Bearer ${this.chave}`;
    return cabecalhos;
  }

  private async requisitar(caminho: string, init: RequestInit & { tempo?: number } = {}): Promise<Response> {
    const { tempo = TEMPO_REST_MS, headers, ...resto } = init;
    try {
      return await fetch(`${this.url}${caminho}`, {
        ...resto,
        headers: { ...this.autenticacao, ...(headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(tempo),
      });
    } catch (erro: any) {
      throw new ErroSupabase(`Sem resposta da Supabase (${erro?.message ?? erro}).`);
    }
  }

  /**
   * Só o conflito no índice único de versão vira ErroVersaoOcupada; os
   * demais 409 (notas, Storage) são falhas comuns.
   */
  private async exigirOk(resposta: Response, acao: string): Promise<Response> {
    if (resposta.ok) return resposta;
    const texto = await resposta.text().catch(() => '');
    if (texto.includes(RESTRICAO_VERSAO)) throw new ErroVersaoOcupada();
    throw new ErroSupabase(`Supabase respondeu ${resposta.status} ao ${acao}: ${texto.slice(0, 300)}`, resposta.status);
  }

  private async rest<T = unknown>(caminho: string, acao: string, init: RequestInit = {}): Promise<T> {
    const resposta = await this.exigirOk(
      await this.requisitar(`/rest/v1/${caminho}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
      }),
      acao
    );
    const texto = await resposta.text();
    return (texto ? JSON.parse(texto) : null) as T;
  }

  private async patch(id: string, corpo: Record<string, unknown>, acao: string): Promise<LinhaAnalise> {
    const linhas = await this.rest<LinhaAnalise[]>(`analises?id=eq.${id}`, acao, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(corpo),
    });
    if (!linhas?.[0]) throw new ErroSupabase(`Análise ${id} não encontrada.`, 404);
    return linhas[0];
  }

  private async gravarNotas(id: string, documentos: NFeDocument[], substituir: boolean): Promise<void> {
    for (let inicio = 0; inicio < documentos.length; inicio += NOTAS_POR_LOTE) {
      const linhas = documentos
        .slice(inicio, inicio + NOTAS_POR_LOTE)
        .map((documento, i) => ({ analise_id: id, ordem: inicio + i, documento }));
      await this.rest(
        `analise_notas${substituir ? '?on_conflict=analise_id,ordem' : ''}`,
        'gravar as notas da análise',
        {
          method: 'POST',
          headers: {
            Prefer: substituir ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
          },
          body: JSON.stringify(linhas),
        }
      );
    }
  }

  private caminhoObjeto(caminho: string): string {
    return `/storage/v1/object/${encodeURIComponent(this.bucket)}/${caminho
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  async salvar(analise: AnaliseSalva, documentos: NFeDocument[], zip: Buffer): Promise<void> {
    // 1. A linha nasce incompleta: invisível até o fim.
    await this.rest('analises', 'salvar a análise', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ ...paraLinha(analise), completa: false }),
    });

    // 2. O ZIP, para a análise listada poder ser reprocessada.
    if (analise.zipPath) {
      await this.exigirOk(
        await this.requisitar(this.caminhoObjeto(analise.zipPath), {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip', 'x-upsert': 'false' },
          body: new Uint8Array(zip),
          tempo: TEMPO_ZIP_MS,
        }),
        'guardar o ZIP'
      );
    }

    // 3. As notas; 4. só então a análise aparece. O índice único de versão
    // vale só para as completas, então o conflito de versão surge aqui.
    await this.gravarNotas(analise.id, documentos, false);
    await this.patch(analise.id, { completa: true }, 'concluir a análise');
  }

  async atualizarEmpresa(id: string, alteracao: AlteracaoEmpresa, documentos: NFeDocument[]): Promise<AnaliseSalva> {
    if (!UUID.test(id)) throw new ErroSupabase(`Análise ${id} não encontrada.`, 404);

    // Some da lista enquanto as notas são regravadas.
    const anterior = deLinha(await this.patch(id, { completa: false }, 'atualizar a análise'));
    await this.gravarNotas(id, documentos, true);

    let linha: LinhaAnalise;
    try {
      linha = await this.patch(
        id,
        {
          empresa_cnpj: alteracao.empresaCnpj,
          empresa_nome: alteracao.empresaNome,
          competencia: alteracao.competencia,
          versao: alteracao.versao,
          resumo: alteracao.resumo,
          completa: true,
        },
        'atualizar a análise'
      );
    } catch (erro) {
      // Não deixa a análise escondida: volta a mostrá-la com os dados antigos.
      await this.patch(id, { completa: true }, 'restaurar a análise').catch(() => undefined);
      throw erro;
    }

    // O ZIP vai para a pasta da empresa nova. Se mover falhar, ele fica
    // onde estava e a análise continua apontando para lá.
    if (anterior.zipPath && alteracao.zipPath && anterior.zipPath !== alteracao.zipPath) {
      const movido = await this.requisitar('/storage/v1/object/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucketId: this.bucket,
          sourceKey: anterior.zipPath,
          destinationKey: alteracao.zipPath,
        }),
      }).catch(() => ({ ok: false, status: 0 }) as Pick<Response, 'ok' | 'status'>);
      if (movido.ok) {
        linha = await this.patch(id, { zip_path: alteracao.zipPath }, 'registrar o novo caminho do ZIP');
      } else {
        console.warn(`ZIP da análise ${id} não foi movido (${movido.status}); segue em ${anterior.zipPath}.`);
      }
    }

    return deLinha(linha);
  }

  async listar(filtro: { empresa?: string; offset?: number; limite?: number } = {}): Promise<PaginaAnalises> {
    const { offset, limite } = limitesDaPagina(filtro);
    // Uma a mais que o pedido, para saber se há próxima página.
    const partes = ['select=*', 'completa=is.true', 'order=criado_em.desc,versao.desc', `limit=${limite + 1}`, `offset=${offset}`];
    if (filtro.empresa !== undefined) partes.push(`empresa_cnpj=eq.${encodeURIComponent(filtro.empresa)}`);
    const linhas = await this.rest<LinhaAnalise[]>(`analises?${partes.join('&')}`, 'listar as análises');
    return { analises: linhas.slice(0, limite).map(deLinha), temMais: linhas.length > limite };
  }

  async maiorVersao(empresa: string, competencia: string): Promise<number> {
    const linhas = await this.rest<Array<{ versao: number }>>(
      `analises?select=versao&completa=is.true&empresa_cnpj=eq.${encodeURIComponent(empresa)}` +
        `&competencia=eq.${encodeURIComponent(competencia)}&order=versao.desc&limit=1`,
      'calcular a próxima versão'
    );
    return linhas[0]?.versao ?? 0;
  }

  /**
   * Próxima versão pela função `reservar_versao`, que guarda a maior já
   * usada. Sem a função (schema.sql não rodado de novo), maior versão + 1.
   */
  async reservarVersao(empresa: string, competencia: string): Promise<number> {
    try {
      const versao = await this.rest<number>('rpc/reservar_versao', 'reservar a próxima versão', {
        method: 'POST',
        body: JSON.stringify({ p_empresa: empresa, p_competencia: competencia }),
      });
      const numero = Number(versao);
      if (!Number.isInteger(numero) || numero < 1) {
        throw new ErroSupabase(`Supabase devolveu uma versão inválida (${JSON.stringify(versao)}).`, 500);
      }
      return numero;
    } catch (erro) {
      if (!(erro instanceof ErroSupabase && erro.status === 404)) throw erro;
      console.warn(
        'Função reservar_versao ausente na Supabase: usando a maior versão + 1. Rode de novo backend/supabase/schema.sql.'
      );
      return (await this.maiorVersao(empresa, competencia)) + 1;
    }
  }

  async listarEmpresas(): Promise<EmpresaComAnalises[]> {
    const linhas = await this.rest<Array<{ cnpj: string; nome: string | null; quantidade: number | string }>>(
      'rpc/empresas_com_analises',
      'listar as empresas',
      { method: 'POST', body: '{}' }
    );
    return linhas.map(l => ({ cnpj: l.cnpj ?? '', nome: l.nome, quantidade: Number(l.quantidade) }));
  }

  async obter(id: string) {
    if (!UUID.test(id)) return null;
    const linhas = await this.rest<LinhaAnalise[]>(`analises?id=eq.${id}&completa=is.true&select=*`, 'ler a análise');
    if (!linhas[0]) return null;
    const analise = deLinha(linhas[0]);

    const documentos: NFeDocument[] = [];
    for (let offset = 0; ; offset += LINHAS_POR_PAGINA) {
      const pagina = await this.rest<Array<{ documento: NFeDocument }>>(
        `analise_notas?analise_id=eq.${id}&select=documento&order=ordem.asc&limit=${LINHAS_POR_PAGINA}&offset=${offset}`,
        'ler as notas da análise'
      );
      documentos.push(...pagina.map(l => l.documento));
      if (pagina.length < LINHAS_POR_PAGINA) break;
    }

    return { analise, documentos };
  }

  async baixarZip(analise: AnaliseSalva): Promise<Buffer | null> {
    if (!analise.zipPath) return null;
    const resposta = await this.requisitar(this.caminhoObjeto(analise.zipPath), { tempo: TEMPO_ZIP_MS });
    if (resposta.status === 404 || resposta.status === 400) {
      // O Storage responde 400 com "not_found" para objeto inexistente.
      const texto = await resposta.text().catch(() => '');
      if (resposta.status === 404 || /not.?found/i.test(texto)) return null;
      throw new ErroSupabase(`Supabase respondeu 400 ao baixar o ZIP: ${texto.slice(0, 300)}`, 400);
    }
    await this.exigirOk(resposta, 'baixar o ZIP');
    return Buffer.from(await resposta.arrayBuffer());
  }

  async uso(): Promise<UsoArmazenamento> {
    const totais = await this.rest<{ analises: number; bytesZips: number | string; bytesBanco: number | string | null }>(
      'rpc/uso_armazenamento',
      'medir o uso',
      { method: 'POST', body: '{}' }
    );
    const bytesBanco = Number(totais?.bytesBanco ?? NaN);
    return {
      tipo: 'supabase',
      analises: Number(totais?.analises ?? 0),
      bytesZips: Number(totais?.bytesZips ?? 0),
      bytesBanco: Number.isFinite(bytesBanco) ? bytesBanco : null,
      limiteBytesZips: LIMITE_GRATUITO_STORAGE,
      limiteBytesBanco: LIMITE_GRATUITO_BANCO,
    };
  }

  /**
   * Exclui notas e análise pela função `excluir_analise` (uma transação só)
   * e depois apaga o ZIP. Bancos em que o schema.sql ainda não foi rodado de
   * novo não têm a função: aí a exclusão segue em etapas.
   */
  async excluir(id: string): Promise<ResultadoExclusaoArmazenada | null> {
    if (!UUID.test(id)) return null;

    let linha: LinhaAnalise | null;
    try {
      const linhas = await this.rest<LinhaAnalise[]>('rpc/excluir_analise', 'excluir a análise', {
        method: 'POST',
        body: JSON.stringify({ p_id: id }),
      });
      linha = linhas?.[0] ?? null;
    } catch (erro) {
      if (!(erro instanceof ErroSupabase && erro.status === 404)) throw erro;
      console.warn(
        'Função excluir_analise ausente na Supabase: excluindo em etapas. Rode de novo backend/supabase/schema.sql.'
      );
      linha = await this.excluirEmEtapas(id);
    }

    if (!linha) return null;
    return this.apagarZip(deLinha(linha));
  }

  /** Exclusão sem a função SQL: esconde, apaga as notas e depois a análise. */
  private async excluirEmEtapas(id: string): Promise<LinhaAnalise | null> {
    // Também as incompletas: uma exclusão interrompida pode ser repetida.
    const linhas = await this.rest<LinhaAnalise[]>(`analises?id=eq.${id}&select=*`, 'ler a análise a excluir');
    if (!linhas[0]) return null;

    // 1. Some da lista antes de perder as notas.
    try {
      await this.patch(id, { completa: false }, 'excluir a análise');
    } catch (erro) {
      if (erro instanceof ErroSupabase && erro.status === 404) return null;
      throw erro;
    }

    // 2. As notas (a chave estrangeira exige que saiam antes da análise).
    try {
      await this.rest(`analise_notas?analise_id=eq.${id}`, 'excluir as notas da análise', {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    } catch (erro) {
      // Nada foi apagado: volta como estava (oculta, se já era incompleta).
      if (linhas[0].completa !== false) {
        await this.patch(id, { completa: true }, 'restaurar a análise').catch(() => undefined);
      }
      throw erro;
    }

    // 3. A análise. Se falhar, ela fica oculta e sem notas.
    try {
      await this.rest(`analises?id=eq.${id}`, 'excluir a análise', {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    } catch (erro: any) {
      throw new ErroExclusaoParcial(id, erro);
    }
    return linhas[0];
  }

  /** Apaga o ZIP. Falhar aqui não desfaz a exclusão; vira aviso. */
  private async apagarZip(analise: AnaliseSalva): Promise<ResultadoExclusaoArmazenada> {
    if (!analise.zipPath) return { analise, zipRemovido: false };
    let resposta: Response;
    try {
      resposta = await this.requisitar(this.caminhoObjeto(analise.zipPath), { method: 'DELETE' });
    } catch (erro: any) {
      return { analise, zipRemovido: false, avisoZip: avisoZipNaoRemovido(analise.zipPath, erro?.message ?? String(erro)) };
    }
    if (resposta.ok) return { analise, zipRemovido: true };

    const texto = await resposta.text().catch(() => '');
    // O Storage responde 400 com "not_found" para objeto inexistente.
    if (resposta.status === 404 || /not.?found/i.test(texto)) {
      return { analise, zipRemovido: false, avisoZip: avisoZipAusente(analise.zipPath) };
    }
    return {
      analise,
      zipRemovido: false,
      avisoZip: avisoZipNaoRemovido(analise.zipPath, `HTTP ${resposta.status}: ${texto.slice(0, 200)}`),
    };
  }

  descricao(): string {
    return `Supabase (${this.url}, bucket ${this.bucket})`;
  }
}

// ==================== Escolha ====================

export function criarArmazenamentoAnalises(): ArmazenamentoAnalises {
  const { url, serviceRoleKey } = config.supabase;

  if (url && serviceRoleKey) {
    const supabase = new ArmazenamentoAnalisesSupabase(url, serviceRoleKey);
    console.log(`✅ Análises salvas em ${supabase.descricao()}`);
    return supabase;
  }

  if (url || serviceRoleKey) {
    console.warn('⚠️  SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidas juntas. Usando memória.');
  }

  const memoria = new ArmazenamentoAnalisesMemoria();
  console.log(`ℹ️  Análises salvas em ${memoria.descricao()}`);
  return memoria;
}
