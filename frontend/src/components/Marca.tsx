import React from 'react';

/**
 * Logotipo do RTE.
 *
 * Usa o arquivo oficial em frontend/public/rte-logo.png, e não uma
 * reconstrução em texto: as proporções, o corte do E e a seta integrada não
 * são reproduzíveis com fonte de sistema. A arte tem 847x220, folga
 * suficiente para os tamanhos usados nas telas sem serrilhar.
 *
 * Se um dia existir a versão vetorial, troque o src por '/rte-logo.svg' —
 * nenhum outro arquivo precisa mudar, porque toda a aplicação passa por
 * aqui.
 */
export const MarcaRTE: React.FC<{
  /** Altura da marca em pixels. */
  tamanho?: number;
  /**
   * Em fundo escuro ou colorido, a marca inteira vira branca. O filtro
   * zera a luminância e inverte, o que transforma preto e roxo em branco
   * sólido sem precisar de um segundo arquivo.
   */
  invertida?: boolean;
  className?: string;
}> = ({ tamanho = 24, invertida = false, className = '' }) => (
  <img
    src="/rte-logo.png"
    alt="RTE"
    height={tamanho}
    style={{
      height: tamanho,
      width: 'auto',
      ...(invertida ? { filter: 'brightness(0) invert(1)' } : {}),
    }}
    className={className}
  />
);
