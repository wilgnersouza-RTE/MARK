import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { NFeDocument } from '../types';
import { sessionService } from './session';
import {
  AVISO_MEMORIA,
  ErroAnaliseInexistente,
  ErroExclusaoInterrompida,
  ErroZipDaAnalise,
  abrirNaSessao,
  armazenamentoAnalises,
  atualizarAposTrocaEmpresa,
  calcularCompetencia,
  causaDaFalha,
  definirArmazenamentoAnalises,
  excluirAnalises,
  reprocessar,
  salvarAposUpload,
} from './analises';
import {
  ArmazenamentoAnalises,
  ArmazenamentoAnalisesMemoria,
  ArmazenamentoAnalisesSupabase,
  ErroExclusaoParcial,
  ErroSupabase,
  ErroVersaoOcupada,
  RESTRICAO_VERSAO,
  SEM_COMPETENCIA,
  caminhoDoZip,
} from './armazenamentoAnalises';

const EMPRESA = '11111111000111';
const OUTRA = '99999999000199';
const EXEMPLOS = path.resolve(__dirname, '../../../exemplos');

let sequencia = 0;

function nota(dia: string | null, cnpjEmitente = OUTRA, cnpjDestino = EMPRESA): NFeDocument {
  sequencia++;
  return {
    id: `doc-${sequencia}`,
    modelo: 55,
    tipo: 'indefinido',
    chaveNFe: `chave-${sequencia}`,
    dataEmissao: dia ? `${dia}T10:00:00.000Z` : new Date().toISOString(),
    ...(dia ? { diaEmissao: dia } : { semDataEmissao: true }),
    cnpjEmitente,
    nomeEmitente: `EMITENTE ${cnpjEmitente}`,
    cnpjDestino,
    nomeDestino: `DESTINO ${cnpjDestino}`,
    regimeTributario: 'Lucro-Real',
    values: {
      baseCalculo: 0, icms: 0, icmsST: 0, ipi: 0, iss: 0, pis: 0, cofins: 0,
      irrf: 0, aliquota: 0, cbs: 0, ibs: 0, total: 100,
    },
    validacoes: [],
    divergencias: [],
    cfops: [],
    ncms: [],
  };
}

const LOTE_VAZIO = { erros: [], arquivosProcessados: 0, arquivosComErro: 0, quantidadeArquivos: 0 };

let contadorSessao = 0;
async function sessaoCom(documentos: NFeDocument[], empresa: string | null, sessionId?: string) {
  sessionId = sessionId ?? `sess-analises-${++contadorSessao}`;
  sessionService.criarOuRecuperarSessao(sessionId, 'usuario', 'contador@exemplo.com');
  return sessionService.adicionarDocumentos(
    sessionId,
    documentos,
    {
      sessionId,
      quantidadeArquivos: documentos.length,
      arquivosProcessados: documentos.length,
      arquivosComErro: 0,
      erros: [],
      documentos,
      timestamp: new Date().toISOString(),
    },
    empresa ? { cnpj: empresa, nome: 'EMPRESA TESTE', inferida: true } : null
  );
}

