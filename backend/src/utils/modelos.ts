/**
 * Modelos de documento fiscal aceitos na importação.
 *
 * Espelha frontend/src/utils/modelos.ts. Os dois lados precisam concordar
 * sobre o que é 55, 65 e 57 para que a mensagem de erro do backend faça
 * sentido para quem escolheu o modelo na tela.
 */
export const MODELOS_DOCUMENTO = [
  { codigo: 55, nome: 'NF-e', descricao: 'Nota Fiscal Eletrônica' },
  { codigo: 65, nome: 'NFC-e', descricao: 'Nota Fiscal de Consumidor Eletrônica' },
  { codigo: 57, nome: 'CT-e', descricao: 'Conhecimento de Transporte Eletrônico' },
  // A NFS-e do padrão nacional não usa a numeração de modelo da SEFAZ, que é
  // estadual. O código aqui é textual de propósito, para não inventar um
  // número que não existe na legislação.
  { codigo: 'NFSE', nome: 'NFS-e', descricao: 'Nota Fiscal de Serviço Eletrônica — padrão nacional' },
] as const;

export const CODIGOS_MODELO = MODELOS_DOCUMENTO.map(m => m.codigo);

/** Rótulo completo, no formato usado nas telas e nas mensagens de erro. */
export function rotuloModelo(codigo: number | string): string {
  const alvo = String(codigo).toUpperCase();
  const m = MODELOS_DOCUMENTO.find(x => String(x.codigo).toUpperCase() === alvo);
  if (!m) return `modelo ${codigo}`;
  // Só os modelos numéricos exibem o número entre parênteses.
  return typeof m.codigo === 'number' ? `${m.nome} (${m.codigo})` : m.nome;
}
