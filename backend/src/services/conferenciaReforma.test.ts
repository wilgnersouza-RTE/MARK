import { NFeDocument, DocumentType } from '../types';
import { conferirCamposNFe, conferirCamposNFSe, type ItemConferido } from './camposTributarios';
import {
  AVISO_SEM_DATA,
  INFORMATIVO_SELETIVO,
  TabelaReforma,
  conferirReforma,
  consolidadoPorCampo,
  diaLocal,
  resumoPorSentido,
  tabelaCarregada,
} from './conferenciaReforma';

const TABELA: TabelaReforma = {
  versao: '1.31',
  temCST: c => ['000', '200', '410'].includes(c),
  obterCClassTrib: c =>
    ({
      '000001': {},
      '200001': {},
      '410001': { fimVigencia: '2026-03-31' },
    } as Record<string, { fimVigencia?: string }>)[c] ?? null,
};

/** Item com os seis campos exigidos e, por padrão, o Seletivo. */
function itemCompleto(extra: Partial<ItemConferido> = {}): ItemConferido {
  return {
    cstReforma: '000',
    cClassTrib: '000001',
    baseIBSCBS: '100.00',
    ibsEstadual: '0.10',
    ibsMunicipal: '0.00',
    cbs: '0.90',
    impostoSeletivo: '1.00',
    ...extra,
  };
}

function nfe(itens: ItemConferido[], dataEmissao = '2026-02-01T13:00:00.000Z', tipo: DocumentType = 'entrada'): NFeDocument {
  return {
    id: 'nfe',
    modelo: 55,
    tipo,
    chaveNFe: 'chave',
    dataEmissao,
    cnpjEmitente: '1',
    nomeEmitente: 'EMITENTE',
    cnpjDestino: '2',
    nomeDestino: 'DESTINO',
    regimeTributario: 'Lucro-Real',
    values: {
      baseCalculo: 0, icms: 0, icmsST: 0, ipi: 0, iss: 0, pis: 0, cofins: 0,
      irrf: 0, aliquota: 0, cbs: 0, ibs: 0, total: 100,
    },
    validacoes: [],
    divergencias: [],
    camposTributarios: conferirCamposNFe(itens),
    cfops: [],
    ncms: [],
    reformaItens: itens.map(i => ({ cst: i.cstReforma, cClassTrib: i.cClassTrib })),
  };
}

function nfse(sem: Array<'cbs' | 'cst'>): NFeDocument {
  const cst = sem.includes('cst') ? undefined : '000';
  return {
    ...nfe([]),
    modelo: 'NFSE',
    dataEmissao: '2026-02-12T10:00:00',
    camposTributarios: conferirCamposNFSe({
      baseCalculo: 100, aliquota: 5, iss: 5, issRetido: false, pis: 0, cofins: 0,
      irrf: 0, csll: 0, inss: 0,
      cst,
      cClassTrib: '000001',
      baseIBSCBS: 100,
      ibsEstadual: 0.1,
      ibsMunicipal: 0,
      cbs: sem.includes('cbs') ? undefined : 0.9,
    }),
    reformaItens: [{ cst, cClassTrib: '000001' }],
  };
}

