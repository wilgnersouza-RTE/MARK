import { NFeDocument, NFeModel } from '../types';
import {
  identificarEmpresa,
  classificarSentido,
  sentidoDaNota,
  contarPorSentido,
  rotuloSentido,
} from './sentidoImportacao';

const EMPRESA = '11111111000111';
const OUTRA = '99999999000199';

let sequencia = 0;

function nota(
  cnpjEmitente: string,
  cnpjDestino: string,
  modelo: NFeModel = 55,
  extras: Partial<NFeDocument> = {}
): NFeDocument {
  sequencia++;
  return {
    id: `doc-${sequencia}`,
    modelo,
    tipo: 'indefinido',
    chaveNFe: `chave-${sequencia}`,
    dataEmissao: '2026-02-01T10:00:00.000Z',
    cnpjEmitente,
    nomeEmitente: cnpjEmitente === EMPRESA ? 'EMPRESA ANALISADA LTDA' : `EMITENTE ${cnpjEmitente}`,
    cnpjDestino,
    nomeDestino: cnpjDestino === EMPRESA ? 'EMPRESA ANALISADA LTDA' : `DESTINO ${cnpjDestino}`,
    regimeTributario: 'Lucro-Real',
    values: {
      baseCalculo: 0, icms: 0, icmsST: 0, ipi: 0, iss: 0, pis: 0, cofins: 0,
      irrf: 0, aliquota: 0, cbs: 0, ibs: 0, total: 100,
    },
    validacoes: [],
    divergencias: [],
    ...extras,
  };
}

/** CNPJ distinto por posição, para fornecedores e clientes variados. */
const parceiro = (i: number) => String(20000000000000 + i);

describe('identificarEmpresa', () => {
  it('identifica a empresa em lote misto de entradas e saídas', () => {
    const docs = [
      nota(parceiro(1), EMPRESA, 55),
      nota(parceiro(2), EMPRESA, 57),
      nota(EMPRESA, parceiro(3), 'NFSE'),
      nota(EMPRESA, parceiro(4), 55),
      nota(parceiro(5), EMPRESA, 65),
    ];

    const { empresa, candidatos } = identificarEmpresa(docs);

    expect(empresa?.cnpj).toBe(EMPRESA);
    expect(empresa?.nome).toBe('EMPRESA ANALISADA LTDA');
    expect(empresa?.quantidadeNotas).toBe(5);
    expect(candidatos[0].cnpj).toBe(EMPRESA);
  });

  it('escolhe a empresa presente em exatamente 80% das notas', () => {
    const docs = [
      nota(parceiro(1), EMPRESA),
      nota(parceiro(2), EMPRESA),
      nota(EMPRESA, parceiro(3)),
      nota(EMPRESA, parceiro(4)),
      nota(parceiro(5), parceiro(6)),
    ];

    expect(identificarEmpresa(docs).empresa?.cnpj).toBe(EMPRESA);
  });

  it('conta a empresa uma vez só quando está nos dois lados da nota', () => {
    const docs = [nota(EMPRESA, EMPRESA), nota(parceiro(1), EMPRESA)];
    const { candidatos } = identificarEmpresa(docs);
    expect(candidatos.find(c => c.cnpj === EMPRESA)?.quantidadeNotas).toBe(2);
  });

  it('pede escolha quando o lote tem uma nota só', () => {
    const { empresa, candidatos } = identificarEmpresa([nota(EMPRESA, OUTRA)]);

    expect(empresa).toBeNull();
    expect(candidatos.map(c => c.cnpj).sort()).toEqual([EMPRESA, OUTRA].sort());
    expect(candidatos.every(c => c.quantidadeNotas === 1)).toBe(true);
    expect(candidatos.every(c => c.nome.length > 0)).toBe(true);
  });

  it('pede escolha quando os dois mais frequentes empatam', () => {
    const docs = [nota(EMPRESA, OUTRA), nota(EMPRESA, OUTRA), nota(EMPRESA, OUTRA)];
    expect(identificarEmpresa(docs).empresa).toBeNull();
  });

  it('pede escolha quando nenhum CNPJ chega a 80% das notas', () => {
    const docs = [
      nota(parceiro(1), EMPRESA),
      nota(parceiro(2), EMPRESA),
      nota(parceiro(3), EMPRESA),
      nota(parceiro(4), parceiro(5)),
      nota(parceiro(6), parceiro(7)),
    ];

    const { empresa, candidatos } = identificarEmpresa(docs);

    expect(empresa).toBeNull();
    expect(candidatos[0]).toEqual(
      expect.objectContaining({ cnpj: EMPRESA, quantidadeNotas: 3 })
    );
  });

  it('oferece no máximo cinco candidatos', () => {
    const docs = Array.from({ length: 6 }, (_, i) => nota(parceiro(i * 2), parceiro(i * 2 + 1)));
    const { empresa, candidatos } = identificarEmpresa(docs);
    expect(empresa).toBeNull();
    expect(candidatos).toHaveLength(5);
  });

  it('ignora CNPJ não informado', () => {
    const docs = [nota('N/A', EMPRESA), nota('N/A', EMPRESA), nota(EMPRESA, 'N/A')];
    const { empresa, candidatos } = identificarEmpresa(docs);
    expect(empresa?.cnpj).toBe(EMPRESA);
    expect(candidatos.map(c => c.cnpj)).toEqual([EMPRESA]);
  });

  it('usa o nome mais recente visto para o candidato', () => {
    const docs = [
      nota(OUTRA, EMPRESA, 55, { dataEmissao: '2026-01-01T00:00:00.000Z', nomeDestino: 'NOME ANTIGO' }),
      nota(OUTRA, EMPRESA, 55, { dataEmissao: '2026-03-01T00:00:00.000Z', nomeDestino: 'NOME NOVO' }),
      nota(OUTRA, EMPRESA, 55, { dataEmissao: '2026-02-01T00:00:00.000Z', nomeDestino: 'NOME DO MEIO' }),
    ];
    const candidato = identificarEmpresa(docs).candidatos.find(c => c.cnpj === EMPRESA);
    expect(candidato?.nome).toBe('NOME NOVO');
  });

  it('compara datas pelo instante, mesmo com fusos em formatos diferentes', () => {
    // 10h em -03:00 é 13h UTC, depois de 12h UTC, embora o texto seja "menor".
    const docs = [
      nota(OUTRA, EMPRESA, 55, { dataEmissao: '2026-03-01T12:00:00.000Z', nomeDestino: 'NOME ANTERIOR' }),
      nota(OUTRA, EMPRESA, 57, { dataEmissao: '2026-03-01T10:00:00-03:00', nomeDestino: 'NOME POSTERIOR' }),
    ];
    const candidato = identificarEmpresa(docs).candidatos.find(c => c.cnpj === EMPRESA);
    expect(candidato?.nome).toBe('NOME POSTERIOR');
  });
});

