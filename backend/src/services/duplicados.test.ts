import { NFeDocument } from '../types';
import { identidadeNota, identidadesNota } from '../utils/identidadeNota';
import { definirArmazenamentoAnalises } from './analises';
import {
  AnaliseSalva,
  ArmazenamentoAnalisesMemoria,
  ErroSupabase,
  SEM_COMPETENCIA,
  caminhoDoZip,
} from './armazenamentoAnalises';
import {
  MOTIVO_REPETIDO_NO_ZIP,
  avisoSemIdentidade,
  definirTempoChecagem,
  separarJaImportadas,
  separarRepetidasNoZip,
} from './duplicados';

const EMPRESA = '11111111000111';
const OUTRA = '99999999000199';
const FORNECEDOR = '22222222000122';

let sequencia = 0;

/** Chave de acesso fictícia de 44 dígitos. */
function chave(n: number): string {
  return `352603${FORNECEDOR}55001${String(n).padStart(9, '0')}1000000001`;
}

function nfe(n: number, dia = '2026-03-10'): NFeDocument {
  sequencia++;
  return {
    id: `doc-${sequencia}`,
    modelo: 55,
    tipo: 'entrada',
    chaveNFe: chave(n),
    dataEmissao: `${dia}T10:00:00.000Z`,
    diaEmissao: dia,
    cnpjEmitente: FORNECEDOR,
    nomeEmitente: 'FORNECEDOR',
    cnpjDestino: EMPRESA,
    nomeDestino: 'EMPRESA LTDA',
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

function nfse(numero: string, codigo = '', prestador = FORNECEDOR): NFeDocument {
  return {
    ...nfe(0),
    modelo: 'NFSE',
    chaveNFe: codigo || numero || 'N/A',
    cnpjEmitente: prestador,
    numeroNfse: numero,
    codigoVerificacao: codigo,
  };
}

let loja: ArmazenamentoAnalisesMemoria;
let idAnalise = 0;

async function salvar(empresa: string, competencia: string, versao: number, documentos: NFeDocument[]) {
  idAnalise++;
  const id = `00000000-0000-4000-9000-${String(idAnalise).padStart(12, '0')}`;
  const analise: AnaliseSalva = {
    id,
    empresaCnpj: empresa,
    empresaNome: 'EMPRESA LTDA',
    competencia,
    versao,
    criadoPor: 'teste@exemplo.com',
    criadoEm: new Date(Date.UTC(2026, 3, 1, 0, idAnalise)).toISOString(),
    totalNotas: documentos.length,
    resumo: {},
    versaoTabela: null,
    zipPath: caminhoDoZip(empresa, competencia, id),
    zipBytes: 1,
  };
  await loja.salvar(analise, documentos, Buffer.from('zip'));
  return id;
}

afterEach(() => jest.restoreAllMocks());

beforeEach(() => {
  loja = new ArmazenamentoAnalisesMemoria();
  definirArmazenamentoAnalises(loja);
});

let contadorSessao = 0;
/** Cada chamada com a sua sessão: o cache do conjunto da empresa é por sessão. */
function dados(extra: { empresaCnpj?: string | null; competenciaDoLote?: string; ignorarAnalise?: string } = {}) {
  contadorSessao++;
  return {
    sessionId: `sess-duplicados-${contadorSessao}`,
    empresaCnpj: EMPRESA as string | null,
    competenciaDoLote: '2026-03',
    ...extra,
  };
}

/** NFS-e gravada antes de o parser guardar número e código separados. */
function nfseAntiga(chaveAntiga: string, dia = '2026-03-10'): NFeDocument {
  const doc: NFeDocument = { ...nfse('x'), chaveNFe: chaveAntiga, diaEmissao: dia };
  delete doc.numeroNfse;
  delete doc.codigoVerificacao;
  return doc;
}

describe('identidadeNota', () => {
  it('NF-e, NFC-e e CT-e pela chave de 44 dígitos', () => {
    expect(identidadeNota(nfe(1))).toBe(`chave:${chave(1)}`);
    expect(identidadeNota({ ...nfe(1), modelo: 57 })).toBe(`chave:${chave(1)}`);
  });

  it('sem chave confiável não tem identidade', () => {
    expect(identidadeNota({ ...nfe(1), chaveNFe: 'N/A' })).toBeNull();
    expect(identidadeNota({ ...nfe(1), chaveNFe: '' })).toBeNull();
    expect(identidadeNota({ ...nfe(1), chaveNFe: '123' })).toBeNull();
  });

  it('NFS-e: prestador + código de verificação; sem código, prestador + número + ano', () => {
    expect(identidadeNota(nfse('10', 'ABC'))).toBe(`nfse:${FORNECEDOR}:c:ABC`);
    expect(identidadeNota(nfse('10', 'ABC'))).toBe(identidadeNota(nfse('010', 'abc')));
    expect(identidadeNota(nfse('10', 'ABC'))).not.toBe(identidadeNota(nfse('10', 'XYZ')));
    expect(identidadeNota(nfse('10', 'ABC'))).not.toBe(identidadeNota(nfse('10', 'ABC', OUTRA)));
    expect(identidadeNota(nfse('10'))).toBe(`nfse:${FORNECEDOR}:n:10:2026`);
  });

  it('NFS-e: o mesmo número em anos diferentes não é a mesma nota', () => {
    const em2025 = { ...nfse('10'), diaEmissao: '2025-12-30' };
    expect(identidadeNota(em2025)).not.toBe(identidadeNota(nfse('10')));
  });

  it('NFS-e sem prestador, ou sem número e código, não tem identidade', () => {
    expect(identidadeNota(nfse('', ''))).toBeNull();
    expect(identidadeNota(nfse('10', 'ABC', ''))).toBeNull();
    expect(identidadeNota({ ...nfse('10'), diaEmissao: undefined })).toBeNull();
  });

  it('NFS-e antiga (sem numeroNfse) reconhece a nova da mesma nota pelo código ou pelo número', () => {
    expect(identidadesNota(nfseAntiga('ABC'))).toContain(identidadeNota(nfse('10', 'abc')));
    expect(identidadesNota(nfseAntiga('10'))).toContain(identidadeNota(nfse('10')));
    expect(identidadesNota(nfseAntiga('10', '2025-01-01'))).not.toContain(identidadeNota(nfse('10')));
  });
});

describe('separarRepetidasNoZip', () => {
  it('a primeira cópia entra; as seguintes são puladas como "repetido no ZIP"', () => {
    const a = nfe(1);
    const copia = { ...nfe(1), id: 'copia' };
    const b = nfe(2);
    const r = separarRepetidasNoZip([a, copia, b], { [a.id]: 'a.xml', copia: 'pasta/a-copia.xml' });

    expect(r.documentos.map(d => d.id)).toEqual([a.id, b.id]);
    expect(r.duplicados).toEqual([
      expect.objectContaining({ nomeArquivo: 'pasta/a-copia.xml', regra: 'zip', motivo: MOTIVO_REPETIDO_NO_ZIP }),
    ]);
  });

  it('nota sem identidade nunca é bloqueada e gera aviso', () => {
    const r = separarRepetidasNoZip([nfse(''), nfse('')]);

    expect(r.documentos).toHaveLength(2);
    expect(r.duplicados).toHaveLength(0);
    expect(r.semIdentidade).toHaveLength(2);
    expect(avisoSemIdentidade(r.semIdentidade)).toContain(
      '2 notas sem identidade confiável (NFS-e sem número nem código de verificação)'
    );
  });

  it('NFS-e com mesmo prestador, número e código é duplicada', () => {
    const r = separarRepetidasNoZip([nfse('7', 'COD'), nfse('7', 'COD'), nfse('8', 'COD2')]);
    expect(r.documentos).toHaveLength(2);
    expect(r.duplicados).toHaveLength(1);
  });
});

describe('separarJaImportadas', () => {
  const FEV = '2026-02-10';

  it('pula a nota já salva em outra competência da empresa, com a origem', async () => {
    const id = await salvar(EMPRESA, '2026-02', 1, [nfe(1, FEV)]);

    const r = await separarJaImportadas([nfe(1, FEV), nfe(2)], dados());

    expect(r.documentos.map(d => d.chaveNFe)).toEqual([chave(2)]);
    expect(r.duplicados).toEqual([
      expect.objectContaining({
        regra: 'analise',
        motivo: 'já importada em EMPRESA LTDA · 02/2026 · v1',
        origem: expect.objectContaining({ analiseId: id, competencia: '2026-02', versao: 1 }),
      }),
    ]);
  });

  it('nota emitida no mês da competência do lote nunca é bloqueada por outra competência', async () => {
    // A nota de fevereiro entrou por engano no lote de março.
    await salvar(EMPRESA, '2026-03', 1, [nfe(1, FEV), nfe(2)]);

    const r = await separarJaImportadas([nfe(1, FEV)], dados({ competenciaDoLote: '2026-02' }));

    expect(r.documentos).toHaveLength(1);
    expect(r.duplicados).toHaveLength(0);
  });

  it('compara só com a versão mais recente de cada competência', async () => {
    await salvar(EMPRESA, '2026-02', 1, [nfe(1, FEV)]);
    await salvar(EMPRESA, '2026-02', 2, [nfe(5, FEV)]);

    const r = await separarJaImportadas([nfe(1, FEV), nfe(5, FEV)], dados());

    expect(r.documentos.map(d => d.chaveNFe)).toEqual([chave(1)]);
    expect(r.duplicados[0].motivo).toBe('já importada em EMPRESA LTDA · 02/2026 · v2');
  });

  it('a origem é a competência datada mais recente; "sem competência" fica por último', async () => {
    await salvar(EMPRESA, SEM_COMPETENCIA, 1, [nfe(1, FEV)]);
    await salvar(EMPRESA, '2026-01', 1, [nfe(1, FEV)]);
    await salvar(EMPRESA, '2026-02', 1, [nfe(1, FEV)]);

    const r = await separarJaImportadas([nfe(1, FEV)], dados());

    expect(r.duplicados[0].origem?.competencia).toBe('2026-02');
  });

  it('a competência do próprio lote não bloqueia (reimportação gera versão completa)', async () => {
    await salvar(EMPRESA, '2026-03', 3, [nfe(1, FEV), nfe(2)]);

    const r = await separarJaImportadas([nfe(1, FEV), nfe(2)], dados());

    expect(r.documentos).toHaveLength(2);
    expect(r.duplicados).toHaveLength(0);
  });

  it('não compara com outras empresas', async () => {
    await salvar(OUTRA, '2026-02', 1, [nfe(1, FEV)]);

    const r = await separarJaImportadas([nfe(1, FEV)], dados());

    expect(r.documentos).toHaveLength(1);
  });

  it('sem empresa, não compara', async () => {
    await salvar(EMPRESA, '2026-02', 1, [nfe(1, FEV)]);

    const r = await separarJaImportadas([nfe(1, FEV)], dados({ empresaCnpj: null }));

    expect(r.documentos).toHaveLength(1);
  });

  it('ignora a análise do próprio lote', async () => {
    const id = await salvar(EMPRESA, '2026-02', 1, [nfe(1, FEV)]);

    const r = await separarJaImportadas([nfe(1, FEV)], dados({ ignorarAnalise: id }));

    expect(r.documentos).toHaveLength(1);
  });

  it('NFS-e antiga salva bloqueia a nova da mesma nota', async () => {
    await salvar(EMPRESA, '2026-02', 1, [nfseAntiga('ABC', FEV)]);

    const r = await separarJaImportadas([{ ...nfse('10', 'ABC'), diaEmissao: FEV }], dados());

    expect(r.duplicados).toHaveLength(1);
  });

  it('Supabase fora: segue com o lote inteiro e avisa que a checagem não foi feita', async () => {
    await salvar(EMPRESA, '2026-02', 1, [nfe(1, FEV)]);
    jest.spyOn(loja, 'listar').mockRejectedValue(new ErroSupabase('fora do ar', 503));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await separarJaImportadas([nfe(1, FEV)], dados());

    expect(r.documentos).toHaveLength(1);
    expect(r.duplicados).toHaveLength(0);
    expect(r.aviso).toContain('não foi feita: a Supabase não respondeu');
  });

  it('leitura lenta: passado o teto, segue com o lote inteiro e avisa', async () => {
    await salvar(EMPRESA, '2026-02', 1, [nfe(1, FEV)]);
    jest.spyOn(loja, 'listar').mockReturnValue(new Promise(() => undefined));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    definirTempoChecagem(30);
    try {
      const r = await separarJaImportadas([nfe(1, FEV)], dados());
      expect(r.documentos).toHaveLength(1);
      expect(r.aviso).toContain('não foi feita: a leitura das análises salvas passou de');
    } finally {
      definirTempoChecagem(20_000);
    }
  });

  it('não altera as análises salvas', async () => {
    const id = await salvar(EMPRESA, '2026-02', 1, [nfe(1, FEV)]);
    await separarJaImportadas([nfe(1, FEV)], dados());

    const registro = await loja.obter(id);
    expect(registro?.documentos).toHaveLength(1);
    expect(registro?.analise.versao).toBe(1);
  });
});
