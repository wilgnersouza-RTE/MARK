import { NFeDocument } from '../types';

/**
 * Identidade da nota fiscal: o que diz que dois XMLs são a mesma nota.
 *
 *   - NF-e, NFC-e e CT-e: a chave de acesso de 44 dígitos. A chave já traz
 *     UF, CNPJ do emitente, modelo, série e número.
 *   - NFS-e: CNPJ (ou CPF) do prestador + código de verificação. Sem código,
 *     prestador + número + ano de emissão, porque há municípios que
 *     reiniciam a numeração a cada ano.
 *
 * Nota sem identidade confiável (chave vazia, "N/A", fora do formato, NFS-e
 * sem prestador ou sem número e código) não tem identidade: nunca é tratada
 * como repetida.
 *
 * É a mesma regra no bloqueio de duplicados da importação
 * (services/duplicados.ts) e na junção das importações da empresa
 * (services/conjuntoEmpresa.ts).
 */

const ehNFSe = (doc: NFeDocument) => String(doc.modelo).toUpperCase() === 'NFSE';
const prestadorDe = (doc: NFeDocument) => (doc.cnpjEmitente ?? '').replace(/\D/g, '');
const anoDe = (doc: NFeDocument) => (/^\d{4}/.test(doc.diaEmissao ?? '') ? doc.diaEmissao!.slice(0, 4) : '');
const semZeros = (numero: string) => numero.trim().replace(/^0+(?=\d)/, '');

/**
 * Identidades pelas quais a nota é reconhecida; vazia quando não há
 * identidade confiável. Duas notas são a mesma quando têm alguma em comum.
 *
 * A nota nova tem uma só. A NFS-e gravada antes de o parser guardar número
 * e código separados (sem `numeroNfse`) tem duas candidatas, porque a chave
 * antiga era o código de verificação ou, sem ele, o número: assim a antiga
 * e a nova da mesma nota se reconhecem.
 */
export function identidadesNota(doc: NFeDocument): string[] {
  if (!ehNFSe(doc)) {
    const chave = (doc.chaveNFe ?? '').trim();
    return /^\d{44}$/.test(chave) ? [`chave:${chave}`] : [];
  }

  const prestador = prestadorDe(doc);
  if (!prestador) return [];
  const ano = anoDe(doc);

  if (doc.numeroNfse === undefined) {
    const antiga = (doc.chaveNFe ?? '').trim();
    if (!antiga || antiga.toUpperCase() === 'N/A') return [];
    const candidatas = [`nfse:${prestador}:c:${antiga.toUpperCase()}`];
    if (ano) candidatas.push(`nfse:${prestador}:n:${semZeros(antiga)}:${ano}`);
    return candidatas;
  }

  const codigo = (doc.codigoVerificacao ?? '').trim().toUpperCase();
  if (codigo) return [`nfse:${prestador}:c:${codigo}`];

  const numero = semZeros(doc.numeroNfse);
  if (numero && ano) return [`nfse:${prestador}:n:${numero}:${ano}`];
  return [];
}

/** Identidade principal da nota; null quando não há identidade confiável. */
export function identidadeNota(doc: NFeDocument): string | null {
  return identidadesNota(doc)[0] ?? null;
}

/** Por que a nota ficou sem identidade, para o aviso da tela. */
export function motivoSemIdentidade(doc: NFeDocument): string {
  if (ehNFSe(doc)) {
    if (!prestadorDe(doc)) return 'NFS-e sem CNPJ do prestador';
    if (doc.numeroNfse !== undefined && semZeros(doc.numeroNfse) && !anoDe(doc)) {
      return 'NFS-e sem código de verificação nem data de emissão';
    }
    return 'NFS-e sem número nem código de verificação';
  }
  return 'sem chave de acesso de 44 dígitos';
}
