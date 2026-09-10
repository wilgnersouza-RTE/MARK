import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { Calendar, Percent, TrendingUp, TrendingDown, DollarSign, AlertTriangle } from 'lucide-react';
import { AjudaIcone, MemoriaCalculo } from './Tooltip';
import { formatarMoeda, formatarMoedaCompacta, formatarPercentual } from '../utils/format';
import { API_URL } from '../utils/api';


interface Props {
  sessionId: string;
  token: string;
}

const ANOS = [2027, 2028, 2029, 2030, 2031, 2032, 2033];

export const AbaReforma: React.FC<Props> = ({ sessionId, token }) => {
  const [ano, setAno] = useState(2033);
  const [iva, setIva] = useState(28);
  const [impostoSeletivo, setImpostoSeletivo] = useState(55);
  const [regime, setRegime] = useState('regime-regular');
  const [sujeitoIS, setSujeitoIS] = useState(false);

  const [simulacao, setSimulacao] = useState<any>(null);
  const [serie, setSerie] = useState<any[]>([]);
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
      const [sim, ser] = await Promise.all([
        axios.get(`${API_URL}/api/v1/reforma/simulacao`, { ...cabecalhos, params }),
        axios.get(`${API_URL}/api/v1/reforma/serie`, { ...cabecalhos, params }),
      ]);
      setSimulacao(sim.data.data);
      setSerie(ser.data.data.serie.filter((s: any) => s.ano >= 2027));
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

  const aumentou = (simulacao?.diferenca ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* ==================== PARÂMETROS ==================== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Alíquotas */}
        <div className="rounded-lg bg-fundo-card p-5 shadow-md">
          <div className="mb-4 flex items-center gap-2">
            <Percent size={16} className="text-amber-600" />
            <h4 className="text-sm font-bold uppercase tracking-wide text-gray-200">
              Alíquotas tributárias
            </h4>
            <AjudaIcone
              largura={340}
              conteudo={
                <MemoriaCalculo
                  titulo="Por que a alíquota é editável"
                  descricao="Apenas 2026 tem alíquota fixada em lei. De 2027 em diante, o IVA depende de resolução do Senado (art. 349 da LC 214/2025). Os valores aqui são referência de mercado, não norma."
                  linhas={[
                    { rotulo: 'IBS + CBS', valor: 'IVA total' },
                    { rotulo: 'CBS (federal)', valor: '8,8% ref.' },
                    { rotulo: 'IBS (estadual + municipal)', valor: 'IVA − CBS' },
                  ]}
                  origem="Ajuste conforme a orientação do seu time tributário."
                />
              }
            />
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-gray-500">IVA (IBS + CBS)</span>
                <span className="font-mono font-bold text-gray-50">
                  {iva.toFixed(1).replace('.', ',')}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={40}
                step={0.1}
                value={iva}
                onChange={e => setIva(parseFloat(e.target.value))}
                className="w-full accent-amber-600"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>0%</span>
                <span>40%</span>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-gray-500">Imposto Seletivo</span>
                <span className="font-mono font-bold text-gray-50">
                  {impostoSeletivo.toFixed(1).replace('.', ',')}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={0.5}
                value={impostoSeletivo}
                onChange={e => setImpostoSeletivo(parseFloat(e.target.value))}
                disabled={!sujeitoIS}
                className="w-full accent-amber-600 disabled:accent-gray-300"
              />
              <label className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={sujeitoIS}
                  onChange={e => setSujeitoIS(e.target.checked)}
                  className="accent-amber-600"
                />
                Itens sujeitos ao Imposto Seletivo
              </label>
            </div>
          </div>
        </div>

        {/* Ano */}
        <div className="rounded-lg bg-fundo-card p-5 shadow-md">
          <div className="mb-1 flex items-center gap-2">
            <Calendar size={16} className="text-amber-600" />
            <h4 className="text-sm font-bold uppercase tracking-wide text-gray-200">
              Ano com impactos da reforma
            </h4>
          </div>
          <p className="mb-3 text-xs text-gray-500">Selecione o ano para visualizar os impactos</p>

          <div className="flex flex-wrap gap-1.5">
            {ANOS.map(a => (
              <button
                key={a}
                onClick={() => setAno(a)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  ano === a
                    ? 'bg-amber-500 text-white shadow'
                    : 'bg-fundo-card text-gray-500 ring-1 ring-fundo-borda hover:bg-amber-500/15'
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          {simulacao && (
            <p className="mt-3 border-t border-fundo-borda pt-3 text-xs leading-snug text-gray-500">
              <strong>{simulacao.titulo}.</strong> {simulacao.resumo}
            </p>
          )}
        </div>

        {/* Regime do fornecedor */}
        <div className="rounded-lg bg-fundo-card p-5 shadow-md">
          <div className="mb-3 flex items-center gap-2">
            <Percent size={16} className="text-amber-600" />
            <h4 className="text-sm font-bold uppercase tracking-wide text-gray-200">
              Tributação do fornecedor
            </h4>
            <AjudaIcone
              largura={340}
              conteudo={
                <MemoriaCalculo
                  titulo="Regime do fornecedor"
                  descricao="Define se a operação transfere crédito integral de IBS e CBS ao adquirente."
                  linhas={[
                    { rotulo: 'Regime Regular', valor: 'gera crédito' },
                    { rotulo: 'Simples Nacional', valor: 'não gera' },
                    { rotulo: 'Simples com opção', valor: 'gera crédito' },
                    { rotulo: 'MEI', valor: 'não gera' },
                  ]}
                  origem="Art. 41 da LC 214/2025."
                />
              }
            />
          </div>

          <select
            value={regime}
            onChange={e => setRegime(e.target.value)}
            className="w-full rounded-lg border border-fundo-borda px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          >
            {(meta?.regimesFornecedor || []).map((r: any) => (
              <option key={r.codigo} value={r.codigo}>
                {r.nome}
              </option>
            ))}
          </select>

          {simulacao?.regimeFornecedor && (
            <p className="mt-3 text-xs leading-snug text-gray-500">
              {simulacao.regimeFornecedor.observacao}
            </p>
          )}
        </div>
      </div>

      {erro && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {erro}
        </div>
      )}

      {carregando && !simulacao && (
        <p className="py-12 text-center text-gray-500">Calculando simulação...</p>
      )}

      {simulacao && (
        <>
          {/* ==================== PREÇO ATUAL x PREÇO NOVO ==================== */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border-l-4 border-amber-400 bg-amber-500/10 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-amber-100 p-2 text-amber-300">
                  <DollarSign size={18} />
                </span>
                <div>
                  <p className="text-sm font-bold text-gray-100">PREÇO ATUAL</p>
                  <p className="text-xs text-gray-500">Com tributos atuais</p>
                </div>
              </div>
              <p className="text-xl font-bold text-gray-50">{formatarMoeda(simulacao.precoAtual)}</p>
            </div>

            <div className="flex items-center justify-between rounded-lg border-l-4 border-amber-500 bg-amber-500/10 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-amber-100 p-2 text-amber-300">
                  <DollarSign size={18} />
                </span>
                <div>
                  <p className="text-sm font-bold text-gray-100">PREÇO NOVO</p>
                  <p className="text-xs text-gray-500">Com reforma tributária em {ano}</p>
                </div>
              </div>
              <p className="text-xl font-bold text-gray-50">{formatarMoeda(simulacao.precoNovo)}</p>
            </div>
          </div>

          {/* ==================== INDICADORES ==================== */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-fundo-card p-5 shadow-md">
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp size={14} className="text-gray-500" />
                <p className="text-xs font-bold uppercase text-gray-500">Tributos atuais</p>
                <AjudaIcone
                  tamanho={13}
                  largura={330}
                  conteudo={
                    <MemoriaCalculo
                      titulo="Tributos atuais destacados"
                      descricao="Soma do que está efetivamente destacado nos XMLs importados."
                      linhas={simulacao.detalhamento
                        .filter((d: any) => d.atual > 0)
                        .map((d: any) => ({ rotulo: d.tributo, valor: formatarMoeda(d.atual) }))}
                      resultado={{ rotulo: 'Total', valor: formatarMoeda(simulacao.totalAtual) }}
                    />
                  }
                />
              </div>
              <p className="text-xl font-bold text-gray-50">{formatarMoeda(simulacao.totalAtual)}</p>
            </div>

            <div className="rounded-lg bg-fundo-card p-5 shadow-md">
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp size={14} className="text-gray-500" />
                <p className="text-xs font-bold uppercase text-gray-500">Após a reforma</p>
                <AjudaIcone
                  tamanho={13}
                  largura={340}
                  conteudo={
                    <MemoriaCalculo
                      titulo={`Tributos em ${ano}`}
                      descricao="Tributos antigos reduzidos pelo fator do ano, mais IBS e CBS sobre a base de cálculo."
                      linhas={[
                        { rotulo: 'Fator ICMS/ISS', valor: `${(simulacao.fatoresDoAno.icms * 100).toFixed(0)}%` },
                        { rotulo: 'Alíquota IBS', valor: formatarPercentual(simulacao.aliquotasEfetivas.ibs, 2) },
                        { rotulo: 'Alíquota CBS', valor: formatarPercentual(simulacao.aliquotasEfetivas.cbs, 2) },
                        { rotulo: 'Base de cálculo', valor: formatarMoeda(simulacao.baseCalculo) },
                      ]}
                      resultado={{ rotulo: 'Total', valor: formatarMoeda(simulacao.totalFuturo) }}
                    />
                  }
                />
              </div>
              <p className="text-xl font-bold text-gray-50">{formatarMoeda(simulacao.totalFuturo)}</p>
            </div>

            <div className="rounded-lg bg-fundo-card p-5 shadow-md">
              <div className="mb-2 flex items-center gap-2">
                {aumentou ? (
                  <TrendingUp size={14} className="text-red-500" />
                ) : (
                  <TrendingDown size={14} className="text-green-400" />
                )}
                <p className="text-xs font-bold uppercase text-gray-500">
                  {aumentou ? 'Aumento' : 'Redução'}
                </p>
              </div>
              <p className={`text-xl font-bold ${aumentou ? 'text-red-400' : 'text-green-400'}`}>
                {formatarPercentual(Math.abs(simulacao.variacaoPercentual), 1)}
              </p>
              <p className="mt-1 text-xs text-gray-500">{formatarMoeda(simulacao.diferenca)}</p>
            </div>

            <div className="rounded-lg bg-fundo-card p-5 shadow-md">
              <div className="mb-2 flex items-center gap-2">
                <DollarSign size={14} className="text-gray-500" />
                <p className="text-xs font-bold uppercase text-gray-500">Crédito IBS/CBS</p>
                <AjudaIcone
                  tamanho={13}
                  largura={320}
                  conteudo={
                    <MemoriaCalculo
                      titulo="Crédito apropriável"
                      descricao="Valor de IBS e CBS que o adquirente pode tomar como crédito, conforme o regime do fornecedor."
                      linhas={[]}
                      resultado={{
                        rotulo: 'Crédito',
                        valor: formatarMoeda(simulacao.creditoIBSCBS),
                      }}
                      origem={simulacao.regimeFornecedor?.observacao}
                    />
                  }
                />
              </div>
              <p className="text-xl font-bold text-gray-50">
                {formatarMoeda(simulacao.creditoIBSCBS)}
              </p>
            </div>
          </div>

          {/* ==================== DETALHAMENTO POR TRIBUTO ==================== */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-lg bg-fundo-card p-6 shadow-md">
              <h4 className="text-base font-bold text-gray-100">Detalhamento por Tributo</h4>
              <p className="mb-4 text-sm text-gray-500">Comparação atual vs. pós-reforma</p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-fundo-borda bg-fundo-eleva text-gray-200">
                      <th className="px-3 py-2 text-left font-semibold">TRIBUTO</th>
                      <th className="px-3 py-2 text-center font-semibold">ATUAL</th>
                      <th className="px-3 py-2 text-center font-semibold">FUTURO ({ano})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulacao.detalhamento.map((d: any) => (
                      <tr key={d.tributo} className="border-b border-fundo-borda">
                        <td className="px-3 py-2 text-gray-200">{d.tributo}</td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-block rounded-md px-2.5 py-1 font-mono text-xs ${
                              d.atual > 0 ? 'bg-red-500/10 text-red-300' : 'bg-fundo-eleva text-gray-500'
                            }`}
                          >
                            {formatarMoeda(d.atual)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-block rounded-md px-2.5 py-1 font-mono text-xs ${
                              d.futuro > 0
                                ? 'bg-green-500/10 text-green-300'
                                : 'bg-fundo-eleva text-gray-500'
                            }`}
                          >
                            {formatarMoeda(d.futuro)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tributos em cadeia: declarado indisponível, não estimado */}
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-fundo-eleva p-3">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
                <div className="text-xs leading-snug text-gray-500">
                  <p className="font-semibold text-gray-200">Tributos em cadeia (resíduo tributário)</p>
                  <p>{simulacao.tributosEmCadeia.motivo}</p>
                </div>
              </div>
            </div>

            {/* ==================== EVOLUÇÃO ANO A ANO ==================== */}
            <div className="rounded-lg bg-fundo-card p-6 shadow-md">
              <h4 className="text-base font-bold text-gray-100">Evolução da carga tributária</h4>
              <p className="mb-4 text-sm text-gray-500">
                Tributos antigos recuando e IBS/CBS avançando, ano a ano
              </p>

              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={serie} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2a3a" />
                  <XAxis dataKey="ano" stroke="#9ca3af" fontSize={12} tickLine={false} />
                  <YAxis
                    tickFormatter={formatarMoedaCompacta}
                    stroke="#9ca3af"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(245, 158, 11, 0.06)' }}
                    contentStyle={{ borderRadius: 8, border: '1px solid #2a2a3a', backgroundColor: '#13131c', color: '#e5e7eb', fontSize: 12 }}
                    formatter={(v: any, n: any) => [formatarMoeda(v), n]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Bar dataKey="icms" stackId="a" fill="#2563eb" name="ICMS" />
                  <Bar dataKey="iss" stackId="a" fill="#7c3aed" name="ISS" />
                  <Bar dataKey="ibs" stackId="a" fill="#16a34a" name="IBS" />
                  <Bar dataKey="cbs" stackId="a" fill="#0891b2" name="CBS" />
                  <Bar dataKey="impostoSeletivo" stackId="a" fill="#ea580c" name="Imp. Seletivo" radius={[4, 4, 0, 0]}>
                    {serie.map((s: any) => (
                      <Cell key={s.ano} fillOpacity={s.ano === ano ? 1 : 0.75} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ==================== AVISO SOBRE AS ALÍQUOTAS ==================== */}
          {meta?.atencao && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="text-xs leading-relaxed text-amber-200">
                <p className="font-semibold">Sobre os números desta tela</p>
                <p>{meta.atencao}</p>
                <p className="mt-1">Base legal: {meta.baseLegal}</p>
                {!meta.revisadoPor && (
                  <p className="mt-1 font-semibold">
                    Esta tabela ainda não passou por revisão tributária registrada.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
