import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  Upload, LogOut, FileText, TrendingUp, AlertTriangle,
  CheckCircle, XCircle, Calendar, Building2, DollarSign, Shield,
  ChevronDown, Users, ArrowLeft, FileSpreadsheet
} from 'lucide-react';

import { MarcaRTE } from './components/Marca';
import { Tooltip as DicaHover, AjudaIcone, MemoriaCalculo } from './components/Tooltip';
import {
  CamposTributarios,
  CartoesReforma,
  useConferenciaReforma,
} from './components/CamposTributarios';
import { AbaAdministracao } from './components/AbaAdministracao';
import { TelaLogin } from './components/TelaLogin';
import { PainelExecutivo } from './components/PainelExecutivo';
import { AnalisesSalvas, rotuloCompetencia } from './components/AnalisesSalvas';
import { API_URL } from './utils/api';
import {
  FiltrosAnalise,
  paraParametros,
  type EstadoFiltros,
  type OpcoesFiltros,
} from './components/FiltrosAnalise';
import {
  formatarMoeda, formatarMoedaCompacta, formatarInteiro,
  formatarPercentual, formatarCNPJ,
} from './utils/format';
import { type ArquivoRejeitado } from './utils/modelos';


// ==================== TIPOS ====================

/** Candidato a empresa analisada, como o backend devolve no upload. */
interface CandidatoEmpresa {
  cnpj: string;
  nome: string;
  quantidadeNotas: number;
}

/** Resumo do lote vigente, devolvido por /upload/nfe e /upload/empresa. */
interface ResumoLote {
  documentosImportados?: number;
  totalDocumentosSessao?: number;
  porModelo: { modelo: string; rotulo: string; quantidade: number }[];
  porSentido: { entrada: number; saida: number; indefinido: number };
  empresa: { cnpj: string; nome: string; inferida: boolean } | null;
  candidatosEmpresa: CandidatoEmpresa[];
  precisaEscolherEmpresa: boolean;
  /** Análise salva do lote, quando o armazenamento respondeu */
  analise?: {
    id: string;
    empresaNome: string | null;
    competencia: string;
    versao: number;
  } | null;
  /** false quando a análise não pôde ser salva (ou a troca não foi gravada) */
  analiseSalva?: boolean;
  /** Orientação para a tela quando a análise não foi salva */
  avisoAnalise?: string;
}


interface ResumoGeral {
  totalDocumentos: number;
  totalValor: number;
  totalTributos: number;
  totalICMS: number;
  totalICMSST: number;
  totalIPI: number;
  totalISS: number;
  totalPIS: number;
  totalCOFINS: number;
  totalIRRF: number;
  totalRetidoTomador: number;
  totalDoPrestador: number;
}

interface RegimeDados {
  regime: string;
  quantidade: number;
  quantidadeFornecedores: number;
  valor: number;
  tributos: number;
  distribuidorPorTributo: {
    icms: number;
    iss: number;
    pis: number;
    cofins: number;
    irrf: number;
  };
}

// ==================== STORE ====================

interface AppState {
  token: string | null;
  sessionId: string | null;
  user: {
    userId: string;
    email: string;
    nome?: string;
    papel?: 'administrador' | 'usuario';
    /** Presente quando um administrador assumiu esta conta */
    assumidoPor?: { userId: string; email: string };
  } | null;
  isLoading: boolean;
  error: string | null;
}

const useAppStore = () => {
  const [state, setState] = useState<AppState>({
    token: localStorage.getItem('token'),
    sessionId: localStorage.getItem('sessionId'),
    user: localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null,
    isLoading: false,
    error: null,
  });

  const setToken = (token: string | null) => {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
    setState(s => ({ ...s, token }));
  };

  const setSessionId = (sessionId: string | null) => {
    if (sessionId) {
      localStorage.setItem('sessionId', sessionId);
    } else {
      localStorage.removeItem('sessionId');
    }
    setState(s => ({ ...s, sessionId }));
  };

  const setUser = (user: typeof state.user) => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
    setState(s => ({ ...s, user }));
  };

  const logout = () => {
    setToken(null);
    setSessionId(null);
    setUser(null);
  };

  return { state, setToken, setSessionId, setUser, logout };
};

// ==================== COMPONENTES ====================

