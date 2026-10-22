import { DocumentType, NFeDocument } from '../types';
import { definirArmazenamentoAnalises, excluirAnalises } from './analises';
import {
  AnaliseSalva,
  ArmazenamentoAnalisesMemoria,
  ErroSupabase,
  SEM_COMPETENCIA,
  caminhoDoZip,
} from './armazenamentoAnalises';
import {
  AVISO_SEM_ANALISES,
  ErroCargaEmpresa,
  ErroEmpresaInvalida,
  JANELA_LISTAGEM_MS,
  MAXIMO_NOTAS_EM_CACHE,
  TTL_CONJUNTO_MS,
  carregarConjunto,
  definirRelogio,
  lerEmpresa,
  limparCacheConjuntos,
  origemDosDocumentos,
  sessoesEmCache,
  tabelaDeImportacoes,
} from './conjuntoEmpresa';
import { sessionService } from './session';

const SUPERA = '11111111000111';
const OUTRA = '99999999000199';

let sequencia = 0;
function nota(tipo: DocumentType, total: number, icms = 0, cfops: string[] = [], chave?: string): NFeDocument {
  sequencia++;
  return {
    id: `doc-${sequencia}`,
    modelo: 55,
    tipo,
    chaveNFe: chave ?? `chave-${sequencia}`,
    dataEmissao: '2026-03-10T10:00:00.000Z',
    diaEmissao: '2026-03-10',
    cnpjEmitente: tipo === 'saida' ? SUPERA : OUTRA,
    nomeEmitente: 'EMITENTE',
    cnpjDestino: tipo === 'saida' ? OUTRA : SUPERA,
    nomeDestino: 'DESTINO',
    regimeTributario: 'Lucro-Real',
    values: {
      baseCalculo: 0, icms, icmsST: 0, ipi: 0, iss: 0, pis: 0, cofins: 0,
      irrf: 0, aliquota: 0, cbs: 0, ibs: 0, total,
    },
    validacoes: [],
    divergencias: [],
    cfops,
    ncms: [],
  };
}

let loja: ArmazenamentoAnalisesMemoria;
let idAnalise = 0;
let gravadoEm = Date.parse('2026-04-01T00:00:00.000Z');
/** Relógio do módulo: avança só quando o teste manda. */
let instante = 0;

/** Passa da janela de reaproveitamento da listagem. */
const depoisDaJanela = () => {
  instante += JANELA_LISTAGEM_MS + 1;
};

async function salvar(
  empresa: string,
  competencia: string,
  versao: number,
  documentos: NFeDocument[],
  nome: string | null = empresa === SUPERA ? 'SUPERA LTDA' : 'OUTRA LTDA'
) {
  idAnalise++;
  gravadoEm += 60_000;
  const id = `00000000-0000-4000-8000-${String(idAnalise).padStart(12, '0')}`;
  const analise: AnaliseSalva = {
    id,
    empresaCnpj: empresa,
    empresaNome: nome,
    competencia,
    versao,
    criadoPor: 'contador@exemplo.com',
    criadoEm: new Date(gravadoEm).toISOString(),
    totalNotas: documentos.length,
    resumo: { nomeArquivo: `${competencia}-v${versao}.zip` },
    versaoTabela: null,
    zipPath: caminhoDoZip(empresa, competencia, id),
    zipBytes: 3,
  };
  await loja.salvar(analise, documentos, Buffer.from('zip'));
  return analise;
}

const varias = (n: number, tipo: DocumentType = 'entrada', total = 10) =>
  Array.from({ length: n }, () => nota(tipo, total, 1));

let contadorSessao = 0;
const novaSessao = () => `sess-conjunto-${++contadorSessao}`;

beforeEach(() => {
  loja = new ArmazenamentoAnalisesMemoria();
  definirArmazenamentoAnalises(loja);
  limparCacheConjuntos();
  instante = 1_000_000;
  definirRelogio(() => instante);
});

afterAll(() => {
  definirRelogio(() => Date.now());
});

describe('lerEmpresa', () => {
  it('ausente ou vazio é o lote atual', () => {
    expect(lerEmpresa({})).toBeNull();
    expect(lerEmpresa({ empresa: '  ' })).toBeNull();
    expect(lerEmpresa(undefined)).toBeNull();
  });

  it('aceita o CNPJ com ou sem pontuação', () => {
    expect(lerEmpresa({ empresa: '11.111.111/0001-11' })).toBe(SUPERA);
  });

  it('recusa o que não é CNPJ de 14 dígitos', () => {
    for (const empresa of ['abc', '123', 'sem-empresa', '111111110001110']) {
      expect(() => lerEmpresa({ empresa })).toThrow(ErroEmpresaInvalida);
    }
  });
});