async function zipDosExemplos(): Promise<Buffer> {
  const zip = new JSZip();
  for (const nome of ['nota1.xml', 'nota2.xml', 'nota3.xml']) {
    zip.file(nome, fs.readFileSync(path.join(EXEMPLOS, nome), 'utf-8'));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

beforeEach(() => {
  definirArmazenamentoAnalises(new ArmazenamentoAnalisesMemoria());
});

describe('calcularCompetencia', () => {
  it('fica com o mês que tem mais notas', () => {
    const docs = [
      ...Array.from({ length: 30 }, () => nota('2026-03-10')),
      ...Array.from({ length: 5 }, () => nota('2026-02-27')),
    ];
    expect(calcularCompetencia(docs)).toBe('2026-03');
  });

  it('usa o dia local do XML, não o instante em UTC', () => {
    // Manaus, 31/12/2025 às 23h30: em UTC já é 2026.
    const doc = { ...nota('2025-12-31'), dataEmissao: '2026-01-01T03:30:00.000Z' };
    expect(calcularCompetencia([doc])).toBe('2025-12');
  });

  it('marca sem competência quando nenhuma nota tem data', () => {
    expect(calcularCompetencia([nota(null), nota(null)])).toBe(SEM_COMPETENCIA);
  });

  it('desempata pelo mês mais recente', () => {
    expect(calcularCompetencia([nota('2026-01-05'), nota('2026-02-05')])).toBe('2026-02');
  });
});

describe('salvarAposUpload', () => {
  it('salva a primeira importação como versão 1, com o ZIP no caminho da empresa', async () => {
    const sessao = await sessaoCom([nota('2026-03-01'), nota('2026-03-02')], EMPRESA);
    const zip = Buffer.from('zip-original');

    const resultado = await salvarAposUpload(sessao, { zip, criadoPor: 'contador@exemplo.com', lote: LOTE_VAZIO });

    expect(resultado.analiseSalva).toBe(true);
    // Sem Supabase, avisa que a análise some ao reiniciar.
    expect(resultado.avisoAnalise).toBe(AVISO_MEMORIA);
    expect(resultado.analise).toEqual(
      expect.objectContaining({ empresaCnpj: EMPRESA, competencia: '2026-03', versao: 1, totalNotas: 2 })
    );
    const salva = (await armazenamentoAnalises().obter(resultado.analise!.id))!;
    expect(salva.analise.zipPath).toBe(caminhoDoZip(EMPRESA, '2026-03', salva.analise.id));
    expect(salva.analise.zipPath).toBe(`${EMPRESA}/2026-03/${salva.analise.id}.zip`);
    expect((await armazenamentoAnalises().baixarZip(salva.analise))!.toString()).toBe('zip-original');
    expect(sessionService.obterSessao(sessao.sessionId)!.analiseId).toBe(salva.analise.id);
    expect(sessionService.obterSessao(sessao.sessionId)!.analiseOrigem).toBe('upload');
  });

  it('reimportar a mesma empresa e competência cria a versão 2 e mantém a 1', async () => {
    const primeira = await salvarAposUpload(await sessaoCom([nota('2026-03-01')], EMPRESA), {
      zip: Buffer.from('a'),
      criadoPor: 'x',
      lote: LOTE_VAZIO,
    });
    const segunda = await salvarAposUpload(await sessaoCom([nota('2026-03-15'), nota('2026-03-16')], EMPRESA), {
      zip: Buffer.from('b'),
      criadoPor: 'x',
      lote: LOTE_VAZIO,
    });

    expect(segunda.analise!.versao).toBe(2);
    const v1 = await armazenamentoAnalises().obter(primeira.analise!.id);
    expect(v1!.analise.versao).toBe(1);
    expect(v1!.documentos).toHaveLength(1);
  });

  it('não derruba quando o armazenamento falha: devolve o aviso com a causa', async () => {
    const quebrado = new ArmazenamentoAnalisesMemoria();
    quebrado.salvar = async () => {
      throw new ErroSupabase('Sem resposta da Supabase (fetch failed).');
    };
    definirArmazenamentoAnalises(quebrado);

    const sessao = await sessaoCom([nota('2026-03-01')], EMPRESA);
    const resultado = await salvarAposUpload(sessao, { zip: Buffer.from('a'), criadoPor: 'x', lote: LOTE_VAZIO });

    expect(resultado.analise).toBeNull();
    expect(resultado.analiseSalva).toBe(false);
    expect(resultado.avisoAnalise).toMatch(/não foi salva.*Restore project/);
    expect(sessionService.obterSessao(sessao.sessionId)!.documentos).toHaveLength(1);
    expect(sessionService.obterSessao(sessao.sessionId)!.analiseId).toBeUndefined();
  });

  it('(e) versão ocupada: tenta de novo com id novo e grava', async () => {
    const loja = new ArmazenamentoAnalisesMemoria();
    const salvarOriginal = loja.salvar.bind(loja);
    const ids: string[] = [];
    loja.salvar = async (analise, documentos, zip) => {
      ids.push(analise.id);
      if (ids.length === 1) throw new ErroVersaoOcupada();
      return salvarOriginal(analise, documentos, zip);
    };
    definirArmazenamentoAnalises(loja);

    const resultado = await salvarAposUpload(await sessaoCom([nota('2026-03-01')], EMPRESA), {
      zip: Buffer.from('a'),
      criadoPor: 'x',
      lote: LOTE_VAZIO,
    });

    expect(resultado.analiseSalva).toBe(true);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(resultado.analise!.id).toBe(ids[1]);
  });

  it('não liga a sessão se outro lote entrou enquanto salvava', async () => {
    const sessao = await sessaoCom([nota('2026-03-01')], EMPRESA);
    const salvando = salvarAposUpload(sessao, { zip: Buffer.from('a'), criadoPor: 'x', lote: LOTE_VAZIO });
    await sessaoCom([nota('2026-04-01')], EMPRESA, sessao.sessionId);

    const resultado = await salvando;
    expect(resultado.analiseSalva).toBe(true);
    expect(sessionService.obterSessao(sessao.sessionId)!.analiseId).toBeUndefined();
  });
});

describe('causaDaFalha', () => {
  it('distingue projeto pausado, espaço esgotado, chave inválida e outros erros', () => {
    expect(causaDaFalha(new ErroSupabase('sem resposta'))).toMatch(/pausado.*Restore project/);
    expect(causaDaFalha(new ErroSupabase('Project paused', 540))).toMatch(/pausado/);
    expect(causaDaFalha(new ErroSupabase('Payload too large', 413))).toMatch(/espaço gratuito/);
    expect(causaDaFalha(new ErroSupabase('cannot execute INSERT in a read-only transaction', 400))).toMatch(
      /espaço gratuito/
    );
    expect(causaDaFalha(new ErroSupabase('Invalid API key', 401))).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(causaDaFalha(new ErroSupabase('forbidden', 403))).toMatch(/chave/);
    expect(causaDaFalha(new ErroSupabase('bad', 422))).toMatch(/HTTP 422/);
    expect(causaDaFalha(new Error('disco'))).toMatch(/falhou \(disco\)/);
  });
});

describe('atualizarAposTrocaEmpresa', () => {
  it('leva a empresa escolhida depois para a análise criada pela sessão, com versão própria', async () => {
    // Já existe a versão 1 de EMPRESA em 2026-03.
    await salvarAposUpload(await sessaoCom([nota('2026-03-01')], EMPRESA), {
      zip: Buffer.from('a'),
      criadoPor: 'x',
      lote: LOTE_VAZIO,
    });

    const sessao = await sessaoCom([nota('2026-03-05')], null);
    const salva = await salvarAposUpload(sessao, { zip: Buffer.from('b'), criadoPor: 'x', lote: LOTE_VAZIO });
    expect(salva.analise).toEqual(expect.objectContaining({ empresaCnpj: '', versao: 1 }));

    const comEmpresa = await sessionService.definirEmpresa(sessao.sessionId, EMPRESA);
    const resultado = await atualizarAposTrocaEmpresa(comEmpresa);

    expect(resultado.analiseSalva).toBe(true);
    expect(resultado.analise).toEqual(
      expect.objectContaining({ id: salva.analise!.id, empresaCnpj: EMPRESA, competencia: '2026-03', versao: 2 })
    );
    const gravada = (await armazenamentoAnalises().obter(salva.analise!.id))!;
    expect(gravada.documentos[0].tipo).toBe('entrada');
    expect(gravada.analise.zipPath).toBe(`${EMPRESA}/2026-03/${salva.analise!.id}.zip`);
    expect((await armazenamentoAnalises().baixarZip(gravada.analise))!.toString()).toBe('b');
  });

  it('sem análise ligada à sessão não faz nada', async () => {
    const sessao = await sessaoCom([nota('2026-03-05')], EMPRESA);
    expect(await atualizarAposTrocaEmpresa(sessao)).toEqual({ analise: null, analiseSalva: false });
  });

  it('(g) trocar a empresa de uma análise aberta cria versão nova e não mexe na original', async () => {
    const origem = await sessaoCom([nota('2026-03-01', OUTRA, EMPRESA), nota('2026-03-02', EMPRESA, OUTRA)], EMPRESA);
    const original = await salvarAposUpload(origem, { zip: Buffer.from('zip-a'), criadoPor: 'x', lote: LOTE_VAZIO });
    const antes = await armazenamentoAnalises().obter(original.analise!.id);

    sessionService.criarOuRecuperarSessao('sess-analises-aberta', 'outro', 'outro@exemplo.com');
    await abrirNaSessao(original.analise!.id, 'sess-analises-aberta');
    expect(sessionService.obterSessao('sess-analises-aberta')!.analiseOrigem).toBe('aberta');

    const trocada = await sessionService.definirEmpresa('sess-analises-aberta', OUTRA);
    const resultado = await atualizarAposTrocaEmpresa(trocada, 'outro@exemplo.com');

    expect(resultado.analiseSalva).toBe(true);
    expect(resultado.analise!.id).not.toBe(original.analise!.id);
    expect(resultado.analise).toEqual(
      expect.objectContaining({
        empresaCnpj: OUTRA,
        competencia: '2026-03',
        versao: 1,
        criadoPor: 'outro@exemplo.com',
        derivadaDe: original.analise!.id,
      })
    );
    expect(await armazenamentoAnalises().obter(original.analise!.id)).toEqual(antes);

    const nova = (await armazenamentoAnalises().obter(resultado.analise!.id))!;
    expect((await armazenamentoAnalises().baixarZip(nova.analise))!.toString()).toBe('zip-a');
    expect(nova.analise.zipPath).toBe(`${OUTRA}/2026-03/${nova.analise.id}.zip`);
    expect(nova.documentos.map(d => d.tipo)).toEqual(['saida', 'entrada']);

    // A sessão passa a apontar para a versão nova, criada por ela.
    const sessaoDepois = sessionService.obterSessao('sess-analises-aberta')!;
    expect(sessaoDepois.analiseId).toBe(nova.analise.id);
    expect(sessaoDepois.analiseOrigem).toBe('upload');
  });

  it('desfaz o vínculo quando a análise ligada não existe mais', async () => {
    const sessao = await sessaoCom([nota('2026-03-01')], EMPRESA);
    await salvarAposUpload(sessao, { zip: Buffer.from('a'), criadoPor: 'x', lote: LOTE_VAZIO });
    definirArmazenamentoAnalises(new ArmazenamentoAnalisesMemoria());

    const resultado = await atualizarAposTrocaEmpresa(sessionService.obterSessao(sessao.sessionId)!);
    expect(resultado.analiseSalva).toBe(false);
    expect(resultado.avisoAnalise).toMatch(/não foi encontrada/);
    expect(sessionService.obterSessao(sessao.sessionId)!.analiseId).toBeUndefined();
  });
});

describe('abrirNaSessao', () => {
  it('carrega notas e empresa na sessão', async () => {
    const origem = await sessaoCom([nota('2026-03-01'), nota('2026-03-02', EMPRESA, OUTRA)], EMPRESA);
    const salva = await salvarAposUpload(origem, { zip: Buffer.from('a'), criadoPor: 'x', lote: LOTE_VAZIO });

    const destino = sessionService.criarOuRecuperarSessao('sess-analises-abrir', 'outro', 'outro@exemplo.com');
    const { sessao } = await abrirNaSessao(salva.analise!.id, destino.sessionId);

    expect(sessao.documentos.map(d => d.tipo)).toEqual(['entrada', 'saida']);
    expect(sessao.empresa).toEqual(expect.objectContaining({ cnpj: EMPRESA }));
    expect(sessao.analiseId).toBe(salva.analise!.id);
    expect(sessao.dashboard?.resumoGeral.totalDocumentos).toBe(origem.dashboard?.resumoGeral.totalDocumentos);
  });

  it('recusa análise inexistente', async () => {
    sessionService.criarOuRecuperarSessao('sess-analises-404', 'u', 'u@exemplo.com');
    await expect(abrirNaSessao('nao-existe', 'sess-analises-404')).rejects.toBeInstanceOf(ErroAnaliseInexistente);
  });
});

describe('reprocessar', () => {
  it('gera a versão seguinte a partir do ZIP guardado', async () => {
    const zip = await zipDosExemplos();
    const sessao = await sessaoCom([nota('2024-09-10', '11222333000144', '99888777000166')], '99888777000166');
    const original = await salvarAposUpload(sessao, { zip, criadoPor: 'x', lote: LOTE_VAZIO });

    const nova = await reprocessar(original.analise!.id, 'revisor@exemplo.com');

    expect(nova).toEqual(
      expect.objectContaining({
        empresaCnpj: '99888777000166',
        competencia: '2024-09',
        versao: 2,
        totalNotas: 3,
        criadoPor: 'revisor@exemplo.com',
        reprocessadaDe: original.analise!.id,
      })
    );
    const intacta = await armazenamentoAnalises().obter(original.analise!.id);
    expect(intacta!.documentos).toHaveLength(1);
  });

  it('(b) mantém a empresa escolhida à mão quando ela ainda está no lote', async () => {
    // O lote identificaria 99888777000166; o contador escolheu 12345678000190.
    const sessao = await sessaoCom([nota('2024-03-15', '12345678000190', '99888777000166')], null);
    sessao.empresa = { cnpj: '12345678000190', nome: 'ESCOLHIDA', inferida: false };
    const original = await salvarAposUpload(sessao, { zip: await zipDosExemplos(), criadoPor: 'x', lote: LOTE_VAZIO });

    const nova = await reprocessar(original.analise!.id, 'x');
    expect(nova.empresaCnpj).toBe('12345678000190');
    const gravada = (await armazenamentoAnalises().obter(nova.id))!;
    expect(gravada.analise.resumo.empresaInferida).toBe(false);
    expect(gravada.documentos.filter(d => d.tipo === 'saida')).toHaveLength(1);
  });

  it('(b) volta a identificar a empresa quando o CNPJ original sumiu do lote', async () => {
    const sessao = await sessaoCom([nota('2024-03-15')], '33333333000133');
    const original = await salvarAposUpload(sessao, { zip: await zipDosExemplos(), criadoPor: 'x', lote: LOTE_VAZIO });

    const nova = await reprocessar(original.analise!.id, 'x');
    expect(nova.empresaCnpj).toBe('99888777000166');
    const gravada = (await armazenamentoAnalises().obter(nova.id))!;
    expect(gravada.analise.resumo.empresaInferida).toBe(true);
  });

  it('ZIP ilegível vira erro do ZIP; análise inexistente, erro próprio', async () => {
    const sessao = await sessaoCom([nota('2026-03-01')], EMPRESA);
    const salva = await salvarAposUpload(sessao, {
      zip: Buffer.from('isto não é zip'),
      criadoPor: 'x',
      lote: LOTE_VAZIO,
    });

    await expect(reprocessar(salva.analise!.id, 'x')).rejects.toBeInstanceOf(ErroZipDaAnalise);
    await expect(reprocessar('nao-existe', 'x')).rejects.toBeInstanceOf(ErroAnaliseInexistente);
  });
});

describe('ArmazenamentoAnalisesSupabase', () => {
  const URL_PROJETO = 'https://projeto.supabase.co';
  const chamadas: Array<{ url: string; init: any }> = [];
  const original = global.fetch;

  function responder(fn: (url: string, init: any) => { status?: number; corpo?: unknown }) {
    global.fetch = (async (url: any, init: any) => {
      chamadas.push({ url: String(url), init });
      const { status = 200, corpo } = fn(String(url), init);
      return new Response(corpo === undefined ? '' : typeof corpo === 'string' ? corpo : JSON.stringify(corpo), {
        status,
      });
    }) as typeof fetch;
  }

  beforeEach(() => {
    chamadas.length = 0;
  });

  afterAll(() => {
    global.fetch = original;
  });

  const analise = {
    id: '11111111-2222-3333-4444-555555555555',
    empresaCnpj: EMPRESA,
    empresaNome: 'EMPRESA',
    competencia: '2026-03',
    versao: 1,
    criadoPor: 'x',
    criadoEm: '2026-03-31T12:00:00.000Z',
    totalNotas: 1,
    resumo: {},
    versaoTabela: '1.31',
    zipPath: `${EMPRESA}/2026-03/11111111-2222-3333-4444-555555555555.zip`,
    zipBytes: 3,
  };

  const linha = (extra: Record<string, unknown> = {}) => ({
    id: analise.id,
    empresa_cnpj: EMPRESA,
    empresa_nome: 'EMPRESA',
    competencia: '2026-03',
    versao: 1,
    criado_por: 'x',
    criado_em: analise.criadoEm,
    total_notas: 1,
    resumo: {},
    versao_tabela: '1.31',
    zip_path: analise.zipPath,
    zip_bytes: 3,
    completa: true,
    ...extra,
  });

  /** PATCH devolve a linha com o corpo aplicado; o resto, 201 vazio. */
  const padrao = (_url: string, init: any) =>
    init?.method === 'PATCH' ? { corpo: [linha(JSON.parse(init.body))] } : { status: 201 };

  it('grava a linha incompleta, o ZIP, as notas e só então marca completa', async () => {
    responder(padrao);
    const loja: ArmazenamentoAnalises = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'eyJchave');

    await loja.salvar(analise, [nota('2026-03-01')], Buffer.from('zip'));

    expect(chamadas.map(c => `${c.init.method} ${c.url}`)).toEqual([
      `POST ${URL_PROJETO}/rest/v1/analises`,
      `POST ${URL_PROJETO}/storage/v1/object/lotes/${EMPRESA}/2026-03/${analise.id}.zip`,
      `POST ${URL_PROJETO}/rest/v1/analise_notas`,
      `PATCH ${URL_PROJETO}/rest/v1/analises?id=eq.${analise.id}`,
    ]);
    expect(JSON.parse(chamadas[0].init.body)).toEqual(
      expect.objectContaining({ empresa_cnpj: EMPRESA, competencia: '2026-03', versao: 1, completa: false })
    );
    expect(chamadas[1].init.headers).toEqual(
      expect.objectContaining({ apikey: 'eyJchave', Authorization: 'Bearer eyJchave', 'x-upsert': 'false' })
    );
    expect(JSON.parse(chamadas[3].init.body)).toEqual({ completa: true });
  });

  it('(f) falha nas notas deixa a análise incompleta, e leituras só veem as completas', async () => {
    responder((url, init) =>
      url.includes('analise_notas') ? { status: 500, corpo: 'erro' } : padrao(url, init)
    );
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    await expect(loja.salvar(analise, [nota('2026-03-01')], Buffer.from('z'))).rejects.toMatchObject({
      name: 'ErroSupabase',
      status: 500,
    });
    expect(chamadas.some(c => c.init.method === 'PATCH')).toBe(false);

    chamadas.length = 0;
    responder(() => ({ corpo: [] }));
    await loja.listar();
    await loja.maiorVersao(EMPRESA, '2026-03');
    await loja.obter(analise.id);
    expect(chamadas).toHaveLength(3);
    expect(chamadas.every(c => c.url.includes('completa=is.true'))).toBe(true);
  });

  it('a chave secreta nova vai só no apikey', async () => {
    responder(() => ({ corpo: [] }));
    await new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'sb_secret_abc').listar();
    expect(chamadas[0].init.headers.apikey).toBe('sb_secret_abc');
    expect(chamadas[0].init.headers.Authorization).toBeUndefined();
  });

  it('só o conflito do índice de versão vira ErroVersaoOcupada; outros 409 e pausa são ErroSupabase', async () => {
    const conflito = { code: '23505', message: `duplicate key value violates unique constraint "${RESTRICAO_VERSAO}"` };
    responder((url, init) => (init?.method === 'PATCH' ? { status: 409, corpo: conflito } : { status: 201 }));
    await expect(
      new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').salvar(analise, [], Buffer.from('z'))
    ).rejects.toBeInstanceOf(ErroVersaoOcupada);

    responder(url =>
      url.includes('analise_notas')
        ? { status: 409, corpo: { code: '23505', message: 'duplicate key value violates unique constraint "analise_notas_pkey"' } }
        : { status: 201 }
    );
    await expect(
      new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').salvar(analise, [nota('2026-03-01')], Buffer.from('z'))
    ).rejects.toMatchObject({ name: 'ErroSupabase', status: 409 });

    responder(() => ({ status: 540, corpo: 'Project paused' }));
    await expect(new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').listar()).rejects.toMatchObject({
      name: 'ErroSupabase',
    });
  });

  it('(d) atualizarEmpresa esconde, regrava as notas por upsert, aplica os campos e move o ZIP', async () => {
    responder((url, init) => (url.endsWith('/object/move') ? { status: 200, corpo: {} } : padrao(url, init)));
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');
    const novoCaminho = `${OUTRA}/2026-03/${analise.id}.zip`;

    const salva = await loja.atualizarEmpresa(
      analise.id,
      { empresaCnpj: OUTRA, empresaNome: 'OUTRA', competencia: '2026-03', versao: 2, resumo: {}, zipPath: novoCaminho },
      [nota('2026-03-01')]
    );

    expect(chamadas.map(c => `${c.init.method} ${c.url}`)).toEqual([
      `PATCH ${URL_PROJETO}/rest/v1/analises?id=eq.${analise.id}`,
      `POST ${URL_PROJETO}/rest/v1/analise_notas?on_conflict=analise_id,ordem`,
      `DELETE ${URL_PROJETO}/rest/v1/analise_notas?analise_id=eq.${analise.id}&ordem=gte.1`,
      `PATCH ${URL_PROJETO}/rest/v1/analises?id=eq.${analise.id}`,
      `POST ${URL_PROJETO}/storage/v1/object/move`,
      `PATCH ${URL_PROJETO}/rest/v1/analises?id=eq.${analise.id}`,
    ]);
    expect(JSON.parse(chamadas[0].init.body)).toEqual({ completa: false });
    expect(chamadas[1].init.headers.Prefer).toContain('resolution=merge-duplicates');
    expect(JSON.parse(chamadas[3].init.body)).toEqual(
      expect.objectContaining({ empresa_cnpj: OUTRA, empresa_nome: 'OUTRA', versao: 2, completa: true })
    );
    expect(JSON.parse(chamadas[4].init.body)).toEqual({
      bucketId: 'lotes',
      sourceKey: analise.zipPath,
      destinationKey: novoCaminho,
    });
    expect(JSON.parse(chamadas[5].init.body)).toEqual({ zip_path: novoCaminho });
    expect(salva.zipPath).toBe(novoCaminho);
  });

  it('atualizarEmpresa com menos notas apaga as linhas que sobram e grava total_notas', async () => {
    responder(padrao);
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    await loja.atualizarEmpresa(
      analise.id,
      { empresaCnpj: EMPRESA, empresaNome: 'EMPRESA', competencia: '2026-03', versao: 1, resumo: {}, zipPath: analise.zipPath },
      [nota('2026-03-01'), nota('2026-03-02')]
    );

    const apagar = chamadas.find(c => c.init.method === 'DELETE');
    expect(apagar?.url).toBe(`${URL_PROJETO}/rest/v1/analise_notas?analise_id=eq.${analise.id}&ordem=gte.2`);
    const ultimoPatch = chamadas.filter(c => c.init.method === 'PATCH').pop();
    expect(JSON.parse(ultimoPatch!.init.body)).toEqual(expect.objectContaining({ total_notas: 2, completa: true }));
    // O DELETE vem depois do upsert e antes de a análise voltar a aparecer.
    const ordem = chamadas.map(c => c.init.method);
    expect(ordem.indexOf('DELETE')).toBeGreaterThan(ordem.indexOf('POST'));
    expect(ordem.lastIndexOf('PATCH')).toBeGreaterThan(ordem.indexOf('DELETE'));
  });

  it('(d) se mover o ZIP falhar, a análise continua apontando para o caminho antigo', async () => {
    responder((url, init) => (url.endsWith('/object/move') ? { status: 400, corpo: 'erro' } : padrao(url, init)));
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    const salva = await loja.atualizarEmpresa(
      analise.id,
      {
        empresaCnpj: OUTRA,
        empresaNome: 'OUTRA',
        competencia: '2026-03',
        versao: 2,
        resumo: {},
        zipPath: `${OUTRA}/2026-03/${analise.id}.zip`,
      },
      []
    );

    expect(salva.zipPath).toBe(analise.zipPath);
    expect(chamadas.filter(c => c.init.method === 'PATCH')).toHaveLength(2);
  });

  it('atualizarEmpresa sem linha devolvida vira ErroSupabase 404', async () => {
    responder((_url, init) => (init?.method === 'PATCH' ? { corpo: [] } : { status: 201 }));
    await expect(
      new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').atualizarEmpresa(
        analise.id,
        { empresaCnpj: OUTRA, empresaNome: null, competencia: '2026-03', versao: 1, resumo: {}, zipPath: null },
        []
      )
    ).rejects.toMatchObject({ name: 'ErroSupabase', status: 404 });
  });

  it('empresas e uso vêm das funções SQL, sem o corte de 1.000 linhas', async () => {
    responder(url =>
      url.endsWith('rpc/empresas_com_analises')
        ? { corpo: [{ cnpj: EMPRESA, nome: 'EMPRESA', quantidade: '1500' }] }
        : { corpo: { analises: 1500, bytesZips: '2048', bytesBanco: 4096 } }
    );
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    expect(await loja.listarEmpresas()).toEqual([{ cnpj: EMPRESA, nome: 'EMPRESA', quantidade: 1500 }]);
    expect(await loja.uso()).toEqual(
      expect.objectContaining({ tipo: 'supabase', analises: 1500, bytesZips: 2048, bytesBanco: 4096 })
    );
    expect(chamadas.map(c => c.init.method)).toEqual(['POST', 'POST']);
  });

  it('lista em páginas e informa se há mais', async () => {
    responder(() => ({ corpo: Array.from({ length: 3 }, () => linha()) }));
    const pagina = await new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').listar({ offset: 4, limite: 2 });
    expect(chamadas[0].url).toContain('limit=3');
    expect(chamadas[0].url).toContain('offset=4');
    expect(pagina.analises).toHaveLength(2);
    expect(pagina.temMais).toBe(true);
  });

  it('lê as notas em páginas e devolve null para id que não é uuid', async () => {
    let paginas = 0;
    responder(url => {
      if (url.includes('/rest/v1/analises?')) return { corpo: [linha()] };
      paginas++;
      return { corpo: paginas === 1 ? Array.from({ length: 1000 }, () => ({ documento: nota('2026-03-01') })) : [] };
    });
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    const registro = await loja.obter(analise.id);
    expect(registro!.documentos).toHaveLength(1000);
    expect(paginas).toBe(2);
    expect(await loja.obter('../../etc')).toBeNull();
  });

  const RPC_EXCLUIR = `${URL_PROJETO}/rest/v1/rpc/excluir_analise`;
  const ZIP_URL = `${URL_PROJETO}/storage/v1/object/lotes/${EMPRESA}/2026-03/${analise.id}.zip`;
  const semFuncao = { status: 404, corpo: { code: 'PGRST202', message: 'Could not find the function public.excluir_analise' } };
  const metodo = (c: { init: any }) => c.init?.method ?? 'GET';

  it('excluir: a função SQL apaga notas e análise numa transação; depois sai o ZIP', async () => {
    responder(url => (url === RPC_EXCLUIR ? { corpo: [linha()] } : { status: 200, corpo: {} }));
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    const removida = await loja.excluir(analise.id);

    expect(chamadas.map(c => `${metodo(c)} ${c.url}`)).toEqual([`POST ${RPC_EXCLUIR}`, `DELETE ${ZIP_URL}`]);
    expect(JSON.parse(chamadas[0].init.body)).toEqual({ p_id: analise.id });
    expect(removida).toEqual({ analise: expect.objectContaining({ id: analise.id, zipBytes: 3 }), zipRemovido: true });
  });

  it('excluir: análise ausente na função ou id que não é uuid devolve null e não apaga o ZIP', async () => {
    responder(() => ({ corpo: [] }));
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    expect(await loja.excluir(analise.id)).toBeNull();
    expect(await loja.excluir('../../etc')).toBeNull();
    expect(chamadas.map(c => `${metodo(c)} ${c.url}`)).toEqual([`POST ${RPC_EXCLUIR}`]);
  });

  it('excluir sem a função (schema antigo): esconde, apaga as notas, a análise e o ZIP', async () => {
    responder((url, init) => {
      if (url === RPC_EXCLUIR) return semFuncao;
      if (!init?.method) return { corpo: [linha()] };
      return padrao(url, init);
    });
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    const removida = await loja.excluir(analise.id);

    expect(chamadas.map(c => `${metodo(c)} ${c.url}`)).toEqual([
      `POST ${RPC_EXCLUIR}`,
      `GET ${URL_PROJETO}/rest/v1/analises?id=eq.${analise.id}&select=*`,
      `PATCH ${URL_PROJETO}/rest/v1/analises?id=eq.${analise.id}`,
      `DELETE ${URL_PROJETO}/rest/v1/analise_notas?analise_id=eq.${analise.id}`,
      `DELETE ${URL_PROJETO}/rest/v1/analises?id=eq.${analise.id}`,
      `DELETE ${ZIP_URL}`,
    ]);
    expect(JSON.parse(chamadas[2].init.body)).toEqual({ completa: false });
    expect(removida).toEqual(expect.objectContaining({ zipRemovido: true }));
  });

  it('excluir sem a função: a linha some entre a leitura e o PATCH devolve null sem DELETE', async () => {
    responder((url, init) => {
      if (url === RPC_EXCLUIR) return semFuncao;
      if (!init?.method) return { corpo: [linha()] };
      if (init.method === 'PATCH') return { corpo: [] };
      return { status: 200 };
    });
    expect(await new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').excluir(analise.id)).toBeNull();
    expect(chamadas.filter(c => metodo(c) === 'DELETE')).toHaveLength(0);
  });

  it('excluir sem a função: falha nas notas devolve a análise completa à lista e lança', async () => {
    responder((url, init) => {
      if (url === RPC_EXCLUIR) return semFuncao;
      if (!init?.method) return { corpo: [linha()] };
      if (init.method === 'DELETE') return { status: 503, corpo: 'pausado' };
      return padrao(url, init);
    });

    await expect(new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').excluir(analise.id)).rejects.toMatchObject({
      name: 'ErroSupabase',
      status: 503,
    });
    const patches = chamadas.filter(c => metodo(c) === 'PATCH').map(c => JSON.parse(c.init.body));
    expect(patches).toEqual([{ completa: false }, { completa: true }]);
    expect(chamadas.filter(c => metodo(c) === 'DELETE')).toHaveLength(1);
  });

  it('excluir sem a função: análise já incompleta não volta a completa se as notas falharem', async () => {
    responder((url, init) => {
      if (url === RPC_EXCLUIR) return semFuncao;
      if (!init?.method) return { corpo: [linha({ completa: false })] };
      if (init.method === 'DELETE') return { status: 503, corpo: 'pausado' };
      return padrao(url, init);
    });

    await expect(new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').excluir(analise.id)).rejects.toBeInstanceOf(
      ErroSupabase
    );
    const patches = chamadas.filter(c => metodo(c) === 'PATCH').map(c => JSON.parse(c.init.body));
    expect(patches).toEqual([{ completa: false }]);
  });

  it('excluir sem a função: falha ao apagar a linha avisa que a exclusão ficou pela metade', async () => {
    responder((url, init) => {
      if (url === RPC_EXCLUIR) return semFuncao;
      if (!init?.method) return { corpo: [linha()] };
      if (init.method === 'DELETE' && url.includes('/rest/v1/analises?')) return { status: 500, corpo: 'erro' };
      return padrao(url, init);
    });

    const erro = await new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').excluir(analise.id).catch(e => e);
    expect(erro).toBeInstanceOf(ErroExclusaoParcial);
    expect(erro.message).toMatch(/excluída pela metade/);
    expect(erro.status).toBe(500);
    expect(chamadas.some(c => c.url.includes('/storage/'))).toBe(false);
  });

  it('reservarVersao usa a função reservar_versao, que guarda a maior já usada', async () => {
    responder(() => ({ corpo: 4 }));
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    expect(await loja.reservarVersao(EMPRESA, '2026-03')).toBe(4);
    expect(chamadas.map(c => `${metodo(c)} ${c.url}`)).toEqual([`POST ${URL_PROJETO}/rest/v1/rpc/reservar_versao`]);
    expect(JSON.parse(chamadas[0].init.body)).toEqual({ p_empresa: EMPRESA, p_competencia: '2026-03' });
  });

  it('reservarVersao sem a função (schema antigo) usa a maior versão gravada + 1', async () => {
    responder(url =>
      url.includes('rpc/reservar_versao')
        ? { status: 404, corpo: { code: 'PGRST202', message: 'Could not find the function public.reservar_versao' } }
        : { corpo: [{ versao: 2 }] }
    );
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    expect(await loja.reservarVersao(EMPRESA, '2026-03')).toBe(3);
    expect(chamadas[1].url).toContain('/rest/v1/analises?select=versao&completa=is.true');
  });

  it('reservarVersao propaga falhas que não são função ausente', async () => {
    responder(() => ({ status: 503, corpo: 'pausado' }));
    await expect(new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k').reservarVersao(EMPRESA, '2026-03')).rejects.toMatchObject({
      name: 'ErroSupabase',
      status: 503,
    });
    expect(chamadas).toHaveLength(1);
  });

  it('excluir: ZIP ausente ou que falha ao apagar vira aviso, e a análise sai', async () => {
    const loja = new ArmazenamentoAnalisesSupabase(URL_PROJETO, 'k');

    responder(url => (url === RPC_EXCLUIR ? { corpo: [linha()] } : { status: 400, corpo: { error: 'not_found' } }));
    expect(await loja.excluir(analise.id)).toEqual(
      expect.objectContaining({ zipRemovido: false, avisoZip: expect.stringMatching(/já não existia/) })
    );

    responder(url => (url === RPC_EXCLUIR ? { corpo: [linha()] } : { status: 500, corpo: 'erro' }));
    expect(await loja.excluir(analise.id)).toEqual(
      expect.objectContaining({ zipRemovido: false, avisoZip: expect.stringMatching(/não foi apagado.*HTTP 500/) })
    );
  });
});

