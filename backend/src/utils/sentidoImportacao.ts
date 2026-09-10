import { NFeDocument, DocumentType } from '../types';

/**
 * Descobre, a partir do próprio lote, se os XMLs são de entrada ou de saída.
 *
 * A tag tpNF do XML não serve para isso: ela é o ponto de vista de quem
 * emitiu a nota. Uma compra sua chega marcada como saída, porque foi saída
 * do fornecedor. Validar por ela acusaria erro em toda importação de
 * entrada legítima.
 *
 * A pista confiável está na repetição. Numa exportação de entradas, o
 * destinatário é sempre a mesma empresa (a analisada) e os emitentes variam
 * entre os fornecedores. Numa exportação de saídas, ocorre o inverso: o
 * emitente é constante e os destinatários variam. Basta ver qual dos dois
 * lados se repete para saber o sentido — sem pedir o CNPJ ao usuário.
 */

export interface SentidoInferido {
  /** Sentido detectado, ou null quando o lote não permite concluir. */
  sentido: DocumentType | null;
  /** CNPJ da empresa analisada, quando identificado. */
  cnpjEmpresa: string | null;
  /** Explicação em português, usada na mensagem de erro. */
  justificativa: string;
}

/** Proporção mínima de notas com o mesmo CNPJ para considerá-lo constante. */
const LIMITE_CONCENTRACAO = 0.8;

/** Lotes pequenos não têm repetição suficiente para concluir nada. */
const MINIMO_DOCUMENTOS = 3;

function maisFrequente(valores: string[]): { valor: string; proporcao: number } {
  const contagem = new Map<string, number>();
  for (const v of valores) {
    if (!v || v === 'N/A') continue;
    contagem.set(v, (contagem.get(v) ?? 0) + 1);
  }

  let melhor = '';
  let maior = 0;
  for (const [valor, n] of contagem.entries()) {
    if (n > maior) {
      maior = n;
      melhor = valor;
    }
  }

  return { valor: melhor, proporcao: valores.length ? maior / valores.length : 0 };
}

export function inferirSentido(documentos: NFeDocument[]): SentidoInferido {
  if (documentos.length < MINIMO_DOCUMENTOS) {
    return {
      sentido: null,
      cnpjEmpresa: null,
      justificativa:
        `O lote tem apenas ${documentos.length} nota(s). ` +
        'São necessárias ao menos 3 para identificar o sentido com segurança.',
    };
  }

  const emitentes = maisFrequente(documentos.map(d => d.cnpjEmitente));
  const destinos = maisFrequente(documentos.map(d => d.cnpjDestino));

  const emitenteConstante = emitentes.proporcao >= LIMITE_CONCENTRACAO;
  const destinoConstante = destinos.proporcao >= LIMITE_CONCENTRACAO;

  // Os dois lados constantes: uma empresa só, emitindo para ela mesma ou
  // lote com um único par. Não há como separar entrada de saída.
  if (emitenteConstante && destinoConstante) {
    return {
      sentido: null,
      cnpjEmpresa: null,
      justificativa:
        'Todas as notas têm o mesmo emitente e o mesmo destinatário, ' +
        'o que não permite distinguir entrada de saída.',
    };
  }

  if (destinoConstante) {
    const pct = Math.round(destinos.proporcao * 100);
    return {
      sentido: 'entrada',
      cnpjEmpresa: destinos.valor,
      justificativa:
        `${pct}% das notas têm o mesmo destinatário (${destinos.valor}) ` +
        'e emitentes variados — é o padrão de um lote de entradas.',
    };
  }

  if (emitenteConstante) {
    const pct = Math.round(emitentes.proporcao * 100);
    return {
      sentido: 'saida',
      cnpjEmpresa: emitentes.valor,
      justificativa:
        `${pct}% das notas têm o mesmo emitente (${emitentes.valor}) ` +
        'e destinatários variados — é o padrão de um lote de saídas.',
    };
  }

  return {
    sentido: null,
    cnpjEmpresa: null,
    justificativa:
      'Nem o emitente nem o destinatário se repetem o suficiente no lote ' +
      'para identificar a empresa analisada.',
  };
}

// ==================== CONFERÊNCIA PELO CNPJ ====================

/** Deixa só os dígitos, para comparar CNPJ digitado com CNPJ do XML. */
export function apenasDigitos(valor: string | undefined | null): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/** Um CNPJ tem 14 dígitos; um CPF, 11. Aceitamos os dois. */
export function documentoValido(valor: string): boolean {
  const d = apenasDigitos(valor);
  return d.length === 14 || d.length === 11;
}

/** Formata para leitura na mensagem de erro. */
export function formatarDocumento(valor: string): string {
  const d = apenasDigitos(valor);
  if (d.length === 14) {
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (d.length === 11) {
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return valor;
}

export type LadoDaNota = 'entrada' | 'saida' | 'alheio';

/**
 * De que lado da nota está a empresa analisada.
 *
 * Com o CNPJ em mão a conferência deixa de ser estatística e passa a ser
 * exata, nota por nota: se a empresa é o destinatário, aquela nota é uma
 * entrada dela; se é o emitente, é uma saída. Não aparecendo em nenhum dos
 * dois lados, a nota não pertence à análise.
 */
export function ladoDaEmpresa(
  doc: { cnpjEmitente: string; cnpjDestino: string },
  cnpjEmpresa: string
): LadoDaNota {
  const alvo = apenasDigitos(cnpjEmpresa);
  if (apenasDigitos(doc.cnpjDestino) === alvo) return 'entrada';
  if (apenasDigitos(doc.cnpjEmitente) === alvo) return 'saida';
  return 'alheio';
}