describe('conferirReforma: matriz da spec', () => {
  it('NF-e 2026 com os sete campos e vínculo certo é completa', () => {
    const r = conferirReforma(nfe([itemCompleto(), itemCompleto()]), TABELA);
    expect(r.situacao).toBe('completa');
    expect(r.pendencias).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.informativos).toEqual([]);
  });

  it('NFS-e 2026 sem CBS tem pendência pelo nome do campo', () => {
    const r = conferirReforma(nfse(['cbs']), TABELA);
    expect(r.situacao).toBe('com pendência');
    expect(r.pendencias.map(p => p.texto)).toEqual(['CBS']);
  });

  it('cClassTrib em 2 de 3 itens', () => {
    const r = conferirReforma(
      nfe([itemCompleto(), itemCompleto(), itemCompleto({ cClassTrib: undefined })]),
      TABELA
    );
    expect(r.situacao).toBe('com pendência');
    expect(r.pendencias.map(p => p.texto)).toEqual(['cClassTrib (2 de 3 itens)']);
  });

  it('CST 000 com cClassTrib 200001 é incompatível', () => {
    const r = conferirReforma(nfe([itemCompleto({ cClassTrib: '200001' })]), TABELA);
    expect(r.situacao).toBe('com pendência');
    expect(r.pendencias).toEqual([
      expect.objectContaining({
        campo: 'cClassTrib incompatível com o CST',
        problema: 'incompativel',
        texto: 'cClassTrib incompatível com o CST',
        detalhe: '200001 com CST 000',
      }),
    ]);
  });

  it('incompatibilidade em parte dos itens diz quantos', () => {
    const r = conferirReforma(
      nfe([itemCompleto(), itemCompleto({ cClassTrib: '200001' })]),
      TABELA
    );
    expect(r.pendencias.map(p => p.texto)).toEqual(['cClassTrib incompatível com o CST (1 de 2 itens)']);
  });

  it('cClassTrib fora da tabela é aviso com a versão, não pendência', () => {
    const r = conferirReforma(nfe([itemCompleto({ cClassTrib: '000099' })]), TABELA);
    expect(r.situacao).toBe('completa');
    expect(r.avisos).toEqual(['cClassTrib 000099 não consta na tabela carregada (v1.31)']);
  });

  it('CST fora da tabela é aviso, não pendência', () => {
    const r = conferirReforma(nfe([itemCompleto({ cstReforma: '999', cClassTrib: '999001' })]), TABELA);
    expect(r.situacao).toBe('completa');
    expect(r.avisos).toEqual([
      'CST 999 não consta na tabela carregada (v1.31)',
      'cClassTrib 999001 não consta na tabela carregada (v1.31)',
    ]);
  });

  it('usa a versão da tabela carregada do arquivo', () => {
    const tabela = tabelaCarregada();
    const r = conferirReforma(nfe([itemCompleto({ cClassTrib: '000099' })]), tabela);
    expect(r.situacao).toBe('completa');
    expect(r.avisos).toEqual([`cClassTrib 000099 não consta na tabela carregada (v${tabela.versao})`]);
  });

  it('vigência vencida na data de emissão é só aviso', () => {
    const doc = nfe([itemCompleto({ cstReforma: '410', cClassTrib: '410001' })], '2026-05-10T13:00:00.000Z');
    const r = conferirReforma(doc, TABELA);
    expect(r.situacao).toBe('completa');
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain('fora de vigência');
    // Antes do fim da vigência, nada a avisar
    const antes = conferirReforma(
      nfe([itemCompleto({ cstReforma: '410', cClassTrib: '410001' })], '2026-02-10T13:00:00.000Z'),
      TABELA
    );
    expect(antes.avisos).toEqual([]);
  });

  it('fimVigencia em DD/MM/AAAA também vale', () => {
    const tabela: TabelaReforma = { ...TABELA, obterCClassTrib: () => ({ fimVigencia: '31/03/2026' }) };
    const item = itemCompleto({ cstReforma: '410', cClassTrib: '410001' });
    expect(conferirReforma(nfe([item], '2026-05-10T13:00:00.000Z'), tabela).avisos[0]).toContain('fora de vigência');
    expect(conferirReforma(nfe([item], '2026-03-31T13:00:00.000Z'), tabela).avisos).toEqual([]);
  });

  it('nota com dia de emissão inválido fica sem data', () => {
    const r = conferirReforma({ ...nfe([{}], '31/02/2026') }, TABELA);
    expect(r.situacao).toBe('sem data');
    expect(r.avisos).toEqual([AVISO_SEM_DATA]);
  });

  it('tabela indisponível transforma códigos em avisos', () => {
    const vazia: TabelaReforma = { versao: 'indisponível', temCST: () => false, obterCClassTrib: () => null };
    const r = conferirReforma(nfe([itemCompleto()]), vazia);
    expect(r.situacao).toBe('completa');
    expect(r.avisos).toEqual([
      'CST 000 não consta na tabela carregada (tabela indisponível)',
      'cClassTrib 000001 não consta na tabela carregada (tabela indisponível)',
    ]);
  });

  it('emissão antes do corte fica fora do período, sem pendências', () => {
    const r = conferirReforma(nfe([{}], '2025-12-15T13:00:00.000Z'), TABELA);
    expect(r).toEqual({ situacao: 'fora do período', pendencias: [], avisos: [], informativos: [] });
  });

  it('vale o dia local do emitente, não o dia em UTC', () => {
    // 2025-12-31T23:30:00-04:00 (Manaus) é 2026-01-01T03:30Z em UTC
    const manaus = { ...nfe([{}], '2026-01-01T03:30:00.000Z'), diaEmissao: '2025-12-31' };
    expect(conferirReforma(manaus, TABELA).situacao).toBe('fora do período');
    // dEmi 2026-01-01 é exigível, ainda que em UTC seja meia-noite
    const virada = { ...nfe([{}], '2026-01-01T00:00:00.000Z'), diaEmissao: '2026-01-01' };
    expect(conferirReforma(virada, TABELA).situacao).toBe('com pendência');
  });

  it('nota sem data fica sem data, com aviso', () => {
    const doc = { ...nfe([{}]), semDataEmissao: true };
    const r = conferirReforma(doc, TABELA);
    expect(r.situacao).toBe('sem data');
    expect(r.pendencias).toEqual([]);
    expect(r.avisos).toHaveLength(1);
  });

  it('Imposto Seletivo ausente é só informativo', () => {
    const r = conferirReforma(nfe([itemCompleto({ impostoSeletivo: undefined })]), TABELA);
    expect(r.situacao).toBe('completa');
    expect(r.informativos).toEqual([INFORMATIVO_SELETIVO]);
  });

  it('nota sem nenhum campo da reforma lista os seis', () => {
    const r = conferirReforma(nfe([{}]), TABELA);
    expect(r.pendencias.map(p => p.texto)).toEqual([
      'CST do IBS/CBS',
      'cClassTrib',
      'Base de cálculo do IBS/CBS',
      'IBS estadual (UF)',
      'IBS municipal',
      'CBS',
    ]);
  });
});

