import * as fs from 'fs';
import * as path from 'path';
import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import JSZip from 'jszip';
import { config } from '../config';
import uploadRoutes from './upload';
import { definirArmazenamentoAnalises, reprocessar } from '../services/analises';
import { ArmazenamentoAnalisesMemoria, ErroSupabase } from '../services/armazenamentoAnalises';
import { sessionService } from '../services/session';

const NOTA1 = path.resolve(__dirname, '../../../exemplos/nota1.xml');
const ZIP_EXEMPLO = path.resolve(__dirname, '../../../exemplos/notas-exemplo.zip');

let servidor: Server;
let base: string;

const token = jwt.sign(
  { userId: 'teste-upload', email: 'teste@exemplo.com', sessionId: 'sess-teste-upload' },
  config.jwt.secret
);

/*
 * Cada teste usa a sua sessão, para um não herdar o lote do outro. O
 * middleware aceita o header quando ele começa com "sess-<userId>-".
 */
let contadorSessao = 0;
function novaSessao(): Record<string, string> {
  contadorSessao++;
  return { Authorization: `Bearer ${token}`, 'x-session-id': `sess-teste-upload-${contadorSessao}` };
}

beforeAll(done => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/upload', uploadRoutes);
  servidor = app.listen(0, () => {
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1/upload`;
    done();
  });
});

afterAll(done => {
  servidor.close(done);
});

async function enviarZip(conteudo: Buffer, cabecalhos: Record<string, string>) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(conteudo)]), 'lote.zip');
  const resposta = await fetch(`${base}/nfe`, { method: 'POST', headers: cabecalhos, body: form });
  return { status: resposta.status, corpo: (await resposta.json()) as any };
}

async function definirEmpresa(cnpj: string, cabecalhos: Record<string, string>) {
  const resposta = await fetch(`${base}/empresa`, {
    method: 'POST',
    headers: { ...cabecalhos, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cnpj }),
  });
  return { status: resposta.status, corpo: (await resposta.json()) as any };
}

async function zipComNota1(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('nota1.xml', fs.readFileSync(NOTA1, 'utf-8'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('POST /upload/nfe', () => {
  it('importa o ZIP só com o arquivo, sem tipo nem modelo', async () => {
    const { status, corpo } = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao());

    expect(status).toBe(200);
    const importacao = corpo.data.importacao;
    expect(importacao.porModelo).toEqual([expect.objectContaining({ modelo: '55', quantidade: 3 })]);
    expect(importacao.empresa).toEqual(expect.objectContaining({ cnpj: '99888777000166', inferida: true }));
    expect(importacao.precisaEscolherEmpresa).toBe(false);
    expect(importacao.porSentido).toEqual({ entrada: 3, saida: 0, indefinido: 0 });
    expect(importacao).not.toHaveProperty('tipo');
    expect(importacao).not.toHaveProperty('modelo');
    expect(importacao.documentos.every((d: any) => ['entrada', 'saida', 'indefinido'].includes(d.tipo))).toBe(true);
  });

  it('pede a escolha da empresa quando o lote tem uma nota só', async () => {
    const { status, corpo } = await enviarZip(await zipComNota1(), novaSessao());

    expect(status).toBe(200);
    const importacao = corpo.data.importacao;
    expect(importacao.precisaEscolherEmpresa).toBe(true);
    expect(importacao.empresa).toBeNull();
    expect(importacao.candidatosEmpresa.length).toBeGreaterThan(0);
    expect(importacao.documentos.every((d: any) => d.tipo === 'indefinido')).toBe(true);
  });

  it('não herda a empresa do lote anterior quando o novo lote não a identifica', async () => {
    const sessao = novaSessao();

    const primeiro = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), sessao);
    expect(primeiro.corpo.data.importacao.empresa).not.toBeNull();

    const segundo = await enviarZip(await zipComNota1(), sessao);
    expect(segundo.status).toBe(200);
    expect(segundo.corpo.data.importacao.empresa).toBeNull();
  });

  it('recusa por arquivo o XML desconhecido e segue com os demais', async () => {
    const zip = new JSZip();
    zip.file('nota1.xml', fs.readFileSync(NOTA1, 'utf-8'));
    zip.file('pedido.xml', '<pedidoCompra><vNF>10.00</vNF></pedidoCompra>');

    const { status, corpo } = await enviarZip(await zip.generateAsync({ type: 'nodebuffer' }), novaSessao());

    expect(status).toBe(200);
    expect(corpo.data.importacao.documentosImportados).toBe(1);
    expect(corpo.data.erros).toEqual([expect.objectContaining({ nomeArquivo: 'pedido.xml' })]);
  });

  it('devolve 400 quando nenhum XML do ZIP é nota fiscal', async () => {
    const zip = new JSZip();
    zip.file('pedido.xml', '<pedidoCompra><vNF>10.00</vNF></pedidoCompra>');
    zip.file('leia-me.txt', 'sem notas');

    const { status, corpo } = await enviarZip(await zip.generateAsync({ type: 'nodebuffer' }), novaSessao());

    expect(status).toBe(400);
    expect(corpo.error).toBe('Nenhuma nota fiscal reconhecida no ZIP');
    expect(corpo.details).toEqual([expect.objectContaining({ nomeArquivo: 'pedido.xml' })]);
  });
});

describe('POST /upload/empresa', () => {
  it('reclassifica o lote ao trocar a empresa e recusa CNPJ fora do lote', async () => {
    const sessao = novaSessao();
    await enviarZip(fs.readFileSync(ZIP_EXEMPLO), sessao);

    const trocada = await definirEmpresa('12345678000190', sessao);
    expect(trocada.status).toBe(200);
    expect(trocada.corpo.data.importacao.empresa).toEqual(
      expect.objectContaining({ cnpj: '12345678000190', inferida: false })
    );
    expect(trocada.corpo.data.importacao.porSentido.saida).toBeGreaterThan(0);

    const fora = await definirEmpresa('33333333000133', sessao);
    expect(fora.status).toBe(400);
  });
});

// ==================== Bloqueio de duplicados ====================

const EMPRESA = '99888777000166';
const OUTRA_EMPRESA = '55444333000122';
const BASE_NOTA = fs.readFileSync(NOTA1, 'utf-8');

/**
 * NF-e fictícia a partir de nota1.xml: número, dia de emissão, emitente e
 * destinatário trocados, com uma chave de 44 dígitos coerente.
 */
function xmlNota(n: number, dia: string | null, opcoes: { emit?: string; dest?: string } = {}): string {
  const emit = opcoes.emit ?? `1234567800${String(n).padStart(4, '0')}`;
  const dest = opcoes.dest ?? EMPRESA;
  const aamm = dia ? `${dia.slice(2, 4)}${dia.slice(5, 7)}` : '2603';
  const chave = `35${aamm}${emit}55001${String(n).padStart(9, '0')}1000000001`;
  return BASE_NOTA.replace('35240612345678000190550010000000011000000017', chave)
    // Sem dia: nota sem data de emissão (lote "sem competência").
    .replace('<dhEmi>2024-03-15T10:30:00-03:00</dhEmi>', dia ? `<dhEmi>${dia}T10:30:00-03:00</dhEmi>` : '')
    .replace('<CNPJ>12345678000190</CNPJ>', `<CNPJ>${emit}</CNPJ>`)
    .replace('<CNPJ>99888777000166</CNPJ>', `<CNPJ>${dest}</CNPJ>`);
}

async function zipDe(arquivos: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [nome, conteudo] of Object.entries(arquivos)) zip.file(nome, conteudo);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('bloqueio de XMLs duplicados', () => {
  let loja: ArmazenamentoAnalisesMemoria;

  beforeEach(() => {
    loja = new ArmazenamentoAnalisesMemoria();
    definirArmazenamentoAnalises(loja);
  });

  afterEach(() => jest.restoreAllMocks());

  const fevereiro = () => zipDe({ 'f1.xml': xmlNota(1, '2026-02-10'), 'f2.xml': xmlNota(2, '2026-02-11') });

  async function totalSalvas() {
    return (await loja.listar()).analises.length;
  }

  it('XML repetido no ZIP entra uma vez e a resposta lista o repetido', async () => {
    const zip = await zipDe({
      'a.xml': xmlNota(1, '2026-03-10'),
      'b.xml': xmlNota(2, '2026-03-11'),
      'copia/a.xml': xmlNota(1, '2026-03-10'),
    });

    const { status, corpo } = await enviarZip(zip, novaSessao());

    expect(status).toBe(200);
    const importacao = corpo.data.importacao;
    expect(importacao.documentosImportados).toBe(2);
    expect(importacao.duplicados).toEqual([
      expect.objectContaining({ nomeArquivo: 'copia/a.xml', regra: 'zip', motivo: 'repetido no ZIP' }),
    ]);
    expect(importacao.avisoDuplicidade).toMatch(/1 nota duplicada foi pulada/);

    const salva = await loja.obter(importacao.analise.id);
    expect(salva?.documentos).toHaveLength(2);
    expect(salva?.analise.resumo.duplicados).toEqual([
      { nomeArquivo: 'copia/a.xml', motivo: 'repetido no ZIP', regra: 'zip' },
    ]);
    // Notas salvas + puladas fecham com os XMLs lidos.
    expect(salva?.analise.resumo.duplicadosPulados).toBe(1);
    expect(salva!.analise.totalNotas + salva!.analise.resumo.duplicadosPulados!).toBe(
      salva!.analise.resumo.arquivosProcessados
    );
  });

  it('pula a nota já importada em outra competência da empresa', async () => {
    await enviarZip(await fevereiro(), novaSessao());

    const marco = await zipDe({
      'f1-de-novo.xml': xmlNota(1, '2026-02-10'),
      'm3.xml': xmlNota(3, '2026-03-10'),
      'm4.xml': xmlNota(4, '2026-03-11'),
    });
    const { status, corpo } = await enviarZip(marco, novaSessao());

    expect(status).toBe(200);
    const importacao = corpo.data.importacao;
    expect(importacao.documentosImportados).toBe(2);
    expect(importacao.analise.competencia).toBe('2026-03');
    expect(importacao.duplicados).toEqual([
      expect.objectContaining({
        nomeArquivo: 'f1-de-novo.xml',
        regra: 'analise',
        motivo: 'já importada em CLIENTE DESTINO LTDA · 02/2026 · v1',
      }),
    ]);
  });

  it('reimportar a mesma competência gera versão nova com todas as notas', async () => {
    const zip = await zipDe({ 'm1.xml': xmlNota(1, '2026-03-10'), 'm2.xml': xmlNota(2, '2026-03-11') });

    await enviarZip(zip, novaSessao());
    const { status, corpo } = await enviarZip(zip, novaSessao());

    expect(status).toBe(200);
    expect(corpo.data.importacao.analise.versao).toBe(2);
    expect(corpo.data.importacao.documentosImportados).toBe(2);
    expect(corpo.data.importacao.duplicados).toEqual([]);
  });

  it('recusa o ZIP em que todas as notas já foram importadas, sem salvar nada', async () => {
    // Lote de 03/2026 que trouxe também duas notas sem data. Sem data, elas
    // não são "do mês" do lote novo, que fica sem competência.
    const semData = () => zipDe({ 'u1.xml': xmlNota(11, null), 'u2.xml': xmlNota(12, null) });
    await enviarZip(
      await zipDe({
        'u1.xml': xmlNota(11, null),
        'u2.xml': xmlNota(12, null),
        'm3.xml': xmlNota(3, '2026-03-10'),
        'm4.xml': xmlNota(4, '2026-03-11'),
        'm5.xml': xmlNota(5, '2026-03-12'),
      }),
      novaSessao()
    );
    const antes = await totalSalvas();

    const { status, corpo } = await enviarZip(await semData(), novaSessao());

    expect(status).toBe(400);
    expect(corpo.error).toBe('Todas as notas deste ZIP já foram importadas');
    expect(corpo.duplicados).toHaveLength(2);
    expect(corpo.duplicados[0].motivo).toBe('já importada em CLIENTE DESTINO LTDA · 03/2026 · v1');
    expect(await totalSalvas()).toBe(antes);
  });

  it('empresa escolhida depois: tira do lote e da análise salva as notas já importadas', async () => {
    await enviarZip(await fevereiro(), novaSessao());

    // Sem empresa identificada: a EMPRESA aparece em 2 de 3 notas.
    const sessao = novaSessao();
    const upload = await enviarZip(
      await zipDe({
        'f1.xml': xmlNota(1, '2026-02-10'),
        'm6.xml': xmlNota(6, '2026-03-10'),
        'm7.xml': xmlNota(7, '2026-03-11', { dest: OUTRA_EMPRESA }),
      }),
      sessao
    );
    expect(upload.corpo.data.importacao.precisaEscolherEmpresa).toBe(true);
    expect(upload.corpo.data.importacao.documentosImportados).toBe(3);
    expect(upload.corpo.data.importacao.duplicados).toEqual([]);

    const escolha = await definirEmpresa(EMPRESA, sessao);

    expect(escolha.status).toBe(200);
    const importacao = escolha.corpo.data.importacao;
    expect(importacao.totalDocumentosSessao).toBe(2);
    expect(importacao.duplicados).toEqual([
      expect.objectContaining({ nomeArquivo: 'f1.xml', motivo: 'já importada em CLIENTE DESTINO LTDA · 02/2026 · v1' }),
    ]);
    expect(importacao.avisoDuplicidade).toMatch(/1 nota duplicada/);

    const salva = await loja.obter(importacao.analise.id);
    expect(salva?.documentos).toHaveLength(2);
    expect(salva?.analise.totalNotas).toBe(2);
    expect(salva?.analise.empresaCnpj).toBe(EMPRESA);
  });

  it('Reprocessar não pula nada', async () => {
    await enviarZip(await fevereiro(), novaSessao());
    const { corpo } = await enviarZip(
      await zipDe({
        'f1.xml': xmlNota(1, '2026-02-10'),
        'm3.xml': xmlNota(3, '2026-03-10'),
        'm4.xml': xmlNota(4, '2026-03-11'),
      }),
      novaSessao()
    );
    expect(corpo.data.importacao.documentosImportados).toBe(2);

    const nova = await reprocessar(corpo.data.importacao.analise.id, 'teste@exemplo.com');

    expect(nova.totalNotas).toBe(3);
    expect(nova.avisoReprocessamento).toBe('A nota pulada na importação por duplicidade volta no reprocessamento.');
  });

  it('Supabase fora: importa só com a regra do ZIP e avisa', async () => {
    await enviarZip(await fevereiro(), novaSessao());
    jest.spyOn(loja, 'listar').mockRejectedValue(new ErroSupabase('fora do ar', 503));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { status, corpo } = await enviarZip(
      await zipDe({
        'f1.xml': xmlNota(1, '2026-02-10'),
        'm3.xml': xmlNota(3, '2026-03-10'),
        'm4.xml': xmlNota(4, '2026-03-11'),
        'm4-copia.xml': xmlNota(4, '2026-03-11'),
      }),
      novaSessao()
    );

    expect(status).toBe(200);
    expect(corpo.data.importacao.documentosImportados).toBe(3);
    expect(corpo.data.importacao.duplicados).toEqual([expect.objectContaining({ regra: 'zip' })]);
    expect(corpo.data.importacao.avisoDuplicidade).toMatch(/não foi feita/);
  });

  describe('escolha da empresa depois do upload', () => {
    /** Sem empresa identificada: a EMPRESA aparece em 2 de 3 notas; f1 já está em 02/2026. */
    const loteSemEmpresa = () =>
      zipDe({
        'f1.xml': xmlNota(1, '2026-02-10'),
        'm6.xml': xmlNota(6, '2026-03-10'),
        'm7.xml': xmlNota(7, '2026-03-11', { dest: OUTRA_EMPRESA }),
      });

    it('trocar de A para B devolve as notas que A tinha tirado', async () => {
      await enviarZip(await fevereiro(), novaSessao());
      const sessao = novaSessao();
      await enviarZip(await loteSemEmpresa(), sessao);

      const a = await definirEmpresa(EMPRESA, sessao);
      expect(a.corpo.data.importacao.totalDocumentosSessao).toBe(2);

      const b = await definirEmpresa(OUTRA_EMPRESA, sessao);

      expect(b.status).toBe(200);
      const importacao = b.corpo.data.importacao;
      expect(importacao.totalDocumentosSessao).toBe(3);
      expect(importacao.duplicados).toEqual([]);
      expect(importacao.avisoDuplicidade).toBeUndefined();
      const salva = await loja.obter(importacao.analise.id);
      expect(salva?.documentos).toHaveLength(3);
      expect(salva?.analise.totalNotas).toBe(3);
      expect(salva?.analise.resumo.duplicadosPulados).toBe(0);
    });

    it('empresa que já tem todas as notas: 400 com os duplicados, sem mudar sessão nem análise', async () => {
      // EMPRESA em 4 de 5 notas: identificada. u1 e u2 vão para 03/2026.
      await enviarZip(
        await zipDe({
          'u1.xml': xmlNota(11, null),
          'u2.xml': xmlNota(12, null, { dest: OUTRA_EMPRESA }),
          'm3.xml': xmlNota(3, '2026-03-10'),
          'm4.xml': xmlNota(4, '2026-03-11'),
          'm5.xml': xmlNota(5, '2026-03-12'),
        }),
        novaSessao()
      );
      const sessao = novaSessao();
      const upload = await enviarZip(
        await zipDe({ 'u1.xml': xmlNota(11, null), 'u2.xml': xmlNota(12, null, { dest: OUTRA_EMPRESA }) }),
        sessao
      );
      expect(upload.corpo.data.importacao.precisaEscolherEmpresa).toBe(true);
      const analiseId = upload.corpo.data.importacao.analise.id;

      const r = await definirEmpresa(EMPRESA, sessao);

      expect(r.status).toBe(400);
      expect(r.corpo.duplicados).toHaveLength(2);
      const naSessao = sessionService.obterSessao(sessao['x-session-id']);
      expect(naSessao?.empresa).toBeUndefined();
      expect(naSessao?.documentos).toHaveLength(2);
      const salva = await loja.obter(analiseId);
      expect(salva?.analise.empresaCnpj).toBe('');
      expect(salva?.documentos).toHaveLength(2);
    });

    it('Supabase fora na escolha: a troca segue com o aviso', async () => {
      await enviarZip(await fevereiro(), novaSessao());
      const sessao = novaSessao();
      await enviarZip(await loteSemEmpresa(), sessao);
      jest.spyOn(loja, 'listar').mockRejectedValue(new ErroSupabase('fora do ar', 503));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const r = await definirEmpresa(EMPRESA, sessao);

      expect(r.status).toBe(200);
      expect(r.corpo.data.importacao.totalDocumentosSessao).toBe(3);
      expect(r.corpo.data.importacao.avisoDuplicidade).toMatch(/não foi feita/);
    });

    it('lote trocado no meio da escolha: 409', async () => {
      await enviarZip(await fevereiro(), novaSessao());
      const sessao = novaSessao();
      await enviarZip(await loteSemEmpresa(), sessao);

      let liberar!: () => void;
      const espera = new Promise<void>(r => (liberar = r));
      const listarOriginal = loja.listar.bind(loja);
      let chamou!: () => void;
      const chamada = new Promise<void>(r => (chamou = r));
      jest.spyOn(loja, 'listar').mockImplementation(async filtro => {
        chamou();
        await espera;
        return listarOriginal(filtro);
      });

      const troca = definirEmpresa(EMPRESA, sessao);
      await chamada;
      // Uma nota só: sem empresa, o upload não consulta as análises salvas.
      await enviarZip(await zipComNota1(), sessao);
      liberar();
      const r = await troca;

      expect(r.status).toBe(409);
      expect(r.corpo.error).toBe('O lote mudou; escolha a empresa de novo.');
    });
  });
});
