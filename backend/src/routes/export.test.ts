import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import * as XLSX from 'xlsx';
import { config } from '../config';
import { sessionService } from '../services/session';
import { NFeDocument } from '../types';
import exportRoutes from './export';
import { conferirCamposNFe, parDoItem } from '../services/camposTributarios';

const USUARIO = 'teste-export';
const EMPRESA = '11111111000111';
const OUTRO = '99999999000199';

let servidor: Server;
let base: string;

const token = jwt.sign(
  { userId: USUARIO, email: 'teste@exemplo.com', sessionId: `sess-${USUARIO}` },
  config.jwt.secret
);

function nota(id: string, emitente: string, destino: string, cfops: string[]): NFeDocument {
  return {
    id,
    modelo: 55,
    tipo: 'indefinido',
    chaveNFe: `chave-${id}`,
    dataEmissao: '2026-02-01T10:00:00.000Z',
    cnpjEmitente: emitente,
    nomeEmitente: 'EMITENTE',
    cnpjDestino: destino,
    nomeDestino: 'DESTINO',
    regimeTributario: 'Lucro-Real',
    values: {
      baseCalculo: 0, icms: 0, icmsST: 0, ipi: 0, iss: 0, pis: 0, cofins: 0,
      irrf: 0, aliquota: 0, cbs: 0, ibs: 0, total: 100,
    },
    validacoes: [],
    divergencias: [],
    cfops,
    ncms: [],
  };
}

const SESSAO = `sess-${USUARIO}-1`;
const cabecalhos = { Authorization: `Bearer ${token}`, 'x-session-id': SESSAO };

