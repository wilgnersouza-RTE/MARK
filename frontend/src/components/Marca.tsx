import React from 'react';
import { ArrowUpRight } from 'lucide-react';

/**
 * Logotipo do RTE.
 *
 * Reconstruído em texto + ícone para escalar sem perda em qualquer tamanho.
 * Se o arquivo vetorial oficial for disponibilizado, basta trocar o corpo
 * deste componente por um <img src="/rte.svg" /> — nenhum outro arquivo
 * precisa mudar, porque toda a aplicação passa por aqui.
 */
export const MarcaRTE: React.FC<{
  /** Altura da tipografia em pixels. */
  tamanho?: number;
  /** Em fundo roxo ou escuro, a marca inteira vira branca. */
  invertida?: boolean;
  className?: string;
}> = ({ tamanho = 24, invertida = false, className = '' }) => (
  <span
    className={`inline-flex items-center font-bold tracking-tight ${className}`}
    style={{ fontSize: tamanho, lineHeight: 1 }}
    aria-label="RTE"
  >
    <span className={invertida ? 'text-white' : 'text-tinta-forte'}>RT</span>
    <span className={invertida ? 'text-white/80' : 'text-marca-azul'}>E</span>
    <ArrowUpRight
      size={tamanho * 0.8}
      strokeWidth={3}
      className={invertida ? 'text-white/80' : 'text-marca-azul'}
      style={{ marginLeft: -tamanho * 0.08 }}
      aria-hidden="true"
    />
  </span>
);
