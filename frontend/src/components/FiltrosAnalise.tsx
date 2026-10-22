import React from 'react';
import { SlidersHorizontal, ChevronUp, ChevronDown, Download, Loader2, X } from 'lucide-react';
import { formatarCNPJ } from '../utils/format';

/**
 * Filtros da análise: Entrada/Saída, CFOP e NCM.
 *
 * Um cartão só, acima das abas, que vale para indicadores, Painel (com o
 * bloco Resumo) e Regimes. O estado vive em quem usa o cartão; aqui só se
 * desenha e se avisa a troca.
 */

export type SentidoFiltro = 'entrada' | 'saida' | 'indefinido' | 'todas';

export interface EstadoFiltros {
  /** CNPJ da empresa cujas análises salvas formam o conjunto; '' = lote atual */
  empresa: string;
  sentido: SentidoFiltro;
  /** '' = todos os CFOPs */
  cfop: string;
  /** '' = todos os NCMs */
  ncm: string;
}

export interface OpcaoCodigo {
  codigo: string;
  quantidade: number;
}

export interface OpcoesFiltros {
  cfops: OpcaoCodigo[];
  ncms: OpcaoCodigo[];
  temEmpresa: boolean;
  sentidoPadrao: SentidoFiltro;
  totalDocumentos: number;
  /** Empresas com análise salva, para a lista EMPRESA */
  empresas?: EmpresaDoFiltro[];
  /** Empresa da resposta (null = lote atual) */
  empresa?: string | null;
  /** Ex.: "Nenhuma análise salva desta empresa" */
  aviso?: string;
  /** Por que a lista de empresas veio vazia (armazenamento fora) */
  avisoEmpresas?: string;
}

export interface EmpresaDoFiltro {
  cnpj: string;
  nome: string | null;
  quantidade: number;
}

/** Query string enviada às rotas: só os filtros ativos. */
export type ParametrosFiltro = Partial<Record<'empresa' | 'sentido' | 'cfop' | 'ncm', string>>;

export function paraParametros(filtros: EstadoFiltros): ParametrosFiltro {
  const params: ParametrosFiltro = {};
  if (filtros.empresa) params.empresa = filtros.empresa;
  if (filtros.sentido !== 'todas') params.sentido = filtros.sentido;
  if (filtros.cfop) params.cfop = filtros.cfop;
  if (filtros.ncm) params.ncm = filtros.ncm;
  return params;
}

/** `exigeEmpresa`: sem empresa analisada o recorte sai sempre vazio. */
const SENTIDOS: Array<{ valor: SentidoFiltro; rotulo: string; exigeEmpresa?: boolean }> = [
  { valor: 'entrada', rotulo: 'Entradas/Compras', exigeEmpresa: true },
  { valor: 'saida', rotulo: 'Saídas/Vendas', exigeEmpresa: true },
  { valor: 'indefinido', rotulo: 'Sem vínculo' },
  { valor: 'todas', rotulo: 'Todas' },
];

const plural = (n: number) => `${n} nota${n === 1 ? '' : 's'}`;

function rotuloEmpresa(cnpj: string, empresas: EmpresaDoFiltro[]): string {
  if (!cnpj) return 'Lote atual';
  const empresa = empresas.find(e => e.cnpj === cnpj);
  return empresa?.nome ? `${empresa.nome} (${formatarCNPJ(cnpj)})` : formatarCNPJ(cnpj);
}

/** Uma linha com a seleção atual, para o cartão retraído. */
function resumoDaSelecao(filtros: EstadoFiltros, empresas: EmpresaDoFiltro[]): string {
  const sentido = SENTIDOS.find(s => s.valor === filtros.sentido)?.rotulo ?? 'Todas';
  return [
    rotuloEmpresa(filtros.empresa, empresas),
    sentido,
    filtros.cfop ? `CFOP ${filtros.cfop}` : 'Todos os CFOPs',
    filtros.ncm ? `NCM ${filtros.ncm}` : 'Todos os NCMs',
  ].join(' · ');
}

const ListaSuspensa: React.FC<{
  id: string;
  rotulo: string;
  valor: string;
  onChange: (valor: string) => void;
  /** Linha de apoio abaixo da lista */
  ajuda?: string;
  children: React.ReactNode;
}> = ({ id, rotulo, valor, onChange, ajuda, children }) => (
  <div className="min-w-0">
    <label
      htmlFor={id}
      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-tinta-suave"
    >
      {rotulo}
    </label>
    <div className="relative">
      <select
        id={id}
        value={valor}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-fundo-borda bg-fundo-card py-2.5 pl-3 pr-9 text-sm text-tinta-forte transition hover:border-marca-azul focus:border-marca-azul focus:outline-none focus:ring-2 focus:ring-marca-azul/20"
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tinta-suave"
      />
    </div>
    {ajuda && <p className="mt-1 text-[11px] text-tinta-suave">{ajuda}</p>}
  </div>
);