describe('carregarConjunto: versões e competências', () => {
  it('só a versão mais recente da competência entra: 41 notas, não 123', async () => {
    await salvar(SUPERA, '2026-03', 1, varias(41));
    await salvar(SUPERA, '2026-03', 2, varias(41));
    const v3 = await salvar(SUPERA, '2026-03', 3, varias(41));

    const conjunto = await carregarConjunto(novaSessao(), SUPERA);
    expect(conjunto.documentos).toHaveLength(41);
    expect(conjunto.importacoes.map(i => i.analise.id)).toEqual([v3.id]);
    expect(conjunto.nome).toBe('SUPERA LTDA');
  });

  it('soma competências diferentes, cada uma na sua versão mais recente', async () => {
    await salvar(SUPERA, '2026-01', 1, varias(2));
    await salvar(SUPERA, '2026-02', 1, varias(5));
    await salvar(SUPERA, '2026-02', 2, varias(3));
    await salvar(OUTRA, '2026-02', 1, varias(7));

    const conjunto = await carregarConjunto(novaSessao(), SUPERA);
    expect(conjunto.documentos).toHaveLength(5);
    expect(conjunto.importacoes.map(i => [i.analise.competencia, i.analise.versao])).toEqual([
      ['2026-02', 2],
      ['2026-01', 1],
    ]);
  });

  it('as análises sem competência entram todas, no fim', async () => {
    await salvar(SUPERA, SEM_COMPETENCIA, 1, varias(2));
    await salvar(SUPERA, SEM_COMPETENCIA, 2, varias(3));
    await salvar(SUPERA, '2026-01', 1, varias(1));

    const conjunto = await carregarConjunto(novaSessao(), SUPERA);
    expect(conjunto.documentos).toHaveLength(6);
    expect(conjunto.importacoes.map(i => i.analise.competencia)).toEqual(['2026-01', SEM_COMPETENCIA, SEM_COMPETENCIA]);
  });

  it('sem nome em nenhuma análise, usa o CNPJ formatado', async () => {
    await salvar(SUPERA, '2026-01', 1, varias(1), null);
    expect((await carregarConjunto(novaSessao(), SUPERA)).nome).toBe('11.111.111/0001-11');
  });

  it('percorre as páginas da listagem e mantém a competência mais antiga', async () => {
    const antiga = await salvar(SUPERA, '2026-01', 1, varias(2));
    const nova = await salvar(SUPERA, '2026-02', 1, varias(3));
    const listar = jest.spyOn(loja, 'listar').mockImplementation(async ({ offset = 0 } = {}) =>
      offset === 0
        ? { analises: [nova], temMais: true }
        : // A segunda página repete a primeira (lista mudou no meio): conta uma vez.
          { analises: [nova, antiga], temMais: false }
    );

    const conjunto = await carregarConjunto(novaSessao(), SUPERA);
    expect(listar).toHaveBeenCalledTimes(2);
    expect(conjunto.importacoes.map(i => i.analise.competencia)).toEqual(['2026-02', '2026-01']);
    expect(conjunto.documentos).toHaveLength(5);
  });
});

describe('carregarConjunto: mudanças entre a listagem e a leitura', () => {
  it('versão mais recente sumiu: usa a próxima versão listada da competência', async () => {
    await salvar(SUPERA, '2026-03', 1, varias(2));
    const v2 = await salvar(SUPERA, '2026-03', 2, varias(3));
    const obter = loja.obter.bind(loja);
    jest.spyOn(loja, 'obter').mockImplementation(async id => (id === v2.id ? null : obter(id)));

    const conjunto = await carregarConjunto(novaSessao(), SUPERA);
    expect(conjunto.importacoes.map(i => i.analise.versao)).toEqual([1]);
    expect(conjunto.documentos).toHaveLength(2);
  });

  it('análise que mudou de empresa fica de fora', async () => {
    await salvar(SUPERA, '2026-03', 1, varias(2));
    const v2 = await salvar(SUPERA, '2026-03', 2, varias(3));
    const obter = loja.obter.bind(loja);
    jest.spyOn(loja, 'obter').mockImplementation(async id => {
      const registro = await obter(id);
      if (registro && id === v2.id) registro.analise.empresaCnpj = OUTRA;
      return registro;
    });

    const conjunto = await carregarConjunto(novaSessao(), SUPERA);
    expect(conjunto.importacoes.map(i => i.analise.versao)).toEqual([1]);
  });
});

