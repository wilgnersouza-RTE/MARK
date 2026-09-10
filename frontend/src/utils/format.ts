/**
 * Formatação em padrão brasileiro.
 *
 * Antes o código usava toFixed(2), que produz "2282815.70" — ponto decimal e
 * sem separador de milhar. Aqui tudo passa por Intl.NumberFormat('pt-BR'),
 * que produz "2.282.815,70".
 */

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moedaCompacta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const decimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 2282815.7 => "R$ 2.282.815,70" */
export function formatarMoeda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) {
    return 'R$ 0,00';
  }
  return moeda.format(valor);
}

/** 2282815.7 => "R$ 2,3 mi" — para eixos de gráfico, onde não cabe o valor cheio */
export function formatarMoedaCompacta(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) {
    return 'R$ 0';
  }
  return moedaCompacta.format(valor);
}

/** 1348 => "1.348" */
export function formatarInteiro(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) {
    return '0';
  }
  return inteiro.format(valor);
}

/** 0.1 => "0,10%" */
export function formatarPercentual(
  valor: number | null | undefined,
  casas: number = 2
): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) {
    return '0,00%';
  }
  return (
    new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    }).format(valor) + '%'
  );
}

/** 1234.5 => "1.234,50" (sem símbolo de moeda) */
export function formatarDecimal(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) {
    return '0,00';
  }
  return decimal.format(valor);
}

/** "2024-03-15T10:30:00-03:00" => "15/03/2024" */
export function formatarData(valor: string | null | undefined): string {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(data);
}

/** "12345678000190" => "12.345.678/0001-90" */
export function formatarCNPJ(valor: string | null | undefined): string {
  if (!valor) return '-';
  const digitos = valor.replace(/\D/g, '');

  if (digitos.length === 14) {
    return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (digitos.length === 11) {
    return digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return valor;
}