export const FiltrosAnalise: React.FC<{
  filtros: EstadoFiltros;
  opcoes: OpcoesFiltros;
  onChange: (filtros: EstadoFiltros) => void;
  onExportar: () => void;
  exportando?: boolean;
  retraido: boolean;
  onAlternarRetraido: () => void;
}> = ({ filtros, opcoes, onChange, onExportar, exportando, retraido, onAlternarRetraido }) => {
  // Limpar filtros mantém a empresa: ela é a origem das notas, não um recorte.
  const padrao: EstadoFiltros = { empresa: filtros.empresa, sentido: opcoes.sentidoPadrao, cfop: '', ncm: '' };
  const foraDoPadrao =
    filtros.sentido !== padrao.sentido || filtros.cfop !== padrao.cfop || filtros.ncm !== padrao.ncm;
  const empresas = opcoes.empresas ?? [];
  // A empresa escolhida continua na lista mesmo se ela vier vazia (armazenamento fora).
  const listaEmpresas =
    filtros.empresa && !empresas.some(e => e.cnpj === filtros.empresa)
      ? [{ cnpj: filtros.empresa, nome: null, quantidade: 0 }, ...empresas]
      : empresas;
  const origem = filtros.empresa ? 'das análises salvas da empresa' : 'do lote';

  return (
  <div className="rounded-xl border border-fundo-borda bg-fundo-card p-5 shadow-lg shadow-black/5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-marca-azul/10 text-marca-azul">
          <SlidersHorizontal size={18} />
        </span>
        <div>
          <p className="font-semibold text-tinta-forte">Filtros da análise</p>
          <p className="text-xs text-tinta-suave">Empresa, Entrada/Saída, CFOP e NCM {origem}</p>
          {retraido && (
            <p className="mt-0.5 text-xs font-medium text-tinta-media">{resumoDaSelecao(filtros, listaEmpresas)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {foraDoPadrao && (
          <button
            type="button"
            onClick={() => onChange(padrao)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            <X size={15} />
            Limpar filtros
          </button>
        )}
        <button
          type="button"
          onClick={onAlternarRetraido}
          aria-expanded={!retraido}
          className="flex items-center gap-1.5 rounded-lg border border-fundo-borda px-3 py-2 text-sm font-medium text-tinta-media transition hover:border-marca-azul hover:text-marca-azul"
        >
          {retraido ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          {retraido ? 'Expandir' : 'Retrair'}
        </button>
        <button
          type="button"
          onClick={onExportar}
          disabled={exportando}
          className="flex items-center gap-1.5 rounded-lg bg-marca-azul px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {exportando ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          Exportar
        </button>
      </div>
    </div>

    {!retraido && (
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ListaSuspensa
          id="filtro-empresa"
          rotulo="Empresa"
          valor={filtros.empresa}
          // Trocar a origem zera CFOP e NCM: os códigos são de outro conjunto.
          onChange={v => onChange({ empresa: v, sentido: 'todas', cfop: '', ncm: '' })}
          ajuda={
            opcoes.avisoEmpresas
              ? 'Empresas indisponíveis no momento'
              : filtros.empresa
                ? 'Versão mais recente de cada competência'
                : 'Lote aberto nesta sessão'
          }
        >
          <option value="">Lote atual</option>
          {listaEmpresas.map(e => (
            <option key={e.cnpj} value={e.cnpj}>
              {rotuloEmpresa(e.cnpj, listaEmpresas)}
            </option>
          ))}
        </ListaSuspensa>

        <ListaSuspensa
          id="filtro-sentido"
          rotulo="Entrada/Saída"
          valor={filtros.sentido}
          onChange={v => onChange({ ...filtros, sentido: v as SentidoFiltro })}
        >
          {SENTIDOS.map(s => (
            <option key={s.valor} value={s.valor} disabled={s.exigeEmpresa && !opcoes.temEmpresa}>
              {s.rotulo}
            </option>
          ))}
        </ListaSuspensa>

        <ListaSuspensa
          id="filtro-cfop"
          rotulo="CFOP do emitente"
          valor={filtros.cfop}
          onChange={v => onChange({ ...filtros, cfop: v })}
          ajuda={`Código como está no XML · quantidade ${filtros.empresa ? "no conjunto" : "no lote"}`}
        >
          <option value="">Todos os CFOPs</option>
          {opcoes.cfops.map(o => (
            <option key={o.codigo} value={o.codigo}>
              {o.codigo} ({plural(o.quantidade)})
            </option>
          ))}
        </ListaSuspensa>

        <ListaSuspensa
          id="filtro-ncm"
          rotulo="NCM"
          valor={filtros.ncm}
          onChange={v => onChange({ ...filtros, ncm: v })}
          ajuda={filtros.empresa ? "Quantidade no conjunto" : "Quantidade no lote"}
        >
          <option value="">Todos os NCMs</option>
          {opcoes.ncms.map(o => (
            <option key={o.codigo} value={o.codigo}>
              {o.codigo} ({plural(o.quantidade)})
            </option>
          ))}
        </ListaSuspensa>
      </div>
    )}
  </div>
  );
};