describe('classificarSentido', () => {
  it('classifica destinatária ou tomadora como entrada e emitente como saída', () => {
    const docs = [
      nota(parceiro(1), EMPRESA, 55),
      nota(parceiro(2), EMPRESA, 57),
      nota(EMPRESA, parceiro(3), 'NFSE'),
    ];

    const classificados = classificarSentido(docs, EMPRESA);

    expect(classificados.map(d => d.tipo)).toEqual(['entrada', 'entrada', 'saida']);
    expect(classificados.map(d => d.modelo)).toEqual([55, 57, 'NFSE']);
    // Não altera as notas de origem.
    expect(docs.every(d => d.tipo === 'indefinido')).toBe(true);
  });

  it('marca como saída a nota em que a empresa está nos dois lados', () => {
    expect(sentidoDaNota(nota(EMPRESA, EMPRESA), EMPRESA)).toBe('saida');
  });

  it('marca como indefinida a nota sem vínculo com a empresa', () => {
    const docs = classificarSentido(
      [nota(parceiro(1), EMPRESA), nota(parceiro(2), parceiro(3))],
      EMPRESA
    );
    expect(contarPorSentido(docs)).toEqual({ entrada: 1, saida: 0, indefinido: 1 });
  });

  it('deixa tudo indefinido sem empresa', () => {
    const docs = classificarSentido([nota(EMPRESA, OUTRA)], null);
    expect(docs[0].tipo).toBe('indefinido');
  });

  it('compara CNPJ só pelos dígitos', () => {
    expect(sentidoDaNota(nota('11.111.111/0001-11', OUTRA), EMPRESA)).toBe('saida');
  });

  it('reclassifica ao trocar a empresa', () => {
    const docs = [nota(EMPRESA, OUTRA), nota(OUTRA, EMPRESA), nota(OUTRA, parceiro(1))];

    const porEmpresa = contarPorSentido(classificarSentido(docs, EMPRESA));
    const porOutra = contarPorSentido(classificarSentido(docs, OUTRA));

    expect(porEmpresa).toEqual({ entrada: 1, saida: 1, indefinido: 1 });
    expect(porOutra).toEqual({ entrada: 1, saida: 2, indefinido: 0 });
  });
});

describe('rotuloSentido', () => {
  it('rotula entrada, saída e nota sem vínculo quando há empresa', () => {
    expect(rotuloSentido('entrada')).toBe('Entrada');
    expect(rotuloSentido('saida')).toBe('Saída');
    expect(rotuloSentido('indefinido')).toBe('Sem vínculo');
    expect(rotuloSentido('indefinido', true)).toBe('Sem vínculo');
  });

  it('rotula como não classificada enquanto não há empresa', () => {
    expect(rotuloSentido('indefinido', false)).toBe('Não classificada');
  });
});
