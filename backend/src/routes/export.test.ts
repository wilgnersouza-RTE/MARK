import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import * as XLSX from 'xlsx';
import { config } from '../config';
import { sessionService } from '../services/session';
import { NFeDocument } from '../types';
import exportRoutes from './export';

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

async function baixarPlanilha(query: string): Promise<XLSX.WorkBook> {
  const resposta = await fetch(`${base}/excel${query}`, { headers: cabecalhos });
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
