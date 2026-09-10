import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Area, AreaChart,
} from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { AjudaIcone, MemoriaCalculo } from './Tooltip';
import { API_URL } from '../utils/api';
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
  };
  divergencias: any[];
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Rótulo curto de mês/ano a partir da data de emissão: "mar/24" */
function chaveMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

/** Cor da célula do heatmap conforme a intensidade da variação */
function corHeatmap(valor: number, maximo: number): string {
  if (maximo === 0 || !Number.isFinite(valor)) return 'rgba(255,255,255,0.03)';
  const intensidade = Math.min(1, Math.abs(valor) / maximo);
  return valor >= 0
    ? `rgba(47, 111, 255, ${0.12 + intensidade * 0.65})`
    : `rgba(236, 72, 153, ${0.12 + intensidade * 0.6})`;
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
        : 'bg-fundo-eleva text-gray-400 ring-1 ring-fundo-borda hover:text-gray-200'
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
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {rotulo}
      </span>
      {memoria && <AjudaIcone tamanho={12} largura={320} conteudo={memoria} />}
    </div>

    <p className={`font-bold text-white ${destaque ? 'text-3xl' : 'text-xl'}`}>{valor}</p>

    <div className="mt-2 flex items-end justify-between gap-3">
      {variacao !== undefined && variacao !== null ? (
        <span
          className={`flex items-center gap-1 text-[11px] font-medium ${
            variacao >= 0 ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {variacao >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {formatarPercentual(Math.abs(variacao), 1)}
          <span className="text-gray-500">vs. período anterior</span>
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
                stroke="#4f8cff"
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
      className={`mt-0.5 shrink-0 ${cor === 'vermelho' ? 'text-red-400' : 'text-amber-400'}`}
    />
    <div className="min-w-0">
      <p className="text-xs font-semibold leading-snug text-gray-100">{titulo}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{detalhe}</p>
    </div>
  </div>
);

const Painel: React.FC<{
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ titulo, subtitulo, children, className = '' }) => (
  <div className={`rounded-lg border border-fundo-borda bg-fundo-card p-4 ${className}`}>
    <div className="mb-3 flex items-baseline gap-2">
      <h3 className="text-sm font-semibold text-gray-100">{titulo}</h3>
      {subtitulo && <span className="text-[11px] text-gray-500">{subtitulo}</span>}
    </div>
    {children}
  </div>
);

export const PainelExecutivo: React.FC<{ sessionId: string; token: string }> = ({
  sessionId,
  token,
}) => {
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [transicao, setTransicao] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [regimeFiltro, setRegimeFiltro] = useState<string[]>([]);
  const [tipoFiltro, setTipoFiltro] = useState<string[]>([]);

  useEffect(() => {
    const cabecalhos = {
      headers: { 'x-session-id': sessionId, Authorization: `Bearer ${token}` },
    };

    (async () => {
      setCarregando(true);
      try {
        // Traz os documentos em páginas e calcula tudo localmente: assim os
        // filtros respondem sem ida ao servidor a cada clique.
        const todos: Documento[] = [];
        let pagina = 1;

        while (pagina <= 10) {
          const r = await axios.get(`${API_URL}/api/v1/dashboard/documentos`, {
            ...cabecalhos,
            params: { pagina, porPagina: 500 },
          });
          todos.push(...r.data.data.documentos);
          if (todos.length >= r.data.data.total) break;
          pagina += 1;
        }
        setDocumentos(todos);

        const s = await axios.get(`${API_URL}/api/v1/reforma/serie`, cabecalhos);
        setTransicao(s.data.data.serie.filter((x: any) => x.ano >= 2027));
      } catch {
        setDocumentos([]);
      } finally {
        setCarregando(false);
      }
    })();
  }, [sessionId, token]);

  const regimes = useMemo(
    () => Array.from(new Set(documentos.map(d => d.regimeTributario))).sort(),
    [documentos]
  );

  const filtrados = useMemo(
    () =>
      documentos.filter(d => {
        if (regimeFiltro.length && !regimeFiltro.includes(d.regimeTributario)) return false;
        if (tipoFiltro.length && !tipoFiltro.includes(String(d.tipo).toLowerCase())) return false;
        return true;
      }),
    [documentos, regimeFiltro, tipoFiltro]
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
    const porFornecedor = new Map<string, { nome: string; cnpj: string; valor: number; tributos: number; qtd: number; divergencias: number }>();
    for (const d of filtrados) {
      const atual = porFornecedor.get(d.cnpjEmitente) || {
        nome: d.nomeEmitente,
        cnpj: d.cnpjEmitente,
        valor: 0,
        tributos: 0,
        qtd: 0,
        divergencias: 0,
      };
      atual.valor += d.values.total;
      atual.tributos +=
        d.values.icms + d.values.icmsST + d.values.ipi + d.values.iss + d.values.pis + d.values.cofins;
      atual.qtd += 1;
      atual.divergencias += d.divergencias?.length || 0;
      porFornecedor.set(d.cnpjEmitente, atual);
    }

    const fornecedores = Array.from(porFornecedor.values()).sort((a, b) => b.valor - a.valor);

    // Tributos, para as barras horizontais
    const tributosLista = [
      { nome: 'ICMS', valor: soma(d => d.values.icms) },
      { nome: 'COFINS', valor: soma(d => d.values.cofins) },
      { nome: 'PIS', valor: soma(d => d.values.pis) },
      { nome: 'ICMS-ST', valor: soma(d => d.values.icmsST) },
      { nome: 'IPI', valor: soma(d => d.values.ipi) },
      { nome: 'ISS', valor: soma(d => d.values.iss) },
      { nome: 'IRRF', valor: soma(d => d.values.irrf) },
    ]
      .filter(t => t.valor > 0)
      .sort((a, b) => b.valor - a.valor);

    // Regimes
    const porRegime = new Map<string, { valor: number; qtd: number; cnpjs: Set<string> }>();
    for (const d of filtrados) {
      const atual = porRegime.get(d.regimeTributario) || { valor: 0, qtd: 0, cnpjs: new Set() };
      atual.valor += d.values.total;
      atual.qtd += 1;
      atual.cnpjs.add(d.cnpjEmitente);
      porRegime.set(d.regimeTributario, atual);
    }

    const comDivergencia = filtrados.filter(d => (d.divergencias?.length || 0) > 0).length;

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
      regimes: Array.from(porRegime.entries()).map(([regime, v]) => ({
        regime,
        valor: v.valor,
        qtd: v.qtd,
        fornecedores: v.cnpjs.size,
      })),
      comDivergencia,
      conformidade:
        filtrados.length > 0 ? ((filtrados.length - comDivergencia) / filtrados.length) * 100 : 0,
      periodo:
        serieMensal.length > 0
          ? `${serieMensal[0].mes} a ${serieMensal[serieMensal.length - 1].mes}`
          : '—',
    };
  }, [filtrados]);

  // ==================== ALERTAS AUTOMÁTICOS ====================
  const alertas = useMemo(() => {
    const lista: Array<{ titulo: string; detalhe: string; cor: 'vermelho' | 'ambar' }> = [];

    if (dados.comDivergencia > 0) {
      lista.push({
        titulo: `${formatarInteiro(dados.comDivergencia)} notas com divergência tributária`,
        detalhe: `${formatarPercentual(100 - dados.conformidade, 1)} do total analisado. Revise antes de concluir: benefício fiscal e ST geram divergência legítima.`,
        cor: 'vermelho',
      });
    }

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

  // Heatmap: variação percentual de cada tributo ao longo da transição
  const heatmap = useMemo(() => {
    if (transicao.length === 0) return { linhas: [], anos: [], maximo: 0 };

    const campos = [
      { chave: 'icms', nome: 'ICMS' },
      { chave: 'iss', nome: 'ISS' },
      { chave: 'pis', nome: 'PIS' },
      { chave: 'cofins', nome: 'COFINS' },
      { chave: 'ibs', nome: 'IBS' },
      { chave: 'cbs', nome: 'CBS' },
    ];

    const anos = transicao.map(t => t.ano);
    let maximo = 0;

    const linhas = campos.map(c => {
      const valores = transicao.map(t => {
        const base = transicao[0][c.chave] || 0;
        const atual = t[c.chave] || 0;
        const variacao = base === 0 ? (atual > 0 ? 100 : 0) : ((atual - base) / base) * 100;
        maximo = Math.max(maximo, Math.abs(variacao));
        return { ano: t.ano, valor: atual, variacao };
      });
      return { nome: c.nome, valores };
    });

    return { linhas, anos, maximo };
  }, [transicao]);

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-gray-400">
        <Loader2 size={18} className="animate-spin" />
        Carregando painel...
      </div>
    );
  }

  if (documentos.length === 0) {
    return (
      <div className="rounded-lg border border-fundo-borda bg-fundo-card py-20 text-center text-gray-400">
        Importe um arquivo ZIP com XMLs para ver o painel.
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
          <p className="text-sm font-semibold text-white">Painel Fiscal</p>
          <p className="text-[11px] text-gray-500">
            NF-e importadas · {dados.periodo}
          </p>
        </div>
      </div>

      {/* ==================== FILTROS ==================== */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-fundo-borda bg-fundo-card px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
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

        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Tipo
        </span>
        {['entrada', 'saida'].map(t => (
          <Chip
            key={t}
            ativo={tipoFiltro.includes(t)}
            onClick={() => alternar(tipoFiltro, setTipoFiltro, t)}
          >
            {t === 'entrada' ? 'Entrada' : 'Saída'}
          </Chip>
        ))}

        {(regimeFiltro.length > 0 || tipoFiltro.length > 0) && (
          <button
            onClick={() => {
              setRegimeFiltro([]);
              setTipoFiltro([]);
            }}
            className="ml-auto text-[11px] font-medium text-red-400 hover:text-red-300"
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
        <CartaoKPI
          rotulo="Conformidade"
          valor={formatarPercentual(dados.conformidade, 1)}
          memoria={
            <MemoriaCalculo
              titulo="Conformidade"
              descricao="Notas sem nenhuma divergência apontada, sobre o total filtrado."
              linhas={[
                {
                  rotulo: 'Conformes',
                  valor: formatarInteiro(filtrados.length - dados.comDivergencia),
                },
                { rotulo: 'Com divergência', valor: formatarInteiro(dados.comDivergencia) },
              ]}
            />
          }
        />
      </div>

      {/* ==================== EVOLUÇÃO MENSAL ==================== */}
      <Painel titulo="Evolução mensal" subtitulo="valor das notas e tributos destacados">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={dados.serieMensal} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2a3a" />
            <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} tickLine={false} />
            <YAxis
              tickFormatter={formatarMoedaCompacta}
              stroke="#9ca3af"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: '1px solid #2a2a3a',
                backgroundColor: '#13131c',
                color: '#e5e7eb',
                fontSize: 12,
              }}
              formatter={(v: any, n: any) => [formatarMoeda(v), n === 'valor' ? 'Valor' : 'Tributos']}
            />
            <Line type="monotone" dataKey="valor" stroke="#4f8cff" strokeWidth={2} dot={false} name="valor" />
            <Line type="monotone" dataKey="tributos" stroke="#22d3ee" strokeWidth={1.5} dot={false} name="tributos" />
          </LineChart>
        </ResponsiveContainer>
      </Painel>

      {/* ==================== HEATMAP DA TRANSIÇÃO ==================== */}
      {heatmap.linhas.length > 0 && (
        <Painel
          titulo="Variação por tributo e ano"
          subtitulo="% contra o primeiro ano da transição"
        >
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-[2px] text-[11px]">
              <thead>
                <tr>
                  <th className="w-24 text-left font-medium text-gray-500" />
                  {heatmap.anos.map(a => (
                    <th key={a} className="pb-1 text-center font-medium text-gray-500">
                      {a}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.linhas.map(linha => (
                  <tr key={linha.nome}>
                    <td className="pr-2 text-left font-medium text-gray-300">{linha.nome}</td>
                    {linha.valores.map(c => (
                      <td
                        key={c.ano}
                        className="rounded px-1 py-1.5 text-center font-medium text-white"
                        style={{ backgroundColor: corHeatmap(c.variacao, heatmap.maximo) }}
                        title={`${linha.nome} em ${c.ano}: ${formatarMoeda(c.valor)}`}
                      >
                        {c.variacao > 0 ? '+' : ''}
                        {c.variacao.toFixed(0)}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-gray-500">
            Azul indica avanço do tributo; rosa indica recuo. Passe o mouse para ver o valor.
          </p>
        </Painel>
      )}

      {/* ==================== BARRAS ==================== */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Painel titulo="Participação por tributo" subtitulo="sobre o total destacado">
          <div className="space-y-2">
            {dados.tributosLista.map(t => (
              <div key={t.nome} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-[11px] text-gray-400">{t.nome}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-white/5">
                  <div
                    className="flex h-5 items-center justify-end rounded bg-gradient-to-r from-marca-azul to-marca-ciano px-2"
                    style={{ width: `${Math.max(6, (t.valor / maiorTributo) * 100)}%` }}
                  >
                    <span className="text-[10px] font-semibold text-white">
                      {formatarPercentual(
                        dados.tributos > 0 ? (t.valor / dados.tributos) * 100 : 0,
                        1
                      )}
                    </span>
                  </div>
                </div>
                <span className="w-24 shrink-0 text-right font-mono text-[11px] text-gray-300">
                  {formatarMoedaCompacta(t.valor)}
                </span>
              </div>
            ))}
          </div>
        </Painel>

        <Painel titulo="Fornecedores por valor" subtitulo="10 maiores no período">
          <div className="space-y-2">
            {dados.fornecedores.slice(0, 10).map(f => (
              <div key={f.cnpj} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate text-[11px] text-gray-400" title={f.nome}>
                  {f.nome}
                </span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-white/5">
                  <div
                    className="h-5 rounded bg-marca-azul/70"
                    style={{ width: `${Math.max(4, (f.valor / maiorFornecedor) * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right font-mono text-[11px] text-gray-300">
                  {formatarMoedaCompacta(f.valor)}
                </span>
              </div>
            ))}
          </div>
        </Painel>
      </div>

      {/* ==================== TABELAS ==================== */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Painel titulo="Fornecedores com divergência" subtitulo="ordenados por ocorrências">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pb-2 font-medium">FORNECEDOR</th>
                  <th className="pb-2 font-medium">CNPJ</th>
                  <th className="pb-2 text-right font-medium">NOTAS</th>
                  <th className="pb-2 text-right font-medium">OCORRÊNCIAS</th>
                  <th className="pb-2 text-right font-medium">VALOR</th>
                </tr>
              </thead>
              <tbody>
                {dados.fornecedores
                  .filter(f => f.divergencias > 0)
                  .sort((a, b) => b.divergencias - a.divergencias)
                  .slice(0, 6)
                  .map(f => (
                    <tr key={f.cnpj} className="border-t border-fundo-borda">
                      <td className="max-w-[150px] truncate py-2 text-gray-200">{f.nome}</td>
                      <td className="py-2 font-mono text-gray-500">{formatarCNPJ(f.cnpj)}</td>
                      <td className="py-2 text-right text-gray-400">{formatarInteiro(f.qtd)}</td>
                      <td className="py-2 text-right">
                        <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-semibold text-red-300">
                          {formatarInteiro(f.divergencias)}
                        </span>
                      </td>
                      <td className="py-2 text-right font-mono text-gray-300">
                        {formatarMoedaCompacta(f.valor)}
                      </td>
                    </tr>
                  ))}
                {dados.fornecedores.filter(f => f.divergencias > 0).length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-500">
                      Nenhuma divergência nos filtros atuais.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Painel>

        <Painel titulo="Composição por regime" subtitulo="fornecedores, notas e valor">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-gray-500">
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
                      <td className="py-2 font-medium text-gray-200">{r.regime}</td>
                      <td className="py-2 text-right text-marca-neon">
                        {formatarInteiro(r.fornecedores)}
                      </td>
                      <td className="py-2 text-right text-gray-400">{formatarInteiro(r.qtd)}</td>
                      <td className="py-2 text-right font-mono text-gray-300">
                        {formatarMoedaCompacta(r.valor)}
                      </td>
                      <td className="py-2 text-right text-gray-400">
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