// Header
const Header: React.FC<{
  user: any;
  onLogout: () => void;
  /** Navegação para as páginas fora do painel (administração). */
  onIrPara: (pagina: 'admin') => void;
}> = ({ user, onLogout, onIrPara }) => {
  const [menuAberto, setMenuAberto] = useState(false);

  // Clique fora fecha o menu
  useEffect(() => {
    if (!menuAberto) return;
    const fechar = () => setMenuAberto(false);
    document.addEventListener('click', fechar);
    return () => document.removeEventListener('click', fechar);
  }, [menuAberto]);

  const iniciais = (user?.nome || user?.email || '?')
    .split(' ')
    .map((p: string) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const ehAdmin = user?.papel === 'administrador';

  return (
    <header className="border-b border-fundo-borda bg-fundo-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-marca-azul text-white">
            <FileText size={17} />
          </span>
          <MarcaRTE tamanho={20} />
        </div>

        <div className="flex items-center gap-3">
          {user?.assumidoPor && (
            <span className="hidden items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 md:flex">
              <Shield size={13} />
              Sessão assumida por {user.assumidoPor.email}
            </span>
          )}

          {/*
            Todo o acesso a áreas fora do painel passa por aqui. Antes a
            administração era uma aba ao lado das abas de análise, o que
            misturava análise com gestão de contas.
          */}
          <div className="relative">
            <button
              onClick={e => {
                e.stopPropagation();
                setMenuAberto(v => !v);
              }}
              className="flex items-center gap-2 rounded-xl border border-fundo-borda px-2.5 py-1.5 transition hover:border-marca-azul"
              aria-haspopup="menu"
              aria-expanded={menuAberto}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-marca-azul text-[10px] font-bold text-white">
                {iniciais}
              </span>
              <span className="hidden text-sm font-medium text-tinta-forte sm:block">
                {user?.nome || user?.email}
              </span>
              <ChevronDown size={14} className="text-tinta-suave" />
            </button>

            {menuAberto && (
              <div
                onClick={e => e.stopPropagation()}
                role="menu"
                className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-xl border border-fundo-borda bg-fundo-card shadow-xl"
              >
                <div className="flex items-center gap-2.5 bg-marca-azul/5 p-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-marca-azul text-xs font-bold text-white">
                    {iniciais}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-tinta-forte">
                      {user?.nome || user?.email}
                    </p>
                    <p className="truncate text-[11px] text-tinta-suave">{user?.email}</p>
                    {ehAdmin && (
                      <span className="mt-1 inline-block rounded bg-marca-azul/10 px-1.5 py-px text-[10px] font-semibold text-rotulo">
                        ADMINISTRADOR
                      </span>
                    )}
                  </div>
                </div>

                <div className="border-t border-fundo-borda">
                  {ehAdmin && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuAberto(false);
                        onIrPara('admin');
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-tinta-forte transition hover:bg-fundo-eleva"
                    >
                      <Users size={16} className="text-tinta-suave" />
                      Usuários
                    </button>
                  )}
                  <button
                    role="menuitem"
                    onClick={onLogout}
                    className="flex w-full items-center gap-2.5 border-t border-fundo-borda px-3.5 py-2.5 text-sm text-red-600 transition hover:bg-red-50"
                  >
                    <LogOut size={16} />
                    Sair
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

const Banner: React.FC = () => (
  <div
    className="relative h-56 overflow-hidden border-b border-fundo-borda bg-cover bg-center md:h-72"
    style={{ backgroundImage: "url('/banner.jpg')" }}
  >
    <div className="absolute inset-0 bg-fundo-card" />

    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
      <MarcaRTE tamanho={52} />
      <p className="mt-3 max-w-xl text-sm text-tinta-forte md:text-base">
        Validador da Reforma Tributária do Consumo — NF-e / NFC-e
      </p>
    </div>
  </div>
);

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`rounded-xl border border-fundo-borda bg-fundo-card p-6 shadow-lg shadow-black/20 ${className}`}>{children}</div>
);

// StatCard Component
// O ícone é a área de hover: passar o mouse sobre ele abre a memória de cálculo.
const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  memoria?: React.ReactNode;
  complemento?: React.ReactNode;
}> = ({ icon, label, value, color, memoria, complemento }) => (
  <Card className={`border-l-4 ${color}`}>
    <div className="flex items-start justify-between">
      <div className="min-w-0">
        <p className="text-tinta-suave text-sm font-medium">{label}</p>
        <p className="text-2xl font-bold text-tinta-forte mt-2 break-words">{value}</p>
        {complemento && <div className="mt-2">{complemento}</div>}
      </div>

      {memoria ? (
        <DicaHover conteudo={memoria} largura={340}>
          <span className="relative rounded-lg border border-fundo-borda p-2 text-tinta-suave transition-colors hover:border-blue-400 hover:text-marca-azul">
            {icon}
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-marca-azul text-[10px] font-bold text-white">
              ?
            </span>
          </span>
        </DicaHover>
      ) : (
        <div className="text-tinta-suave">{icon}</div>
      )}
    </div>
  </Card>
);

/**
 * Teto do upload e da troca de empresa. O backend espera até 180 s pelo ZIP
 * na Supabase e 30 s por requisição de notas (em lotes de 200); o navegador
 * precisa esperar mais que isso, senão desiste de uma gravação em andamento.
 */
const TEMPO_GRAVACAO_MS = 20 * 60 * 1000;

// Upload Section
const UploadSection: React.FC<{
  sessionId: string;
  token: string;
  onUploadSuccess: () => Promise<void>;
  /** Lote de uma análise salva aberta, mostrado como se fosse o upload */
  loteInicial?: ResumoLote | null;
  rejeitadosIniciais?: ArquivoRejeitado[];
  /** Avisa qual análise salva está no painel e se o lote ficou sem salvar */
  onLoteMudou?: (info: { analiseId: string | null; naoSalvo: boolean }) => void;
}> = ({ sessionId, token, onUploadSuccess, loteInicial = null, rejeitadosIniciais = [], onLoteMudou }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Arquivos do ZIP que não puderam ser lidos, com o motivo.
  const [rejeitados, setRejeitados] = useState<ArquivoRejeitado[]>(rejeitadosIniciais);
  const [baixandoErros, setBaixandoErros] = useState(false);
  // Quantos documentos da importação anterior foram descartados.
  const [substituidos, setSubstituidos] = useState(0);
  // Resumo do lote vigente: modelos, sentidos e empresa analisada.
  const [lote, setLote] = useState<ResumoLote | null>(loteInicial);
  // Aviso de que a análise não foi salva (upload ou troca de empresa).
  const [avisoAnalise, setAvisoAnalise] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  // Lista de CNPJs aberta pelo botão "Alterar".
  const [alterandoEmpresa, setAlterandoEmpresa] = useState(false);
  const [salvandoEmpresa, setSalvandoEmpresa] = useState(false);
  const [erroEmpresa, setErroEmpresa] = useState<string | null>(null);

  /**
   * Troca a empresa analisada. O servidor reclassifica as notas já
   * importadas; não há novo upload.
   */
  const escolherEmpresa = async (cnpj: string) => {
    setSalvandoEmpresa(true);
    setErroEmpresa(null);
    try {
      const resposta = await axios.post(
        `${API_URL}/api/v1/upload/empresa`,
        { cnpj },
        {
          headers: { Authorization: `Bearer ${token}`, 'x-session-id': sessionId },
          // A troca pode gravar uma versão nova, com o ZIP: mesmo teto do upload.
          timeout: TEMPO_GRAVACAO_MS,
        }
      );
      const atualizado = resposta.data?.data?.importacao;
      if (atualizado) {
        const { analise, analiseSalva, avisoAnalise: aviso, ...resto } = atualizado;
        if (analiseSalva) {
          setLote(atual => ({ ...(atual ?? {}), ...resto, analise, analiseSalva: true }));
          setAvisoAnalise(aviso ?? null);
        } else {
          // Não gravou: some a linha "Salva em" e o aviso continua na tela
          // (o novo, se veio; senão o do upload).
          setLote(atual => ({ ...(atual ?? {}), ...resto, analise: null, analiseSalva: false }));
          setAvisoAnalise(anterior => aviso ?? anterior);
        }
        onLoteMudou?.({ analiseId: analiseSalva ? analise?.id ?? null : null, naoSalvo: !analiseSalva });
      }
      setAlterandoEmpresa(false);
      await onUploadSuccess();
    } catch (error: any) {
      setErroEmpresa(error.response?.data?.error || 'Não foi possível trocar a empresa analisada.');
    } finally {
      setSalvandoEmpresa(false);
    }
  };

  /**
   * Baixa a planilha com todos os arquivos recusados.
   *
   * A lista é reenviada ao servidor porque, quando a importação falha por
   * inteiro, nada foi gravado na sessão — e é aí que a planilha serve.
   */
  const exportarErros = async () => {
    setBaixandoErros(true);
    try {
      const resposta = await axios.post(
        `${API_URL}/api/v1/export/erros-importacao`,
        { erros: rejeitados },
        {
          headers: { Authorization: `Bearer ${token}`, 'x-session-id': sessionId },
          responseType: 'blob',
        }
      );

      const url = URL.createObjectURL(new Blob([resposta.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `xmls-recusados-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setUploadError('Não foi possível gerar a planilha de erros.');
    } finally {
      setBaixandoErros(false);
    }
  };

  const handleFileUpload = async (file: File | undefined) => {
    if (!file || isUploading) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setUploadError('Apenas arquivos ZIP são permitidos');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setRejeitados([]);
    setSubstituidos(0);
    setLote(null);
    setAvisoAnalise(null);
    setAlterandoEmpresa(false);
    setErroEmpresa(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post(`${API_URL}/api/v1/upload/nfe`, formData, {
        headers: {
          'x-session-id': sessionId,
          'Authorization': `Bearer ${token}`,
        },
        // O upload espera o ZIP e as notas chegarem à Supabase.
        timeout: TEMPO_GRAVACAO_MS,
      });

      if (response.data.success) {
        setUploadError(null);
        // Importação parcial: alguns XMLs entraram, outros foram recusados.
        // Antes isso passava em silêncio e o usuário só via o total errado.
        setRejeitados(response.data.data?.erros ?? []);
        setLote(response.data.data?.importacao ?? null);
        setAvisoAnalise(response.data.data?.importacao?.avisoAnalise ?? null);
        onLoteMudou?.({
          analiseId: response.data.data?.importacao?.analise?.id ?? null,
          naoSalvo: response.data.data?.importacao?.analiseSalva === false,
        });
        setSubstituidos(response.data.data?.importacao?.documentosSubstituidos ?? 0);
        await onUploadSuccess();
      } else {
        setUploadError(response.data.error);
        setRejeitados(response.data.details ?? []);
      }
    } catch (error: any) {
      setUploadError(error.response?.data?.error || error.message);
      setRejeitados(error.response?.data?.details ?? []);
    } finally {
      setIsUploading(false);
    }
  };

  const mostrarCandidatos = !!lote && (lote.precisaEscolherEmpresa || alterandoEmpresa);

  return (
    <Card className="border-2 border-dashed border-marca-azul/40 bg-marca-azul/[0.06]">
      <div className="text-center">
        <div className="mb-4 flex items-center justify-center gap-2">
          <h3 className="text-lg font-semibold">Importar Notas Fiscais</h3>
          <AjudaIcone
            largura={360}
            conteudo={
              <MemoriaCalculo
                titulo="Como a importação funciona"
                descricao="Envie o ZIP do mês com todas as notas juntas, de entrada e de saída. Não é preciso escolher nada antes."
                linhas={[
                  { rotulo: 'Modelo', valor: 'NF-e, NFC-e, CT-e, CT-e OS e NFS-e, lido do próprio XML' },
                  { rotulo: 'Empresa', valor: 'o CNPJ que aparece em pelo menos 80% das notas' },
                  { rotulo: 'Entrada', valor: 'a empresa é destinatária ou tomadora' },
                  { rotulo: 'Saída', valor: 'a empresa é emitente' },
                  { rotulo: 'Recusados', valor: 'XML corrompido, sem valores ou desconhecido' },
                ]}
                origem="Se a empresa não puder ser identificada, a tela lista os CNPJs do lote para você escolher. A escolha pode ser trocada depois, sem novo upload."
              />
            }
          />
        </div>

        {/*
          Área de arrastar e soltar. O botão continua para quem prefere
          escolher o arquivo; os dois caminhos chamam o mesmo envio.
        */}
        <div
          onDragOver={e => {
            e.preventDefault();
            if (!isUploading) setArrastando(true);
          }}
          onDragLeave={e => {
            e.preventDefault();
            // Passar sobre o ícone, o texto ou o botão também dispara
            // dragleave; só apaga o destaque quando sai da área de fato.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setArrastando(false);
          }}
          onDrop={e => {
            e.preventDefault();
            setArrastando(false);
            handleFileUpload(e.dataTransfer.files?.[0]);
          }}
          className={`rounded-xl border-2 border-dashed px-4 py-8 transition ${
            arrastando ? 'border-marca-azul bg-marca-azul/10' : 'border-fundo-borda'
          }`}
        >
          <Upload className="mx-auto mb-3 text-marca-azul" size={40} />
          <p className="mb-4 text-sm text-tinta-media">
            {isUploading
              ? 'Processando o ZIP...'
              : arrastando
                ? 'Solte o ZIP para importar'
                : 'Arraste o ZIP do mês para cá ou'}
          </p>

          <input
            type="file"
            accept=".zip"
            onChange={e => {
              handleFileUpload(e.target.files?.[0]);
              // Permite reenviar o mesmo arquivo em seguida.
              e.target.value = '';
            }}
            disabled={isUploading}
            className="hidden"
            id="file-input"
          />
          <label
            htmlFor="file-input"
            className={`inline-block rounded-lg bg-gradient-to-r from-marca-azul to-marca-roxo px-6 py-3 font-semibold text-white shadow-neon transition hover:opacity-90 ${
              isUploading ? 'pointer-events-none opacity-50' : 'cursor-pointer'
            }`}
          >
            {isUploading ? 'Processando...' : 'Escolher arquivo ZIP'}
          </label>
        </div>

        {uploadError && <p className="mt-4 text-sm text-red-600">{uploadError}</p>}

        {avisoAnalise && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{avisoAnalise}</span>
          </p>
        )}

        {lote && (
          <div className="mt-4 rounded-lg border border-fundo-borda bg-fundo-card p-4 text-left text-sm">
            <p className="font-semibold text-tinta-forte">
              {formatarInteiro(lote.totalDocumentosSessao ?? lote.documentosImportados ?? 0)} nota
              {(lote.totalDocumentosSessao ?? lote.documentosImportados ?? 0) === 1 ? '' : 's'} importada
              {(lote.totalDocumentosSessao ?? lote.documentosImportados ?? 0) === 1 ? '' : 's'}
            </p>
            <p className="mt-1 text-xs text-tinta-media">
              {lote.porModelo.map(m => `${m.rotulo}: ${formatarInteiro(m.quantidade)}`).join(' · ')}
            </p>
            {lote.analise && (
              <p className="mt-1 text-xs text-tinta-suave">
                Salva em Análises salvas: competência {rotuloCompetencia(lote.analise.competencia)} ·
                versão {lote.analise.versao}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-marca-azul/10 px-3 py-1 text-xs font-semibold text-marca-azul">
                Entradas: {formatarInteiro(lote.porSentido.entrada)}
              </span>
              <span className="rounded-full bg-marca-roxo/10 px-3 py-1 text-xs font-semibold text-marca-roxo">
                Saídas: {formatarInteiro(lote.porSentido.saida)}
              </span>
              <span className="rounded-full bg-fundo-eleva px-3 py-1 text-xs font-semibold text-tinta-media">
                Sem vínculo: {formatarInteiro(lote.porSentido.indefinido)}
              </span>
            </div>

            {lote.empresa ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-tinta-media">
                <Building2 size={14} className="text-marca-azul" />
                <span>
                  Empresa analisada:{' '}
                  <strong className="text-tinta-forte">{lote.empresa.nome}</strong> (
                  {formatarCNPJ(lote.empresa.cnpj)}){' '}
                  {lote.empresa.inferida ? '— identificada pelo lote' : '— escolhida por você'}
                </span>
                <button
                  type="button"
                  onClick={() => setAlterandoEmpresa(v => !v)}
                  className="rounded-md border border-marca-azul/40 px-2 py-0.5 font-semibold text-marca-azul transition hover:bg-marca-azul/10"
                >
                  {alterandoEmpresa ? 'Cancelar' : 'Alterar'}
                </button>
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Não foi possível identificar a empresa analisada neste lote. Escolha abaixo
                qual CNPJ é o da empresa; até lá, as notas ficam sem entrada ou saída.
              </p>
            )}

            {mostrarCandidatos && (
              <div className="mt-3">
                <p className="mb-2 text-xs font-semibold text-tinta-media">
                  CNPJs encontrados no lote
                </p>
                <ul className="space-y-1">
                  {lote.candidatosEmpresa.map(c => (
                    <li key={c.cnpj}>
                      <button
                        type="button"
                        disabled={salvandoEmpresa || lote.empresa?.cnpj === c.cnpj}
                        onClick={() => escolherEmpresa(c.cnpj)}
                        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-fundo-borda px-3 py-2 text-left text-xs transition hover:border-marca-azul hover:bg-marca-azul/5 disabled:cursor-default disabled:opacity-60"
                      >
                        <span>
                          <strong className="text-tinta-forte">{c.nome}</strong>{' '}
                          <span className="font-mono text-tinta-suave">{formatarCNPJ(c.cnpj)}</span>
                        </span>
                        <span className="text-tinta-suave">
                          {formatarInteiro(c.quantidadeNotas)} nota{c.quantidadeNotas === 1 ? '' : 's'}
                          {lote.empresa?.cnpj === c.cnpj ? ' · atual' : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {salvandoEmpresa && (
                  <p className="mt-2 text-xs text-tinta-suave">Reclassificando as notas...</p>
                )}
                {erroEmpresa && <p className="mt-2 text-xs text-red-600">{erroEmpresa}</p>}
              </div>
            )}
          </div>
        )}

        {substituidos > 0 && (
          <p className="mt-4 rounded-lg border border-marca-azul/40 bg-marca-azul/5 px-3 py-2 text-left text-xs text-tinta-media">
            A análise anterior foi substituída: {substituidos} documento
            {substituidos > 1 ? 's' : ''} da importação anterior
            {substituidos > 1 ? ' foram descartados' : ' foi descartado'}. Cada
            importação recomeça a análise do zero.
          </p>
        )}

        {rejeitados.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-400/60 bg-amber-50 p-4 text-left">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertTriangle size={16} />
                {rejeitados.length} arquivo{rejeitados.length > 1 ? 's' : ''} não
                {rejeitados.length > 1 ? ' foram' : ' foi'} importado
                {rejeitados.length > 1 ? 's' : ''}
              </p>

              {/*
                A lista na tela mostra só os oito primeiros. Com dezenas de
                recusas, analisar exige a planilha completa.
              */}
              <button
                onClick={exportarErros}
                disabled={baixandoErros}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
              >
                <FileSpreadsheet size={14} />
                {baixandoErros ? 'Gerando…' : 'Exportar erros em Excel'}
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {rejeitados.slice(0, 8).map((r, i) => (
                <li key={i} className="text-xs leading-snug text-amber-900">
                  <span className="font-mono">{r.nomeArquivo}</span> — {r.erro}
                </li>
              ))}
            </ul>
            {rejeitados.length > 8 && (
              <p className="mt-2 text-xs text-amber-800">
                e mais {rejeitados.length - 8}.
              </p>
            )}
          </div>
        )}
        <p className="mt-4 text-sm text-tinta-suave">
          Máximo 50MB • ZIP contendo XMLs • cada importação substitui a anterior
        </p>

      </div>
    </Card>
  );
};

// Dashboard Content
/**
 * Painel do lote, com a barra de filtros comum a todas as abas.
 *
 * O estado dos filtros vive aqui e vai em todas as buscas: indicadores do
 * topo, Painel (com o bloco Resumo e a conferência de campos), Regimes e
 * Exportar. Trocar de aba não mexe na seleção.
 */
const DashboardContent: React.FC<{
  /** Muda a cada importação ou troca de empresa: recarrega opções e filtros */
  versaoLote: number;
  sessionId: string;
  token: string;
}> = ({ versaoLote, sessionId, token }) => {
  const [activeTab, setActiveTab] = useState<'painel' | 'regimes'>('painel');
  const [opcoes, setOpcoes] = useState<OpcoesFiltros | null>(null);
  const [filtros, setFiltros] = useState<EstadoFiltros | null>(null);
  const [resumo, setResumo] = useState<ResumoGeral | null>(null);
  const [regimes, setRegimes] = useState<RegimeDados[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [retraido, setRetraido] = useState(false);
  const [exportando, setExportando] = useState(false);
  // "Atualizar dashboard" incrementa: refaz /filtros mantendo a seleção.
  const [recarga, setRecarga] = useState(0);
  const ultimaVersao = useRef<number | null>(null);

  const cabecalhos = { 'x-session-id': sessionId, Authorization: `Bearer ${token}` };

  // Objeto estável por seleção: os filhos refazem a busca só quando ele muda.
  const parametros = useMemo(() => (filtros ? paraParametros(filtros) : null), [filtros]);

  // Uma busca só alimenta os cartões Entradas e Saídas e a lista de notas.
  const conferencia = useConferenciaReforma(sessionId, token, parametros);

  // Busca as opções. Lote novo abre os filtros no padrão que o servidor
  // indica; numa recarga a seleção atual é mantida (objeto novo, para todas
  // as buscas serem refeitas).
  useEffect(() => {
    let ativo = true;
    setErro(null);
    axios
      .get(`${API_URL}/api/v1/dashboard/filtros`, { headers: cabecalhos })
      .then(r => {
        if (!ativo) return;
        const dados: OpcoesFiltros = r.data.data;
        const padrao: EstadoFiltros = { sentido: dados.sentidoPadrao, cfop: '', ncm: '' };
        const loteNovo = ultimaVersao.current !== versaoLote;
        ultimaVersao.current = versaoLote;
        setOpcoes(dados);
        setFiltros(f => (loteNovo || !f ? padrao : { ...f }));
      })
      .catch(() => {
        if (!ativo) return;
        // Opções velhas não podem seguir valendo para um lote que não se conhece.
        setOpcoes(null);
        setFiltros(null);
        setResumo(null);
        setErro('Não foi possível carregar os filtros da análise.');
      });
    return () => {
      ativo = false;
    };
  }, [versaoLote, recarga, sessionId, token]);

  // Indicadores do topo e aba Regimes, sempre com o recorte escolhido.
  useEffect(() => {
    if (!parametros) return;
    let ativo = true;
    setIsLoading(true);
    setErro(null);

    Promise.all([
      axios.get(`${API_URL}/api/v1/dashboard/resumo`, { headers: cabecalhos, params: parametros }),
      axios.get(`${API_URL}/api/v1/dashboard/regimes`, { headers: cabecalhos, params: parametros }),
    ])
      .then(([resumoRes, regimeRes]) => {
        if (!ativo) return;
        setResumo(resumoRes.data.data);
        setRegimes(regimeRes.data.data || []);
      })
      .catch(() => {
        if (ativo) setErro('Erro ao carregar dashboard');
      })
      .finally(() => {
        if (ativo) setIsLoading(false);
      });

    return () => {
      ativo = false;
    };
  }, [parametros, sessionId, token]);

  // Refaz /filtros e, com ele, todas as buscas, sem perder a seleção.
  const onRefresh = () => {
    setErro(null);
    setRecarga(n => n + 1);
  };

  const botaoAtualizar = (
    <div className="flex gap-4">
      <button
        onClick={onRefresh}
        disabled={isLoading}
        className="flex-1 rounded-lg bg-gradient-to-r from-marca-azul to-marca-roxo px-4 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        Atualizar dashboard
      </button>
    </div>
  );

  const handleExportExcel = async () => {
    setExportando(true);
    try {
      const response = await axios.get(`${API_URL}/api/v1/export/excel`, {
        headers: cabecalhos,
        params: parametros ?? {},
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'nfe-validator-export.xlsx');
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (error: any) {
      console.error('Erro ao exportar:', error);
      // Com responseType 'blob', o corpo de erro também chega como Blob.
      let mensagem = 'Não foi possível exportar a planilha.';
      try {
        const texto = await error.response?.data?.text?.();
        const corpo = texto ? JSON.parse(texto) : null;
        if (corpo?.error) mensagem = corpo.error;
      } catch {
        // corpo ilegível: fica a mensagem genérica
      }
      setErro(mensagem);
    } finally {
      setExportando(false);
    }
  };

  const bannerErro = erro && (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{erro}</div>
  );

  if (!opcoes || !filtros) {
    // Sem opções só se chega por erro (ou antes da primeira resposta).
    return erro ? (
      <div className="space-y-6">
        {bannerErro}
        {botaoAtualizar}
      </div>
    ) : null;
  }

  if (opcoes.totalDocumentos === 0) {
    return (
      <div className="text-center py-12">
        <FileText size={48} className="mx-auto text-tinta-suave mb-4" />
        <p className="text-tinta-suave">Nenhum dado disponível. Faça upload de NF-e para começar.</p>
      </div>
    );
  }

  const cartaoFiltros = (
    <FiltrosAnalise
      filtros={filtros}
      opcoes={opcoes}
      onChange={setFiltros}
      onExportar={handleExportExcel}
      exportando={exportando}
      retraido={retraido}
      onAlternarRetraido={() => setRetraido(v => !v)}
    />
  );

  // Lote com notas, mas indicadores ainda não carregados (ou com falha):
  // o cartão e o botão de atualizar continuam à mão.
  if (!resumo) {
    return (
      <div className="space-y-6">
        {cartaoFiltros}
        {bannerErro}
        {botaoAtualizar}
      </div>
    );
  }

  const recorteVazio = resumo.totalDocumentos === 0;

  return (
    <div className="space-y-6">
      {cartaoFiltros}

      {bannerErro}

      {recorteVazio && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0" />
          Nenhuma nota com os filtros escolhidos
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<FileText size={24} />}
          label="Total de Documentos"
          value={formatarInteiro(resumo.totalDocumentos)}
          color="border-blue-500"
          memoria={
            <MemoriaCalculo
              titulo="Total de Documentos"
              descricao="Contagem de XMLs processados com sucesso nesta sessão, dentro dos filtros escolhidos."
              linhas={[]}
              resultado={{ rotulo: 'Total', valor: formatarInteiro(resumo.totalDocumentos) }}
              origem="XMLs que falharam na leitura não entram nesta contagem — eles são listados no retorno da importação."
            />
          }
        />

        <StatCard
          icon={<DollarSign size={24} />}
          label="Valor Total"
          value={formatarMoeda(resumo.totalValor)}
          color="border-green-500"
          memoria={
            <MemoriaCalculo
              titulo="Valor Total"
              descricao="Soma do valor total de cada nota, sem descontar tributos."
              linhas={[
                { rotulo: 'Documentos somados', valor: formatarInteiro(resumo.totalDocumentos) },
                {
                  rotulo: 'Média por documento',
                  valor: formatarMoeda(
                    resumo.totalDocumentos > 0 ? resumo.totalValor / resumo.totalDocumentos : 0
                  ),
                },
              ]}
              resultado={{ rotulo: 'Σ valor das notas', valor: formatarMoeda(resumo.totalValor) }}
              origem="Origem: tag <vNF> do grupo <total><ICMSTot> de cada XML."
            />
          }
        />

        <StatCard
          icon={<TrendingUp size={24} />}
          label="Total Tributos"
          value={formatarMoeda(resumo.totalTributos)}
          color="border-orange-500"
          complemento={
            // Quem recolhe cada parcela é pessoa diferente. Sem a quebra, o
            // número sozinho sugere que tudo é do emitente da nota.
            resumo.totalRetidoTomador > 0 ? (
              <p className="text-[11px] leading-snug text-tinta-media">
                {formatarMoeda(resumo.totalDoPrestador)} do prestador ·{' '}
                {formatarMoeda(resumo.totalRetidoTomador)} retidos pelo tomador
              </p>
            ) : undefined
          }
          memoria={
            <MemoriaCalculo
              titulo="Total de Tributos"
              descricao="Soma de todos os tributos destacados nas notas, independentemente de quem recolhe."
              linhas={[
                { rotulo: 'Do prestador', valor: formatarMoeda(resumo.totalDoPrestador) },
                { rotulo: 'Retido pelo tomador', valor: formatarMoeda(resumo.totalRetidoTomador) },
                { rotulo: 'ICMS', valor: formatarMoeda(resumo.totalICMS) },
                { rotulo: 'ICMS-ST', valor: formatarMoeda(resumo.totalICMSST) },
                { rotulo: 'IPI', valor: formatarMoeda(resumo.totalIPI) },
                { rotulo: 'ISS', valor: formatarMoeda(resumo.totalISS) },
                { rotulo: 'PIS', valor: formatarMoeda(resumo.totalPIS) },
                { rotulo: 'COFINS', valor: formatarMoeda(resumo.totalCOFINS) },
                { rotulo: 'IRRF', valor: formatarMoeda(resumo.totalIRRF) },
              ]}
              resultado={{ rotulo: 'Total', valor: formatarMoeda(resumo.totalTributos) }}
              origem={`Carga tributária sobre o valor total: ${formatarPercentual(
                resumo.totalValor > 0 ? (resumo.totalTributos / resumo.totalValor) * 100 : 0
              )}`}
            />
          }
        />

      </div>

      {/* Tabs */}
      <div className="border-b border-fundo-borda">
        <div className="flex gap-4">
          {(
            [
              { id: 'painel', label: 'Painel' },
              { id: 'regimes', label: 'Regimes' },
            ] as const
          ).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 font-semibold border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-marca-neon text-marca-neon'
                  : 'border-transparent text-tinta-suave hover:text-tinta-forte'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'painel' && parametros && (
          <div className="space-y-6">
            {/* CAP-5: o resumo do lote parte do percentual de notas completas. */}
            <CartoesReforma conferencia={conferencia} />

            <PainelExecutivo sessionId={sessionId} token={token} filtros={parametros} />

            {/* Resumo: o conteúdo da antiga aba Detalhado. */}
            <Card>
              <div className="mb-1 flex items-center gap-2">
                <h3 className="font-semibold text-lg">Resumo</h3>
                <AjudaIcone
                  largura={320}
                  conteudo={
                    <MemoriaCalculo
                      titulo="Distribuição de Tributos"
                      descricao="Soma de cada tributo destacado nas notas importadas. O percentual é a participação do tributo no total da carga tributária."
                      linhas={[]}
                      resultado={{ rotulo: 'Total', valor: formatarMoeda(resumo.totalTributos) }}
                      origem="Tributos zerados não aparecem no gráfico."
                    />
                  }
                />
              </div>
              <p className="mb-4 text-sm text-tinta-suave">
                Distribuição de tributos · total de {formatarMoeda(resumo.totalTributos)} em tributos destacados
              </p>

              {(() => {
                // Barras horizontais em vez de pizza: com 5 tributos de ordens de
                // grandeza muito diferentes, as fatias e os rótulos se sobrepõem
                // e fica impossível comparar valores.
                // A lista precisa cobrir todo tributo destacado na nota. O IPI
                // e o ICMS-ST faltavam aqui, e era por isso que esta aba não
                // fechava com o Painel.
                const tributos = [
                  { nome: 'ICMS', valor: resumo.totalICMS, cor: '#7F2BF5' },
                  { nome: 'ICMS-ST', valor: resumo.totalICMSST, cor: '#5E1BB8' },
                  { nome: 'IPI', valor: resumo.totalIPI, cor: '#B47CFF' },
                  { nome: 'COFINS', valor: resumo.totalCOFINS, cor: '#0891b2' },
                  { nome: 'PIS', valor: resumo.totalPIS, cor: '#1D9E75' },
                  { nome: 'ISS', valor: resumo.totalISS, cor: '#EF9F27' },
                  { nome: 'IRRF', valor: resumo.totalIRRF, cor: '#65a30d' },
                ]
                  .filter(t => t.valor > 0)
                  .sort((a, b) => b.valor - a.valor);

                if (tributos.length === 0) {
                  return (
                    <p className="py-12 text-center text-tinta-suave">
                      Nenhum tributo destacado nas notas filtradas.
                    </p>
                  );
                }

                const total = tributos.reduce((soma, t) => soma + t.valor, 0);

                return (
                  <>
                    <ResponsiveContainer width="100%" height={40 + tributos.length * 52}>
                      <BarChart
                        data={tributos}
                        layout="vertical"
                        margin={{ top: 5, right: 90, left: 10, bottom: 5 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E3DC" />
                        <XAxis
                          type="number"
                          tickFormatter={formatarMoedaCompacta}
                          stroke="#888780"
                          fontSize={12}
                        />
                        <YAxis
                          type="category"
                          dataKey="nome"
                          width={70}
                          stroke="#888780"
                          fontSize={13}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                          formatter={(valor: any) => [formatarMoeda(valor), 'Valor']}
                          contentStyle={{
                            borderRadius: 8,
                            border: '1px solid #2a2a3a',
                            fontSize: 13,
                          }}
                        />
                        <Bar dataKey="valor" radius={[0, 6, 6, 0]} barSize={28}>
                          {tributos.map(t => (
                            <Cell key={t.nome} fill={t.cor} />
                          ))}
                          <LabelList
                            dataKey="valor"
                            position="right"
                            formatter={(v: any) => formatarMoedaCompacta(v)}
                            fontSize={12}
                            fill="#d1d5db"
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>

                    {/* Valores exatos embaixo: o eixo é compacto, aqui vai o número cheio */}
                    <div className="mt-4 space-y-2 border-t border-fundo-borda pt-4">
                      {tributos.map(t => (
                        <div key={t.nome} className="flex items-center gap-3 text-sm">
                          <span
                            className="h-3 w-3 shrink-0 rounded-sm"
                            style={{ backgroundColor: t.cor }}
                          />
                          <span className="w-16 font-medium text-tinta-media">{t.nome}</span>
                          <span className="flex-1 text-right font-mono text-tinta-forte">
                            {formatarMoeda(t.valor)}
                          </span>
                          <span className="w-16 text-right text-tinta-suave">
                            {formatarPercentual(total > 0 ? (t.valor / total) * 100 : 0, 1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </Card>

            {/* Lista de notas com o que falta, pelo nome do campo. */}
            <CamposTributarios conferencia={conferencia} />
          </div>
        )}

        {activeTab === 'regimes' && (
          <Card>
            <div className="mb-1 flex items-center gap-2">
              <h3 className="text-lg font-semibold">Análise por Regime Tributário</h3>
              <AjudaIcone
                largura={340}
                conteudo={
                  <MemoriaCalculo
                    titulo="Como o regime é identificado"
                    descricao="O regime é inferido a partir dos tributos destacados na nota, já que o XML não traz o regime do emitente de forma explícita em todos os casos."
                    linhas={[
                      { rotulo: 'Sem PIS e COFINS', valor: 'Simples Nacional' },
                      { rotulo: 'Com ICMS, sem ISS', valor: 'Lucro Real' },
                      { rotulo: 'Com ISS', valor: 'Lucro Presumido' },
                    ]}
                    origem="É uma heurística. Para auditoria, confirme o regime na consulta ao CNPJ."
                  />
                }
              />
            </div>
            <p className="mb-4 text-sm text-tinta-suave">
              {formatarInteiro(regimes.reduce((s, r) => s + r.quantidadeFornecedores, 0))}{' '}
              fornecedores distribuídos em {regimes.length} regime(s)
            </p>

            {regimes.length === 0 ? (
              <p className="py-12 text-center text-tinta-suave">
                Nenhum dado de regime disponível.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={380}>
                  <BarChart data={regimes} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E3DC" />
                    <XAxis dataKey="regime" stroke="#888780" fontSize={12} tickLine={false} />
                    <YAxis
                      tickFormatter={formatarMoedaCompacta}
                      stroke="#888780"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                      contentStyle={{ borderRadius: 8, border: '1px solid #2a2a3a', backgroundColor: '#FFFFFF', color: '#3D3D3A', fontSize: 13 }}
                      formatter={(valor: any, nome: any) => [formatarMoeda(valor), nome]}
                      labelFormatter={(rotulo: any) => {
                        const r = regimes.find(x => x.regime === rotulo);
                        return r
                          ? `${rotulo} — ${formatarInteiro(r.quantidadeFornecedores)} fornecedor(es), ${formatarInteiro(r.quantidade)} nota(s)`
                          : rotulo;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                    <Bar dataKey="valor" fill="#7F2BF5" name="Valor Total" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="tributos" fill="#ea580c" name="Tributos" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                {/* Detalhamento com a quantidade de fornecedores de cada regime */}
                <div className="mt-6 overflow-x-auto border-t border-fundo-borda pt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-fundo-borda bg-fundo-eleva text-tinta-media">
                        <th className="px-3 py-2 text-left font-semibold">Regime</th>
                        <th className="px-3 py-2 text-right font-semibold">Fornecedores</th>
                        <th className="px-3 py-2 text-right font-semibold">Notas</th>
                        <th className="px-3 py-2 text-right font-semibold">Valor Total</th>
                        <th className="px-3 py-2 text-right font-semibold">Tributos</th>
                        <th className="px-3 py-2 text-right font-semibold">Carga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regimes.map(r => (
                        <tr key={r.regime} className="border-b border-fundo-borda hover:bg-marca-azul/10">
                          <td className="px-3 py-2 font-semibold text-tinta-forte">{r.regime}</td>
                          <td className="px-3 py-2 text-right">
                            <span className="inline-flex items-center gap-1 rounded-full bg-marca-azul/10 px-2.5 py-0.5 font-semibold text-marca-azul">
                              <Building2 size={13} />
                              {formatarInteiro(r.quantidadeFornecedores)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-tinta-media">
                            {formatarInteiro(r.quantidade)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-tinta-forte">
                            {formatarMoeda(r.valor)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-orange-300">
                            {formatarMoeda(r.tributos)}
                          </td>
                          <td className="px-3 py-2 text-right text-tinta-suave">
                            {formatarPercentual(r.valor > 0 ? (r.tributos / r.valor) * 100 : 0, 1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        )}

      </div>

      {/* Action Buttons */}
      {botaoAtualizar}
    </div>
  );
};

// ==================== MAIN APP ====================

const App: React.FC = () => {
  const { state, setToken, setSessionId, setUser, logout } = useAppStore();
  // Muda a cada importação ou troca de empresa; o painel recarrega com ela.
  const [versaoLote, setVersaoLote] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [pagina, setPagina] = useState<'painel' | 'admin'>('painel');
  // Análise salva aberta: o card de importação é recriado mostrando o lote dela.
  const [loteAberto, setLoteAberto] = useState<{
    lote: ResumoLote | null;
    erros: ArquivoRejeitado[];
    chave: number;
  }>({ lote: null, erros: [], chave: 0 });
  const [analiseAtualId, setAnaliseAtualId] = useState<string | null>(null);
  // O lote no painel não foi salvo: abrir outra análise o descarta.
  const [loteNaoSalvo, setLoteNaoSalvo] = useState(false);

  /**
   * Troca a sessão pela de outro usuário, a pedido do administrador.
   *
   * O token do administrador é descartado do navegador de propósito: manter
   * os dois ao mesmo tempo abriria caminho para agir como um enquanto se
   * navega como outro. Para voltar, ele faz logout e entra de novo.
   */
  const assumirUsuario = (dados: {
    token: string;
    sessionId: string;
    user: any;
    assumidoPor: { userId: string; email: string };
  }) => {
    setToken(dados.token);
    setSessionId(dados.sessionId);
    setUser({ ...dados.user, assumidoPor: dados.assumidoPor });
    setAppError(null);
    // Recarrega para que todas as abas leiam os documentos da conta assumida.
    window.location.reload();
  };

  const handleLogin = async (email: string, password: string) => {
    setIsLoading(true);
    setAppError(null);

    try {
      const response = await axios.post(`${API_URL}/api/v1/auth/login`, { email, password });

      if (response.data.success) {
        const { token, sessionId, user } = response.data.data;
        setToken(token);
        setSessionId(sessionId);
        setUser(user);
      }
    } catch (error: any) {
      setAppError(error.response?.data?.error || 'Erro ao fazer login');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Avisa o painel de que o lote mudou. As buscas, todas com os filtros da
   * análise, ficam no DashboardContent.
   */
  const refreshDashboard = async () => {
    setVersaoLote(v => v + 1);
  };

  if (!state.token) {
    return (
      <TelaLogin
        onAutenticado={({ token, sessionId, user }) => {
          setToken(token);
          setSessionId(sessionId);
          setUser(user);
          setAppError(null);
        }}
      />
    );
  }

  // ---------- Páginas fora do painel ----------
  // A Administração deixou de ser aba e passou a ser página
  // própria, aberta pelo menu do nome. Sem banner e sem o card de
  // importação, para não misturar gestão com análise.
  if (pagina !== 'painel') {
    const ehAdmin = state.user?.papel === 'administrador';

    return (
      <div className="min-h-screen bg-fundo">
        <Header user={state.user} onLogout={logout} onIrPara={setPagina} />

        <main className="mx-auto max-w-7xl px-6 py-6">
          <button
            onClick={() => setPagina('painel')}
            className="mb-1 flex items-center gap-1.5 text-xs font-medium text-rotulo transition hover:underline"
          >
            <ArrowLeft size={14} />
            Voltar ao painel
          </button>
          <p className="mb-5 text-xs text-tinta-suave">
            Administração
          </p>

          {pagina === 'admin' &&
            (ehAdmin ? (
              <AbaAdministracao
                token={state.token}
                sessionId={state.sessionId!}
                usuarioAtualId={state.user?.userId ?? ''}
                onAssumirUsuario={assumirUsuario}
              />
            ) : (
              <p className="rounded-lg border border-fundo-borda bg-fundo-card p-6 text-sm text-tinta-media">
                Esta área é restrita a administradores.
              </p>
            ))}

        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-fundo">
      <Header user={state.user} onLogout={logout} onIrPara={setPagina} />
      <Banner />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {appError && (
          <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-700">
            {appError}
          </div>
        )}

        <UploadSection
          key={loteAberto.chave}
          sessionId={state.sessionId!}
          token={state.token}
          onUploadSuccess={refreshDashboard}
          loteInicial={loteAberto.lote}
          rejeitadosIniciais={loteAberto.erros}
          onLoteMudou={({ analiseId, naoSalvo }) => {
            setAnaliseAtualId(analiseId);
            setLoteNaoSalvo(naoSalvo);
          }}
        />

        <div className="mt-8">
          <AnalisesSalvas
            sessionId={state.sessionId!}
            token={state.token}
            versaoLote={versaoLote}
            analiseAtualId={analiseAtualId}
            loteAtualNaoSalvo={loteNaoSalvo}
            onAbrir={async (importacao, erros) => {
              setLoteAberto(atual => ({ lote: importacao ?? null, erros, chave: atual.chave + 1 }));
              setAnaliseAtualId(importacao?.analise?.id ?? null);
              setLoteNaoSalvo(false);
              await refreshDashboard();
            }}
          />
        </div>

        <div className="mt-8">
          <DashboardContent
            versaoLote={versaoLote}
            sessionId={state.sessionId!}
            token={state.token}
          />
        </div>
      </main>
    </div>
  );
};

export default App;
