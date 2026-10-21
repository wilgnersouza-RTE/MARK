import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Check, Minus, ChevronRight, ChevronDown, Loader2, AlertTriangle, Info } from 'lucide-react';
import { AjudaIcone, MemoriaCalculo } from './Tooltip';
import { formatarMoeda, formatarPercentual } from '../utils/format';
import { API_URL } from '../utils/api';
import { type ParametrosFiltro } from './FiltrosAnalise';

/**
 * Conferência da reforma por nota (CAP-4 e CAP-5).
 *
 * As regras vivem no backend (services/conferenciaReforma.ts); aqui só se
 * desenha o que /dashboard/campos devolve. Uma busca alimenta os cartões
 * Entradas e Saídas, no topo do Painel, e a lista de notas, no fim dele.
 */

interface Campo {
  grupo: 'atual' | 'reforma';
  campo: string;
  situacao: 'preenchido' | 'parcial' | 'ausente';
  valor?: string;
  itens?: { com: number; total: number; zerados?: number };
  /** Alíquota como consta na nota, sem conversão de escala */
  aliquota?: number;
  base?: number;
  valorNumerico?: number;
  /** Informado com valor zero */
  zerado?: boolean;
  /** Todo zero do campo foi aceito (CST sem grupo padrão ou IBS municipal em 2026) */
  zeroAceito?: boolean;
}

type Situacao = 'completa' | 'com pendência' | 'fora do período' | 'sem data';

type TipoProblema = 'ausente' | 'zerado' | 'parcial' | 'incompativel';

interface Pendencia {
  campo: string;
  problema: TipoProblema;
  texto: string;
  detalhe?: string;
  /** Outros tipos que a pendência junta (parcial e zerado no mesmo campo) */
  tambem?: TipoProblema[];
}

interface Nota {
  id: string;
  numero: string;
  modelo: string | number;
  sentido: 'entrada' | 'saida' | 'indefinido';
  /** AAAA-MM-DD no fuso do emitente; null quando a nota não tem data válida */
  diaEmissao: string | null;
  emitente: string;
  cnpjEmitente: string;
  valor: number;
  situacao: Situacao;
  /** A nota numa frase, em linguagem de contador */
  resumo?: string;
  /** Tipos de problema presentes nas pendências */
  tipos?: TipoProblema[];
  /** Leiaute do XML (só NFS-e) */
  leiaute?: string;
  /** Código do serviço (só NFS-e) */
  codigoServico?: string;
  /** De que tag veio o código (cTribNac, item da LC 116, código municipal) */
  tipoCodigoServico?: string;
  pendencias: Pendencia[];
  avisos: string[];
  informativos: string[];
  campos: Campo[];
}

/** Selo de cada tipo de problema: rótulo, cor e explicação. */
const SELO_PROBLEMA: Record<TipoProblema, { rotulo: string; estilo: string; explica: string }> = {
  ausente: {
    rotulo: 'ausente',
    estilo: 'border-red-200 bg-red-50 text-red-800',
    explica: 'campo que não está no XML',
  },
  zerado: {
    rotulo: 'zerado',
    estilo: 'border-amber-200 bg-amber-50 text-amber-800',
    explica: 'campo informado com valor zero',
  },
  parcial: {
    rotulo: 'parcial',
    estilo: 'border-sky-200 bg-sky-50 text-sky-800',
    explica: 'campo em só parte dos itens',
  },
  incompativel: {
    rotulo: 'incompatível',
    estilo: 'border-violet-200 bg-violet-50 text-violet-800',
    explica: 'cClassTrib que não começa pelo CST',
  },
};

/** Selo de um tipo; tipo desconhecido vindo do backend ganha selo neutro. */
function seloDe(tipo: string): { rotulo: string; estilo: string; explica: string } {
  return (
    SELO_PROBLEMA[tipo as TipoProblema] ?? {
      rotulo: tipo,
      estilo: 'border-fundo-borda bg-fundo-eleva text-tinta-media',
      explica: tipo,
    }
  );
}

