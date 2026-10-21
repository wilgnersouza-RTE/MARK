import { NFeDocument } from '../types';
import { sessionService, ErroEmpresaForaDoLote } from './session';
import { contarPorSentido } from '../utils/sentidoImportacao';

const EMPRESA = '11111111000111';
const OUTRA = '99999999000199';

let sequencia = 0;

function nota(cnpjEmitente: string, cnpjDestino: string): NFeDocument {
  sequencia++;
  return {
    id: `doc-${sequencia}`,
    modelo: 55,
    tipo: 'indefinido',
    chaveNFe: `chave-${sequencia}`,
    dataEmissao: '2026-02-01T10:00:00.000Z',
    cnpjEmitente,
    nomeEmitente: `EMITENTE ${cnpjEmitente}`,
    cnpjDestino,
    nomeDestino: `DESTINO ${cnpjDestino}`,
    regimeTributario: 'Lucro-Real',
    values: {
      baseCalculo: 0, icms: 0, icmsST: 0, ipi: 0, iss: 0, pis: 0, cofins: 0,
      irrf: 0, aliquota: 0, cbs: 0, ibs: 0, total: 100,
    },
    validacoes: [],
    divergencias: [],
  };
}

async function sessaoComLote(sessionId: string, documentos: NFeDocument[]) {
  sessionService.criarOuRecuperarSessao(sessionId, 'usuario-teste', 'teste@exemplo.com');
  return sessionService.adicionarDocumentos(
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
    null
  );
}

describe('sessionService.definirEmpresa', () => {
  it('reclassifica as notas já importadas e regenera o dashboard', async () => {
    const sessao = await sessaoComLote('sess-empresa-1', [
      nota(EMPRESA, OUTRA),
      nota(OUTRA, EMPRESA),
      nota(OUTRA, '22222222000122'),
    ]);
    expect(contarPorSentido(sessao.documentos)).toEqual({ entrada: 0, saida: 0, indefinido: 3 });

    const atualizada = await sessionService.definirEmpresa('sess-empresa-1', EMPRESA);

    expect(atualizada.empresa).toEqual(expect.objectContaining({ cnpj: EMPRESA, inferida: false }));
    expect(contarPorSentido(atualizada.documentos)).toEqual({ entrada: 1, saida: 1, indefinido: 1 });
    expect(atualizada.dashboard).not.toBeNull();
  });

  it('aceita CNPJ formatado', async () => {
    await sessaoComLote('sess-empresa-2', [nota(EMPRESA, OUTRA)]);
    const atualizada = await sessionService.definirEmpresa('sess-empresa-2', '11.111.111/0001-11');
    expect(atualizada.empresa?.cnpj).toBe(EMPRESA);
  });

  it('recusa CNPJ que não aparece no lote', async () => {
    await sessaoComLote('sess-empresa-3', [nota(EMPRESA, OUTRA)]);
    await expect(
      sessionService.definirEmpresa('sess-empresa-3', '33333333000133')
    ).rejects.toBeInstanceOf(ErroEmpresaForaDoLote);
  });
});