describe('resumoPorSentido', () => {
  it('4 entradas exigíveis, 3 completas: 75%', () => {
    const r = resumoPorSentido([
      { tipo: 'entrada', situacao: 'completa' },
      { tipo: 'entrada', situacao: 'completa' },
      { tipo: 'entrada', situacao: 'completa' },
      { tipo: 'entrada', situacao: 'com pendência' },
      { tipo: 'entrada', situacao: 'fora do período' },
      { tipo: 'entrada', situacao: 'sem data' },
      { tipo: 'saida', situacao: 'com pendência' },
      { tipo: 'indefinido', situacao: 'completa' },
    ]);
    expect(r.entrada).toEqual({ total: 4, completas: 3, percentual: 75 });
    expect(r.saida).toEqual({ total: 1, completas: 0, percentual: 0 });
    expect(r.semVinculo).toEqual({ total: 1, completas: 1, percentual: 100 });
    expect(r.total).toEqual({ total: 6, completas: 4, percentual: 66.7 });
  });

  it('sem notas exigíveis, zero', () => {
    const zero = { total: 0, completas: 0, percentual: 0 };
    expect(resumoPorSentido([])).toEqual({ entrada: zero, saida: zero, semVinculo: zero, total: zero });
  });
});

describe('consolidadoPorCampo', () => {
  it('conta notas por problema, separando entradas e saídas', () => {
    const docs = [
      nfe([{ ...itemCompleto(), cbs: undefined }], undefined, 'entrada'),
      nfe([itemCompleto({ cClassTrib: '200001' })], undefined, 'saida'),
      nfe([{ ...itemCompleto(), cbs: undefined }], undefined, 'saida'),
    ].map(doc => ({ tipo: doc.tipo, conferencia: conferirReforma(doc, TABELA) }));

    const linhas = consolidadoPorCampo(docs);
    expect(linhas.find(l => l.problema === 'CBS')).toEqual({ problema: 'CBS', entradas: 1, saidas: 1, semVinculo: 0, total: 2 });
    expect(linhas.find(l => l.problema === 'cClassTrib incompatível com o CST')).toEqual({
      problema: 'cClassTrib incompatível com o CST', entradas: 0, saidas: 1, semVinculo: 0, total: 1,
    });
    expect(linhas.find(l => l.problema === 'cClassTrib')?.total).toBe(0);
  });
});

describe('diaLocal', () => {
  it('aceita ISO com fuso sem converter, ISO sem fuso e DD/MM/AAAA', () => {
    expect(diaLocal('2025-12-31T23:30:00-04:00')).toBe('2025-12-31');
    expect(diaLocal('2026-01-15T10:00:00')).toBe('2026-01-15');
    expect(diaLocal('2026-01-01')).toBe('2026-01-01');
    expect(diaLocal('15/01/2026')).toBe('2026-01-15');
    expect(diaLocal('')).toBeNull();
    expect(diaLocal('ontem')).toBeNull();
  });

  it('recusa datas impossíveis', () => {
    expect(diaLocal('31/02/2026')).toBeNull();
    expect(diaLocal('2026-13-01')).toBeNull();
    expect(diaLocal('2026-04-31')).toBeNull();
    expect(diaLocal('2028-02-29')).toBe('2028-02-29');
  });
});

describe('tabelaCarregada', () => {
  it('com o arquivo ilegível, segue com tabela vazia e versão indisponível', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rtcService } = require('./rtc');
    const espiao = jest.spyOn(rtcService, 'obterMetadados').mockImplementation(() => {
      throw new Error('arquivo ausente');
    });
    const erroConsole = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const tabela = tabelaCarregada();
      expect(tabela.versao).toBe('indisponível');
      expect(tabela.temCST('000')).toBe(false);
    } finally {
      espiao.mockRestore();
      erroConsole.mockRestore();
    }
  });
});
