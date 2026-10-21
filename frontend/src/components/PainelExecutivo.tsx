import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ResponsiveContainer, Area, AreaChart } from 'recharts';
import {
  AlertTriangle, TrendingUp, TrendingDown, Loader2, Store, CornerUpLeft,
} from 'lucide-react';
import { AjudaIcone, MemoriaCalculo } from './Tooltip';
import { API_URL } from '../utils/api';
import { type ParametrosFiltro } from './FiltrosAnalise';
import {
  formatarMoeda, formatarMoedaCompacta, formatarInteiro, formatarPercentual, formatarCNPJ,
} from '../utils/format';


interface Documento {
  id: string;
  modelo: number;
  tipo: string;
  chaveNFe: string;
  dataEmissao: string;
  cnpjEmitente: string;
  nomeEmitente: string;
  regimeTributario: string;
  values: {
    baseCalculo: number;
    icms: number;
    icmsST: number;
    ipi: number;
    iss: number;
    pis: number;
    cofins: number;
    irrf: number;
    total: number;
    /** Parcela dos valores acima retida pelo tomador */
    retido?: {
      iss: number;
      pis: number;
      cofins: number;
      irrf: number;
    };
  };
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Rótulo curto de mês/ano a partir da data de emissão: "mar/24" */
function chaveMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

const Chip: React.FC<{
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ ativo, onClick, children }) => (
  <button
    onClick={onClick}
    className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
      ativo
        ? 'bg-marca-azul text-white shadow-neon'
        : 'bg-fundo-eleva text-tinta-fraca ring-1 ring-fundo-borda hover:text-tinta-media'
    }`}
  >
    {children}
  </button>
);

/** Cartão de KPI com variação e sparkline, no formato da referência */
const CartaoKPI: React.FC<{
  rotulo: string;
  valor: string;
  variacao?: number | null;
  serie?: Array<{ v: number }>;
  memoria?: React.ReactNode;
  destaque?: boolean;
}> = ({ rotulo, valor, variacao, serie, memoria, destaque }) => (
  <div
    className={`rounded-lg border border-fundo-borda bg-fundo-card p-4 ${
      destaque ? 'lg:col-span-2' : ''
    }`}
  >
    <div className="mb-1 flex items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-tinta-forte">
        {rotulo}
      </span>
      {memoria && <AjudaIcone tamanho={12} largura={320} conteudo={memoria} />}
    </div>

    <p className={`font-bold text-tinta-forte ${destaque ? 'text-3xl' : 'text-xl'}`}>{valor}</p>

    <div className="mt-2 flex items-end justify-between gap-3">
      {variacao !== undefined && variacao !== null ? (
        <span
          className={`flex items-center gap-1 text-[11px] font-medium ${
            variacao >= 0 ? 'text-emerald-700' : 'text-red-600'
          }`}
        >
          {variacao >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {formatarPercentual(Math.abs(variacao), 1)}
          <span className="text-tinta-suave">vs. período anterior</span>
        </span>
      ) : (
        <span />
      )}

      {serie && serie.length > 1 && (
        <div className="h-8 w-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serie}>
              <Area
                type="monotone"
                dataKey="v"
                stroke="#7F2BF5"
                strokeWidth={1.5}
                fill="rgba(79,140,255,0.15)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  </div>
);

/** Alerta gerado a partir dos dados, no estilo dos avisos da referência */
const Alerta: React.FC<{ titulo: string; detalhe: string; cor: 'vermelho' | 'ambar' }> = ({
  titulo,
  detalhe,
  cor,
}) => (
  <div
    className={`flex gap-2 rounded-lg border-l-2 bg-fundo-card p-3 ${
      cor === 'vermelho' ? 'border-l-red-500' : 'border-l-amber-500'
    }`}
    style={{ borderRadius: 0 }}
  >
    <AlertTriangle
      size={13}
      className={`mt-0.5 shrink-0 ${cor === 'vermelho' ? 'text-red-600' : 'text-amber-600'}`}
    />
    <div className="min-w-0">
      <p className="text-xs font-semibold leading-snug text-tinta-forte">{titulo}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-tinta-fraca">{detalhe}</p>
    </div>
  </div>
);


/**
 * Barras de participação de um grupo de tributos.
 *
 * O percentual é sempre sobre o total geral, e não sobre o subtotal do
 * grupo: senão as duas listas somariam cem por cento cada uma e a
 * comparação entre elas ficaria impossível.
 */
const BarrasDeTributo: React.FC<{
  lista: Array<{ nome: string; valor: number }>;
  maior: number;
  total: number;
  titulo: string;
  subtotal: number;
  icone: React.ReactNode;
  /** Grupo secundário usa tom mais claro, para distinguir também em impressão */
  secundaria?: boolean;
  className?: string;
}> = ({ lista, maior, total, titulo, subtotal, icone, secundaria, className = '' }) => (
  <div className={className}>
    <div className="mb-2 flex items-center gap-2">
      <span className="text-tinta-suave">{icone}</span>
      <span className="text-xs font-semibold text-tinta-forte">{titulo}</span>
      <span className="text-[11px] text-tinta-suave">
        {formatarMoeda(subtotal)} · {formatarPercentual(total > 0 ? (subtotal / total) * 100 : 0, 0)}
      </span>
    </div>

    <div className="space-y-2">
      {lista.map(t => (
        <div key={t.nome} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-[11px] font-medium text-rotulo">{t.nome}</span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-fundo-eleva">
            <div
              className={`flex h-5 items-center justify-end rounded px-2 ${
                secundaria ? 'bg-marca-ciano' : 'bg-marca-azul'
              }`}
              style={{ width: `${Math.max(6, (t.valor / maior) * 100)}%` }}
            >
              <span className="text-[10px] font-semibold text-white">
                {formatarPercentual(total > 0 ? (t.valor / total) * 100 : 0, 1)}
              </span>
            </div>
          </div>
          <span className="w-24 shrink-0 text-right font-mono text-[11px] text-tinta-media">
            {formatarMoedaCompacta(t.valor)}
          </span>
        </div>
      ))}
    </div>
  </div>
);

/**
 * Todo painel aceita uma memória de cálculo. A regra adotada no sistema é
 * simples: se o número exibido é resultado de uma conta, o usuário precisa
 * conseguir ver a conta sem sair da tela.
 */
const Painel: React.FC<{
  titulo: string;
  subtitulo?: string;
  memoria?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ titulo, subtitulo, memoria, children, className = '' }) => (
  <div className={`rounded-lg border border-fundo-borda bg-fundo-card p-4 ${className}`}>
    <div className="mb-3 flex items-baseline gap-2">
      <h3 className="text-sm font-semibold text-tinta-forte">{titulo}</h3>
      {memoria && (
        <span className="translate-y-0.5">
          <AjudaIcone largura={330} tamanho={14} conteudo={memoria} />
        </span>
      )}
      {subtitulo && <span className="text-[11px] text-tinta-suave">{subtitulo}</span>}
    </div>
    {children}
  </div>
);

export const PainelExecutivo: React.FC<{
  sessionId: string;
  token: string;
  /** Filtros da análise (Entrada/Saída, CFOP e NCM), aplicados no servidor */
  filtros: ParametrosFiltro;
}> = ({ sessionId, token, filtros }) => {
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [regimeFiltro, setRegimeFiltro] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    const cabecalhos = {
      headers: { 'x-session-id': sessionId, Authorization: `Bearer ${token}` },
    };

    // Recorte novo: um regime escolhido antes pode nem existir nele, e
    // continuaria filtrando sem chip visível.
    setRegimeFiltro([]);

    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        // Traz os documentos do recorte em páginas e calcula tudo localmente:
        // assim o filtro de regime responde sem ida ao servidor a cada clique.
        const todos: Documento[] = [];
        let pagina = 1;

        while (pagina <= 10) {
          const r = await axios.get(`${API_URL}/api/v1/dashboard/documentos`, {
            ...cabecalhos,
            params: { ...filtros, pagina, porPagina: 500 },
          });
          todos.push(...r.data.data.documentos);
          if (todos.length >= r.data.data.total) break;
          pagina += 1;
        }
        if (ativo) setDocumentos(todos);
      } catch {
        if (ativo) {
          setDocumentos([]);
          setErro('Não foi possível carregar o painel. Use "Atualizar dashboard" para tentar de novo.');
        }
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [sessionId, token, filtros]);

  const regimes = useMemo(
    () => Array.from(new Set(documentos.map(d => d.regimeTributario))).sort(),
    [documentos]
  );

  const filtrados = useMemo(
    () =>
      documentos.filter(
        d => !regimeFiltro.length || regimeFiltro.includes(d.regimeTributario)
      ),
    [documentos, regimeFiltro]
  );

  const alternar = (lista: string[], set: (v: string[]) => void, valor: string) =>
    set(lista.includes(valor) ? lista.filter(x => x !== valor) : [...lista, valor]);

  // ==================== AGREGAÇÕES ====================
  const dados = useMemo(() => {
    const soma = (f: (d: Documento) => number) => filtrados.reduce((s, d) => s + (f(d) || 0), 0);

    const valor = soma(d => d.values.total);
    const base = soma(d => d.values.baseCalculo || d.values.total);
    const tributos = soma(
      d =>
        d.values.icms + d.values.icmsST + d.values.ipi + d.values.iss + d.values.pis +
        d.values.cofins + d.values.irrf
    );

    // Série mensal, ordenada cronologicamente
    const porMes = new Map<string, { ordem: number; valor: number; tributos: number; qtd: number }>();
    for (const d of filtrados) {
      const data = new Date(d.dataEmissao);
      if (Number.isNaN(data.getTime())) continue;

      const chave = chaveMes(d.dataEmissao);
      const atual = porMes.get(chave) || {
        ordem: data.getFullYear() * 12 + data.getMonth(),
        valor: 0,
        tributos: 0,
        qtd: 0,
      };
      atual.valor += d.values.total;
      atual.tributos +=
        d.values.icms + d.values.icmsST + d.values.ipi + d.values.iss + d.values.pis +
        d.values.cofins + d.values.irrf;
      atual.qtd += 1;
      porMes.set(chave, atual);
    }

    const serieMensal = Array.from(porMes.entries())
      .map(([mes, v]) => ({ mes, ...v }))
      .sort((a, b) => a.ordem - b.ordem);

    // Variação: metade final do período contra a metade inicial
    const metade = Math.floor(serieMensal.length / 2);
    const somaFatia = (ini: number, fim: number, campo: 'valor' | 'tributos') =>
      serieMensal.slice(ini, fim).reduce((s, m) => s + m[campo], 0);

    const variacao = (campo: 'valor' | 'tributos') => {
      if (serieMensal.length < 2) return null;
      const anterior = somaFatia(0, metade, campo);
      const recente = somaFatia(metade, serieMensal.length, campo);
      if (anterior === 0) return null;
      return ((recente - anterior) / anterior) * 100;
    };

    // Fornecedores
    const porFornecedor = new Map<
      string,
      { nome: string; cnpj: string; valor: number; tributos: number; qtd: number }
    >();
    for (const d of filtrados) {
      const atual = porFornecedor.get(d.cnpjEmitente) || {
        nome: d.nomeEmitente,
        cnpj: d.cnpjEmitente,
        valor: 0,
        tributos: 0,
        qtd: 0,
      };
      atual.valor += d.values.total;
      atual.tributos +=
        d.values.icms + d.values.icmsST + d.values.ipi + d.values.iss + d.values.pis + d.values.cofins;
      atual.qtd += 1;
      porFornecedor.set(d.cnpjEmitente, atual);
    }

    const fornecedores = Array.from(porFornecedor.values()).sort((a, b) => b.valor - a.valor);

    // Tributos, para as barras horizontais.
    //
    // A lista é separada por quem recolhe: o que o emitente ou prestador
    // apura vai de um lado, o que o tomador retém na fonte vai do outro.
    // Somar os dois numa lista só sugere que o dinheiro todo é do mesmo
    // contribuinte, o que não é verdade em nota de serviço.
    const retido = (escolher: (r: { iss: number; pis: number; cofins: number; irrf: number }) => number) =>
      soma(d => (d.values.retido ? escolher(d.values.retido) : 0));

    const totalRetido =
      retido(r => r.iss) + retido(r => r.pis) + retido(r => r.cofins) + retido(r => r.irrf);

    const tributosDoPrestador = [
      { nome: 'ICMS', valor: soma(d => d.values.icms) },
      { nome: 'ICMS-ST', valor: soma(d => d.values.icmsST) },
      { nome: 'IPI', valor: soma(d => d.values.ipi) },
      { nome: 'ISS', valor: soma(d => d.values.iss) - retido(r => r.iss) },
      { nome: 'PIS', valor: soma(d => d.values.pis) - retido(r => r.pis) },
      { nome: 'COFINS', valor: soma(d => d.values.cofins) - retido(r => r.cofins) },
      { nome: 'IRRF', valor: soma(d => d.values.irrf) - retido(r => r.irrf) },
    ]
      .filter(t => t.valor > 0.005)
      .sort((a, b) => b.valor - a.valor);

    const tributosRetidos = [
      { nome: 'ISS', valor: retido(r => r.iss) },
      { nome: 'COFINS', valor: retido(r => r.cofins) },
      { nome: 'PIS', valor: retido(r => r.pis) },
      { nome: 'IRRF', valor: retido(r => r.irrf) },
    ]
      .filter(t => t.valor > 0.005)
      .sort((a, b) => b.valor - a.valor);

    const tributosLista = [...tributosDoPrestador, ...tributosRetidos];

    // Regimes
    const porRegime = new Map<string, { valor: number; qtd: number; cnpjs: Set<string> }>();
    for (const d of filtrados) {
      const atual = porRegime.get(d.regimeTributario) || { valor: 0, qtd: 0, cnpjs: new Set() };
      atual.valor += d.values.total;
      atual.qtd += 1;
      atual.cnpjs.add(d.cnpjEmitente);
      porRegime.set(d.regimeTributario, atual);
    }


    return {
      valor,
      base,
      tributos,
      carga: valor > 0 ? (tributos / valor) * 100 : 0,
      serieMensal,
      variacaoValor: variacao('valor'),
      variacaoTributos: variacao('tributos'),
      fornecedores,
      tributosLista,
      tributosDoPrestador,
      tributosRetidos,
      totalRetido,
      totalDoPrestador: Math.max(tributos - totalRetido, 0),
      regimes: Array.from(porRegime.entries()).map(([regime, v]) => ({
        regime,
        valor: v.valor,
        qtd: v.qtd,
        fornecedores: v.cnpjs.size,
      })),
      periodo:
        serieMensal.length > 0
          ? `${serieMensal[0].mes} a ${serieMensal[serieMensal.length - 1].mes}`
          : '—',
    };
  }, [filtrados]);

  // ==================== ALERTAS AUTOMÁTICOS ====================
  const alertas = useMemo(() => {
    const lista: Array<{ titulo: string; detalhe: string; cor: 'vermelho' | 'ambar' }> = [];

    const simples = dados.regimes.find(r => r.regime.toLowerCase().includes('simples'));
    if (simples && dados.valor > 0) {
      const fatia = (simples.valor / dados.valor) * 100;
      if (fatia > 5) {
        lista.push({
          titulo: `Simples Nacional concentra ${formatarPercentual(fatia, 1)} do valor`,
          detalhe: `${simples.fornecedores} fornecedor(es). Esses valores não transferem crédito integral de IBS/CBS após a reforma.`,
          cor: 'ambar',
        });
      }
    }

    if (dados.variacaoTributos !== null && Math.abs(dados.variacaoTributos) > 15) {
      lista.push({
        titulo: `Tributos ${dados.variacaoTributos > 0 ? 'subiram' : 'caíram'} ${formatarPercentual(Math.abs(dados.variacaoTributos), 1)} no período`,
        detalhe: 'Comparação entre a segunda e a primeira metade dos meses importados.',
        cor: dados.variacaoTributos > 0 ? 'vermelho' : 'ambar',
      });
    }

    const concentrado = dados.fornecedores[0];
    if (concentrado && dados.valor > 0) {
      const fatia = (concentrado.valor / dados.valor) * 100;
      if (fatia > 30) {
        lista.push({
          titulo: `${concentrado.nome} concentra ${formatarPercentual(fatia, 1)} das compras`,
          detalhe: 'Concentração alta em um único fornecedor eleva o risco de dependência.',
          cor: 'ambar',
        });
      }
    }

    return lista.slice(0, 2);
  }, [dados]);

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-tinta-fraca">
        <Loader2 size={18} className="animate-spin" />
        Carregando painel...
      </div>
    );
  }

  if (erro) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{erro}</div>
    );
  }

  if (documentos.length === 0) {
    return (
      <div className="rounded-lg border border-fundo-borda bg-fundo-card py-20 text-center text-tinta-fraca">
        Nenhuma nota com os filtros escolhidos.
      </div>
    );
  }

  const maiorFornecedor = dados.fornecedores[0]?.valor || 1;
  const maiorTributo = dados.tributosLista[0]?.valor || 1;

  return (
    <div className="space-y-3">
      {/* ==================== CABEÇALHO ==================== */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-fundo-borda bg-fundo-card px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-marca-azul text-xs font-bold text-white">
          NF
        </span>
        <div>
          <p className="text-sm font-semibold text-tinta-forte">Painel Fiscal</p>
          <p className="text-[11px] text-tinta-suave">
            NF-e importadas · {dados.periodo}
          </p>
        </div>
      </div>

      {/* ==================== FILTROS ==================== */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-fundo-borda bg-fundo-card px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-tinta-forte">
          Regime
        </span>
        {regimes.map(r => (
          <Chip
            key={r}
            ativo={regimeFiltro.includes(r)}
            onClick={() => alternar(regimeFiltro, setRegimeFiltro, r)}
          >
            {r}
          </Chip>
        ))}

        {regimeFiltro.length > 0 && (
          <button
            onClick={() => setRegimeFiltro([])}
            className="ml-auto text-[11px] font-medium text-red-600 hover:text-red-800"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* ==================== ALERTAS ==================== */}
      {alertas.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {alertas.map((a, i) => (
            <Alerta key={i} {...a} />
          ))}
        </div>
      )}

      {/* ==================== KPIs ==================== */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <CartaoKPI
          rotulo="Valor total"
          valor={formatarMoeda(dados.valor)}
          variacao={dados.variacaoValor}
          serie={dados.serieMensal.map(m => ({ v: m.valor }))}
          destaque
          memoria={
            <MemoriaCalculo
              titulo="Valor total"
              descricao="Soma do valor das notas após os filtros aplicados."
              linhas={[
                { rotulo: 'Notas', valor: formatarInteiro(filtrados.length) },
                {
                  rotulo: 'Média por nota',
                  valor: formatarMoeda(filtrados.length ? dados.valor / filtrados.length : 0),
                },
              ]}
              resultado={{ rotulo: 'Total', valor: formatarMoeda(dados.valor) }}
            />
          }
        />
        <CartaoKPI
          rotulo="Tributos"
          valor={formatarMoeda(dados.tributos)}
          variacao={dados.variacaoTributos}
          serie={dados.serieMensal.map(m => ({ v: m.tributos }))}
        />
        <CartaoKPI rotulo="Carga tributária" valor={formatarPercentual(dados.carga, 1)} />
      </div>

      {/* ==================== BARRAS ==================== */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Painel
          titulo="Participação por tributo"
          subtitulo="sobre o total destacado"
          memoria={
            <MemoriaCalculo
              titulo="Participação por tributo"
              descricao="Quanto cada tributo representa dentro da carga total destacada nas notas filtradas."
              linhas={[
                { rotulo: 'Fórmula', valor: 'tributo ÷ total destacado' },
                { rotulo: 'Total destacado', valor: formatarMoeda(dados.tributos) },
              ]}
              origem="Separado por quem recolhe: o prestador apura o seu; o retido é antecipação do tomador."
            />
          }
        >
          <BarrasDeTributo
            lista={dados.tributosDoPrestador}
            maior={maiorTributo}
            total={dados.tributos}
            titulo="Recolhido pelo prestador"
            subtotal={dados.totalDoPrestador}
            icone={<Store size={14} />}
          />

          {dados.tributosRetidos.length > 0 && (
            <>
              <BarrasDeTributo
                lista={dados.tributosRetidos}
                maior={maiorTributo}
                total={dados.tributos}
                titulo="Retido pelo tomador"
                subtotal={dados.totalRetido}
                icone={<CornerUpLeft size={14} />}
                secundaria
                className="mt-4 border-t border-fundo-borda pt-3"
              />

              <p className="mt-3 border-t border-fundo-borda pt-3 text-[11px] leading-snug text-tinta-suave">
                O que o prestador recolhe entra na apuração dele. O retido é
                antecipação recolhida pelo tomador.
              </p>
            </>
          )}
        </Painel>

        <Painel
          titulo="Fornecedores por valor"
          subtitulo="10 maiores no período"
          memoria={
            <MemoriaCalculo
              titulo="Fornecedores por valor"
              descricao="Notas agrupadas por CNPJ do emitente e ordenadas pelo valor somado."
              linhas={[
                { rotulo: 'Chave do agrupamento', valor: 'CNPJ do emitente' },
                { rotulo: 'Ordenação', valor: 'maior valor primeiro' },
              ]}
              origem="Mostra apenas os dez primeiros; os demais entram no total geral."
            />
          }
        >
          <div className="space-y-2">
            {dados.fornecedores.slice(0, 10).map(f => (
              <div key={f.cnpj} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate text-[11px] font-medium text-rotulo" title={f.nome}>
                  {f.nome}
                </span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-fundo-eleva">
                  <div
                    className="h-5 rounded bg-marca-azul/70"
                    style={{ width: `${Math.max(4, (f.valor / maiorFornecedor) * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right font-mono text-[11px] text-tinta-media">
                  {formatarMoedaCompacta(f.valor)}
                </span>
              </div>
            ))}
          </div>
        </Painel>
      </div>

      {/* ==================== TABELAS ==================== */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Painel
          titulo="Composição por regime"
          subtitulo="fornecedores, notas e valor"
          memoria={
            <MemoriaCalculo
              titulo="Composição por regime"
              descricao="O regime é inferido a partir dos tributos destacados na nota, e não de cadastro externo."
              linhas={[
                { rotulo: 'Fornecedores', valor: 'CNPJs distintos no regime' },
                { rotulo: 'Notas', valor: 'documentos importados' },
                { rotulo: 'Valor', valor: 'soma de vNF' },
              ]}
              origem="Fornecedor que emite em mais de um regime aparece em cada um deles."
            />
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-tinta-forte">
                  <th className="pb-2 font-medium">REGIME</th>
                  <th className="pb-2 text-right font-medium">FORNECEDORES</th>
                  <th className="pb-2 text-right font-medium">NOTAS</th>
                  <th className="pb-2 text-right font-medium">VALOR</th>
                  <th className="pb-2 text-right font-medium">FATIA</th>
                </tr>
              </thead>
              <tbody>
                {dados.regimes
                  .sort((a, b) => b.valor - a.valor)
                  .map(r => (
                    <tr key={r.regime} className="border-t border-fundo-borda">
                      <td className="py-2 font-medium text-tinta-media">{r.regime}</td>
                      <td className="py-2 text-right text-marca-neon">
                        {formatarInteiro(r.fornecedores)}
                      </td>
                      <td className="py-2 text-right text-tinta-fraca">{formatarInteiro(r.qtd)}</td>
                      <td className="py-2 text-right font-mono text-tinta-media">
                        {formatarMoedaCompacta(r.valor)}
                      </td>
                      <td className="py-2 text-right text-tinta-fraca">
                        {formatarPercentual(dados.valor > 0 ? (r.valor / dados.valor) * 100 : 0, 1)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Painel>
      </div>

      {/* ==================== RODAPÉ ==================== */}
      <p className="px-1 pb-2 text-[10px] text-gray-600">
        {formatarInteiro(filtrados.length)} de {formatarInteiro(documentos.length)} notas fiscais
        consideradas · Base de cálculo {formatarMoeda(dados.base)} · Fonte: XMLs importados nesta
        sessão
      </p>
    </div>
  );
};
