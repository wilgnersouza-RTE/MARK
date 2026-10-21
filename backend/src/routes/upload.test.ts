import * as fs from 'fs';
import * as path from 'path';
import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import JSZip from 'jszip';
import { config } from '../config';
import uploadRoutes from './upload';

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