describe('excluirAnalises', () => {
  async function salvarNota(dia: string, zip = 'zip') {
    const sessao = await sessaoCom([nota(dia)], EMPRESA);
    const salva = await salvarAposUpload(sessao, { zip: Buffer.from(zip), criadoPor: 'x', lote: LOTE_VAZIO });
    return { sessao, analise: salva.analise! };
  }

  it('exclui análise, notas e ZIP e informa o espaço liberado', async () => {
    const { analise } = await salvarNota('2026-03-01', 'abcde');
    const resultado = await excluirAnalises([analise.id], 'contador@exemplo.com');

    expect(resultado).toEqual(
      expect.objectContaining({ excluidas: [analise.id], naoEncontradas: [], bytesLiberados: 5, avisos: [] })
    );
    expect(await armazenamentoAnalises().obter(analise.id)).toBeNull();
    expect((await armazenamentoAnalises().uso()).bytesZips).toBe(0);
  });

  it('lote parcial: exclui os existentes e devolve os não encontrados; repetidos contam uma vez', async () => {
    const a = (await salvarNota('2026-03-01')).analise;
    const b = (await salvarNota('2026-03-02')).analise;
    const inexistente = '00000000-0000-4000-8000-000000000000';

    const resultado = await excluirAnalises([a.id, inexistente, b.id, a.id], 'x');
    expect(resultado.excluidas).toEqual([a.id, b.id]);
    expect(resultado.naoEncontradas).toEqual([inexistente]);
    expect((await armazenamentoAnalises().listar()).analises).toHaveLength(0);
  });

  it('não renumera as versões restantes; a próxima importação segue a maior', async () => {
    const v1 = (await salvarNota('2026-03-01')).analise;
    const v2 = (await salvarNota('2026-03-02')).analise;
    const v3 = (await salvarNota('2026-03-03')).analise;
    expect([v1.versao, v2.versao, v3.versao]).toEqual([1, 2, 3]);

    await excluirAnalises([v2.id], 'x');

    const restantes = (await armazenamentoAnalises().listar()).analises;
    expect(restantes.map(a => [a.id, a.versao])).toEqual([
      [v3.id, 3],
      [v1.id, 1],
    ]);
    expect((await salvarNota('2026-03-04')).analise.versao).toBe(4);
  });

  it('excluir a versão mais alta não libera o número: a próxima importação vira a seguinte', async () => {
    await salvarNota('2026-03-01');
    await salvarNota('2026-03-02');
    const v3 = (await salvarNota('2026-03-03')).analise;
    expect(v3.versao).toBe(3);

    await excluirAnalises([v3.id], 'x');
    expect(await armazenamentoAnalises().maiorVersao(EMPRESA, '2026-03')).toBe(2);
    expect((await salvarNota('2026-03-04')).analise.versao).toBe(4);
  });

  it('versão reservada por gravação que falhou é pulada, não reusada', async () => {
    const loja = new ArmazenamentoAnalisesMemoria();
    definirArmazenamentoAnalises(loja);
    expect((await salvarNota('2026-03-01')).analise.versao).toBe(1);

    const salvarOriginal = loja.salvar.bind(loja);
    loja.salvar = async () => {
      throw new ErroSupabase('Sem resposta da Supabase (fetch failed).');
    };
    const sessao = await sessaoCom([nota('2026-03-02')], EMPRESA);
    expect((await salvarAposUpload(sessao, { zip: Buffer.from('z'), criadoPor: 'x', lote: LOTE_VAZIO })).analiseSalva).toBe(false);
    loja.salvar = salvarOriginal;

    expect((await salvarNota('2026-03-03')).analise.versao).toBe(3);
  });

  it('desfaz o vínculo das sessões ligadas, que seguem com as notas em memória', async () => {
    const { sessao, analise } = await salvarNota('2026-03-01');
    sessionService.criarOuRecuperarSessao('sess-excluir-aberta', 'outro', 'outro@exemplo.com');
    await abrirNaSessao(analise.id, 'sess-excluir-aberta');

    const resultado = await excluirAnalises([analise.id], 'x');

    expect(resultado.sessoesDesvinculadas).toBe(2);
    for (const id of [sessao.sessionId, 'sess-excluir-aberta']) {
      const depois = sessionService.obterSessao(id)!;
      expect(depois.analiseId).toBeUndefined();
      expect(depois.analiseOrigem).toBeUndefined();
      expect(depois.documentos).toHaveLength(1);
    }
  });

  it('ZIP ausente: exclui a análise e devolve o aviso', async () => {
    const loja = new ArmazenamentoAnalisesMemoria();
    definirArmazenamentoAnalises(loja);
    const { analise } = await salvarNota('2026-03-01');
    const salva = (await loja.obter(analise.id))!.analise;
    (loja as any).zips.delete(salva.zipPath);

    const resultado = await excluirAnalises([analise.id], 'x');
    expect(resultado.excluidas).toEqual([analise.id]);
    expect(resultado.bytesLiberados).toBe(0);
    expect(resultado.avisos).toEqual([expect.stringMatching(/já não existia/)]);
  });

  it('falha do armazenamento no meio do lote informa o que já saiu', async () => {
    const loja = new ArmazenamentoAnalisesMemoria();
    definirArmazenamentoAnalises(loja);
    const a = (await salvarNota('2026-03-01')).analise;
    const b = (await salvarNota('2026-03-02')).analise;
    const excluirOriginal = loja.excluir.bind(loja);
    loja.excluir = async id => {
      if (id === b.id) throw new ErroSupabase('Sem resposta da Supabase (fetch failed).');
      return excluirOriginal(id);
    };

    const erro = await excluirAnalises([a.id, b.id], 'x').catch(e => e);
    expect(erro).toBeInstanceOf(ErroExclusaoInterrompida);
    expect(erro.parcial.excluidas).toEqual([a.id]);
    expect(await loja.obter(b.id)).not.toBeNull();
  });

  it('registra no log quem excluiu e, se houver, o administrador que assumiu a conta', async () => {
    const a = (await salvarNota('2026-03-01')).analise;
    const b = (await salvarNota('2026-03-02')).analise;
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await excluirAnalises([a.id], 'contador@exemplo.com');
      await excluirAnalises([b.id], 'cliente@exemplo.com', { userId: 'adm', email: 'admin@exemplo.com' });
      const linhas = log.mock.calls.map(c => String(c[0])).filter(l => l.includes('excluiu a análise'));
      expect(linhas[0]).toContain(
        `contador@exemplo.com excluiu a análise ${a.id} (empresa ${EMPRESA}, competência 2026-03, versão 1)`
      );
      expect(linhas[1]).toMatch(/cliente@exemplo\.com \(assumido por admin@exemplo\.com\) excluiu/);
    } finally {
      log.mockRestore();
    }
  });

  it('id em maiúsculas casa com a análise e com a sessão, e conta uma vez', async () => {
    const { sessao, analise } = await salvarNota('2026-03-01');
    const resultado = await excluirAnalises([analise.id.toUpperCase(), analise.id], 'x');
    expect(resultado.excluidas).toEqual([analise.id]);
    expect(resultado.sessoesDesvinculadas).toBe(1);
    expect(sessionService.obterSessao(sessao.sessionId)!.analiseId).toBeUndefined();
  });

  it('desfaz o vínculo da sessão antes de apagar no armazenamento', async () => {
    const loja = new ArmazenamentoAnalisesMemoria();
    definirArmazenamentoAnalises(loja);
    const { sessao, analise } = await salvarNota('2026-03-01');
    const excluirOriginal = loja.excluir.bind(loja);
    let vinculoDurante: string | undefined = 'nao-lido';
    loja.excluir = async id => {
      vinculoDurante = sessionService.obterSessao(sessao.sessionId)!.analiseId;
      return excluirOriginal(id);
    };

    await excluirAnalises([analise.id], 'x');
    expect(vinculoDurante).toBeUndefined();
  });
});
