import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { AlertTriangle, ArrowRight, LogIn, LogOut, SlidersHorizontal } from 'lucide-react';
import { AjudaIcone, MemoriaCalculo } from './Tooltip';
import { formatarMoeda, formatarMoedaCompacta, formatarPercentual } from '../utils/format';
import { API_URL } from '../utils/api';

interface Props {
  sessionId: string;
  token: string;
}

const ANOS = [2027, 2028, 2029, 2030, 2031, 2032, 2033];

/** Roxo da marca clareando ao longo da transição: 2027 pálido, 2033 cheio. */
const TOM_DO_ANO = [
  '#E5E3DC', '#DCCBF7', '#CDB2F3', '#BC93EF', '#A96FEB', '#944BF0', '#7F2BF5',
];

const COR_ANTIGOS = '#B4B2A9';
const COR_NOVOS = '#7F2BF5';

/** Tributos que a reforma extingue e os que entram no lugar. */
const TRIBUTOS_QUE_SAEM = ['ICMS', 'ICMS-ST', 'IPI', 'PIS', 'COFINS', 'ISS'];
const TRIBUTOS_QUE_ENTRAM = ['IBS Estadual', 'IBS Municipal', 'CBS', 'Imposto Seletivo'];

export const AbaReforma: React.FC<Props> = ({ sessionId, token }) => {
  const [ano, setAno] = useState(2033);
  const [iva, setIva] = useState(28);
  const [impostoSeletivo, setImpostoSeletivo] = useState(55);
  const [regime, setRegime] = useState('regime-regular');
  const [sujeitoIS, setSujeitoIS] = useState(false);

  const [simulacao, setSimulacao] = useState<any>(null);
  const [serie, setSerie] = useState<any[]>([]);
  const [sensibilidade, setSensibilidade] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const cabecalhos = {
    headers: { 'x-session-id': sessionId, Authorization: `Bearer ${token}` },
  };

  useEffect(() => {
    axios
      .get(`${API_URL}/api/v1/reforma/metadados`)
      .then(r => setMeta(r.data.data))
      .catch(() => undefined);
  }, []);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    const params = {
      ano,
      iva,
      is: impostoSeletivo,
      regime,
      sujeitoIS: String(sujeitoIS),
    };

    try {
      // A sensibilidade roda o mesmo ano com duas alíquotas vizinhas, para
      // responder "e se o IVA vier diferente" sem refazer a simulação.
      const [sim, ser, menor, maior] = await Promise.all([
        axios.get(`${API_URL}/api/v1/reforma/simulacao`, { ...cabecalhos, params }),
        axios.get(`${API_URL}/api/v1/reforma/serie`, { ...cabecalhos, params }),
        axios.get(`${API_URL}/api/v1/reforma/simulacao`, {
          ...cabecalhos,
          params: { ...params, iva: Math.max(0, iva - 2) },
        }),
        axios.get(`${API_URL}/api/v1/reforma/simulacao`, {
          ...cabecalhos,
          params: { ...params, iva: iva + 2 },
        }),
      ]);

      setSimulacao(sim.data.data);
      setSerie(ser.data.data.serie.filter((s: any) => s.ano >= 2027));
      setSensibilidade([
        { iva: Math.max(0, iva - 2), preco: menor.data.data.precoNovo },
        { iva, preco: sim.data.data.precoNovo, atual: true },
        { iva: iva + 2, preco: maior.data.data.precoNovo },
      ]);
    } catch (e: any) {
      setErro(e.response?.data?.error || 'Não foi possível calcular a simulação.');
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, iva, impostoSeletivo, regime, sujeitoIS, sessionId, token]);

  // Debounce: os sliders disparam muitas mudanças seguidas
  useEffect(() => {
    const id = setTimeout(buscar, 300);
    return () => clearTimeout(id);
  }, [buscar]);

  const linhas: any[] = simulacao?.detalhamento ?? [];
  const saem = linhas.filter(l => TRIBUTOS_QUE_SAEM.includes(l.tributo));
  const entram = linhas.filter(l => TRIBUTOS_QUE_ENTRAM.includes(l.tributo));

  /** Carga sobre o preço: o número que vai para a conversa com o cliente. */
  const cargaHoje =
    simulacao && simulacao.precoAtual > 0
      ? (simulacao.totalAtual / simulacao.precoAtual) * 100
      : 0;
  const cargaFutura =
    simulacao && simulacao.precoNovo > 0
      ? (simulacao.totalFuturo / simulacao.precoNovo) * 100
      : 0;

  const dadosGrafico = useMemo(
    () =>
      serie.map(s => ({
        ano: s.ano,
        antigos: s.icms + s.icmsST + s.ipi + s.pis + s.cofins + s.iss,
        novos: s.ibs + s.cbs + s.impostoSeletivo,
      })),
    [serie]
  );

  if (erro) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-sm text-red-700">
        {erro}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ==================== PREMISSAS ==================== */}
      <div className="rounded-lg border border-fundo-borda bg-fundo-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-marca-azul">
            <SlidersHorizontal size={16} />
            Premissas da simulação
          </span>
          <span className="text-xs text-tinta-suave">
            {simulacao
              ? `${simulacao.totalDocumentos} documentos · base de ${formatarMoeda(
                  simulacao.baseCalculo
                )}`
              : 'calculando…'}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-tinta-suave">IVA (IBS + CBS)</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={40}
                step={0.5}
                value={iva}
                onChange={e => setIva(Number(e.target.value))}
                className="flex-1 accent-marca-azul"
              />
              <span className="w-14 text-right text-sm font-semibold text-tinta-forte">
                {formatarPercentual(iva)}
              </span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-tinta-suave">Imposto Seletivo</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={300}
                step={1}
                value={impostoSeletivo}
                onChange={e => setImpostoSeletivo(Number(e.target.value))}
                className="flex-1 accent-marca-azul"
                disabled={!sujeitoIS}
              />
              <span className="w-14 text-right text-sm font-semibold text-tinta-forte">
                {formatarPercentual(impostoSeletivo)}
              </span>
            </div>
            <label className="mt-1 flex items-center gap-2 text-xs text-tinta-fraca">
              <input
                type="checkbox"
                checked={sujeitoIS}
                onChange={e => setSujeitoIS(e.target.checked)}
                className="accent-marca-azul"
              />
              Itens sujeitos ao Imposto Seletivo
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs text-tinta-suave">Regime do fornecedor</label>
            <select
              value={regime}
              onChange={e => setRegime(e.target.value)}
              className="w-full rounded-lg border border-fundo-borda px-3 py-2 text-sm"
            >
              {meta?.regimesFornecedor
                ? meta.regimesFornecedor.map((r: any) => (
                    <option key={r.codigo} value={r.codigo}>
                      {r.nome}
                    </option>
                  ))
                : <option value="regime-regular">Regime Regular</option>}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-tinta-suave">Crédito de IBS/CBS</label>
            <p className="rounded-lg bg-fundo-eleva px-3 py-2 text-sm text-tinta-media">
              {simulacao?.regimeFornecedor?.geraCredito === false
                ? 'Não transfere crédito'
                : 'Crédito integral'}
            </p>
          </div>
        </div>
      </div>

      {/* ==================== LINHA DO TEMPO ==================== */}
      <div>
        <div className="flex gap-1">
          {ANOS.map((a, i) => (
            <button
              key={a}
              onClick={() => setAno(a)}
              className="h-1.5 flex-1 rounded-full transition"
              style={{ backgroundColor: TOM_DO_ANO[i] }}
              aria-label={`Simular ${a}`}
            />
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          {ANOS.map(a => (
            <button
              key={a}
              onClick={() => setAno(a)}
              className={`flex-1 rounded-md py-0.5 text-xs transition ${
                a === ano
                  ? 'bg-marca-azul font-semibold text-white'
                  : 'text-tinta-suave hover:text-marca-azul'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* ==================== IMPACTO NO PREÇO ==================== */}
      <div className="border border-fundo-borda border-l-[3px] border-l-marca-azul bg-fundo-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <p className="text-xs text-tinta-suave">
            {simulacao?.resumo ?? 'Calculando o cenário do ano selecionado…'}
          </p>
          <AjudaIcone
            tamanho={13}
            largura={330}
            conteudo={
              <MemoriaCalculo
                titulo={`Preço em ${ano}`}
                descricao="O preço novo mantém a mesma base e troca a carga antiga pela carga do ano simulado."
                linhas={[
                  { rotulo: 'Preço atual', valor: formatarMoeda(simulacao?.precoAtual ?? 0) },
                  { rotulo: '− tributos hoje', valor: formatarMoeda(simulacao?.totalAtual ?? 0) },
                  {
                    rotulo: `+ tributos em ${ano}`,
                    valor: formatarMoeda(simulacao?.totalFuturo ?? 0),
                  },
                ]}
                resultado={{
                  rotulo: 'Preço novo',
                  valor: formatarMoeda(simulacao?.precoNovo ?? 0),
                }}
                origem="A variação percentual compara os tributos, não o preço."
              />
            }
          />
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-sm text-tinta-suave line-through">
            {formatarMoeda(simulacao?.precoAtual ?? 0)}
          </span>
          <ArrowRight size={16} className="text-marca-azul" />
          <span className="text-2xl font-bold text-tinta-forte">
            {formatarMoeda(simulacao?.precoNovo ?? 0)}
          </span>
          <span
            className={`rounded-md px-2 py-1 text-xs font-semibold ${
              (simulacao?.diferenca ?? 0) > 0
                ? 'bg-red-50 text-red-700'
                : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {formatarPercentual(simulacao?.variacaoPercentual ?? 0)} ·{' '}
            {formatarMoeda(simulacao?.diferenca ?? 0)}
          </span>
        </div>
      </div>

      {/* ==================== INDICADORES ==================== */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador
          rotulo="Carga efetiva hoje"
          valor={formatarPercentual(cargaHoje)}
          memoria={
            <MemoriaCalculo
              titulo="Carga efetiva hoje"
              descricao="Peso dos tributos destacados sobre o preço praticado hoje."
              linhas={[
                { rotulo: 'Tributos atuais', valor: formatarMoeda(simulacao?.totalAtual ?? 0) },
                { rotulo: 'Preço atual', valor: formatarMoeda(simulacao?.precoAtual ?? 0) },
              ]}
              resultado={{ rotulo: 'Carga', valor: formatarPercentual(cargaHoje) }}
              origem="tributos ÷ preço"
            />
          }
        />
        <Indicador
          rotulo={`Carga em ${ano}`}
          valor={formatarPercentual(cargaFutura)}
          memoria={
            <MemoriaCalculo
              titulo={`Carga em ${ano}`}
              descricao="Mesma conta, com os tributos e o preço projetados para o ano selecionado."
              linhas={[
                { rotulo: `Tributos em ${ano}`, valor: formatarMoeda(simulacao?.totalFuturo ?? 0) },
                { rotulo: 'Preço novo', valor: formatarMoeda(simulacao?.precoNovo ?? 0) },
              ]}
              resultado={{ rotulo: 'Carga', valor: formatarPercentual(cargaFutura) }}
              origem="tributos ÷ preço"
            />
          }
        />
        <Indicador
          rotulo="Crédito IBS/CBS"
          valor={formatarMoeda(simulacao?.creditoIBSCBS ?? 0)}
          destaque
          memoria={
            <MemoriaCalculo
              titulo="Crédito IBS/CBS"
              descricao="Crédito que o adquirente aproveita, quando o regime do fornecedor transfere crédito."
              linhas={[
                { rotulo: 'Base de cálculo', valor: formatarMoeda(simulacao?.baseCalculo ?? 0) },
                {
                  rotulo: 'Alíquota IBS',
                  valor: formatarPercentual(simulacao?.aliquotasEfetivas?.ibs ?? 0),
                },
                {
                  rotulo: 'Alíquota CBS',
                  valor: formatarPercentual(simulacao?.aliquotasEfetivas?.cbs ?? 0),
                },
              ]}
              resultado={{
                rotulo: 'Crédito',
                valor: formatarMoeda(simulacao?.creditoIBSCBS ?? 0),
              }}
              origem={
                simulacao?.regimeFornecedor?.geraCredito === false
                  ? 'O regime selecionado não transfere crédito, por isso o valor fica zerado.'
                  : 'base × (alíquota IBS + alíquota CBS)'
              }
            />
          }
        />
        <Indicador
          rotulo="Resíduo em cadeia"
          valor="sem dado"
          alerta
          memoria={
            <MemoriaCalculo
              titulo="Resíduo em cadeia"
              descricao={
                simulacao?.tributosEmCadeia?.motivo ??
                'Tributo embutido nas etapas anteriores da cadeia.'
              }
              linhas={[
                { rotulo: 'Exige', valor: 'CNAE do emitente' },
                { rotulo: 'Exige', valor: 'matriz insumo-produto' },
              ]}
              origem="Declarado como indisponível em vez de estimado, para não gerar número sem lastro."
            />
          }
        />
      </div>

      {/* ==================== BALANÇO: SAI / ENTRA ==================== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Balanco
          titulo="Sai do preço"
          icone={<LogOut size={14} />}
          linhas={saem.map(l => ({ nome: l.tributo, valor: l.atual }))}
          total={simulacao?.totalAtual ?? 0}
          base={simulacao?.precoAtual ?? 0}
        />
        <Balanco
          titulo="Entra no preço"
          icone={<LogIn size={14} />}
          destaque
          linhas={entram.map(l => ({ nome: l.tributo, valor: l.futuro }))}
          total={simulacao?.totalFuturo ?? 0}
          base={simulacao?.precoNovo ?? 0}
        />
      </div>

      {/* ==================== TRANSIÇÃO ANO A ANO ==================== */}
      <div className="rounded-lg border border-fundo-borda bg-fundo-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <h4 className="text-base font-semibold text-tinta-forte">Transição ano a ano</h4>
          <AjudaIcone
            largura={340}
            conteudo={
              <MemoriaCalculo
                titulo="Transição ano a ano"
                descricao="Cada ano aplica o fator de redução dos tributos antigos previsto na legislação e soma o IBS e a CBS sobre a mesma base."
                linhas={[
                  { rotulo: 'Antigos', valor: 'ICMS, ICMS-ST, IPI, PIS, COFINS, ISS' },
                  { rotulo: 'Novos', valor: 'IBS + CBS + Seletivo' },
                  { rotulo: 'Variação', valor: 'contra a carga de hoje' },
                ]}
                origem="A carga pode subir nos primeiros anos, quando os dois sistemas convivem."
              />
            }
          />
        </div>

        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dadosGrafico}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E3DC" vertical={false} />
              <XAxis dataKey="ano" stroke="#888780" fontSize={12} />
              <YAxis
                stroke="#888780"
                fontSize={12}
                tickFormatter={v => formatarMoedaCompacta(v)}
              />
              <Tooltip
                formatter={(v: number) => formatarMoeda(v)}
                contentStyle={{
                  background: '#FFFFFF',
                  border: '1px solid #E5E3DC',
                  borderRadius: 8,
                }}
              />
              <Legend />
              <Bar
                dataKey="antigos"
                stackId="a"
                name="ICMS · IPI · PIS · COFINS · ISS"
                fill={COR_ANTIGOS}
              />
              <Bar dataKey="novos" stackId="a" name="IBS · CBS · Seletivo" fill={COR_NOVOS} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-fundo-borda text-xs text-tinta-suave">
                <th className="py-2 text-left font-normal">Ano</th>
                <th className="py-2 text-right font-normal">Antigos</th>
                <th className="py-2 text-right font-normal">IBS/CBS</th>
                <th className="py-2 text-right font-normal">Total</th>
                <th className="py-2 text-right font-normal">Variação</th>
              </tr>
            </thead>
            <tbody>
              {serie.map(s => {
                const antigos = s.icms + s.icmsST + s.ipi + s.pis + s.cofins + s.iss;
                const novos = s.ibs + s.cbs + s.impostoSeletivo;
                return (
                  <tr
                    key={s.ano}
                    className={`border-b border-fundo-borda last:border-0 ${
                      s.ano === ano ? 'bg-marca-azul/5 font-semibold' : ''
                    }`}
                  >
                    <td className="py-2 text-left text-tinta-forte">{s.ano}</td>
                    <td className="py-2 text-right font-mono text-tinta-media">
                      {formatarMoedaCompacta(antigos)}
                    </td>
                    <td className="py-2 text-right font-mono text-tinta-media">
                      {formatarMoedaCompacta(novos)}
                    </td>
                    <td className="py-2 text-right font-mono text-tinta-forte">
                      {formatarMoedaCompacta(s.total)}
                    </td>
                    <td
                      className={`py-2 text-right font-mono ${
                        s.variacaoPercentual > 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatarPercentual(s.variacaoPercentual)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ==================== SENSIBILIDADE E FORNECEDORES ==================== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-fundo-borda bg-fundo-card p-4">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-tinta-forte">
              Sensibilidade da alíquota
            </h4>
            <AjudaIcone
              largura={320}
              conteudo={
                <MemoriaCalculo
                  titulo="Sensibilidade da alíquota"
                  descricao="A mesma simulação rodada com o IVA dois pontos abaixo e dois acima do valor escolhido."
                  linhas={[
                    { rotulo: 'Ano', valor: String(ano) },
                    { rotulo: 'Demais premissas', valor: 'inalteradas' },
                  ]}
                  origem="Serve para responder o que acontece se a alíquota final vier diferente da projetada."
                />
              }
            />
          </div>
          <p className="mb-3 text-xs text-tinta-suave">preço novo em {ano}</p>

          {sensibilidade.map(s => (
            <div
              key={s.iva}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                s.atual ? 'bg-marca-azul/10 font-semibold text-tinta-forte' : 'text-tinta-media'
              }`}
            >
              <span>IVA {formatarPercentual(s.iva)}</span>
              <span className="font-mono">{formatarMoeda(s.preco)}</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-fundo-borda bg-fundo-card p-4">
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold text-tinta-forte">Impacto por fornecedor</h4>
            <AjudaIcone
              largura={330}
              conteudo={
                <MemoriaCalculo
                  titulo="Impacto por fornecedor"
                  descricao="A mesma simulação do ano selecionado, rodada nota a nota e agrupada por CNPJ."
                  linhas={[
                    { rotulo: 'Tributos hoje', valor: 'destacados na nota' },
                    { rotulo: 'Tributos no ano', valor: 'antigos × fator + IBS/CBS' },
                    { rotulo: 'Variação', valor: '(novo − hoje) ÷ hoje' },
                  ]}
                  origem="Passe o mouse sobre cada linha para ver os números daquele fornecedor."
                />
              }
            />
          </div>
          <p className="mb-3 text-xs text-tinta-suave">variação da carga em {ano}</p>

          {(simulacao?.porFornecedor ?? []).slice(0, 6).map((f: any) => (
            <div key={f.cnpj} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="truncate text-tinta-media">
                {f.fornecedor}
                <span className="ml-1 text-xs text-tinta-suave">· {f.regime}</span>
              </span>

              {/*
                A tag de memória: o percentual só é confiável se o usuário
                conseguir ver de onde ele saiu, sem trocar de tela.
              */}
              <AjudaIcone
                largura={320}
                tamanho={14}
                conteudo={
                  <MemoriaCalculo
                    titulo={f.fornecedor}
                    descricao={`${f.documentos} documento(s) · regime ${f.regime}`}
                    linhas={[
                      { rotulo: 'Base de cálculo', valor: formatarMoeda(f.base) },
                      { rotulo: 'Tributos hoje', valor: formatarMoeda(f.atual) },
                      { rotulo: 'Alíquota IBS+CBS', valor: formatarPercentual(f.aliquotaAplicada) },
                      { rotulo: `Tributos em ${ano}`, valor: formatarMoeda(f.futuro) },
                      { rotulo: 'Diferença', valor: formatarMoeda(f.diferenca) },
                    ]}
                    resultado={{
                      rotulo: 'Variação',
                      valor: formatarPercentual(f.variacaoPercentual),
                    }}
                    origem={`${formatarMoeda(f.atual)} de tributos hoje contra ${formatarMoeda(
                      f.futuro
                    )} em ${ano}, sobre a mesma base.`}
                  />
                }
              />

              <span
                className={`w-20 shrink-0 text-right font-mono ${
                  f.variacaoPercentual > 0 ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {formatarPercentual(f.variacaoPercentual)}
              </span>
            </div>
          ))}

          {!carregando && (simulacao?.porFornecedor ?? []).length === 0 && (
            <p className="py-4 text-center text-sm text-tinta-suave">
              Importe notas para ver o impacto por fornecedor.
            </p>
          )}
        </div>
      </div>

      {/* ==================== RESSALVA ==================== */}
      {simulacao?.tributosEmCadeia?.disponivel === false && (
        <div className="border-l-[3px] border-amber-400 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle size={14} />
            Tributos em cadeia não calculados
          </p>
          <p className="mt-1 text-xs leading-snug text-amber-900">
            {simulacao.tributosEmCadeia.motivo}
          </p>
        </div>
      )}
    </div>
  );
};

/** Cartão de indicador do topo. */
const Indicador: React.FC<{
  rotulo: string;
  valor: string;
  destaque?: boolean;
  alerta?: boolean;
  memoria?: React.ReactNode;
}> = ({ rotulo, valor, destaque, alerta, memoria }) => (
  <div className="rounded-lg border border-fundo-borda bg-fundo-card p-3">
    <div className="flex items-center gap-1.5">
      <p className="text-xs text-tinta-suave">{rotulo}</p>
      {memoria && <AjudaIcone tamanho={13} largura={310} conteudo={memoria} />}
    </div>
    <p
      className={`mt-1 text-lg font-bold ${
        alerta ? 'text-amber-700' : destaque ? 'text-marca-azul' : 'text-tinta-forte'
      }`}
    >
      {valor}
    </p>
  </div>
);

/** Coluna do balanço: o que sai e o que entra no preço. */
const Balanco: React.FC<{
  titulo: string;
  icone: React.ReactNode;
  linhas: Array<{ nome: string; valor: number }>;
  total: number;
  base: number;
  destaque?: boolean;
}> = ({ titulo, icone, linhas, total, base, destaque }) => (
  <div className="rounded-lg border border-fundo-borda bg-fundo-card p-4">
    <p
      className={`mb-3 flex items-center gap-2 text-sm ${
        destaque ? 'text-marca-azul' : 'text-tinta-suave'
      }`}
    >
      {icone}
      {titulo}
    </p>

    {linhas.map(l => (
      <div key={l.nome} className="flex justify-between py-1 text-sm">
        <span className={l.valor > 0 ? 'text-tinta-media' : 'text-tinta-suave'}>{l.nome}</span>
        <span className="font-mono text-tinta-media">
          {l.valor > 0 ? (
            <>
              {formatarMoeda(l.valor)}
              <span className="ml-1 text-xs text-tinta-suave">
                {formatarPercentual(base > 0 ? (l.valor / base) * 100 : 0)}
              </span>
            </>
          ) : (
            <span className="text-tinta-suave">não incide</span>
          )}
        </span>
      </div>
    ))}

    <div className="mt-2 flex justify-between border-t border-fundo-borda pt-2 text-sm font-semibold text-tinta-forte">
      <span>Total</span>
      <span className="font-mono">
        {formatarMoeda(total)}
        <span className="ml-1 text-xs font-normal text-tinta-suave">
          {formatarPercentual(base > 0 ? (total / base) * 100 : 0)}
        </span>
      </span>
    </div>
  </div>
);