beforeAll(async () => {
  const documentos = [
    nota('entrada-1102-aaaa', OUTRO, EMPRESA, ['1102']),
    nota('entrada-1403-bbbb', OUTRO, EMPRESA, ['1403']),
    nota('saida-5102-cccccc', EMPRESA, OUTRO, ['5102']),
  ];
  sessionService.criarOuRecuperarSessao(SESSAO, USUARIO, 'teste@exemplo.com');
  await sessionService.adicionarDocumentos(
    SESSAO,
    documentos,
    {
      sessionId: SESSAO,
      quantidadeArquivos: 3,
      arquivosProcessados: 3,
      arquivosComErro: 0,
      erros: [],
      documentos,
      timestamp: new Date().toISOString(),
    },
    { cnpj: EMPRESA, nome: 'EMPRESA', inferida: true }
  );

  await new Promise<void>(pronto => {
    const app = express();
    app.use('/api/v1/export', exportRoutes);
    servidor = app.listen(0, () => {
      base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1/export`;
      pronto();
    });
  });
});

afterAll(done => {
  servidor.close(done);
});

async function baixarPlanilha(
  query: string,
  comCabecalhos: Record<string, string> = cabecalhos
): Promise<XLSX.WorkBook> {
  const resposta = await fetch(`${base}/excel${query}`, { headers: comCabecalhos });
  expect(resposta.status).toBe(200);
  const livro = XLSX.read(Buffer.from(await resposta.arrayBuffer()), { type: 'buffer' });
  expect(livro.SheetNames).not.toContain('Transição 2024-2027');
  return livro;
}

const linhas = (livro: XLSX.WorkBook, aba: string) =>
  XLSX.utils.sheet_to_json<any[]>(livro.Sheets[aba], { header: 1 });

async function linhasDaAbaDocumentos(query: string): Promise<any[][]> {
  return linhas(await baixarPlanilha(query), 'Documentos').slice(1);
}

/**
 * Linhas de nota da aba Pendências de tributos, como objetos pelo nome da
 * coluna: os testes não dependem da posição das colunas.
 */
function notasPorColuna(livro: XLSX.WorkBook): Array<Record<string, any>> {
  const aba = linhas(livro, 'Pendências de tributos');
  const inicio = aba.findIndex(l => l[0] === 'Sentido');
  const cabecalho = aba[inicio] as string[];
  return aba
    .slice(inicio + 1)
    .map(l => Object.fromEntries(cabecalho.map((coluna, i) => [coluna, l[i]])));
}

/** Valor da linha do Resumo cujo rótulo é o informado. */
function valorDoResumo(livro: XLSX.WorkBook, rotulo: string): unknown {
  return linhas(livro, 'Resumo').find(l => l[0] === rotulo)?.[1];
}

describe('GET /export/excel com filtros', () => {
  it('sem filtro exporta o lote inteiro', async () => {
    expect(await linhasDaAbaDocumentos('')).toHaveLength(3);
  });

  it('exporta só o recorte de entradas com CFOP 1102', async () => {
    const documentos = await linhasDaAbaDocumentos('?sentido=entrada&cfop=1102');
    expect(documentos).toHaveLength(1);
    // Coluna Tipo (sentido)
    expect(documentos[0][2]).toBe('Entrada');
  });

  it('o Resumo da planilha filtrada conta só o recorte', async () => {
    const livro = await baixarPlanilha('?sentido=entrada');
    expect(valorDoResumo(livro, 'Total de Documentos')).toBe(2);
    expect(valorDoResumo(livro, 'Valor Total')).toBe('R$ 200.00');
  });

  it('recusa o recorte sem nota em comum', async () => {
    const resposta = await fetch(`${base}/excel?sentido=saida&cfop=1102`, { headers: cabecalhos });
    const corpo = (await resposta.json()) as any;
    expect(resposta.status).toBe(400);
    expect(corpo.error).toBe('Nenhuma nota com os filtros escolhidos');
  });
});

describe('GET /export/excel: abas da reforma', () => {
  it('traz as abas novas com cabeçalho de empresa, filtros e tabela', async () => {
    const livro = await baixarPlanilha('?sentido=entrada&cfop=1102');
    expect(livro.SheetNames).toEqual(
      expect.arrayContaining(['Pendências de tributos', 'Consolidado por campo'])
    );

    const pendencias = linhas(livro, 'Pendências de tributos');
    const rotulo = (r: string) => pendencias.find(l => l[0] === r)?.[1];
    expect(rotulo('Empresa analisada')).toBe('EMPRESA (11.111.111/0001-11)');
    expect(rotulo('Entrada/Saída')).toBe('Entradas');
    expect(rotulo('CFOP')).toBe('1102');
    expect(rotulo('NCM')).toBe('Todos');
    expect(rotulo('Tabela de cClassTrib')).toMatch(/^v\d/);
  });

  it('lista por nota as pendências do recorte, só entradas', async () => {
    const notas = notasPorColuna(await baixarPlanilha('?sentido=entrada'));

    expect(notas).toHaveLength(2);
    expect(notas.every(l => l['Sentido'] === 'Entrada')).toBe(true);
    // As notas de teste não trazem nenhum campo da reforma
    expect(notas[0]['Pendências']).toContain('CBS');
    expect(notas[0]['Situação']).toBe('com pendência');
    expect(notas[0]['Tipo de problema']).toBe('ausente');
  });

  it('consolida quantas notas têm cada problema', async () => {
    const livro = await baixarPlanilha('');
    const consolidado = linhas(livro, 'Consolidado por campo');
    const linha = (r: string) => consolidado.find(l => l[0] === r);

    expect(linha('Notas exigíveis')?.slice(1, 5)).toEqual([2, 1, 0, 3]);
    expect(linha('Notas completas')?.slice(1, 5)).toEqual([0, 0, 0, 0]);
    expect(linha('CBS: ausente')?.slice(1, 5)).toEqual([2, 1, 0, 3]);
    expect(linha('CBS: zerado')?.slice(1, 5)).toEqual([0, 0, 0, 0]);
    expect(linha('cClassTrib incompatível com o CST')?.slice(1, 5)).toEqual([0, 0, 0, 0]);
  });

  it('com filtro de entradas, o consolidado só conta entradas', async () => {
    const livro = await baixarPlanilha('?sentido=entrada');
    const consolidado = linhas(livro, 'Consolidado por campo');
    expect(consolidado.find(l => l[0] === 'CBS: ausente')?.slice(1, 5)).toEqual([2, 0, 0, 2]);
  });
});

describe('GET /export/excel: períodos, avisos e ordem', () => {
  const SESSAO2 = `sess-${USUARIO}-2`;
  const cabecalhos2 = { Authorization: `Bearer ${token}`, 'x-session-id': SESSAO2 };
  const ITEM = {
    cstReforma: '000', cClassTrib: '000099', baseIBSCBS: '100.00', ibsEstadual: '0.10',
    ibsMunicipal: '0.00', cbs: '0.90',
  };

  beforeAll(async () => {
    const documentos: NFeDocument[] = [
      // Saída completa, com cClassTrib fora da tabela carregada: aviso
      {
        ...nota('saida-completa-aviso', EMPRESA, OUTRO, ['5102']),
        camposTributarios: conferirCamposNFe([ITEM]),
        // Como o parser monta: com os campos que vieram zerados
        reformaItens: [parDoItem(ITEM)],
        diaEmissao: '2026-02-01',
      },
      nota('saida-pendente', EMPRESA, OUTRO, ['5102']),
      nota('entrada-pendente', OUTRO, EMPRESA, ['1102']),
      { ...nota('entrada-sem-data', OUTRO, EMPRESA, ['1102']), semDataEmissao: true },
      {
        ...nota('entrada-2025', OUTRO, EMPRESA, ['1102']),
        dataEmissao: '2025-06-01T13:00:00.000Z',
        diaEmissao: '2025-06-01',
      },
    ];
    sessionService.criarOuRecuperarSessao(SESSAO2, USUARIO, 'teste@exemplo.com');
    await sessionService.adicionarDocumentos(
      SESSAO2,
      documentos,
      {
        sessionId: SESSAO2,
        quantidadeArquivos: documentos.length,
        arquivosProcessados: documentos.length,
        arquivosComErro: 0,
        erros: [],
        documentos,
        timestamp: new Date().toISOString(),
      },
      { cnpj: EMPRESA, nome: 'EMPRESA', inferida: true }
    );
  });

  async function notasDasPendencias(): Promise<Array<Record<string, any>>> {
    return notasPorColuna(await baixarPlanilha('', cabecalhos2));
  }

  it('deixa de fora as notas sem data e de 2025', async () => {
    const chaves = (await notasDasPendencias()).map(l => l['Número / chave']);
    expect(chaves).not.toContain('chave-entrada-sem-data');
    expect(chaves).not.toContain('chave-entrada-2025');
  });

  it('inclui a nota completa que tem aviso', async () => {
    const linha = (await notasDasPendencias()).find(
      l => l['Número / chave'] === 'chave-saida-completa-aviso'
    );
    // IBS municipal zero em 2026 é aceito: a nota segue completa
    expect(linha?.['Situação']).toBe('completa');
    expect(linha?.['Avisos']).toContain('não consta na tabela carregada');
    expect(linha?.['Data de emissão']).toBe('01/02/2026');
  });

  it('sem filtro de sentido, entradas vêm antes das saídas', async () => {
    expect((await notasDasPendencias()).map(l => l['Sentido'])).toEqual(['Entrada', 'Saída', 'Saída']);
  });

  it('o consolidado conta fora do período e sem data, com o percentual total', async () => {
    const consolidado = linhas(await baixarPlanilha('', cabecalhos2), 'Consolidado por campo');
    const linha = (r: string) => consolidado.find(l => String(l[0]).startsWith(r));
    expect(linha('Fora do período')?.[4]).toBe(1);
    expect(linha('Fora do período')?.[0]).toBe('Fora do período (antes de 01/01/2026)');
    expect(linha('Sem data de emissão')?.[4]).toBe(1);
    expect(linha('Percentual de completas')?.slice(1, 5)).toEqual(['0%', '50%', '0%', '33.3%']);
  });
});

describe('GET /export/excel: tipo de problema', () => {
  const SESSAO3 = `sess-${USUARIO}-3`;
  const cabecalhos3 = { Authorization: `Bearer ${token}`, 'x-session-id': SESSAO3 };

  beforeAll(async () => {
    const zerada = {
      cstReforma: '000', cClassTrib: '000001', baseIBSCBS: '100.00', ibsEstadual: '0.10',
      ibsMunicipal: '0.05', cbs: '0.00', aliquotaCBS: '0', valorCBS: '0.00',
    };
    const documentos: NFeDocument[] = [
      {
        ...nota('entrada-cbs-zero', OUTRO, EMPRESA, ['1102']),
        camposTributarios: conferirCamposNFe([zerada]),
        reformaItens: [parDoItem(zerada)],
      },
    ];
    sessionService.criarOuRecuperarSessao(SESSAO3, USUARIO, 'teste@exemplo.com');
    await sessionService.adicionarDocumentos(
      SESSAO3,
      documentos,
      {
        sessionId: SESSAO3,
        quantidadeArquivos: 1,
        arquivosProcessados: 1,
        arquivosComErro: 0,
        erros: [],
        documentos,
        timestamp: new Date().toISOString(),
      },
      { cnpj: EMPRESA, nome: 'EMPRESA', inferida: true }
    );
  });

  it('a aba Pendências de tributos traz o tipo de problema de cada pendência', async () => {
    const livro = await baixarPlanilha('', cabecalhos3);
    expect(livro.SheetNames).toContain('Pendências de tributos');
    expect(livro.SheetNames).not.toContain('Pendências da reforma');

    const aba = linhas(livro, 'Pendências de tributos');
    const cabecalho = aba.find(l => l[0] === 'Sentido')!;
    const linha = aba[aba.indexOf(cabecalho) + 1];
    const coluna = (nome: string) => linha[cabecalho.indexOf(nome)];

    expect(coluna('Tipo de problema')).toBe('zerado');
    expect(coluna('Pendências')).toBe('CBS informada com valor zero [zerado]');
    expect(coluna('Resumo')).toBe('1 pendência: CBS informada com valor zero.');
  });

  it('o consolidado separa zerado de ausente', async () => {
    const consolidado = linhas(await baixarPlanilha('', cabecalhos3), 'Consolidado por campo');
    const linha = (r: string) => consolidado.find(l => l[0] === r)?.slice(1, 5);
    expect(linha('CBS: zerado')).toEqual([1, 0, 0, 1]);
    expect(linha('CBS: ausente')).toEqual([0, 0, 0, 0]);
  });
});
