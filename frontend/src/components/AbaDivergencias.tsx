import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Search, X, ArrowUpDown, Calendar } from 'lucide-react';
import { AjudaIcone, MemoriaCalculo } from './Tooltip';
import { formatarMoeda, formatarInteiro, formatarPercentual } from '../utils/format';
import { API_URL } from '../utils/api';

interface Divergencia {
  tributo: string;
  ano: number;
  valorAtual: number;
  valorPrevisto: number;
  diferenca: number;
  percentual: number;
  fornecedor?: string;
}

type Coluna = 'tributo' | 'ano' | 'valorAtual' | 'valorPrevisto' | 'diferenca' | 'fornecedor';

const LIMITES = [50, 100, 150, 200];
const ANOS_REFORMA = [2027, 2028, 2029, 2030, 2031, 2032, 2033];

/**
 * Cabeçalho ordenável da tabela.
 *
 * Fica no escopo do módulo, e não dentro do componente: definido lá dentro,
 * seria recriado a cada render e remontaria a tabela inteira a cada tecla
 * digitada na busca — o que fazia o campo perder o foco.
 */
const Cabecalho: React.FC<{
  coluna: Coluna;
  children: React.ReactNode;
  alinhar?: string;
  ordemAtual: { coluna: Coluna; asc: boolean };
  onOrdenar: (c: Coluna) => void;
}> = ({ coluna, children, alinhar = 'text-left', ordemAtual, onOrdenar }) => (
  <th className={`px-2 py-2 ${alinhar}`}>
    <button
      onClick={() => onOrdenar(coluna)}
      className={`inline-flex items-center gap-1 font-semibold transition-colors hover:text-marca-neon ${
        ordemAtual.coluna === coluna ? 'text-marca-neon' : 'text-gray-200'
      }`}
    >
      {children}
      <ArrowUpDown size={12} />
    </button>
  </th>
);

