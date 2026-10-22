import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { sessionService } from '../services/session';
import { DocumentType, NFeDocument, NFeModel } from '../types';
import dashboardRoutes from './dashboard';
import { conferirCamposNFe } from '../services/camposTributarios';
import { definirArmazenamentoAnalises, excluirAnalises } from '../services/analises';
import {
  AnaliseSalva,
  ArmazenamentoAnalisesMemoria,
  ErroSupabase,
  caminhoDoZip,
} from '../services/armazenamentoAnalises';
import { limparCacheConjuntos } from '../services/conjuntoEmpresa';

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

describe('GET /dashboard/campos: conferência da reforma', () => {
  const ITEM_COMPLETO = {
    cstReforma: '000', cClassTrib: '000001', baseIBSCBS: '100.00', ibsEstadual: '0.10',
    ibsMunicipal: '0.00', cbs: '0.90',
  };

  function completa(doc: NFeDocument): NFeDocument {
    return {
      ...doc,
      camposTributarios: conferirCamposNFe([ITEM_COMPLETO]),
      reformaItens: [{ cst: '000', cClassTrib: '000001' }],
    };
  }

  function loteReforma(): NFeDocument[] {
    return [
      completa(nota('entrada', 55, ['1102'], [], 100)),
      completa(nota('entrada', 55, ['1102'], [], 100)),
      completa(nota('entrada', 55, ['1403'], [], 100)),
      // Sem campos da reforma: com pendência
      nota('entrada', 55, ['1102'], [], 100),
      // Antes do corte e sem data: fora do percentual
      { ...completa(nota('entrada', 55, ['1102'], [], 100)), dataEmissao: '2025-12-15T13:00:00.000Z' },
      { ...nota('entrada', 55, ['1102'], [], 100), semDataEmissao: true },
      completa(nota('saida', 55, ['5102'], [], 100)),
      nota('saida', 55, ['5102'], [], 100),
    ];
  }

  it('devolve situação, pendências e o resumo por sentido', async () => {
    const cabecalhos = await sessaoComLote(loteReforma(), true);
    const { corpo } = await get('/campos', cabecalhos);

    expect(corpo.data.porSentido).toEqual({
      entrada: { total: 4, completas: 3, percentual: 75 },
      saida: { total: 2, completas: 1, percentual: 50 },
      semVinculo: { total: 0, completas: 0, percentual: 0 },
      total: { total: 6, completas: 4, percentual: 66.7 },
    });
    expect(corpo.data.temEmpresa).toBe(true);
    expect(corpo.data.dataDeCorte).toBe('2026-01-01');
    expect(corpo.data.resumo).toEqual({
      total: 8, completas: 4, comPendencia: 2, foraDoPeriodo: 1, semData: 1,
    });
    expect(corpo.data.versaoTabela).toEqual(expect.any(String));

    const pendente = corpo.data.notas.find((n: any) => n.situacao === 'com pendência');
    expect(pendente).toEqual(
      expect.objectContaining({ sentido: 'entrada', diaEmissao: '2026-02-01' })
    );
    expect(pendente.pendencias.map((p: any) => p.texto)).toContain('CBS');

    const semData = corpo.data.notas.find((n: any) => n.situacao === 'sem data');
    expect(semData.diaEmissao).toBeNull();
    expect(semData.avisos).toHaveLength(1);
  });

  it('sem empresa, temEmpresa é false e as notas exigíveis ficam sem vínculo', async () => {
    const cabecalhos = await sessaoComLote(loteReforma(), false);
    const { corpo } = await get('/campos', cabecalhos);
    expect(corpo.data.temEmpresa).toBe(false);
    expect(corpo.data.porSentido.entrada.total).toBe(0);
    expect(corpo.data.porSentido.semVinculo).toEqual({ total: 6, completas: 4, percentual: 66.7 });
  });

  it('a lista respeita o sentido, mas os cartões não', async () => {
    const cabecalhos = await sessaoComLote(loteReforma(), true);
    const { corpo } = await get('/campos?sentido=saida', cabecalhos);
    expect(corpo.data.notas).toHaveLength(2);
    expect(corpo.data.porSentido.entrada.total).toBe(4);
  });

  it('os cartões respeitam CFOP', async () => {
    const cabecalhos = await sessaoComLote(loteReforma(), true);
    const { corpo } = await get('/campos?cfop=1403', cabecalhos);
    expect(corpo.data.notas).toHaveLength(1);
    expect(corpo.data.porSentido).toEqual({
      entrada: { total: 1, completas: 1, percentual: 100 },
      saida: { total: 0, completas: 0, percentual: 0 },
      semVinculo: { total: 0, completas: 0, percentual: 0 },
      total: { total: 1, completas: 1, percentual: 100 },
    });
  });

  it('sem sessão devolve o mesmo formato, vazio', async () => {
    const outro = jwt.sign(
      { userId: 'sem-sessao', email: 'x@exemplo.com', sessionId: 'sessao-inexistente' },
      config.jwt.secret
    );
    const { status, corpo } = await get('/campos', {
      Authorization: `Bearer ${outro}`,
      'x-session-id': 'sessao-inexistente',
    });
    expect(status).toBe(200);
    expect(corpo.data.notas).toEqual([]);
    expect(corpo.data.resumo.total).toBe(0);
    const zero = { total: 0, completas: 0, percentual: 0 };
    expect(corpo.data.porSentido).toEqual({ entrada: zero, saida: zero, semVinculo: zero, total: zero });
    expect(corpo.data.temEmpresa).toBe(false);
  });
});

