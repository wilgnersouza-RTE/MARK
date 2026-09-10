import React, { useState, useRef } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Tooltip acionado por hover (e por foco, para acessibilidade via teclado).
 *
 * Usa posicionamento fixo calculado a partir do elemento âncora, em vez de
 * absolute, para o balão não ser cortado por containers com overflow hidden —
 * caso dos cards e das tabelas com rolagem.
 */
export const Tooltip: React.FC<{
  children: React.ReactNode;
  conteudo: React.ReactNode;
  largura?: number;
}> = ({ children, conteudo, largura = 300 }) => {
  const [visivel, setVisivel] = useState(false);
  const [posicao, setPosicao] = useState({ top: 0, left: 0, acima: false });
  const ancoraRef = useRef<HTMLSpanElement>(null);

  const abrir = () => {
    const el = ancoraRef.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    const espacoAbaixo = window.innerHeight - r.bottom;
    const acima = espacoAbaixo < 200;

    // Mantém o balão dentro da janela na horizontal
    let left = r.left + r.width / 2 - largura / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - largura - 12));

    setPosicao({
      top: acima ? r.top - 8 : r.bottom + 8,
      left,
      acima,
    });
    setVisivel(true);
  };

  return (
    <>
      <span
        ref={ancoraRef}
        tabIndex={0}
        onMouseEnter={abrir}
        onMouseLeave={() => setVisivel(false)}
        onFocus={abrir}
        onBlur={() => setVisivel(false)}
        className="inline-flex cursor-help outline-none"
      >
        {children}
      </span>

      {visivel && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: posicao.top,
            left: posicao.left,
            width: largura,
            transform: posicao.acima ? 'translateY(-100%)' : undefined,
            zIndex: 9999,
          }}
          className="rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-xl animate-fadeIn"
        >
          {conteudo}
        </div>
      )}
    </>
  );
};

/**
 * Ícone de interrogação com tooltip — o padrão visual pedido para os cards.
 */
export const AjudaIcone: React.FC<{
  conteudo: React.ReactNode;
  largura?: number;
  tamanho?: number;
}> = ({ conteudo, largura, tamanho = 16 }) => (
  <Tooltip conteudo={conteudo} largura={largura}>
    <HelpCircle
      size={tamanho}
      className="text-gray-500 transition-colors hover:text-blue-400"
    />
  </Tooltip>
);

/**
 * Bloco padronizado de memória de cálculo: título, linhas de composição e
 * o resultado destacado no rodapé.
 */
export const MemoriaCalculo: React.FC<{
  titulo: string;
  descricao?: string;
  linhas: Array<{ rotulo: string; valor: string }>;
  resultado?: { rotulo: string; valor: string };
  origem?: string;
}> = ({ titulo, descricao, linhas, resultado, origem }) => (
  <div className="space-y-2">
    <p className="font-semibold text-white">{titulo}</p>

    {descricao && <p className="text-gray-300 leading-snug">{descricao}</p>}

    {linhas.length > 0 && (
      <div className="space-y-1 border-t border-fundo-borda border-gray-700 pt-2">
        {linhas.map((linha, i) => (
          <div key={i} className="flex justify-between gap-3 text-gray-300">
            <span>{linha.rotulo}</span>
            <span className="font-mono whitespace-nowrap">{linha.valor}</span>
          </div>
        ))}
      </div>
    )}

    {resultado && (
      <div className="flex justify-between gap-3 border-t border-fundo-borda border-gray-700 pt-2 font-semibold text-white">
        <span>{resultado.rotulo}</span>
        <span className="font-mono whitespace-nowrap">{resultado.valor}</span>
      </div>
    )}

    {origem && (
      <p className="border-t border-fundo-borda border-gray-700 pt-2 text-xs text-gray-500 leading-snug">
        {origem}
      </p>
    )}
  </div>
);