export const AbaDivergencias: React.FC<{
  divergencias: Divergencia[];
  sessionId?: string;
  token?: string;
}> = ({ divergencias, sessionId, token }) => {
  // Ano de referência: 'atual' usa as divergências já calculadas; um ano da
  // transição recalcula tudo no backend conforme a legislação daquele ano.
  const [anoReferencia, setAnoReferencia] = useState<string>('atual');
  const [recalculadas, setRecalculadas] = useState<Divergencia[] | null>(null);
  const [contexto, setContexto] = useState<{ titulo: string; resumo: string } | null>(null);
  const [recalculando, setRecalculando] = useState(false);

  useEffect(() => {
    if (anoReferencia === 'atual' || !sessionId || !token) {
      setRecalculadas(null);
      setContexto(null);
      return;
    }

    setRecalculando(true);
    axios
      .get(`${API_URL}/api/v1/reforma/divergencias`, {
        headers: { 'x-session-id': sessionId, Authorization: `Bearer ${token}` },
        params: { ano: anoReferencia },
      })
      .then(r => {
        setRecalculadas(r.data.data.divergencias);
        setContexto({ titulo: r.data.data.titulo, resumo: r.data.data.resumo });
      })
      .catch(() => {
        setRecalculadas([]);
        setContexto(null);
      })
      .finally(() => setRecalculando(false));
  }, [anoReferencia, sessionId, token]);

  const base = recalculadas ?? divergencias;
  const [busca, setBusca] = useState('');
  const [tributo, setTributo] = useState('todos');
  const [ano, setAno] = useState('todos');
  const [sentido, setSentido] = useState('todos');
  const [limite, setLimite] = useState(50);
  const [ordem, setOrdem] = useState<{ coluna: Coluna; asc: boolean }>({
    coluna: 'diferenca',
    asc: true,
  });

  // Opções montadas a partir dos dados, não fixas em código: se a base tiver
  // outros tributos ou anos, os filtros acompanham.
  const tributos = useMemo(
    () => Array.from(new Set(base.map(d => d.tributo))).sort(),
    [base]
  );
  const anos = useMemo(
    () => Array.from(new Set(base.map(d => d.ano))).sort((a, b) => a - b),
    [base]
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    const resultado = base.filter(d => {
      if (tributo !== 'todos' && d.tributo !== tributo) return false;
      if (ano !== 'todos' && String(d.ano) !== ano) return false;
      if (sentido === 'maior' && d.diferenca <= 0) return false;
      if (sentido === 'menor' && d.diferenca >= 0) return false;

      if (termo) {
        const alvo = `${d.tributo} ${d.ano} ${d.fornecedor ?? ''}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });

    const { coluna, asc } = ordem;
    resultado.sort((a, b) => {
      const va = a[coluna];
      const vb = b[coluna];

      // Diferença ordena por magnitude: o que mais destoa vem primeiro,
      // independentemente de ser para mais ou para menos.
      if (coluna === 'diferenca') {
        return asc ? Math.abs(vb as number) - Math.abs(va as number)
                   : Math.abs(va as number) - Math.abs(vb as number);
      }
      if (typeof va === 'number' && typeof vb === 'number') {
        return asc ? vb - va : va - vb;
      }
      return asc
        ? String(vb ?? '').localeCompare(String(va ?? ''), 'pt-BR')
        : String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR');
    });

    return resultado;
  }, [base, busca, tributo, ano, sentido, ordem]);

  const visiveis = filtradas.slice(0, limite);
  const temFiltro = busca !== '' || tributo !== 'todos' || ano !== 'todos' || sentido !== 'todos';

  const limparFiltros = () => {
    setBusca('');
    setTributo('todos');
    setAno('todos');
    setSentido('todos');
  };

  const ordenarPor = (coluna: Coluna) =>
    setOrdem(atual =>
      atual.coluna === coluna ? { coluna, asc: !atual.asc } : { coluna, asc: true }
    );


  const totalDiferenca = filtradas.reduce((soma, d) => soma + d.diferenca, 0);

  return (
    <div className="rounded-lg bg-fundo-card p-6 shadow-md">
      <div className="mb-1 flex items-center gap-2">
        <AlertTriangle size={20} className="text-orange-500" />
        <h3 className="text-lg font-semibold">Divergências Encontradas</h3>
        <AjudaIcone
          largura={340}
          conteudo={
            <MemoriaCalculo
              titulo="Como a divergência é calculada"
              descricao="Para cada tributo da nota, o valor destacado é comparado com o valor esperado pela alíquota do regime no ano de referência."
              linhas={[
                { rotulo: 'Diferença', valor: 'previsto − atual' },
                { rotulo: 'Percentual', valor: '(diferença ÷ previsto) × 100' },
              ]}
              origem="Valor negativo indica que a nota destacou mais tributo do que o previsto."
            />
          }
        />
      </div>

      <p className="mb-4 text-sm text-gray-500">
        {temFiltro ? (
          <>
            {formatarInteiro(filtradas.length)} de {formatarInteiro(base.length)}{' '}
            ocorrências após os filtros
          </>
        ) : (
          <>{formatarInteiro(base.length)} ocorrências no total</>
        )}
      </p>

      {base.length === 0 && !recalculando ? (
        <p className="py-8 text-center text-gray-500">
          Nenhuma divergência encontrada nos documentos importados.
        </p>
      ) : (
        <>
          {/* ============ ANO DE REFERÊNCIA (transição 2027-2033) ============ */}
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Calendar size={15} className="text-amber-600" />
              <span className="text-xs font-bold uppercase tracking-wide text-gray-200">
                Ano de referência do cálculo
              </span>
              <AjudaIcone
                tamanho={14}
                largura={350}
                conteudo={
                  <MemoriaCalculo
                    titulo="Recálculo pela legislação anual"
                    descricao="Ao escolher um ano da transição, cada tributo da nota é recalculado pelas regras daquele ano: ICMS e ISS reduzidos pelo fator vigente, PIS/COFINS extintos a partir de 2027, e IBS e CBS aplicados sobre a base de cálculo."
                    linhas={[
                      { rotulo: '2027-2028', valor: 'ICMS/ISS integrais' },
                      { rotulo: '2029', valor: 'ICMS/ISS a 90%' },
                      { rotulo: '2030', valor: 'a 80%' },
                      { rotulo: '2031', valor: 'a 70%' },
                      { rotulo: '2032', valor: 'a 60%' },
                      { rotulo: '2033', valor: 'extintos' },
                    ]}
                    origem="Fatores definidos na EC 132/2023 e LC 214/2025."
                  />
                }
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setAnoReferencia('atual')}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  anoReferencia === 'atual'
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-fundo-card text-gray-500 ring-1 ring-fundo-borda hover:bg-fundo-eleva'
                }`}
              >
                Legislação atual
              </button>
              {ANOS_REFORMA.map(a => (
                <button
                  key={a}
                  onClick={() => setAnoReferencia(String(a))}
                  disabled={!sessionId || !token}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    anoReferencia === String(a)
                      ? 'bg-amber-500 text-white shadow'
                      : 'bg-fundo-card text-gray-500 ring-1 ring-fundo-borda hover:bg-amber-500/20'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>

            {recalculando && (
              <p className="mt-2 text-xs text-gray-500">Recalculando pela legislação do ano...</p>
            )}
            {contexto && !recalculando && (
              <p className="mt-2 text-xs leading-snug text-gray-500">
                <strong>{contexto.titulo}.</strong> {contexto.resumo}
              </p>
            )}
          </div>

          {/* ==================== FILTROS ==================== */}
          <div className="mb-4 rounded-lg border border-fundo-borda bg-fundo-eleva p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Buscar por fornecedor, tributo ou ano
                </label>
                <div className="relative">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                  />
                  <input
                    type="text"
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Digite para filtrar..."
                    className="w-full rounded-lg border border-fundo-borda py-2 pl-9 pr-9 text-sm focus:border-marca-azul focus:outline-none focus:ring-1 focus:ring-marca-azul"
                  />
                  {busca && (
                    <button
                      onClick={() => setBusca('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-200"
                      aria-label="Limpar busca"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Tributo</label>
                <select
                  value={tributo}
                  onChange={e => setTributo(e.target.value)}
                  className="w-full rounded-lg border border-fundo-borda px-3 py-2 text-sm focus:border-marca-azul focus:outline-none focus:ring-1 focus:ring-marca-azul"
                >
                  <option value="todos">Todos</option>
                  {tributos.map(t => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Ano</label>
                <select
                  value={ano}
                  onChange={e => setAno(e.target.value)}
                  className="w-full rounded-lg border border-fundo-borda px-3 py-2 text-sm focus:border-marca-azul focus:outline-none focus:ring-1 focus:ring-marca-azul"
                >
                  <option value="todos">Todos</option>
                  {anos.map(a => (
                    <option key={a} value={String(a)}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Sentido:</span>
              {[
                { id: 'todos', rotulo: 'Todos' },
                { id: 'maior', rotulo: 'Recolheu a menos' },
                { id: 'menor', rotulo: 'Recolheu a mais' },
              ].map(op => (
                <button
                  key={op.id}
                  onClick={() => setSentido(op.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    sentido === op.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-fundo-card text-gray-500 ring-1 ring-fundo-borda hover:bg-fundo-eleva'
                  }`}
                >
                  {op.rotulo}
                </button>
              ))}

              {temFiltro && (
                <button
                  onClick={limparFiltros}
                  className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-red-400 hover:text-red-300"
                >
                  <X size={14} /> Limpar filtros
                </button>
              )}
            </div>
          </div>

          {/* ==================== TABELA ==================== */}
          {filtradas.length === 0 ? (
            <p className="py-8 text-center text-gray-500">
              Nenhuma divergência corresponde aos filtros aplicados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-fundo-borda bg-fundo-eleva">
                    <Cabecalho ordemAtual={ordem} onOrdenar={ordenarPor} coluna="tributo">Tributo</Cabecalho>
                    <Cabecalho ordemAtual={ordem} onOrdenar={ordenarPor} coluna="ano">Ano</Cabecalho>
                    <Cabecalho ordemAtual={ordem} onOrdenar={ordenarPor} coluna="valorAtual" alinhar="text-right">Atual</Cabecalho>
                    <Cabecalho ordemAtual={ordem} onOrdenar={ordenarPor} coluna="valorPrevisto" alinhar="text-right">Previsto</Cabecalho>
                    <Cabecalho ordemAtual={ordem} onOrdenar={ordenarPor} coluna="diferenca" alinhar="text-right">Diferença</Cabecalho>
                    <Cabecalho ordemAtual={ordem} onOrdenar={ordenarPor} coluna="fornecedor">Fornecedor</Cabecalho>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((div, i) => (
                    <tr key={i} className="border-b border-fundo-borda transition-colors hover:bg-marca-azul/10">
                      <td className="px-2 py-2 font-semibold text-gray-100">{div.tributo}</td>
                      <td className="px-2 py-2 text-gray-500">{div.ano}</td>
                      <td className="px-2 py-2 text-right font-mono text-gray-100">
                        {formatarMoeda(div.valorAtual)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-gray-100">
                        {formatarMoeda(div.valorPrevisto)}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono font-semibold ${
                          div.diferenca < 0 ? 'text-red-400' : 'text-green-400'
                        }`}
                      >
                        {formatarMoeda(div.diferenca)}
                        <span className="ml-1 text-xs font-normal opacity-75">
                          ({formatarPercentual(div.percentual, 1)})
                        </span>
                      </td>
                      <td className="max-w-[220px] truncate px-2 py-2 text-gray-500">
                        {div.fornecedor || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ==================== RODAPÉ: LIMITE DE LINHAS ==================== */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-fundo-borda pt-4">
            <div className="text-sm text-gray-500">
              Exibindo <strong>{formatarInteiro(visiveis.length)}</strong> de{' '}
              <strong>{formatarInteiro(filtradas.length)}</strong> ocorrências
              {filtradas.length > 0 && (
                <span className="ml-3 text-gray-500">
                  Soma das diferenças:{' '}
                  <span
                    className={`font-mono font-semibold ${
                      totalDiferenca < 0 ? 'text-red-400' : 'text-green-400'
                    }`}
                  >
                    {formatarMoeda(totalDiferenca)}
                  </span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Linhas por página:</span>
              {LIMITES.map(n => (
                <button
                  key={n}
                  onClick={() => setLimite(n)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    limite === n
                      ? 'bg-blue-600 text-white'
                      : 'bg-fundo-card text-gray-500 ring-1 ring-fundo-borda hover:bg-fundo-eleva'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {filtradas.length > limite && (
            <p className="mt-2 text-center text-sm text-gray-500">
              Há mais {formatarInteiro(filtradas.length - limite)} ocorrências além do limite
              atual. Aumente o número de linhas ou refine os filtros.
            </p>
          )}
        </>
      )}
    </div>
  );
};