describe('filtro por empresa (?empresa=)', () => {
  const SUPERA = EMPRESA;
  let loja: ArmazenamentoAnalisesMemoria;
  let idAnalise = 0;

  async function salvar(competencia: string, versao: number, documentos: NFeDocument[]) {
    idAnalise++;
    const id = `00000000-0000-4000-9000-${String(idAnalise).padStart(12, '0')}`;
    const analise: AnaliseSalva = {
      id,
      empresaCnpj: SUPERA,
      empresaNome: 'SUPERA LTDA',
      competencia,
      versao,
      criadoPor: 'contador@exemplo.com',
      criadoEm: new Date(Date.UTC(2026, 3, 1, 0, idAnalise)).toISOString(),
      totalNotas: documentos.length,
      resumo: {},
      versaoTabela: null,
      zipPath: caminhoDoZip(SUPERA, competencia, id),
      zipBytes: 3,
    };
    await loja.salvar(analise, documentos, Buffer.from('zip'));
    return analise;
  }

  /** Notas já classificadas, como ficam gravadas na análise. */
  const classificadas = (n: number, tipo: DocumentType, total: number) =>
    Array.from({ length: n }, () => ({ ...nota(tipo, 55, tipo === 'saida' ? ['5102'] : ['1102'], [], total), tipo }));

  beforeEach(() => {
    loja = new ArmazenamentoAnalisesMemoria();
    definirArmazenamentoAnalises(loja);
    limparCacheConjuntos();
  });

  it('Supera 03/2026 v1, v2 e v3: só a v3 entra, 41 notas, e o totalizador fecha', async () => {
    await salvar('2026-03', 1, classificadas(41, 'entrada', 10));
    await salvar('2026-03', 2, classificadas(41, 'entrada', 10));
    const v3 = await salvar('2026-03', 3, classificadas(41, 'entrada', 10));
    // A sessão tem outro lote: a empresa não o usa nem o altera.
    const cabecalhos = await sessaoComLote(lote(), true);

    const resumo = await get(`/resumo?empresa=${SUPERA}`, cabecalhos);
    expect(resumo.status).toBe(200);
    expect(resumo.corpo.data.totalDocumentos).toBe(41);
    expect(resumo.corpo.data.totalValor).toBe(410);

    const importacoes = await get(`/importacoes?empresa=${SUPERA}`, cabecalhos);
    expect(importacoes.status).toBe(200);
    expect(importacoes.corpo.data.importacoes).toEqual([
      expect.objectContaining({ id: v3.id, competencia: '2026-03', versao: 3, notas: 41, valorTotal: 410 }),
    ]);
    expect(importacoes.corpo.data.total).toEqual({ notas: 41, valorTotal: 410, tributos: 0 });

    // "Lote atual" de novo: o painel volta ao lote da sessão.
    const doLote = await get('/resumo', cabecalhos);
    expect(doLote.corpo.data.totalDocumentos).toBe(4);
  });

  it('várias competências somadas; filtro de sentido vale para tudo, inclusive o totalizador', async () => {
    await salvar('2026-01', 1, [...classificadas(2, 'entrada', 100), ...classificadas(1, 'saida', 50)]);
    await salvar('2026-02', 1, classificadas(9, 'entrada', 1));
    await salvar('2026-02', 2, classificadas(3, 'entrada', 100));
    const cabecalhos = await sessaoComLote(lote(), false);

    const todas = await get(`/resumo?empresa=${SUPERA}`, cabecalhos);
    expect(todas.corpo.data.totalDocumentos).toBe(6);

    const entradas = await get(`/resumo?empresa=${SUPERA}&sentido=entrada`, cabecalhos);
    expect(entradas.corpo.data.totalDocumentos).toBe(5);
    expect(entradas.corpo.data.totalValor).toBe(500);

    const docs = await get(`/documentos?empresa=${SUPERA}&sentido=entrada`, cabecalhos);
    expect(docs.corpo.data.total).toBe(5);

    const campos = await get(`/campos?empresa=${SUPERA}&sentido=entrada`, cabecalhos);
    expect(campos.corpo.data.notas).toHaveLength(5);
    expect(campos.corpo.data.temEmpresa).toBe(true);

    const tabela = await get(`/importacoes?empresa=${SUPERA}&sentido=entrada`, cabecalhos);
    expect(tabela.corpo.data.importacoes.map((l: any) => [l.competencia, l.versao, l.notas])).toEqual([
      ['2026-02', 2, 3],
      ['2026-01', 1, 2],
    ]);
    expect(tabela.corpo.data.total).toEqual({ notas: 5, valorTotal: 500, tributos: 0 });
  });

  it('/filtros traz as empresas e, com a empresa, as opções e o sentido do conjunto', async () => {
    await salvar('2026-03', 1, classificadas(2, 'entrada', 10));
    const cabecalhos = await sessaoComLote(lote(), false);

    const doLote = await get('/filtros', cabecalhos);
    expect(doLote.corpo.data.empresa).toBeNull();
    expect(doLote.corpo.data.empresas).toEqual([{ cnpj: SUPERA, nome: 'SUPERA LTDA', quantidade: 1 }]);
    expect(doLote.corpo.data.sentidoPadrao).toBe('todas');
    expect(doLote.corpo.data.totalDocumentos).toBe(4);

    const daEmpresa = await get(`/filtros?empresa=${SUPERA}`, cabecalhos);
    expect(daEmpresa.corpo.data.empresa).toBe(SUPERA);
    expect(daEmpresa.corpo.data.totalDocumentos).toBe(2);
    expect(daEmpresa.corpo.data.cfops).toEqual([{ codigo: '1102', quantidade: 2 }]);
    expect(daEmpresa.corpo.data.sentidoPadrao).toBe('entrada');
    expect(daEmpresa.corpo.data.aviso).toBeUndefined();
  });

  it('empresa sem análises: painel vazio com o aviso', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    const filtros = await get(`/filtros?empresa=${OUTRO}`, cabecalhos);
    expect(filtros.status).toBe(200);
    expect(filtros.corpo.data.totalDocumentos).toBe(0);
    expect(filtros.corpo.data.aviso).toBe('Nenhuma análise salva desta empresa');

    const tabela = await get(`/importacoes?empresa=${OUTRO}`, cabecalhos);
    expect(tabela.corpo.data.importacoes).toEqual([]);
    expect(tabela.corpo.data.aviso).toBe('Nenhuma análise salva desta empresa');
  });

  it('análise excluída depois da carga: a próxima usa a versão anterior', async () => {
    await salvar('2026-03', 1, classificadas(2, 'entrada', 10));
    const v2 = await salvar('2026-03', 2, classificadas(5, 'entrada', 10));
    const cabecalhos = await sessaoComLote(lote(), true);
    expect((await get(`/resumo?empresa=${SUPERA}`, cabecalhos)).corpo.data.totalDocumentos).toBe(5);

    await excluirAnalises([v2.id], 'teste');
    expect((await get(`/resumo?empresa=${SUPERA}`, cabecalhos)).corpo.data.totalDocumentos).toBe(2);
  });

  it('armazenamento fora: 503 com a causa, e o lote atual continua funcionando', async () => {
    jest.spyOn(loja, 'listar').mockRejectedValue(new ErroSupabase('sem rede'));
    jest.spyOn(loja, 'listarEmpresas').mockRejectedValue(new ErroSupabase('sem rede'));
    const cabecalhos = await sessaoComLote(lote(), true);

    for (const rota of ['/resumo', '/filtros', '/campos', '/importacoes', '/documentos']) {
      const resposta = await get(`${rota}?empresa=${SUPERA}`, cabecalhos);
      expect(resposta.status).toBe(503);
      expect(resposta.corpo.error).toMatch(/Restore project/);
    }

    const filtros = await get('/filtros', cabecalhos);
    expect(filtros.status).toBe(200);
    expect(filtros.corpo.data.totalDocumentos).toBe(4);
    expect(filtros.corpo.data.empresas).toEqual([]);
    expect(filtros.corpo.data.avisoEmpresas).toMatch(/Restore project/);
    expect((await get('/resumo', cabecalhos)).corpo.data.totalDocumentos).toBe(4);
  });

  it('parâmetro inválido: 400', async () => {
    const cabecalhos = await sessaoComLote(lote(), true);
    for (const rota of ['/resumo', '/filtros', '/campos', '/importacoes', '/documentos', '/regimes']) {
      expect((await get(`${rota}?empresa=abc`, cabecalhos)).status).toBe(400);
    }
    expect((await get('/importacoes', cabecalhos)).status).toBe(400);
  });
});

