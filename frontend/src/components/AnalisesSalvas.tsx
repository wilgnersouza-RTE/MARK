import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Archive, ChevronDown, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { API_URL } from '../utils/api';
import { formatarCNPJ, formatarInteiro } from '../utils/format';

/**
 * Análises salvas: cada importação fica guardada no servidor, numerada por
 * versão dentro de empresa + competência. Aqui o contador filtra por
 * empresa, abre uma análise (que passa a ser o lote do painel) ou a
 * reprocessa com as regras e a tabela atuais, o que gera a versão seguinte.
 */

export interface AnaliseResumo {
  id: string;
  empresaCnpj: string;
  empresaNome: string | null;
  competencia: string;
  versao: number;
  criadoPor: string;
  criadoEm: string;
  totalNotas: number;
  versaoTabela: string | null;
  nomeArquivo: string | null;
  reprocessadaDe: string | null;
  derivadaDe?: string | null;
}

interface EmpresaComAnalises {
  cnpj: string;
  nome: string | null;
  quantidade: number;
}

interface Uso {
  tipo: 'memoria' | 'supabase';
  analises: number;
  bytesZips: number;
  bytesBanco: number | null;
  limiteBytesZips: number | null;
  limiteBytesBanco: number | null;
}

/** Valor do filtro para as análises sem empresa definida. */
const SEM_EMPRESA = 'sem-empresa';

/** Análises por página (o backend devolve no máximo 100). */
const POR_PAGINA = 100;

/** Abrir lê todas as notas da análise; lotes grandes levam alguns minutos. */
const TEMPO_ABRIR_MS = 10 * 60 * 1000;

/**
 * Reprocessar baixa o ZIP (até 180 s), lê os XMLs e grava a versão nova
 * (ZIP até 180 s, mais as notas em lotes de 30 s cada). O navegador espera
 * mais que o backend; se ainda assim desistir, a lista é recarregada.
 */
const TEMPO_REPROCESSAR_MS = 30 * 60 * 1000;

/** "2026-03" vira "03/2026". */
export function rotuloCompetencia(competencia: string): string {
  const partes = competencia.match(/^(\d{4})-(\d{2})$/);
  return partes ? `${partes[2]}/${partes[1]}` : 'Sem competência';
}

function formatarBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} GB`;
}

function formatarMomento(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(data);
}

function textoUso(uso: Uso): string {
  if (uso.tipo === 'memoria') {
    return 'Armazenamento em memória: as análises somem quando o servidor reinicia.';
  }
  const partes = [`${formatarInteiro(uso.analises)} análise${uso.analises === 1 ? '' : 's'}`];
  if (uso.limiteBytesZips) {
    const pct = Math.round((uso.bytesZips / uso.limiteBytesZips) * 100);
    partes.push(`ZIPs: ${formatarBytes(uso.bytesZips)} de ${formatarBytes(uso.limiteBytesZips)} (${pct}%)`);
  }
  if (uso.bytesBanco !== null && uso.limiteBytesBanco) {
    const pct = Math.round((uso.bytesBanco / uso.limiteBytesBanco) * 100);
    partes.push(`banco: ${formatarBytes(uso.bytesBanco)} de ${formatarBytes(uso.limiteBytesBanco)} (${pct}%)`);
  }
  return `Espaço gratuito da Supabase · ${partes.join(' · ')}`;
}

const tempoEsgotado = (e: any) => e?.code === 'ECONNABORTED' || /timeout/i.test(String(e?.message ?? ''));

export const AnalisesSalvas: React.FC<{
  sessionId: string;
  token: string;
  /** Muda a cada importação ou troca de empresa: recarrega a lista */
  versaoLote: number;
  /** Análise aberta na sessão; a resposta tem o formato do upload */
  onAbrir: (importacao: any, erros: { nomeArquivo: string; erro: string }[]) => Promise<void> | void;
  /** Id da análise que está no painel agora */
  analiseAtualId?: string | null;
  /** O lote no painel não foi salvo: abrir pede confirmação antes */
  loteAtualNaoSalvo?: boolean;
}> = ({ sessionId, token, versaoLote, onAbrir, analiseAtualId, loteAtualNaoSalvo }) => {
  const [empresas, setEmpresas] = useState<EmpresaComAnalises[]>([]);
  const [empresa, setEmpresa] = useState('');
  const [analises, setAnalises] = useState<AnaliseResumo[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [uso, setUso] = useState<Uso | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  // Análise cuja abertura espera confirmação (o lote atual não foi salvo).
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [retraido, setRetraido] = useState(false);

  const cabecalhos = { Authorization: `Bearer ${token}`, 'x-session-id': sessionId };
  const filtroEmpresa = empresa ? { empresa } : {};

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);

    Promise.all([
      axios.get(`${API_URL}/api/v1/analises/empresas`, { headers: cabecalhos }),
      axios.get(`${API_URL}/api/v1/analises`, {
        headers: cabecalhos,
        params: { ...filtroEmpresa, offset: 0, limite: POR_PAGINA },
      }),
      axios.get(`${API_URL}/api/v1/analises/uso`, { headers: cabecalhos }).catch(() => null),
    ])
      .then(([emp, lista, usoRes]) => {
        if (!ativo) return;
        setEmpresas(emp.data.data ?? []);
        setAnalises(lista.data.data ?? []);
        setTemMais(!!lista.data.paginacao?.temMais);
        setUso(usoRes?.data?.data ?? null);
      })
      .catch(e => {
        if (!ativo) return;
        setAnalises([]);
        setTemMais(false);
        setErro(e.response?.data?.error || 'Não foi possível carregar as análises salvas.');
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [empresa, versaoLote, recarga, sessionId, token]);

  const carregarMais = async () => {
    setCarregandoMais(true);
    setErro(null);
    try {
      const resposta = await axios.get(`${API_URL}/api/v1/analises`, {
        headers: cabecalhos,
        params: { ...filtroEmpresa, offset: analises.length, limite: POR_PAGINA },
      });
      const novas: AnaliseResumo[] = resposta.data.data ?? [];
      // Uma análise criada no meio do caminho desloca a página: evita repetir.
      setAnalises(atuais => [...atuais, ...novas.filter(n => !atuais.some(a => a.id === n.id))]);
      setTemMais(!!resposta.data.paginacao?.temMais);
    } catch (e: any) {
      setErro(e.response?.data?.error || 'Não foi possível carregar mais análises.');
    } finally {
      setCarregandoMais(false);
    }
  };

  const abrir = async (analise: AnaliseResumo) => {
    setConfirmando(null);
    setOcupada(analise.id);
    setErro(null);
    setMensagem(null);
    try {
      const resposta = await axios.post(
        `${API_URL}/api/v1/analises/${analise.id}/abrir`,
        {},
        { headers: cabecalhos, timeout: TEMPO_ABRIR_MS }
      );
      await onAbrir(resposta.data?.data?.importacao, resposta.data?.data?.erros ?? []);
      setMensagem(
        `Análise aberta: ${analise.empresaNome ?? 'sem empresa'} · ${rotuloCompetencia(analise.competencia)} · versão ${analise.versao}.`
      );
    } catch (e: any) {
      setErro(e.response?.data?.error || 'Não foi possível abrir a análise.');
    } finally {
      setOcupada(null);
    }
  };

  const pedirAbertura = (analise: AnaliseResumo) => {
    if (loteAtualNaoSalvo) {
      setConfirmando(analise.id);
      return;
    }
    abrir(analise);
  };

  const reprocessar = async (analise: AnaliseResumo) => {
    setConfirmando(null);
    setOcupada(analise.id);
    setErro(null);
    setMensagem(null);
    try {
      const resposta = await axios.post(
        `${API_URL}/api/v1/analises/${analise.id}/reprocessar`,
        {},
        { headers: cabecalhos, timeout: TEMPO_REPROCESSAR_MS }
      );
      const nova: AnaliseResumo | undefined = resposta.data?.data?.analise;
      setMensagem(
        nova
          ? `Reprocessada com as regras atuais: versão ${nova.versao} de ${rotuloCompetencia(nova.competencia)} criada. ` +
              'Clique em Abrir para levá-la ao painel.'
          : 'Reprocessamento concluído. A lista foi recarregada; clique em Abrir na versão nova para levá-la ao painel.'
      );
      setRecarga(r => r + 1);
    } catch (e: any) {
      if (tempoEsgotado(e)) {
        // O servidor pode ter terminado depois que o navegador desistiu.
        setMensagem(
          'O reprocessamento está demorando. A lista foi recarregada: se a versão nova ainda não aparecer, ' +
            'aguarde alguns minutos e recarregue de novo antes de tentar outra vez.'
        );
        setRecarga(r => r + 1);
      } else {
        setErro(e.response?.data?.error || 'Não foi possível reprocessar a análise.');
      }
    } finally {
      setOcupada(null);
    }
  };

  return (
    <div className="rounded-xl border border-fundo-borda bg-fundo-card p-5 shadow-lg shadow-black/5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-marca-azul/10 text-marca-azul">
            <Archive size={18} />
          </span>
          <div>
            <p className="font-semibold text-tinta-forte">Análises salvas</p>
            <p className="text-xs text-tinta-suave">
              Cada importação fica guardada por empresa, competência e versão
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRetraido(r => !r)}
          aria-expanded={!retraido}
          className="flex items-center gap-1.5 rounded-lg border border-fundo-borda px-3 py-2 text-sm font-medium text-tinta-media transition hover:border-marca-azul hover:text-marca-azul"
        >
          <ChevronDown size={15} className={retraido ? '' : 'rotate-180'} />
          {retraido ? 'Expandir' : 'Retrair'}
        </button>
      </div>

      {!retraido && (
        <>
          <div className="mt-5 max-w-md">
            <label
              htmlFor="filtro-empresa"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-tinta-suave"
            >
              Empresa
            </label>
            <div className="relative">
              <select
                id="filtro-empresa"
                value={empresa}
                onChange={e => setEmpresa(e.target.value)}
                className="w-full appearance-none rounded-lg border border-fundo-borda bg-fundo-card py-2.5 pl-3 pr-9 text-sm text-tinta-forte transition hover:border-marca-azul focus:border-marca-azul focus:outline-none focus:ring-2 focus:ring-marca-azul/20"
              >
                <option value="">Todas as empresas</option>
                {empresas.map(e => (
                  <option key={e.cnpj || SEM_EMPRESA} value={e.cnpj || SEM_EMPRESA}>
                    {e.cnpj
                      ? `${e.nome ?? 'Nome não informado'} (${formatarCNPJ(e.cnpj)})`
                      : 'Sem empresa definida'}{' '}
                    · {e.quantidade}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-tinta-suave"
              />
            </div>
          </div>

          {erro && <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
          {mensagem && (
            <p className="mt-4 rounded-lg border border-marca-azul/40 bg-marca-azul/5 px-3 py-2 text-sm text-tinta-media">
              {mensagem}
            </p>
          )}

          <div className="mt-4 max-h-96 overflow-y-auto">
            {carregando && analises.length === 0 ? (
              <p className="flex items-center gap-2 py-4 text-sm text-tinta-suave">
                <Loader2 size={15} className="animate-spin" /> Carregando análises...
              </p>
            ) : analises.length === 0 ? (
              <p className="py-4 text-sm text-tinta-suave">
                {erro ? '' : 'Nenhuma análise salva ainda. Importe um ZIP para criar a primeira.'}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-fundo-borda">
                  {analises.map(a => {
                    const atual = a.id === analiseAtualId;
                    return (
                      <li key={a.id} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0 text-sm">
                            <p className="font-semibold text-tinta-forte">
                              {rotuloCompetencia(a.competencia)} · versão {a.versao}
                              {atual && (
                                <span className="ml-2 rounded-full bg-marca-azul/10 px-2 py-0.5 text-[11px] font-semibold text-marca-azul">
                                  no painel
                                </span>
                              )}
                            </p>
                            <p className="truncate text-xs text-tinta-media">
                              {a.empresaCnpj
                                ? `${a.empresaNome ?? 'Nome não informado'} (${formatarCNPJ(a.empresaCnpj)})`
                                : 'Sem empresa definida'}
                            </p>
                            <p className="text-xs text-tinta-suave">
                              {formatarMomento(a.criadoEm)} · {a.criadoPor} · {formatarInteiro(a.totalNotas)} nota
                              {a.totalNotas === 1 ? '' : 's'}
                              {a.reprocessadaDe ? ' · reprocessada' : ''}
                              {a.derivadaDe ? ' · empresa trocada' : ''}
                              {a.versaoTabela ? ` · tabela v${a.versaoTabela}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => pedirAbertura(a)}
                              disabled={ocupada !== null}
                              className="flex items-center gap-1.5 rounded-lg bg-marca-azul px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                            >
                              {ocupada === a.id ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                              Abrir
                            </button>
                            <button
                              type="button"
                              onClick={() => reprocessar(a)}
                              disabled={ocupada !== null}
                              title="Lê de novo o ZIP guardado com as regras e a tabela atuais e cria a versão seguinte"
                              className="flex items-center gap-1.5 rounded-lg border border-marca-azul/40 px-3 py-1.5 text-xs font-semibold text-marca-azul transition hover:bg-marca-azul/10 disabled:opacity-50"
                            >
                              <RefreshCw size={14} />
                              Reprocessar
                            </button>
                          </div>
                        </div>

                        {confirmando === a.id && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span className="min-w-0 flex-1">
                              O lote que está no painel não foi salvo. Abrir esta análise o descarta, e para
                              recuperá-lo será preciso importar o ZIP de novo.
                            </span>
                            <button
                              type="button"
                              onClick={() => abrir(a)}
                              className="rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white transition hover:opacity-90"
                            >
                              Abrir mesmo assim
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmando(null)}
                              className="rounded-md border border-amber-500 px-2.5 py-1 font-semibold transition hover:bg-amber-100"
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {temMais && (
                  <button
                    type="button"
                    onClick={carregarMais}
                    disabled={carregandoMais}
                    className="mt-2 flex items-center gap-1.5 rounded-lg border border-fundo-borda px-3 py-1.5 text-xs font-semibold text-tinta-media transition hover:border-marca-azul hover:text-marca-azul disabled:opacity-50"
                  >
                    {carregandoMais && <Loader2 size={14} className="animate-spin" />}
                    Carregar mais
                  </button>
                )}
              </>
            )}
          </div>

          {uso && <p className="mt-3 text-[11px] text-tinta-suave">{textoUso(uso)}</p>}
        </>
      )}
    </div>
  );
};