/** Número como está na nota, em pt-BR, sem acrescentar unidade. */
function formatarNumero(n: number | undefined, tipo: 'valor' | 'aliquota' = 'valor'): string {
  if (n === undefined || n === null) return '-';
  return tipo === 'valor'
    ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

interface ResumoSentido {
  total: number;
  completas: number;
  percentual: number;
}

export interface DadosConferencia {
  notas: Nota[];
  porSentido: {
    entrada: ResumoSentido;
    saida: ResumoSentido;
    semVinculo: ResumoSentido;
    total: ResumoSentido;
  };
  temEmpresa: boolean;
  versaoTabela: string;
  /** AAAA-MM-DD */
  dataDeCorte: string;
}

/** "2026-01-01" vira "01/01/2026", sem passar por Date (que mudaria o dia pelo fuso). */
function formatarDia(dia: string | null | undefined): string {
  if (!dia) return '-';
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** "1.31" vira "v1.31"; a tabela que não pôde ser lida fica por extenso. */
function rotuloVersao(versao: string | undefined): string {
  if (!versao) return '?';
  return versao === 'indisponível' ? 'tabela indisponível' : `v${versao}`;
}

export interface EstadoConferencia {
  dados: DadosConferencia | null;
  carregando: boolean;
  erro: string | null;
}

/** Busca a conferência com os filtros da análise. Sem filtros, não busca. */
export function useConferenciaReforma(
  sessionId: string,
  token: string,
  filtros: ParametrosFiltro | null
): EstadoConferencia {
  const [estado, setEstado] = useState<EstadoConferencia>({
    dados: null,
    carregando: false,
    erro: null,
  });

  useEffect(() => {
    // Sem filtros ainda não há o que buscar; não fica carregando para sempre.
    if (!filtros) {
      setEstado(e => ({ ...e, carregando: false }));
      return;
    }
    let ativo = true;
    setEstado(e => ({ ...e, carregando: true, erro: null }));

    axios
      .get(`${API_URL}/api/v1/dashboard/campos`, {
        headers: { 'x-session-id': sessionId, Authorization: `Bearer ${token}` },
        params: filtros,
      })
      .then(r => {
        if (ativo) setEstado({ dados: r.data.data ?? null, carregando: false, erro: null });
      })
      .catch(() => {
        // Mantém os dados anteriores: uma recarga que falha não apaga a tela.
        if (ativo)
          setEstado(e => ({
            ...e,
            carregando: false,
            erro: 'Não foi possível carregar a conferência de tributos.',
          }));
      });

    return () => {
      ativo = false;
    };
  }, [sessionId, token, filtros]);

  return estado;
}

// ==================== Cartões Entradas e Saídas ====================

export const CartoesReforma: React.FC<{ conferencia: EstadoConferencia }> = ({ conferencia }) => {
  const { dados, carregando, erro } = conferencia;
  const corte = dados ? formatarDia(dados.dataDeCorte) : 'a data de corte';
  const semVinculo = dados?.temEmpresa ? dados.porSentido.semVinculo.total : 0;

  const cartoes: Array<{ titulo: string; resumo?: ResumoSentido }> = [
    { titulo: 'Entradas', resumo: dados?.porSentido.entrada },
    { titulo: 'Saídas', resumo: dados?.porSentido.saida },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-tinta-forte">
          Notas com os campos da reforma completos
        </h3>
        <AjudaIcone
          largura={340}
          tamanho={14}
          conteudo={
            <MemoriaCalculo
              titulo="Percentual de notas completas"
              descricao={`Entre as notas emitidas a partir de ${corte}, quantas trazem CST do IBS/CBS, cClassTrib, base de cálculo, IBS estadual, IBS municipal e CBS, com o cClassTrib compatível com o CST.`}
              linhas={[
                { rotulo: 'Fora do período', valor: `emitidas antes de ${corte}, não contam` },
                { rotulo: 'Sem data', valor: 'XML sem data de emissão, não contam' },
                { rotulo: 'Imposto Seletivo', valor: 'informativo, não conta' },
              ]}
              origem="Os cartões ignoram o filtro Entrada/Saída, porque são a própria divisão, e respeitam CFOP e NCM."
            />
          }
        />
        {carregando && dados && (
          <span className="flex items-center gap-1 text-[11px] text-tinta-suave">
            <Loader2 size={12} className="animate-spin" /> atualizando…
          </span>
        )}
      </div>

      {erro && (
        <div className="mb-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {erro}
          {dados ? ' Mostrando o último resultado carregado.' : ''}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {cartoes.map(({ titulo, resumo }) => (
          <div
            key={titulo}
            className="rounded-xl border border-fundo-borda border-l-4 border-l-marca-azul bg-fundo-card p-5 shadow-lg shadow-black/20"
          >
            <p className="text-sm font-medium text-tinta-suave">{titulo}</p>
            {carregando && !dados ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-tinta-suave">
                <Loader2 size={14} className="animate-spin" /> Conferindo…
              </p>
            ) : resumo && resumo.total > 0 ? (
              <>
                <p className="mt-2 text-3xl font-bold text-tinta-forte">
                  {formatarPercentual(resumo.percentual, 1)}
                </p>
                <p className="mt-1 text-sm text-tinta-media">
                  {resumo.completas} completa{resumo.completas === 1 ? '' : 's'} de{' '}
                  {resumo.total} nota{resumo.total === 1 ? ' exigível' : 's exigíveis'}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-tinta-suave">
                {dados && !dados.temEmpresa
                  ? 'Empresa analisada não identificada.'
                  : 'Nenhuma nota exigível neste recorte.'}
              </p>
            )}
          </div>
        ))}
      </div>

      {semVinculo > 0 && (
        <p className="mt-2 text-[11px] text-tinta-suave">
          {semVinculo} nota{semVinculo === 1 ? '' : 's'} sem vínculo não entra
          {semVinculo === 1 ? '' : 'm'} nos cartões: a empresa analisada não é emitente nem
          destinatária.
        </p>
      )}
    </div>
  );
};

// ==================== Lista de notas ====================

type Filtro = 'todas' | Situacao;

const FILTROS: Array<[Filtro, string]> = [
  ['todas', 'Todas'],
  ['com pendência', 'Com pendência'],
  ['completa', 'Completas'],
  ['fora do período', 'Fora do período'],
  ['sem data', 'Sem data'],
];

const ESTILO_SITUACAO: Record<Situacao, string> = {
  completa: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'com pendência': 'bg-amber-50 text-amber-800 border-amber-200',
  'fora do período': 'bg-fundo-eleva text-tinta-suave border-fundo-borda',
  'sem data': 'bg-fundo-eleva text-tinta-suave border-fundo-borda',
};

export const CamposTributarios: React.FC<{ conferencia: EstadoConferencia }> = ({
  conferencia,
}) => {
  const { dados, carregando, erro } = conferencia;
  const notas = useMemo(() => dados?.notas ?? [], [dados]);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [aberta, setAberta] = useState<string | null>(null);

  const contagem = useMemo(() => {
    const c: Record<Filtro, number> = {
      todas: notas.length,
      completa: 0,
      'com pendência': 0,
      'fora do período': 0,
      'sem data': 0,
    };
    for (const n of notas) c[n.situacao]++;
    return c;
  }, [notas]);

  const visiveis = useMemo(
    () => (filtro === 'todas' ? notas : notas.filter(n => n.situacao === filtro)),
    [notas, filtro]
  );

  const corte = dados ? formatarDia(dados.dataDeCorte) : 'a data de corte';

  // Sem nada carregado, o erro ocupa o lugar da lista; com dados anteriores,
  // aparece acima deles.
  if (erro && !dados) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
        {erro}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-fundo-borda bg-fundo-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-tinta-forte">Conferência de tributos por nota</h3>
        <AjudaIcone
          largura={340}
          tamanho={14}
          conteudo={
            <MemoriaCalculo
              titulo="Conferência de tributos"
              descricao="Verifica se a nota traz os campos da reforma, se os campos de valor não vieram zerados e se o cClassTrib combina com o CST do IBS/CBS. Não verifica se o imposto está correto."
              linhas={[
                { rotulo: 'Completa', valor: 'seis campos presentes e sem zero, vínculo certo' },
                { rotulo: 'Com pendência', valor: 'campo ausente, zerado, parcial ou cClassTrib incompatível' },
                { rotulo: 'Zero aceito', valor: 'quando o CST não exige o grupo padrão (imunidade, não incidência)' },
                { rotulo: 'Fora do período', valor: `emitida antes de ${corte}` },
                { rotulo: 'Sem data', valor: 'XML sem data de emissão' },
              ]}
              origem={`Em NF-e e NFC-e, o campo precisa estar em todos os itens. Código fora da tabela carregada (${rotuloVersao(
                dados?.versaoTabela
              )}) gera só aviso.`}
            />
          }
        />
        <span className="text-[11px] text-tinta-suave">
          {notas.length} nota{notas.length === 1 ? '' : 's'} · clique para ver campo a campo
        </span>
        {carregando && dados && (
          <span className="flex items-center gap-1 text-[11px] text-tinta-suave">
            <Loader2 size={12} className="animate-spin" /> atualizando…
          </span>
        )}
      </div>

      {erro && (
        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {erro} Mostrando o último resultado carregado.
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTROS.map(([id, rotulo]) => (
          <button
            key={id}
            onClick={() => setFiltro(id)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              filtro === id
                ? 'bg-marca-azul font-medium text-white'
                : 'border border-fundo-borda text-tinta-media hover:border-marca-azul'
            }`}
          >
            {rotulo}{' '}
            <span className={filtro === id ? 'opacity-75' : 'text-tinta-suave'}>{contagem[id]}</span>
          </button>
        ))}
      </div>

      {carregando && !dados ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-tinta-suave">
          <Loader2 size={16} className="animate-spin" />
          Conferindo os campos…
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[22px_1fr_1.3fr_auto_auto_auto] gap-3 border-b border-fundo-borda pb-2 text-[11px] font-semibold text-tinta-forte">
              <span />
              <span>Nota</span>
              <span>Emitente</span>
              <span className="text-right">Emissão</span>
              <span className="text-right">Valor</span>
              <span className="text-right">Situação</span>
            </div>

            {visiveis.map(nota => {
              const expandida = aberta === nota.id;

              return (
                <div
                  key={nota.id}
                  className={`border-b border-fundo-borda ${expandida ? 'bg-fundo-eleva' : ''}`}
                >
                  <button
                    onClick={() => setAberta(expandida ? null : nota.id)}
                    className="grid w-full grid-cols-[22px_1fr_1.3fr_auto_auto_auto] items-center gap-3 py-2 text-left text-xs"
                  >
                    {expandida ? (
                      <ChevronDown size={14} className="text-marca-azul" />
                    ) : (
                      <ChevronRight size={14} className="text-tinta-suave" />
                    )}
                    <span className="truncate font-mono text-tinta-forte">{nota.numero}</span>
                    <span className="truncate text-tinta-media">{nota.emitente}</span>
                    <span className="text-right font-mono text-tinta-media">
                      {formatarDia(nota.diaEmissao)}
                    </span>
                    <span className="text-right font-mono text-tinta-media">
                      {formatarMoeda(nota.valor)}
                    </span>
                    <span
                      className={`justify-self-end rounded-full border px-2 py-0.5 text-[11px] ${
                        ESTILO_SITUACAO[nota.situacao]
                      }`}
                    >
                      {nota.situacao}
                    </span>
                  </button>

                  {/* Resumo, selos e pendências à vista, sem precisar expandir */}
                  {(nota.resumo || (nota.tipos ?? []).length > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 pb-1.5 pl-[34px] text-[11px]">
                      {(nota.tipos ?? []).map(t => (
                        <span
                          key={t}
                          title={seloDe(t).explica}
                          className={`rounded-full border px-2 py-0.5 font-semibold ${seloDe(t).estilo}`}
                        >
                          {seloDe(t).rotulo}
                        </span>
                      ))}
                      {nota.resumo && <span className="text-tinta-media">{nota.resumo}</span>}
                    </div>
                  )}
                  {(nota.pendencias.length > 0 || nota.avisos.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 pb-2 pl-[34px] text-[11px]">
                      {nota.pendencias.map(p => (
                        <span
                          key={p.texto}
                          title={
                            p.detalhe ??
                            [p.problema, ...(p.tambem ?? [])].map(t => seloDe(t).explica).join('; ')
                          }
                          className={`rounded border px-1.5 py-0.5 ${seloDe(p.problema).estilo}`}
                        >
                          {p.texto}
                          {p.detalhe ? ` · ${p.detalhe}` : ''}
                        </span>
                      ))}
                      {nota.avisos.map(a => (
                        <span
                          key={a}
                          className="flex items-center gap-1 rounded border border-fundo-borda bg-fundo-eleva px-1.5 py-0.5 text-tinta-suave"
                        >
                          <Info size={11} className="shrink-0" />
                          {a}
                        </span>
                      ))}
                    </div>
                  )}

                  {expandida && (
                    <div className="px-7 pb-4 pt-1">
                      {(nota.leiaute || nota.codigoServico) && (
                        <p className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-tinta-media">
                          {nota.leiaute && (
                            <span>
                              Leiaute: <span className="font-medium text-tinta-forte">{nota.leiaute}</span>
                            </span>
                          )}
                          {nota.codigoServico && (
                            <span>
                              Código do serviço:{' '}
                              <span className="font-mono text-tinta-forte">{nota.codigoServico}</span>
                              {nota.tipoCodigoServico && (
                                <span className="text-tinta-suave"> ({nota.tipoCodigoServico})</span>
                              )}
                            </span>
                          )}
                        </p>
                      )}
                      <div className="grid gap-5 lg:grid-cols-2">
                        <ListaDeCampos
                          titulo="Tributação atual (não entra no percentual)"
                          campos={nota.campos.filter(c => c.grupo === 'atual')}
                        />
                        <ListaDeCampos
                          titulo="Reforma · IBS, CBS e Seletivo"
                          campos={nota.campos.filter(c => c.grupo === 'reforma')}
                        />
                      </div>
                      <p className="mt-2 text-[10.5px] text-tinta-suave">
                        Alíquota, base e valor como estão no XML, sem conversão de escala.
                      </p>
                      {nota.informativos.length > 0 && (
                        <p className="mt-3 text-[11px] text-tinta-suave">
                          {nota.informativos.join(' · ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {visiveis.length === 0 && (
              <p className="py-8 text-center text-sm text-tinta-suave">
                Nenhuma nota neste filtro.
              </p>
            )}
          </div>
        </div>
      )}

      <p className="mt-3 border-t border-fundo-borda pt-3 text-[11px] leading-snug text-tinta-suave">
        Imposto Seletivo ausente não é pendência: só é exigido para itens sujeitos ao Seletivo.
        Tabela de cClassTrib carregada: {rotuloVersao(dados?.versaoTabela)}.
      </p>
    </div>
  );
};

/**
 * Tabela de campos de um grupo: situação de cada um e, para os tributos,
 * alíquota, base e valor como constam na nota.
 */
const ListaDeCampos: React.FC<{ titulo: string; campos: Campo[] }> = ({ titulo, campos }) => (
  <div>
    <div className="mb-1 grid grid-cols-[1fr_4.5rem_6rem_6rem] gap-2 border-b border-fundo-borda pb-1 text-[11px] font-semibold text-tinta-forte">
      <span>{titulo}</span>
      <span className="text-right">Alíquota</span>
      <span className="text-right">Base</span>
      <span className="text-right">Valor</span>
    </div>

    {campos.map(c => {
      const temNumeros =
        c.aliquota !== undefined || c.base !== undefined || c.valorNumerico !== undefined;

      return (
        <div
          key={c.campo}
          className="grid grid-cols-[1fr_4.5rem_6rem_6rem] items-baseline gap-2 py-0.5 text-[11.5px]"
        >
          <span
            className={`flex flex-wrap items-baseline gap-1.5 ${
              c.situacao === 'ausente' ? 'text-tinta-suave' : 'text-tinta-media'
            }`}
          >
            {c.situacao === 'preenchido' && (!c.zerado || c.zeroAceito) && (
              <Check size={13} className="shrink-0 translate-y-0.5 text-emerald-700" />
            )}
            {(c.situacao === 'parcial' || (c.zerado && !c.zeroAceito)) && (
              <AlertTriangle size={13} className="shrink-0 translate-y-0.5 text-amber-600" />
            )}
            {c.situacao === 'ausente' && (
              <Minus size={13} className="shrink-0 translate-y-0.5 text-tinta-suave" />
            )}
            {c.campo}
            {c.zeroAceito && (c.zerado || (c.itens?.zerados ?? 0) > 0) && (
              <span
                title="Zero esperado: CST sem grupo padrão ou IBS municipal em 2026"
                className="rounded-full border border-fundo-borda bg-fundo-eleva px-1.5 text-[10px] font-semibold text-tinta-suave"
              >
                zero aceito
              </span>
            )}
            {c.zerado && !c.zeroAceito && (
              <span
                className={`rounded-full border px-1.5 text-[10px] font-semibold ${SELO_PROBLEMA.zerado.estilo}`}
              >
                zerado
              </span>
            )}
            {c.situacao === 'parcial' && (
              <span className="text-[10.5px] text-amber-700">
                {c.itens?.com} de {c.itens?.total} itens
              </span>
            )}
            {!c.zerado && !c.zeroAceito && (c.itens?.zerados ?? 0) > 0 && (
              <span className="text-[10.5px] text-amber-700">
                zero em {c.itens?.zerados} de {c.itens?.com} itens
              </span>
            )}
          </span>

          {c.situacao === 'ausente' ? (
            <span className="col-span-3 text-right text-tinta-suave">não informado</span>
          ) : temNumeros ? (
            <>
              <span className="text-right font-mono text-tinta-forte">
                {formatarNumero(c.aliquota, 'aliquota')}
              </span>
              <span className="text-right font-mono text-tinta-forte">{formatarNumero(c.base)}</span>
              <span className="text-right font-mono text-tinta-forte">
                {formatarNumero(c.valorNumerico)}
              </span>
            </>
          ) : (
            <span className="col-span-3 text-right font-mono text-tinta-forte">
              {c.valor ?? (c.itens && c.itens.total > 1 ? 'varia por item' : 'informado')}
            </span>
          )}
        </div>
      );
    })}
  </div>
);