describe('carregarConjunto: notas repetidas', () => {
  it('a mesma nota em duas competências conta uma vez, na importação mais recente', async () => {
    const repetida = () => nota('entrada', 100, 10, [], 'CHAVE-REPETIDA');
    const semChave = () => nota('entrada', 1, 0, [], 'N/A');
    await salvar(SUPERA, '2026-02', 1, [repetida(), nota('entrada', 50, 5), semChave()]);
    await salvar(SUPERA, '2026-03', 1, [repetida(), nota('entrada', 70, 7), semChave()]);

    const conjunto = await carregarConjunto(novaSessao(), SUPERA);
    // 2 de 03, 1 de 02 sem a repetida, e as duas sem chave (não comparáveis).
    expect(conjunto.documentos).toHaveLength(5);
    const tabela = tabelaDeImportacoes(conjunto, {});
    expect(tabela.importacoes.map(l => [l.competencia, l.notas])).toEqual([
      ['2026-03', 3],
      ['2026-02', 2],
    ]);
    expect(tabela.total.valorTotal).toBe(100 + 70 + 1 + 50 + 1);
  });
});

describe('carregarConjunto: cache', () => {
  it('reaproveita a carga e a listagem enquanto nada muda', async () => {
    await salvar(SUPERA, '2026-03', 1, varias(4));
    const sessao = novaSessao();
    const obter = jest.spyOn(loja, 'obter');
    const listar = jest.spyOn(loja, 'listar');

    const [a, b] = await Promise.all([carregarConjunto(sessao, SUPERA), carregarConjunto(sessao, SUPERA)]);
    const c = await carregarConjunto(sessao, SUPERA);
    expect(listar).toHaveBeenCalledTimes(1);
    expect(obter).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);

    // Depois da janela, lista de novo, mas sem mudança não relê as notas.
    depoisDaJanela();
    expect(await carregarConjunto(sessao, SUPERA)).toBe(a);
    expect(listar).toHaveBeenCalledTimes(2);
    expect(obter).toHaveBeenCalledTimes(1);

    // Nova versão: recarrega.
    await salvar(SUPERA, '2026-03', 2, varias(6));
    depoisDaJanela();
    expect((await carregarConjunto(sessao, SUPERA)).documentos).toHaveLength(6);
    expect(obter).toHaveBeenCalledTimes(2);
  });

  it('exclusão por este servidor vale na hora: a próxima carga usa a versão anterior', async () => {
    await salvar(SUPERA, '2026-03', 1, varias(2));
    const v2 = await salvar(SUPERA, '2026-03', 2, varias(3));
    const sessao = novaSessao();
    expect((await carregarConjunto(sessao, SUPERA)).documentos).toHaveLength(3);

    await excluirAnalises([v2.id], 'teste');
    const depois = await carregarConjunto(sessao, SUPERA);
    expect(depois.documentos).toHaveLength(2);
    expect(depois.importacoes[0].analise.versao).toBe(1);
  });

  it('alteração no lugar (troca de empresa mantendo id e versão) invalida a carga', async () => {
    const v1 = await salvar(SUPERA, '2026-03', 1, varias(2));
    const sessao = novaSessao();
    expect((await carregarConjunto(sessao, SUPERA)).nome).toBe('SUPERA LTDA');

    await loja.atualizarEmpresa(
      v1.id,
      {
        empresaCnpj: SUPERA,
        empresaNome: 'SUPERA NOVO NOME',
        competencia: '2026-03',
        versao: 1,
        resumo: { porSentido: { entrada: 0, saida: 2, indefinido: 0 } },
        zipPath: v1.zipPath,
      },
      varias(2, 'saida')
    );
    depoisDaJanela();
    const depois = await carregarConjunto(sessao, SUPERA);
    expect(depois.nome).toBe('SUPERA NOVO NOME');
    expect(depois.documentos.every(d => d.tipo === 'saida')).toBe(true);
  });

  it('trocar de empresa na mesma sessão carrega o conjunto da outra', async () => {
    await salvar(SUPERA, '2026-03', 1, varias(2));
    await salvar(OUTRA, '2026-03', 1, varias(7));
    const sessao = novaSessao();

    expect((await carregarConjunto(sessao, SUPERA)).documentos).toHaveLength(2);
    expect((await carregarConjunto(sessao, OUTRA)).documentos).toHaveLength(7);
    expect((await carregarConjunto(sessao, SUPERA)).documentos).toHaveLength(2);
    expect(sessoesEmCache()).toEqual([sessao]);
  });

  it('vence em 10 minutos', async () => {
    await salvar(SUPERA, '2026-03', 1, varias(2));
    const sessao = novaSessao();
    const obter = jest.spyOn(loja, 'obter');
    await carregarConjunto(sessao, SUPERA);
    instante += TTL_CONJUNTO_MS;
    await carregarConjunto(sessao, SUPERA);
    expect(obter).toHaveBeenCalledTimes(2);
  });

  it('acima do limite de notas, sai a sessão usada há mais tempo', async () => {
    const metade = Math.floor(MAXIMO_NOTAS_EM_CACHE / 2) + 1;
    await salvar(SUPERA, '2026-03', 1, varias(metade));
    await salvar(OUTRA, '2026-03', 1, varias(metade));
    const [s1, s2, s3] = [novaSessao(), novaSessao(), novaSessao()];

    await carregarConjunto(s1, SUPERA);
    await carregarConjunto(s2, OUTRA);
    // Duas metades passam do limite: s1, a menos usada, sai.
    expect(sessoesEmCache()).toEqual([s2]);

    await carregarConjunto(s3, '22222222000122'); // vazia, cabe
    await carregarConjunto(s2, OUTRA); // s2 vira a mais recente
    expect(sessoesEmCache()).toEqual([s3, s2]);
  });

  it('sessão encerrada perde o que tinha guardado', async () => {
    await salvar(SUPERA, '2026-03', 1, varias(2));
    const sessao = novaSessao();
    sessionService.criarOuRecuperarSessao(sessao, 'u', 'u@exemplo.com');
    await carregarConjunto(sessao, SUPERA);
    expect(sessoesEmCache()).toContain(sessao);

    sessionService.deletarSessao(sessao);
    expect(sessoesEmCache()).not.toContain(sessao);
  });

  it('falha do armazenamento vira ErroCargaEmpresa com a causa', async () => {
    jest.spyOn(loja, 'listar').mockRejectedValue(new ErroSupabase('sem rede'));
    await expect(carregarConjunto(novaSessao(), SUPERA)).rejects.toThrow(ErroCargaEmpresa);
    await expect(carregarConjunto(novaSessao(), SUPERA)).rejects.toThrow(/Restore project/);
  });

  it('falha ao ler as notas não fica presa no cache', async () => {
    await salvar(SUPERA, '2026-03', 1, varias(2));
    const sessao = novaSessao();
    const obter = jest.spyOn(loja, 'obter').mockRejectedValueOnce(new ErroSupabase('sem rede'));
    await expect(carregarConjunto(sessao, SUPERA)).rejects.toThrow(ErroCargaEmpresa);
    obter.mockRestore();
    expect((await carregarConjunto(sessao, SUPERA)).documentos).toHaveLength(2);
  });
});

