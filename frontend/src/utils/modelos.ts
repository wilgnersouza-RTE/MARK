/**
 * Modelos de documento fiscal aceitos na importação.
 *
 * O código numérico é o que vai para o backend e o que aparece na tag <mod>
 * do XML; o nome é o que o usuário reconhece. Os dois andam juntos na tela
 * ("NF-e (55)") para não haver dúvida sobre o que está sendo importado.
 */
export const MODELOS_DOCUMENTO = [
  { codigo: '55', nome: 'NF-e', descricao: 'Nota Fiscal Eletrônica' },
  { codigo: '65', nome: 'NFC-e', descricao: 'Nota Fiscal de Consumidor Eletrônica' },
  { codigo: '57', nome: 'CT-e', descricao: 'Conhecimento de Transporte Eletrônico' },
  // Sem número entre parênteses: a NFS-e do padrão nacional não usa a
  // numeração de modelo da SEFAZ.
  { codigo: 'NFSE', nome: 'NFS-e', descricao: 'Nota Fiscal de Serviço Eletrônica — padrão nacional' },
] as const;

export type ModeloDocumento = (typeof MODELOS_DOCUMENTO)[number]['codigo'];

/** Rótulo completo, no formato usado nas telas e nas mensagens de erro. */
export function rotuloModelo(codigo: string): string {
  const m = MODELOS_DOCUMENTO.find(x => x.codigo === String(codigo));
  if (!m) return `modelo ${codigo}`;
  return /^\d+$/.test(m.codigo) ? `${m.nome} (${m.codigo})` : m.nome;
}

/** Arquivo do ZIP que não pôde ser importado, com o motivo. */
export interface ArquivoRejeitado {
  nomeArquivo: string;
  erro: string;
}
