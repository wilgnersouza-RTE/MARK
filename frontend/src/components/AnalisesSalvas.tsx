import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Archive, ChevronDown, Download, FolderOpen, Loader2, RefreshCw, Trash2 } from 'lucide-react';
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
  zipBytes?: number;
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

/** Ids por pedido de exclusão (limite do backend). */
const MAXIMO_POR_EXCLUSAO = 100;

/** Cada exclusão faz algumas chamadas à Supabase; um lote de 100 leva um tempo. */
const TEMPO_EXCLUIR_MS = 10 * 60 * 1000;

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
  return partes.join(' · ');
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
  /** Análises excluídas: a tela avisa se a que está no painel saiu */
  onExcluidas?: (ids: string[]) => void;
}> = ({ sessionId, token, versaoLote, onAbrir, analiseAtualId, loteAtualNaoSalvo, onExcluidas }) => {
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
  // Ids marcados nas caixas de seleção.
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  // Análises cuja exclusão espera "Excluir definitivamente".
  const [aExcluir, setAExcluir] = useState<AnaliseResumo[] | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  // Análise cujo ZIP está sendo baixado.
  const [baixando, setBaixando] = useState<string | null>(null);
  const quadroExclusao = useRef<HTMLDivElement>(null);
  const caixaTodas = useRef<HTMLInputElement>(null);

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
        const novas: AnaliseResumo[] = lista.data.data ?? [];
        setAnalises(novas);
        // A seleção só vale para o que continua na lista.
        setSelecionadas(atuais => new Set(novas.filter(a => atuais.has(a.id)).map(a => a.id)));
        // O quadro de confirmação não lista o que já saiu da lista.
        setAExcluir(atuais => {
          if (!atuais) return atuais;
          const restantes = atuais.filter(a => novas.some(n => n.id === a.id));
          return restantes.length > 0 ? restantes : null;
        });
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
      // O reprocessamento não pula duplicadas: as puladas na importação voltam.
      const avisoDuplicadas: string | undefined = resposta.data?.data?.avisoReprocessamento;
      setMensagem(
        (nova
          ? `Reprocessada com as regras atuais: versão ${nova.versao} de ${rotuloCompetencia(nova.competencia)} criada. ` +
            'Clique em Abrir para levá-la ao painel.'
          : 'Reprocessamento concluído. A lista foi recarregada; clique em Abrir na versão nova para levá-la ao painel.') +
          (avisoDuplicadas ? ` ${avisoDuplicadas}` : '')
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

  const alternarSelecao = (id: string) => {
    setSelecionadas(atuais => {
      const novas = new Set(atuais);
      if (novas.has(id)) novas.delete(id);
      else novas.add(id);
      return novas;
    });
  };

  const quantasSelecionadas = analises.filter(a => selecionadas.has(a.id)).length;
  const todasSelecionadas = analises.length > 0 && quantasSelecionadas === analises.length;
  const algumasSelecionadas = quantasSelecionadas > 0 && !todasSelecionadas;

  useEffect(() => {
    if (caixaTodas.current) caixaTodas.current.indeterminate = algumasSelecionadas;
  }, [algumasSelecionadas]);

  const alternarTodas = () => {
    setSelecionadas(todasSelecionadas ? new Set() : new Set(analises.map(a => a.id)));
  };

  // O quadro de confirmação aparece fora da lista rolável: leva o foco e a
  // tela até ele, para não ficar escondido.
  const abertoParaExcluir = aExcluir !== null;
  useEffect(() => {
    if (!abertoParaExcluir || !quadroExclusao.current) return;
    quadroExclusao.current.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    quadroExclusao.current.focus();
  }, [abertoParaExcluir]);

  /** Só abre o quadro de confirmação; nada é apagado aqui. */
  const pedirExclusao = (lista: AnaliseResumo[]) => {
    if (lista.length === 0 || ocupada !== null || excluindo) return;
    setConfirmando(null);
    setErro(null);
    setMensagem(null);
    setAExcluir(lista);
  };

  /** Baixa o ZIP guardado, para o usuário ficar com uma cópia antes de excluir. */
  const baixarZip = async (analise: AnaliseResumo) => {
    setBaixando(analise.id);
    setErro(null);
    try {
      const resposta = await axios.get(`${API_URL}/api/v1/analises/${analise.id}/zip`, {
        headers: cabecalhos,
        responseType: 'blob',
        timeout: TEMPO_ABRIR_MS,
      });
      const disposicao = String(resposta.headers['content-disposition'] ?? '');
      const utf8 = disposicao.match(/filename\*=UTF-8''([^;]+)/i);
      const simples = disposicao.match(/filename="([^"]+)"/i);
      const nome = utf8
        ? decodeURIComponent(utf8[1])
        : simples?.[1] ?? `analise-${analise.competencia}-v${analise.versao}.zip`;

      const url = window.URL.createObjectURL(new Blob([resposta.data], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', nome);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      // Com responseType 'blob', o corpo de erro também chega como Blob.
      let mensagemErro = 'Não foi possível baixar o ZIP da análise.';
      try {
        const texto = await e.response?.data?.text?.();
        const corpo = texto ? JSON.parse(texto) : null;
        if (corpo?.error) mensagemErro = corpo.error;
      } catch {
        // corpo ilegível: fica a mensagem genérica
      }
      setErro(mensagemErro);
    } finally {
      setBaixando(null);
    }
  };

  /** Chamado só por "Excluir definitivamente". */
  const excluir = async () => {
    if (!aExcluir || ocupada !== null) return;
    const ids = aExcluir.map(a => a.id);
    setExcluindo(true);
    setErro(null);
    setMensagem(null);

    const excluidas: string[] = [];
    const naoEncontradas: string[] = [];
    const avisos: string[] = [];
    let bytesLiberados = 0;
    let falha: string | null = null;
    let incerto = false;

    // O servidor aceita até 100 ids por pedido.
    for (let inicio = 0; inicio < ids.length && !falha; inicio += MAXIMO_POR_EXCLUSAO) {
      try {
        const resposta = await axios.post(
          `${API_URL}/api/v1/analises/excluir`,
          { ids: ids.slice(inicio, inicio + MAXIMO_POR_EXCLUSAO) },
          { headers: cabecalhos, timeout: TEMPO_EXCLUIR_MS }
        );
        const dados = resposta.data?.data ?? {};
        excluidas.push(...(dados.excluidas ?? []));
        naoEncontradas.push(...(dados.naoEncontradas ?? []));
        avisos.push(...(dados.avisos ?? []));
        bytesLiberados += dados.bytesLiberados ?? 0;
      } catch (e: any) {
        if (!e.response) {
          // Sem resposta (tempo esgotado ou rede): o servidor pode ter excluído.
          incerto = true;
          falha =
            'Sem resposta do servidor: não dá para saber se as análises foram excluídas. ' +
            'A lista foi recarregada; confira o que ainda aparece antes de tentar de novo.';
          break;
        }
        const dados = e.response.data?.data;
        excluidas.push(...(dados?.excluidas ?? []));
        naoEncontradas.push(...(dados?.naoEncontradas ?? []));
        avisos.push(...(dados?.avisos ?? []));
        bytesLiberados += dados?.bytesLiberados ?? 0;
        falha = e.response.data?.error || 'Não foi possível excluir as análises.';
      }
    }

    const sairam = new Set([...excluidas, ...naoEncontradas]);
    setAnalises(atuais => atuais.filter(a => !sairam.has(a.id)));
    setSelecionadas(atuais => new Set(Array.from(atuais).filter(id => !sairam.has(id))));
    setAExcluir(null);
    setExcluindo(false);
    // Sem resposta, avisa por todas as pedidas: a do painel pode ter saído.
    const possivelmenteExcluidas = incerto ? ids.filter(id => !naoEncontradas.includes(id)) : excluidas;
    if (possivelmenteExcluidas.length > 0) onExcluidas?.(possivelmenteExcluidas);

    if (falha) setErro(falha);
    const partes: string[] = [];
    if (excluidas.length > 0) {
      partes.push(
        `${formatarInteiro(excluidas.length)} análise${excluidas.length === 1 ? ' excluída' : 's excluídas'}.`
      );
      partes.push(
        bytesLiberados > 0
          ? `${formatarBytes(bytesLiberados)} de ZIP liberado${excluidas.length === 1 ? '' : 's'}.`
          : `Nenhum ZIP foi apagado agora: ${excluidas.length === 1 ? 'o ZIP já não existia' : 'os ZIPs já não existiam'} ou não ${excluidas.length === 1 ? 'pôde' : 'puderam'} ser apagado${excluidas.length === 1 ? '' : 's'}.`
      );
    }
    if (naoEncontradas.length > 0) {
      partes.push(`${formatarInteiro(naoEncontradas.length)} já não existia${naoEncontradas.length === 1 ? '' : 'm'}.`);
    }
    partes.push(...avisos);
    if (partes.length > 0) setMensagem(partes.join(' '));
    // Empresas e uso do espaço mudam com a exclusão.
    setRecarga(r => r + 1);
  };

  const bytesAExcluir = (aExcluir ?? []).reduce((total, a) => total + (a.zipBytes ?? 0), 0);

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

          {aExcluir && (
            <div
              ref={quadroExclusao}
              role="alertdialog"
              aria-modal="false"
              aria-labelledby="titulo-exclusao"
              tabIndex={-1}
              onKeyDown={e => {
                if (e.key === 'Escape' && !excluindo) {
                  e.stopPropagation();
                  setAExcluir(null);
                }
              }}
              className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <p id="titulo-exclusao" className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} className="shrink-0" />
                {aExcluir.length === 1
                  ? 'Esta análise será excluída, com as notas e o ZIP guardado:'
                  : `Estas ${formatarInteiro(aExcluir.length)} análises serão excluídas, com as notas e os ZIPs guardados:`}
              </p>
              <ul className="mt-2 max-h-40 list-none overflow-y-auto pl-6 text-xs">
                {aExcluir.map(a => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-0.5">
                    <span>
                      {a.empresaCnpj
                        ? `${a.empresaNome ?? 'Nome não informado'} (${formatarCNPJ(a.empresaCnpj)})`
                        : 'Sem empresa definida'}{' '}
                      · {rotuloCompetencia(a.competencia)} · versão {a.versao} · {formatarInteiro(a.totalNotas)} nota
                      {a.totalNotas === 1 ? '' : 's'}
                    </span>
                    {aExcluir.length === 1 && (
                      <button
                        type="button"
                        onClick={() => baixarZip(a)}
                        disabled={baixando !== null || excluindo}
                        className="flex items-center gap-1 rounded-md border border-red-400 px-2 py-0.5 font-semibold transition hover:bg-red-100 disabled:opacity-50"
                      >
                        {baixando === a.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        Baixar ZIP
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                Total: {formatarInteiro(aExcluir.length)} análise{aExcluir.length === 1 ? '' : 's'} · espaço liberado
                (ZIPs): {formatarBytes(bytesAExcluir)}
              </p>
              <p className="mt-2 text-xs">
                {aExcluir.length === 1
                  ? 'Para guardar uma cópia, baixe o ZIP antes de excluir.'
                  : 'Para guardar cópias, cancele e baixe antes os ZIPs que quiser manter, pelo botão "Baixar ZIP" de cada análise na lista.'}
              </p>
              <p className="mt-2 font-semibold">Confirma esta ação? Ela pode ser irreversível.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={excluir}
                  disabled={excluindo || ocupada !== null || baixando !== null}
                  className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {excluindo ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Excluir definitivamente
                </button>
                <button
                  type="button"
                  onClick={() => setAExcluir(null)}
                  disabled={excluindo}
                  className="rounded-md border border-red-400 px-3 py-1.5 text-xs font-semibold transition hover:bg-red-100 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {analises.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <label className="flex cursor-pointer items-center gap-2 text-tinta-media">
                <input
                  ref={caixaTodas}
                  type="checkbox"
                  checked={todasSelecionadas}
                  onChange={alternarTodas}
                  disabled={excluindo}
                  className="h-4 w-4 accent-marca-azul"
                />
                Selecionar todas as carregadas
              </label>
              <button
                type="button"
                onClick={() => pedirExclusao(analises.filter(a => selecionadas.has(a.id)))}
                disabled={quantasSelecionadas === 0 || ocupada !== null || excluindo}
                className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={14} />
                Excluir selecionadas ({formatarInteiro(quantasSelecionadas)})
              </button>
            </div>
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
                          <div className="flex min-w-0 items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selecionadas.has(a.id)}
                            onChange={() => alternarSelecao(a.id)}
                            disabled={excluindo}
                            aria-label={`Selecionar ${rotuloCompetencia(a.competencia)} versão ${a.versao}`}
                            className="mt-1 h-4 w-4 shrink-0 accent-marca-azul"
                          />
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
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => pedirAbertura(a)}
                              disabled={ocupada !== null || excluindo || aExcluir !== null}
                              className="flex items-center gap-1.5 rounded-lg bg-marca-azul px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                            >
                              {ocupada === a.id ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                              Abrir
                            </button>
                            <button
                              type="button"
                              onClick={() => reprocessar(a)}
                              disabled={ocupada !== null || excluindo || aExcluir !== null}
                              title="Lê de novo o ZIP guardado com as regras e a tabela atuais e cria a versão seguinte"
                              className="flex items-center gap-1.5 rounded-lg border border-marca-azul/40 px-3 py-1.5 text-xs font-semibold text-marca-azul transition hover:bg-marca-azul/10 disabled:opacity-50"
                            >
                              <RefreshCw size={14} />
                              Reprocessar
                            </button>
                            <button
                              type="button"
                              onClick={() => baixarZip(a)}
                              disabled={baixando !== null || excluindo}
                              title="Baixa o ZIP original guardado, para ter uma cópia"
                              className="flex items-center gap-1.5 rounded-lg border border-fundo-borda px-3 py-1.5 text-xs font-semibold text-tinta-media transition hover:border-marca-azul hover:text-marca-azul disabled:opacity-50"
                            >
                              {baixando === a.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                              Baixar ZIP
                            </button>
                            <button
                              type="button"
                              onClick={() => pedirExclusao([a])}
                              disabled={ocupada !== null || excluindo}
                              title="Exclui a análise, as notas e o ZIP guardado (pede confirmação)"
                              className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                              Excluir
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
                    disabled={carregandoMais || excluindo}
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