describe('origemDosDocumentos', () => {
  it('empresa sem análises: conjunto vazio com o aviso', async () => {
    const origem = await origemDosDocumentos(novaSessao(), { empresa: SUPERA });
    expect(origem.documentos).toEqual([]);
    expect(origem.aviso).toBe(AVISO_SEM_ANALISES);
    expect(origem.empresa).toEqual(expect.objectContaining({ cnpj: SUPERA }));
  });

  it('sem empresa usa o lote da sessão (vazio quando não há sessão)', async () => {
    const origem = await origemDosDocumentos('sessao-inexistente', {});
    expect(origem.documentos).toEqual([]);
    expect(origem.conjunto).toBeUndefined();
  });
});

describe('tabelaDeImportacoes', () => {
  it('uma linha por importação e o total geral igual à soma', async () => {
    await salvar(SUPERA, '2026-01', 1, [nota('entrada', 100, 10), nota('saida', 50, 5)]);
    await salvar(SUPERA, '2026-02', 1, [nota('entrada', 200, 20)]);
    await salvar(SUPERA, '2026-02', 2, [nota('entrada', 300, 30), nota('saida', 400, 40)]);

    const tabela = tabelaDeImportacoes(await carregarConjunto(novaSessao(), SUPERA), {});
    expect(tabela.importacoes).toEqual([
      expect.objectContaining({ competencia: '2026-02', versao: 2, notas: 2, valorTotal: 700, tributos: 70, nomeArquivo: '2026-02-v2.zip' }),
      expect.objectContaining({ competencia: '2026-01', versao: 1, notas: 2, valorTotal: 150, tributos: 15 }),
    ]);
    expect(tabela.total).toEqual({ notas: 4, valorTotal: 850, tributos: 85 });
    expect(tabela.aviso).toBeUndefined();
  });

  it('respeita os filtros: só entradas', async () => {
    await salvar(SUPERA, '2026-01', 1, [nota('entrada', 100, 10, ['1102']), nota('saida', 50, 5, ['5102'])]);
    const conjunto = await carregarConjunto(novaSessao(), SUPERA);

    expect(tabelaDeImportacoes(conjunto, { sentido: 'entrada' }).total).toEqual({ notas: 1, valorTotal: 100, tributos: 10 });
    expect(tabelaDeImportacoes(conjunto, { cfop: '5102' }).total).toEqual({ notas: 1, valorTotal: 50, tributos: 5 });
  });
});
