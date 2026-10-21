import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { sessionService } from '../services/session';
import { DocumentType, NFeDocument, NFeModel } from '../types';
import dashboardRoutes from './dashboard';

const USUARIO = 'teste-dashboard';
const EMPRESA = '11111111000111';
const OUTRO = '99999999000199';

let servidor: Server;
let base: string;

const token = jwt.sign(
  { userId: USUARIO, email: 'teste@exemplo.com', sessionId: `sess-${USUARIO}` },
  config.jwt.secret
);

let sequencia = 0;
function nota(
  sentido: DocumentType,
  modelo: NFeModel,
  cfops: string[],
  ncms: string[],
  total: number
): NFeDocument {
  sequencia++;
  // O sentido sai do CNPJ da empresa: emitente é saída, destinatário é entrada.
  const [emitente, destino] =
    sentido === 'saida' ? [EMPRESA, OUTRO] : sentido === 'entrada' ? [OUTRO, EMPRESA] : [OUTRO, '22222222000122'];
  return {
    id: `doc-${sequencia}`,
    modelo,
    tipo: 'indefinido',
    chaveNFe: `chave-${sequencia}`,
    dataEmissao: '2026-02-01T10:00:00.000Z',
    cnpjEmitente: emitente,
    nomeEmitente: `EMITENTE ${emitente}`,
    cnpjDestino: destino,
    nomeDestino: `DESTINO ${destino}`,
    regimeTributario: 'Lucro-Real',
    values: {
      baseCalculo: 0, icms: 0, icmsST: 0, ipi: 0, iss: 0, pis: 0, cofins: 0,
      irrf: 0, aliquota: 0, cbs: 0, ibs: 0, total,
    },
    validacoes: [],
    divergencias: [],
    cfops,
    ncms,
  };
}

function lote(): NFeDocument[] {
  return [
    nota('entrada', 55, ['1102'], ['84713012'], 100),
    nota('entrada', 57, ['1102'], [], 200),
    nota('saida', 55, ['5102'], ['84713012', '22021000'], 400),
    nota('entrada', 'NFSE', [], [], 800),
  ];
}

let contadorSessao = 0;
async function sessaoComLote(documentos: NFeDocument[], comEmpresa: boolean) {
  contadorSessao++;
  const sessionId = `sess-${USUARIO}-${contadorSessao}`;
  sessionService.criarOuRecuperarSessao(sessionId, USUARIO, 'teste@exemplo.com');
  await sessionService.adicionarDocumentos(
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
    comEmpresa ? { cnpj: EMPRESA, nome: 'EMPRESA', inferida: true } : null
  );
  return { Authorization: `Bearer ${token}`, 'x-session-id': sessionId };
}

async function get(caminho: string, cabecalhos: Record<string, string>) {
  const resposta = await fetch(`${base}${caminho}`, { headers: cabecalhos });
  return { status: resposta.status, corpo: (await resposta.json()) as any };
}

beforeAll(done => {
  const app = express();
  app.use('/api/v1/dashboard', dashboardRoutes);
  servidor = app.listen(0, () => {
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1/dashboard`;
    done();
  });
});

afterAll(done => {
  servidor.close(done);
});

describe('GET /dashboard/filtros', () => {
  it('devolve só os códigos do lote, com a quantidade de notas', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { status, corpo } = await get('/filtros', cabecalhos);

    expect(status).toBe(200);
    expect(corpo.success).toBe(true);
    expect(corpo.timestamp).toEqual(expect.any(String));
    expect(corpo.data.cfops).toEqual([
      { codigo: '1102', quantidade: 2 },
      { codigo: '5102', quantidade: 1 },
    ]);
    expect(corpo.data.ncms).toEqual([
      { codigo: '22021000', quantidade: 1 },
      { codigo: '84713012', quantidade: 2 },
    ]);
    expect(corpo.data.temEmpresa).toBe(true);
    expect(corpo.data.sentidoPadrao).toBe('entrada');
  });

  it('calcula as opções sobre o lote inteiro, ignorando filtros', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { corpo } = await get('/filtros?sentido=saida&cfop=5102', cabecalhos);
    expect(corpo.data.cfops).toHaveLength(2);
  });

  it('abre em todas quando há empresa mas nenhuma nota de entrada', async () => {
    const soSaidas = lote().filter(d => d.cnpjEmitente === EMPRESA);
    const cabecalhos = await sessaoComLote(soSaidas, true);
    const { corpo } = await get('/filtros', cabecalhos);
    expect(corpo.data.temEmpresa).toBe(true);
    expect(corpo.data.sentidoPadrao).toBe('todas');
  });

  it('abre em todas quando o lote não tem empresa', async () => {
    const cabecalhos = await sessaoComLote(lote(), false);
    const { corpo } = await get('/filtros', cabecalhos);
    expect(corpo.data.temEmpresa).toBe(false);
    expect(corpo.data.sentidoPadrao).toBe('todas');
  });
});

describe('filtros aplicados ao dashboard', () => {
  it('sem filtro responde pelo lote inteiro', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { corpo } = await get('/resumo', cabecalhos);
    expect(corpo.data.totalDocumentos).toBe(4);
    expect(corpo.data.totalValor).toBe(1500);
  });

  it('só entradas', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { corpo } = await get('/resumo?sentido=entrada', cabecalhos);
    expect(corpo.data.totalDocumentos).toBe(3);
    expect(corpo.data.totalValor).toBe(1100);
  });

  it('CFOP 1102 deixa a NFS-e fora', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { corpo } = await get('/resumo?cfop=1102', cabecalhos);
    expect(corpo.data.totalDocumentos).toBe(2);
    expect(corpo.data.totalValor).toBe(300);
  });

  it('NCM deixa CT-e e NFS-e fora', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { corpo } = await get('/documentos?ncm=84713012', cabecalhos);
    expect(corpo.data.total).toBe(2);
    expect(corpo.data.documentos.every((d: NFeDocument) => d.modelo === 55)).toBe(true);
  });

  it('combinação sem nota em comum zera os indicadores', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { status, corpo } = await get('/resumo?sentido=entrada&cfop=5102', cabecalhos);
    expect(status).toBe(200);
    expect(corpo.data.totalDocumentos).toBe(0);
    expect(corpo.data.totalValor).toBe(0);
  });

  it('sentido inválido é ignorado', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { corpo } = await get('/resumo?sentido=xyz', cabecalhos);
    expect(corpo.data.totalDocumentos).toBe(4);
  });

  it('regimes respeitam os filtros', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { corpo } = await get('/regimes?sentido=saida', cabecalhos);
    expect(corpo.data).toEqual([
      expect.objectContaining({ regime: 'Lucro-Real', quantidade: 1, valor: 400 }),
    ]);
  });

  it('fornecedores respeitam os filtros', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { corpo } = await get('/fornecedores?sentido=saida', cabecalhos);
    expect(corpo.data).toEqual([
      expect.objectContaining({ cnpj: EMPRESA, quantidade: 1, valor: 400 }),
    ]);
  });

  it('a conferência de campos respeita os filtros', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const { corpo } = await get('/campos?sentido=saida', cabecalhos);
    expect(corpo.success).toBe(true);
    expect(corpo.data.resumo.total).toBe(1);
  });

  it('a rota de transição não existe mais', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const resposta = await fetch(`${base}/transicao`, { headers: cabecalhos });
    expect(resposta.status).toBe(404);
  });
});
