import { NFeDocument, DocumentType } from '../types';

/**
 * Identifica a empresa analisada no lote e classifica cada nota em entrada
 * ou saída do ponto de vista dela.
 *
 * A tag tpNF do XML não serve para isso: ela é o ponto de vista de quem
 * emitiu a nota. Uma compra sua chega marcada como saída, porque foi saída
 * do fornecedor. Classificar por ela inverteria toda nota de entrada.
 *
 * A pista confiável é a repetição. A empresa analisada aparece em quase
 * todas as notas do lote, como emitente nas vendas e como destinatária ou
 * tomadora nas compras, enquanto fornecedores e clientes variam. Por isso a
 * contagem considera os dois lados juntos, uma vez por nota.
 *
 * Em CT-e, o parser já grava o tomador do serviço em cnpjDestino; em NFS-e,
 * o tomador. Nos dois casos, "destino" quer dizer quem escritura a despesa.
 */

export interface CandidatoEmpresa {
  cnpj: string;
  nome: string;
  /** Em quantas notas do lote o CNPJ aparece, de um lado ou do outro */
  quantidadeNotas: number;
}

export interface IdentificacaoEmpresa {
  /** Empresa identificada com segurança, ou null quando é preciso escolher */
  empresa: CandidatoEmpresa | null;
  /** Os CNPJs mais frequentes do lote, do mais para o menos frequente */
  candidatos: CandidatoEmpresa[];
  /** Todos os CNPJs do lote, na mesma ordem; base para validar uma escolha */
  todos: CandidatoEmpresa[];
}

/** Proporção mínima de notas em que o CNPJ precisa aparecer. */
export const LIMITE_CONCENTRACAO = 0.8;

/** Quantos CNPJs oferecer quando a escolha fica com o contador. */
export const MAXIMO_CANDIDATOS = 5;

/** Nomes que o parser grava quando o XML não traz o nome da parte. */
const NOMES_GENERICOS = new Set(['N/A', 'Consumidor Final', 'Tomador não identificado']);

/** Só os dígitos; vazio quando o documento não foi informado. */
export function normalizarCnpj(valor: string | undefined | null): string {
  if (!valor || valor === 'N/A') return '';
  return String(valor).replace(/\D/g, '');
}

export function identificarEmpresa(documentos: NFeDocument[]): IdentificacaoEmpresa {
  const contagem = new Map<string, { quantidade: number; nome: string; data: number }>();

  for (const doc of documentos) {
    const partes: Array<[string, string]> = [
      [normalizarCnpj(doc.cnpjEmitente), doc.nomeEmitente],
      [normalizarCnpj(doc.cnpjDestino), doc.nomeDestino],
    ];

    // Uma vez por nota, mesmo que a empresa esteja nos dois lados.
    const vistosNaNota = new Set<string>();

    for (const [cnpj, nome] of partes) {
      if (!cnpj) continue;

      const atual = contagem.get(cnpj) ?? { quantidade: 0, nome: '', data: -1 };
      if (!vistosNaNota.has(cnpj)) {
        atual.quantidade++;
        vistosNaNota.add(cnpj);
      }

      // Guarda o nome da nota mais recente, preferindo um nome real a um
      // genérico (o genérico entra sem data e perde para qualquer nome real).
      // Datas vêm em formatos diferentes (ISO com Z na NF-e, texto do XML com
      // ou sem fuso no CT-e e na NFS-e): compara-se o instante, não o texto.
      const instante = Date.parse(doc.dataEmissao || '');
      const data = Number.isFinite(instante) ? instante : 0;
      if (nome && !NOMES_GENERICOS.has(nome) && data >= atual.data) {
        atual.nome = nome;
        atual.data = data;
      } else if (!atual.nome && nome) {
        atual.nome = nome;
      }

      contagem.set(cnpj, atual);
    }
  }

  const ordenados: CandidatoEmpresa[] = Array.from(contagem.entries())
    .map(([cnpj, c]) => ({ cnpj, nome: c.nome || 'Nome não informado', quantidadeNotas: c.quantidade }))
    .sort((a, b) => b.quantidadeNotas - a.quantidadeNotas || a.cnpj.localeCompare(b.cnpj));

  const candidatos = ordenados.slice(0, MAXIMO_CANDIDATOS);

  // Uma nota só não tem repetição nenhuma: emitente e destinatário empatam.
  if (documentos.length < 2 || ordenados.length === 0) {
    return { empresa: null, candidatos, todos: ordenados };
  }

  const [primeiro, segundo] = ordenados;
  const concentrado = primeiro.quantidadeNotas >= LIMITE_CONCENTRACAO * documentos.length;
  const isolado = !segundo || primeiro.quantidadeNotas > segundo.quantidadeNotas;

  return {
    empresa: concentrado && isolado ? primeiro : null,
    candidatos,
    todos: ordenados,
  };
}

/**
 * Sentido de uma nota para a empresa informada.
 *
 * Emitente vence: quando a empresa está nos dois lados, a nota é saída.
 */
export function sentidoDaNota(documento: NFeDocument, cnpjEmpresa: string | null | undefined): DocumentType {
  const empresa = normalizarCnpj(cnpjEmpresa);
  if (!empresa) return 'indefinido';
  if (normalizarCnpj(documento.cnpjEmitente) === empresa) return 'saida';
  if (normalizarCnpj(documento.cnpjDestino) === empresa) return 'entrada';
  return 'indefinido';
}

/** Cópia das notas com o sentido calculado para a empresa informada. */
export function classificarSentido(
  documentos: NFeDocument[],
  cnpjEmpresa: string | null | undefined
): NFeDocument[] {
  return documentos.map(doc => ({ ...doc, tipo: sentidoDaNota(doc, cnpjEmpresa) }));
}

/** Quantidade de notas por sentido. */
export function contarPorSentido(documentos: NFeDocument[]): Record<DocumentType, number> {
  const contagem: Record<DocumentType, number> = { entrada: 0, saida: 0, indefinido: 0 };
  for (const doc of documentos) contagem[doc.tipo] = (contagem[doc.tipo] ?? 0) + 1;
  return contagem;
}

/**
 * Rótulo do sentido para telas e planilhas.
 *
 * Sem empresa definida, nenhuma nota foi classificada ainda: chamar isso de
 * "Sem vínculo" diria que a nota não tem relação com a empresa.
 */
export function rotuloSentido(tipo: DocumentType | string, temEmpresa = true): string {
  if (!temEmpresa) return 'Não classificada';
  if (tipo === 'entrada') return 'Entrada';
  if (tipo === 'saida') return 'Saída';
  return 'Sem vínculo';
}
