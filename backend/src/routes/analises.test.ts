import * as fs from 'fs';
import * as path from 'path';
import { AddressInfo } from 'net';
import { Server } from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import JSZip from 'jszip';
import { config } from '../config';
import uploadRoutes from './upload';
import analisesRoutes from './analises';
import dashboardRoutes from './dashboard';
import { definirArmazenamentoAnalises } from '../services/analises';
import { ArmazenamentoAnalisesMemoria, ErroSupabase } from '../services/armazenamentoAnalises';

const EXEMPLOS = path.resolve(__dirname, '../../../exemplos');
const ZIP_EXEMPLO = path.join(EXEMPLOS, 'notas-exemplo.zip');
const EMPRESA_EXEMPLO = '99888777000166';

let servidor: Server;
let base: string;

const token = jwt.sign(
  { userId: 'teste-analises', email: 'contador@exemplo.com', sessionId: 'sess-teste-analises' },
  config.jwt.secret
);

let contadorSessao = 0;
function novaSessao(): Record<string, string> {
  contadorSessao++;
  return { Authorization: `Bearer ${token}`, 'x-session-id': `sess-teste-analises-${contadorSessao}` };
}

beforeAll(done => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/upload', uploadRoutes);
  app.use('/api/v1/analises', analisesRoutes);
  app.use('/api/v1/dashboard', dashboardRoutes);
  servidor = app.listen(0, () => {
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1`;
    done();
  });
});

afterAll(done => {
  servidor.close(done);
});

beforeEach(() => {
  definirArmazenamentoAnalises(new ArmazenamentoAnalisesMemoria());
});

async function enviarZip(conteudo: Buffer, cabecalhos: Record<string, string>) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(conteudo)]), 'lote.zip');
  const resposta = await fetch(`${base}/upload/nfe`, { method: 'POST', headers: cabecalhos, body: form });
  return { status: resposta.status, corpo: (await resposta.json()) as any };
}

async function chamar(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, cabecalhos: Record<string, string>, corpo?: unknown) {
  const resposta = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { ...cabecalhos, 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: resposta.status, corpo: (await resposta.json()) as any };
}

async function zipComNota1(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('nota1.xml', fs.readFileSync(path.join(EXEMPLOS, 'nota1.xml'), 'utf-8'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('análises salvas pelas rotas', () => {
  it('o upload salva a análise; reimportar gera a versão 2', async () => {
    const primeira = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao());
    expect(primeira.status).toBe(200);
    expect(primeira.corpo.data.importacao.analiseSalva).toBe(true);
    expect(primeira.corpo.data.importacao.analise).toEqual(
      expect.objectContaining({ empresaCnpj: EMPRESA_EXEMPLO, competencia: '2024-09', versao: 1 })
    );

    const segunda = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao());
    expect(segunda.corpo.data.importacao.analise.versao).toBe(2);

    const lista = await chamar('GET', `/analises?empresa=${EMPRESA_EXEMPLO}`, novaSessao());
    expect(lista.status).toBe(200);
    expect(lista.corpo.data.map((a: any) => a.versao)).toEqual([2, 1]);
    expect(lista.corpo.data[0].criadoPor).toBe('contador@exemplo.com');
  });

  it('filtra por empresa e lista as empresas', async () => {
    await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao());
    await enviarZip(await zipComNota1(), novaSessao()); // sem empresa

    const empresas = await chamar('GET', '/analises/empresas', novaSessao());
    expect(empresas.corpo.data.map((e: any) => e.cnpj).sort()).toEqual(['', EMPRESA_EXEMPLO]);

    const daEmpresa = await chamar('GET', `/analises?empresa=${EMPRESA_EXEMPLO}`, novaSessao());
    expect(daEmpresa.corpo.data).toHaveLength(1);

    const semEmpresa = await chamar('GET', '/analises?empresa=sem-empresa', novaSessao());
    expect(semEmpresa.corpo.data).toEqual([expect.objectContaining({ empresaCnpj: '', competencia: '2024-03' })]);

    const todas = await chamar('GET', '/analises', novaSessao());
    expect(todas.corpo.data).toHaveLength(2);

    const uso = await chamar('GET', '/analises/uso', novaSessao());
    expect(uso.corpo.data).toEqual(expect.objectContaining({ tipo: 'memoria', analises: 2 }));

    const pontuado = await chamar('GET', '/analises?empresa=99.888.777/0001-66', novaSessao());
    expect(pontuado.corpo.data).toHaveLength(1);
  });

  it('recusa empresa que não é CNPJ de 14 dígitos nem sem-empresa', async () => {
    await enviarZip(await zipComNota1(), novaSessao()); // sem empresa
    for (const empresa of ['abc', '123', '9988877700016600']) {
      const resposta = await chamar('GET', `/analises?empresa=${empresa}`, novaSessao());
      expect(resposta.status).toBe(400);
    }
    expect((await chamar('GET', '/analises?limite=0', novaSessao())).status).toBe(400);
  });

  it('pagina a lista', async () => {
    for (let i = 0; i < 3; i++) await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao());

    const primeira = await chamar('GET', '/analises?limite=2', novaSessao());
    expect(primeira.corpo.data.map((a: any) => a.versao)).toEqual([3, 2]);
    expect(primeira.corpo.paginacao).toEqual({ offset: 0, limite: 2, temMais: true });

    const segunda = await chamar('GET', '/analises?limite=2&offset=2', novaSessao());
    expect(segunda.corpo.data.map((a: any) => a.versao)).toEqual([1]);
    expect(segunda.corpo.paginacao.temMais).toBe(false);
  });

  it('a empresa escolhida depois do upload atualiza a análise salva', async () => {
    const sessao = novaSessao();
    const upload = await enviarZip(await zipComNota1(), sessao);
    const id = upload.corpo.data.importacao.analise.id;

    const troca = await chamar('POST', '/upload/empresa', sessao, { cnpj: EMPRESA_EXEMPLO });
    expect(troca.status).toBe(200);
    expect(troca.corpo.data.importacao.analiseSalva).toBe(true);
    expect(troca.corpo.data.importacao.analise).toEqual(
      expect.objectContaining({ id, empresaCnpj: EMPRESA_EXEMPLO, versao: 1 })
    );

    const lista = await chamar('GET', `/analises?empresa=${EMPRESA_EXEMPLO}`, novaSessao());
    expect(lista.corpo.data.map((a: any) => a.id)).toEqual([id]);
    expect(lista.corpo.data[0].porSentido).toEqual({ entrada: 1, saida: 0, indefinido: 0 });
  });

  it('abrir carrega a análise noutra sessão com o mesmo painel do upload', async () => {
    const original = novaSessao();
    const upload = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), original);
    const id = upload.corpo.data.importacao.analise.id;
    const resumoOriginal = await chamar('GET', '/dashboard/resumo', original);

    const outra = novaSessao();
    const aberta = await chamar('POST', `/analises/${id}/abrir`, outra);
    expect(aberta.status).toBe(200);
    expect(aberta.corpo.data.importacao).toEqual(
      expect.objectContaining({
        totalDocumentosSessao: 3,
        empresa: expect.objectContaining({ cnpj: EMPRESA_EXEMPLO }),
        porSentido: upload.corpo.data.importacao.porSentido,
        analise: expect.objectContaining({ id }),
      })
    );

    const resumoAberto = await chamar('GET', '/dashboard/resumo', outra);
    expect(resumoAberto.corpo.data).toEqual(resumoOriginal.corpo.data);

    // Trocar a empresa da análise aberta cria outra versão; a aberta fica intacta.
    const troca = await chamar('POST', '/upload/empresa', outra, { cnpj: '12345678000190' });
    expect(troca.corpo.data.importacao.analiseSalva).toBe(true);
    expect(troca.corpo.data.importacao.analise).toEqual(
      expect.objectContaining({ empresaCnpj: '12345678000190', derivadaDe: id })
    );
    expect(troca.corpo.data.importacao.analise.id).not.toBe(id);
    const daOriginal = await chamar('GET', `/analises?empresa=${EMPRESA_EXEMPLO}`, novaSessao());
    expect(daOriginal.corpo.data).toEqual([expect.objectContaining({ id, empresaCnpj: EMPRESA_EXEMPLO, versao: 1 })]);

    expect((await chamar('POST', '/analises/inexistente/abrir', novaSessao())).status).toBe(404);
  });

  it('reprocessar gera a versão seguinte do ZIP guardado', async () => {
    const upload = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao());
    const id = upload.corpo.data.importacao.analise.id;

    const reprocessada = await chamar('POST', `/analises/${id}/reprocessar`, novaSessao());
    expect(reprocessada.status).toBe(200);
    expect(reprocessada.corpo.data.analise).toEqual(
      expect.objectContaining({ empresaCnpj: EMPRESA_EXEMPLO, versao: 2, reprocessadaDe: id, totalNotas: 3 })
    );

    expect((await chamar('POST', '/analises/inexistente/reprocessar', novaSessao())).status).toBe(404);
  });

  it('ZIP guardado ilegível responde 400 no reprocessamento', async () => {
    const loja = new ArmazenamentoAnalisesMemoria();
    loja.baixarZip = async () => Buffer.from('não é zip');
    definirArmazenamentoAnalises(loja);

    const upload = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao());
    const reprocessada = await chamar('POST', `/analises/${upload.corpo.data.importacao.analise.id}/reprocessar`, novaSessao());
    expect(reprocessada.status).toBe(400);
  });

  it('Supabase indisponível: o upload responde 200 com analiseSalva false e o aviso', async () => {
    const quebrado = new ArmazenamentoAnalisesMemoria();
    quebrado.salvar = async () => {
      throw new ErroSupabase('Sem resposta da Supabase (fetch failed).');
    };
    quebrado.listar = async () => {
      throw new ErroSupabase('Sem resposta da Supabase (fetch failed).');
    };
    definirArmazenamentoAnalises(quebrado);

    const sessao = novaSessao();
    const upload = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), sessao);
    expect(upload.status).toBe(200);
    expect(upload.corpo.data.importacao.analiseSalva).toBe(false);
    expect(upload.corpo.data.importacao.avisoAnalise).toMatch(/reative-o no painel da Supabase/);
    expect(upload.corpo.data.importacao.totalDocumentosSessao).toBe(3);

    const lista = await chamar('GET', '/analises', sessao);
    expect(lista.status).toBe(503);
    expect(lista.corpo.error).toMatch(/Restore project/);
  });

  it('(a) troca de empresa depois de um reenvio que não salvou não mexe na análise anterior', async () => {
    const loja = new ArmazenamentoAnalisesMemoria();
    definirArmazenamentoAnalises(loja);
    const sessao = novaSessao();

    const primeira = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), sessao);
    const idA = primeira.corpo.data.importacao.analise.id;
    const antes = await loja.obter(idA);

    loja.salvar = async () => {
      throw new ErroSupabase('Sem resposta da Supabase (fetch failed).');
    };
    const segunda = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), sessao);
    expect(segunda.corpo.data.importacao.analiseSalva).toBe(false);

    const troca = await chamar('POST', '/upload/empresa', sessao, { cnpj: '12345678000190' });
    expect(troca.status).toBe(200);
    expect(troca.corpo.data.importacao.analiseSalva).toBe(false);
    expect(await loja.obter(idA)).toEqual(antes);
  });

  it('(c) arquivo que não é ZIP responde 400', async () => {
    const { status, corpo } = await enviarZip(Buffer.from('isto não é um zip'), novaSessao());
    expect(status).toBe(400);
    expect(corpo.error).toMatch(/O ZIP não pôde ser lido/);
  });

  it('exige autenticação', async () => {
    const resposta = await fetch(`${base}/analises`);
    expect(resposta.status).toBe(401);
  });

  describe('exclusão', () => {
    const INEXISTENTE = '00000000-0000-4000-8000-000000000000';

    it('DELETE /analises/:id exclui; some da lista e o uso diminui; de novo, 404', async () => {
      const upload = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao());
      const id = upload.corpo.data.importacao.analise.id;
      const usoAntes = (await chamar('GET', '/analises/uso', novaSessao())).corpo.data;

      const resposta = await chamar('DELETE', `/analises/${id}`, novaSessao());
      expect(resposta.status).toBe(200);
      expect(resposta.corpo.data).toEqual(
        expect.objectContaining({ excluidas: [id], naoEncontradas: [], bytesLiberados: usoAntes.bytesZips })
      );

      expect((await chamar('GET', '/analises', novaSessao())).corpo.data).toHaveLength(0);
      expect((await chamar('GET', '/analises/uso', novaSessao())).corpo.data).toEqual(
        expect.objectContaining({ analises: 0, bytesZips: 0 })
      );
      expect((await chamar('DELETE', `/analises/${id}`, novaSessao())).status).toBe(404);
      expect((await chamar('DELETE', '/analises/nao-e-uuid', novaSessao())).status).toBe(400);
    });

    it('POST /analises/excluir exclui em lote, informa os não encontrados e o espaço liberado', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push((await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao())).corpo.data.importacao.analise.id);
      }

      const resposta = await chamar('POST', '/analises/excluir', novaSessao(), { ids: [ids[0], INEXISTENTE, ids[2]] });
      expect(resposta.status).toBe(200);
      expect(resposta.corpo.data.excluidas).toEqual([ids[0], ids[2]]);
      expect(resposta.corpo.data.naoEncontradas).toEqual([INEXISTENTE]);
      expect(resposta.corpo.data.bytesLiberados).toBe(2 * fs.readFileSync(ZIP_EXEMPLO).length);

      // A versão que ficou mantém o número; a próxima importação não reusa a 3 excluída.
      const lista = await chamar('GET', '/analises', novaSessao());
      expect(lista.corpo.data.map((a: any) => [a.id, a.versao])).toEqual([[ids[1], 2]]);
      const nova = await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao());
      expect(nova.corpo.data.importacao.analise.versao).toBe(4);
    });

    it('recusa lote vazio, com mais de 100 ids ou com id que não é uuid', async () => {
      const muitos = Array.from({ length: 101 }, () => INEXISTENTE);
      for (const corpo of [{}, { ids: [] }, { ids: 'x' }, { ids: muitos }, { ids: [INEXISTENTE, 'abc'] }, { ids: [1] }]) {
        expect((await chamar('POST', '/analises/excluir', novaSessao(), corpo)).status).toBe(400);
      }
      const cem = Array.from({ length: 100 }, () => INEXISTENTE);
      expect((await chamar('POST', '/analises/excluir', novaSessao(), { ids: cem })).status).toBe(200);
    });

    it('excluir a análise aberta desfaz o vínculo e o painel segue com os dados', async () => {
      const sessao = novaSessao();
      const id = (await enviarZip(fs.readFileSync(ZIP_EXEMPLO), sessao)).corpo.data.importacao.analise.id;

      const resposta = await chamar('DELETE', `/analises/${id}`, novaSessao());
      expect(resposta.corpo.data.sessoesDesvinculadas).toBe(1);

      const resumo = await chamar('GET', '/dashboard/resumo', sessao);
      expect(resumo.status).toBe(200);
      // A troca de empresa não tenta mais gravar na análise excluída.
      const troca = await chamar('POST', '/upload/empresa', sessao, { cnpj: '12345678000190' });
      expect(troca.status).toBe(200);
      expect(troca.corpo.data.importacao.analiseSalva).toBe(false);
    });

    it('ZIP ausente: exclui e devolve o aviso', async () => {
      const loja = new ArmazenamentoAnalisesMemoria();
      loja.excluir = async function (this: ArmazenamentoAnalisesMemoria, id: string) {
        const r = await ArmazenamentoAnalisesMemoria.prototype.excluir.call(this, id);
        return r && { ...r, zipRemovido: false, avisoZip: 'O ZIP da análise já não existia no armazenamento.' };
      };
      definirArmazenamentoAnalises(loja);
      const id = (await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao())).corpo.data.importacao.analise.id;

      const resposta = await chamar('DELETE', `/analises/${id}`, novaSessao());
      expect(resposta.status).toBe(200);
      expect(resposta.corpo.data.avisos).toEqual([expect.stringMatching(/já não existia/)]);
      expect(resposta.corpo.data.bytesLiberados).toBe(0);
    });

    it('Supabase fora: 503 com a causa e o que já tinha saído', async () => {
      const loja = new ArmazenamentoAnalisesMemoria();
      definirArmazenamentoAnalises(loja);
      const a = (await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao())).corpo.data.importacao.analise.id;
      const b = (await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao())).corpo.data.importacao.analise.id;
      const original = loja.excluir.bind(loja);
      loja.excluir = async id => {
        if (id === b) throw new ErroSupabase('Sem resposta da Supabase (fetch failed).');
        return original(id);
      };

      const resposta = await chamar('POST', '/analises/excluir', novaSessao(), { ids: [a, b] });
      expect(resposta.status).toBe(503);
      expect(resposta.corpo.error).toMatch(/Restore project.*1 análise já tinha sido excluída/);
      expect(resposta.corpo.data.excluidas).toEqual([a]);

      const individual = await chamar('DELETE', `/analises/${b}`, novaSessao());
      expect(individual.status).toBe(503);
    });

    it('exige autenticação para excluir e baixar o ZIP', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      expect((await fetch(`${base}/analises/${id}`, { method: 'DELETE' })).status).toBe(401);
      expect((await fetch(`${base}/analises/excluir`, { method: 'POST' })).status).toBe(401);
      expect((await fetch(`${base}/analises/${id}/zip`)).status).toBe(401);
    });

    it('aceita id em maiúsculas e registra no log quem excluiu e quem assumiu a conta', async () => {
      const id = (await enviarZip(fs.readFileSync(ZIP_EXEMPLO), novaSessao())).corpo.data.importacao.analise.id;
      const tokenAssumido = jwt.sign(
        {
          userId: 'cliente',
          email: 'cliente@exemplo.com',
          sessionId: 'sess-assumida',
          assumidoPor: { userId: 'adm', email: 'admin@exemplo.com' },
        },
        config.jwt.secret
      );
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        const resposta = await chamar('DELETE', `/analises/${id.toUpperCase()}`, {
          Authorization: `Bearer ${tokenAssumido}`,
          'x-session-id': 'sess-assumida',
        });
        expect(resposta.status).toBe(200);
        expect(resposta.corpo.data.excluidas).toEqual([id]);
        const linha = log.mock.calls.map(c => String(c[0])).find(l => l.includes('excluiu a análise'));
        expect(linha).toContain(`cliente@exemplo.com (assumido por admin@exemplo.com) excluiu a análise ${id}`);
      } finally {
        log.mockRestore();
      }
    });

    it('GET /analises/:id/zip baixa o ZIP guardado com o nome original; 404 sem análise ou sem ZIP', async () => {
      const original = fs.readFileSync(ZIP_EXEMPLO);
      const id = (await enviarZip(original, novaSessao())).corpo.data.importacao.analise.id;

      const resposta = await fetch(`${base}/analises/${id}/zip`, { headers: novaSessao() });
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get('content-type')).toBe('application/zip');
      expect(resposta.headers.get('content-disposition')).toContain('filename="lote.zip"');
      expect(Buffer.from(await resposta.arrayBuffer()).equals(original)).toBe(true);

      const inexistente = '00000000-0000-4000-8000-000000000000';
      expect((await fetch(`${base}/analises/${inexistente}/zip`, { headers: novaSessao() })).status).toBe(404);
      expect((await fetch(`${base}/analises/abc/zip`, { headers: novaSessao() })).status).toBe(400);

      const loja = new ArmazenamentoAnalisesMemoria();
      loja.baixarZip = async () => null;
      definirArmazenamentoAnalises(loja);
      const semZip = (await enviarZip(original, novaSessao())).corpo.data.importacao.analise.id;
      expect((await fetch(`${base}/analises/${semZip}/zip`, { headers: novaSessao() })).status).toBe(404);
    });
  });
});