describe('GET /dashboard/campos: tipos, resumo, leiaute e código do serviço', () => {
  const NFSE_ZERADA = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe>
  <Numero>7</Numero>
  <DataEmissaoNfse>2026-03-05T09:00:00</DataEmissaoNfse>
  <CpfCnpjPrestador>${OUTRO}</CpfCnpjPrestador>
  <RazaoSocialPrestador>PRESTADOR FICTICIO</RazaoSocialPrestador>
  <CpfCnpjTomador>${EMPRESA}</CpfCnpjTomador>
  <Servicos><CodigoTributacaoMunicipio>010701</CodigoTributacaoMunicipio></Servicos>
  <ValoresNFSe>
    <ValorServicos>1000.00</ValorServicos><BaseCalculo>1000.00</BaseCalculo><ValorIss>25.00</ValorIss>
    <CBS><Aliquota>0</Aliquota><Vlr>0</Vlr></CBS>
    <IBS><BaseCalculo>0</BaseCalculo><AliquotaEstadual>0</AliquotaEstadual><AliquotaMunicipal>0</AliquotaMunicipal><Vlr>0</Vlr></IBS>
  </ValoresNFSe>
</NFSe>`;

  it('leva os tipos de problema, o resumo, o leiaute e o código do serviço', async () => {
    const { nfeParserService } = await import('../services/nfeParser');
    const doc = await nfeParserService.parseNFE(NFSE_ZERADA);
    const cabecalhos = await sessaoComLote([doc], true);
    const { corpo } = await get('/campos', cabecalhos);

    const nota = corpo.data.notas[0];
    expect(nota.tipos).toEqual(['ausente', 'zerado']);
    expect(nota.resumo).toMatch(/^5 pendências: faltam CST do IBS\/CBS e cClassTrib; /);
    expect(nota.tipoCodigoServico).toBe('código de tributação municipal');
    expect(nota.leiaute).toBe('Municipal (raiz NFSe)');
    expect(nota.codigoServico).toBe('010701');
    const cbs = nota.campos.find((c: any) => c.grupo === 'reforma' && c.campo === 'CBS');
    expect(cbs).toEqual(expect.objectContaining({ aliquota: 0, valorNumerico: 0, zerado: true }));
    expect(nota.pendencias.filter((p: any) => p.problema === 'zerado')).toHaveLength(3);
    expect(cbs.zeroAceito).toBeUndefined();
    // IBS municipal zero em 2026 é aceito: a tela recebe a marca neutra
    const municipal = nota.campos.find((c: any) => c.grupo === 'reforma' && c.campo === 'IBS municipal');
    expect(municipal).toEqual(expect.objectContaining({ zerado: true, zeroAceito: true }));
  });
});
