import { DocumentType, NFeDocument, NFeModel } from '../types';
import { filtrarDocumentos, lerFiltros, opcoesDoLote } from './filtros';

let sequencia = 0;

function nota(
  tipo: DocumentType,
  modelo: NFeModel,
  cfops: string[] = [],
  ncms: string[] = []
): NFeDocument {
  sequencia++;
  return {
    id: `doc-${sequencia}`,
    modelo,
    tipo,
    chaveNFe: `chave-${sequencia}`,
    dataEmissao: '2026-02-01T10:00:00.000Z',
    cnpjEmitente: '11111111000111',
    nomeEmitente: 'EMITENTE',
    cnpjDestino: '22222222000122',
    nomeDestino: 'DESTINO',
    regimeTributario: 'Lucro-Real',
    values: {
      baseCalculo: 0, icms: 0, icmsST: 0, ipi: 0, iss: 0, pis: 0, cofins: 0,
      irrf: 0, aliquota: 0, cbs: 0, ibs: 0, total: 100,
    },
    validacoes: [],
    divergencias: [],
    cfops,
    ncms,
  };
}

const NFE_ENTRADA = nota('entrada', 55, ['1102', '1403'], ['84713012', '85171231']);
const NFE_SAIDA = nota('saida', 55, ['5102'], ['84713012']);
const NFCE_SAIDA = nota('saida', 65, ['5102'], ['22021000']);
const CTE_ENTRADA = nota('entrada', 57, ['1102']);
const NFSE_ENTRADA = nota('entrada', 'NFSE');
const SEM_VINCULO = nota('indefinido', 55, ['5102'], ['84713012']);

const LOTE = [NFE_ENTRADA, NFE_SAIDA, NFCE_SAIDA, CTE_ENTRADA, NFSE_ENTRADA, SEM_VINCULO];

const ids = (docs: NFeDocument[]) => docs.map(d => d.id);

describe('lerFiltros', () => {
  it('lê sentido, CFOP e NCM da query', () => {
    expect(lerFiltros({ sentido: 'entrada', cfop: '1102', ncm: '84713012' })).toEqual({
      sentido: 'entrada',
      cfop: '1102',
      ncm: '84713012',
    });
  });

  it('ignora sentido inválido, tratando como todas', () => {
    expect(lerFiltros({ sentido: 'xyz' })).toEqual({});
  });

  it('trata ausente, vazio e "todas" como sem filtro', () => {
    expect(lerFiltros({})).toEqual({});
    expect(lerFiltros(undefined)).toEqual({});
    expect(lerFiltros({ sentido: 'todas', cfop: '', ncm: '  ' })).toEqual({});
  });

  it('aceita NCM com pontuação e usa o primeiro valor repetido', () => {
    expect(lerFiltros({ ncm: '8471.30.12', cfop: ['1102', '5102'] })).toEqual({
      ncm: '84713012',
      cfop: '1102',
    });
  });
});

describe('filtrarDocumentos', () => {
  it('sem filtro devolve o lote inteiro', () => {
    expect(filtrarDocumentos(LOTE, lerFiltros({ sentido: 'todas' }))).toHaveLength(LOTE.length);
  });

  it('só entradas', () => {
    expect(ids(filtrarDocumentos(LOTE, { sentido: 'entrada' }))).toEqual(
      ids([NFE_ENTRADA, CTE_ENTRADA, NFSE_ENTRADA])
    );
  });

  it('sem vínculo devolve só as notas indefinidas', () => {
    expect(ids(filtrarDocumentos(LOTE, { sentido: 'indefinido' }))).toEqual(ids([SEM_VINCULO]));
  });

  it('CFOP pega item ou operação do CT-e e deixa a NFS-e fora', () => {
    expect(ids(filtrarDocumentos(LOTE, { cfop: '1102' }))).toEqual(ids([NFE_ENTRADA, CTE_ENTRADA]));
  });

  it('NCM pega só NF-e e NFC-e com algum item do código', () => {
    expect(ids(filtrarDocumentos(LOTE, { ncm: '84713012' }))).toEqual(
      ids([NFE_ENTRADA, NFE_SAIDA, SEM_VINCULO])
    );
  });

  it('combina os filtros com E lógico', () => {
    expect(ids(filtrarDocumentos(LOTE, { sentido: 'saida', cfop: '5102', ncm: '84713012' }))).toEqual(
      ids([NFE_SAIDA])
    );
  });

  it('combinação sem nota em comum devolve lista vazia', () => {
    expect(filtrarDocumentos(LOTE, { sentido: 'entrada', cfop: '5102' })).toEqual([]);
  });
});

describe('opcoesDoLote', () => {
  it('lista só os códigos presentes, com a quantidade de notas, em ordem', () => {
    expect(opcoesDoLote(LOTE, 'cfops')).toEqual([
      { codigo: '1102', quantidade: 2 },
      { codigo: '1403', quantidade: 1 },
      { codigo: '5102', quantidade: 3 },
    ]);
    expect(opcoesDoLote(LOTE, 'ncms')).toEqual([
      { codigo: '22021000', quantidade: 1 },
      { codigo: '84713012', quantidade: 3 },
      { codigo: '85171231', quantidade: 1 },
    ]);
  });

  it('devolve lista vazia para lote vazio', () => {
    expect(opcoesDoLote([], 'cfops')).toEqual([]);
  });
});
