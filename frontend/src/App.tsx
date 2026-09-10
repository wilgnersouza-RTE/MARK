import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, LineChart, Line, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  Upload, Download, LogOut, FileText, TrendingUp, AlertTriangle,
  CheckCircle, XCircle, Calendar, Building2, DollarSign, Settings
} from 'lucide-react';

import { Tooltip as DicaHover, AjudaIcone, MemoriaCalculo } from './components/Tooltip';
import { AbaDivergencias } from './components/AbaDivergencias';
import { AbaReforma } from './components/AbaReforma';
import { TelaLogin } from './components/TelaLogin';
import { PainelExecutivo } from './components/PainelExecutivo';
import { API_URL } from './utils/api';
import {
  ConfiguracoesImportacao,
  CONFIGURACAO_PADRAO,
  type ConfiguracaoImportacao as TipoConfig,
} from './components/ConfiguracoesImportacao';
import {
  formatarMoeda, formatarMoedaCompacta, formatarInteiro,
  formatarPercentual, formatarCNPJ,
} from './utils/format';


// ==================== TIPOS ====================

interface Divergencia {
  tributo: string;
  ano: number;
  valorAtual: number;
  valorPrevisto: number;
  diferenca: number;
  percentual: number;
  fornecedor: string;
  cnpj: string;
}

interface ResumoGeral {
  totalDocumentos: number;
  totalValor: number;
  totalTributos: number;
  totalICMS: number;
  totalISS: number;
  totalPIS: number;
  totalCOFINS: number;
  totalIRRF: number;
  documentosConformes: number;
  documentosComDivergencias: number;
  percentualConformidade: number;
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

interface FornecedorDados {
  cnpj: string;
  nome: string;
  regime: string;
  quantidade: number;
  valor: number;
  tributos: number;
  conformidade: number;
}

// ==================== STORE ====================

interface AppState {
  token: string | null;
  sessionId: string | null;
  user: { userId: string; email: string } | null;
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
const Header: React.FC<{ user: any; onLogout: () => void }> = ({ user, onLogout }) => {
  // Iniciais do usuário para o avatar do canto direito
  const iniciais = (user?.nome || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p: string) => p[0]?.toUpperCase())
    .join('');

  return (
    <header className="sticky top-0 z-40 border-b border-fundo-borda bg-fundo-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-marca-azul to-marca-roxo text-white shadow-neon">
            <FileText size={18} />
          </span>
          <span className="text-lg font-bold tracking-tight">
            <span className="text-white">Contabilidade</span>
            <span className="text-marca-neon">.net</span>
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden text-right sm:block">
            <p className="text-xs text-gray-500">Logado como</p>
            <p className="text-sm font-semibold text-gray-200">
              {user?.nome || user?.email}
            </p>
          </div>

          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-marca-azul to-marca-ciano text-xs font-bold text-white">
            {iniciais}
          </span>

          <button
            onClick={onLogout}
            className="flex items-center gap-2 rounded-lg border border-fundo-borda px-3 py-2 text-sm text-gray-400 transition hover:border-red-500/50 hover:text-red-400"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </div>
    </header>
  );
};

/**
 * Banner do topo. Se existir frontend/public/banner.jpg, ele é usado; caso
 * contrário aparece o gradiente neon abaixo, para a área nunca ficar vazia.
 */
const Banner: React.FC = () => (
  <div
    className="relative h-56 overflow-hidden border-b border-fundo-borda bg-cover bg-center md:h-72"
    style={{ backgroundImage: "url('/banner.jpg')" }}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-[#12002e] via-[#0b1a3a] to-[#04060f]" />

    <div className="absolute inset-0 opacity-80">
      <div className="absolute -left-32 top-1/4 h-[420px] w-[420px] rounded-full bg-marca-roxo/25 blur-[130px]" />
      <div className="absolute -right-24 bottom-0 h-[380px] w-[380px] rounded-full bg-marca-ciano/20 blur-[120px]" />
      <div className="absolute left-0 top-8 h-[2px] w-full bg-gradient-to-r from-transparent via-marca-neon/60 to-transparent" />
      <div className="absolute bottom-10 left-[10%] h-[1px] w-[50%] bg-gradient-to-r from-transparent via-marca-ciano/50 to-transparent" />
    </div>

    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-white/90 drop-shadow-[0_0_25px_rgba(79,140,255,0.5)] md:text-5xl">
        Contabilidade<span className="text-marca-neon">.net</span>
      </h1>
      <p className="mt-3 max-w-xl text-sm text-blue-100/60 md:text-base">
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
        <p className="text-gray-500 text-sm font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-100 mt-2 break-words">{value}</p>
        {complemento && <div className="mt-2">{complemento}</div>}
      </div>

      {memoria ? (
        <DicaHover conteudo={memoria} largura={340}>
          <span className="relative rounded-lg border border-fundo-borda p-2 text-gray-500 transition-colors hover:border-blue-400 hover:text-blue-400">
            {icon}
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
              ?
            </span>
          </span>
        </DicaHover>
      ) : (
        <div className="text-gray-500">{icon}</div>
      )}
    </div>
  </Card>
);

// Upload Section
const UploadSection: React.FC<{
  sessionId: string;
  token: string;
  onUploadSuccess: () => Promise<void>;
}> = ({ sessionId, token, onUploadSuccess }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<'entrada' | 'saida'>('entrada');
  const [modelo, setModelo] = useState<'55' | '65'>('55');
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [config, setConfig] = useState<TipoConfig>(CONFIGURACAO_PADRAO);

  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      setUploadError('Apenas arquivos ZIP são permitidos');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tipo', tipo);
      formData.append('modelo', modelo);
      // Configurações da Reforma Tributária vão junto e ficam registradas na importação
      formData.append('configuracao', JSON.stringify(config));

      const response = await axios.post(`${API_URL}/api/v1/upload/nfe`, formData, {
        headers: {
          'x-session-id': sessionId,
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.data.success) {
        setUploadError(null);
        await onUploadSuccess();
      } else {
        setUploadError(response.data.error);
      }
    } catch (error: any) {
      setUploadError(error.response?.data?.error || error.message);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card className="border-2 border-dashed border-marca-azul/40 bg-marca-azul/[0.06]">
      <div className="text-center">
        <Upload className="mx-auto mb-4 text-blue-400" size={40} />
        <h3 className="text-lg font-semibold mb-4">Importar Notas Fiscais</h3>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-2">Tipo</label>
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value as 'entrada' | 'saida')}
              className="w-full px-3 py-2 border border-fundo-borda rounded-lg"
            >
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-2">Modelo</label>
            <select
              value={modelo}
              onChange={e => setModelo(e.target.value as '55' | '65')}
              className="w-full px-3 py-2 border border-fundo-borda rounded-lg"
            >
              <option value="55">55 (Produto)</option>
              <option value="65">65 (Serviço)</option>
            </select>
          </div>
        </div>

        <input
          type="file"
          accept=".zip"
          onChange={e => e.target.files && handleFileUpload(e.target.files[0])}
          disabled={isUploading}
          className="hidden"
          id="file-input"
        />
        <label
          htmlFor="file-input"
          className="inline-block cursor-pointer rounded-lg bg-gradient-to-r from-marca-azul to-marca-roxo px-6 py-3 font-semibold text-white shadow-neon transition hover:opacity-90 disabled:opacity-50"
        >
          {isUploading ? 'Processando...' : 'Escolher arquivo ZIP'}
        </label>

        {uploadError && <p className="text-red-400 text-sm mt-4">{uploadError}</p>}
        <p className="text-gray-500 text-sm mt-4">📦 Máximo 50MB • ZIP contendo XMLs de NF-e</p>

        {/* Configurações da Reforma Tributária do Consumo (IT 2025.002) */}
        <div className="mt-6 border-t border-fundo-borda border-marca-azul/30 pt-4">
          <button
            type="button"
            onClick={() => setMostrarConfig(v => !v)}
            className="mx-auto flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-blue-300 transition hover:bg-blue-100"
          >
            <Settings size={16} />
            Configurações da Reforma Tributária
            <span className="text-xs font-normal text-gray-500">
              {mostrarConfig ? '(ocultar)' : '(CST, cClassTrib e demais campos)'}
            </span>
          </button>
        </div>
      </div>

      {mostrarConfig && (
        <div className="mt-4 rounded-lg border border-marca-azul/30 bg-fundo-card p-4 text-left">
          <ConfiguracoesImportacao valor={config} onChange={setConfig} />
        </div>
      )}
    </Card>
  );
};

// Dashboard Content
const DashboardContent: React.FC<{
  resumo: ResumoGeral | null;
  divergencias: Divergencia[];
  regimes: RegimeDados[];
  fornecedores: FornecedorDados[];
  transicao: any;
  isLoading: boolean;
  sessionId: string;
  token: string;
  onRefresh: () => Promise<void>;
}> = ({
  resumo,
  divergencias,
  regimes,
  fornecedores,
  transicao,
  isLoading,
  sessionId,
  token,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState('painel');

  const handleExportExcel = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/v1/export/excel`, {
        headers: {
          'x-session-id': sessionId,
          'Authorization': `Bearer ${token}`,
        },
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'nfe-validator-export.xlsx');
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
    } catch (error) {
      console.error('Erro ao exportar:', error);
    }
  };

  if (!resumo) {
    return (
      <div className="text-center py-12">
        <FileText size={48} className="mx-auto text-gray-500 mb-4" />
        <p className="text-gray-500">Nenhum dado disponível. Faça upload de NF-e para começar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
              descricao="Contagem de XMLs de NF-e processados com sucesso nesta sessão."
              linhas={[
                { rotulo: 'Conformes', valor: formatarInteiro(resumo.documentosConformes) },
                { rotulo: 'Com divergência', valor: formatarInteiro(resumo.documentosComDivergencias) },
              ]}
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
          memoria={
            <MemoriaCalculo
              titulo="Total de Tributos"
              descricao="Soma dos cinco tributos destacados nas notas."
              linhas={[
                { rotulo: 'ICMS', valor: formatarMoeda(resumo.totalICMS) },
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

        <StatCard
          icon={<CheckCircle size={24} />}
          label="Conformidade"
          value={formatarPercentual(resumo.percentualConformidade, 1)}
          color="border-purple-500"
          complemento={
            <div className="flex items-center gap-3 text-sm">
              <DicaHover
                largura={320}
                conteudo={
                  <MemoriaCalculo
                    titulo="Documentos conformes"
                    descricao="Notas em que todos os tributos destacados ficaram dentro da margem de 10% em relação à alíquota esperada para o regime e o ano de emissão."
                    linhas={[]}
                    resultado={{
                      rotulo: 'Conformes',
                      valor: formatarInteiro(resumo.documentosConformes),
                    }}
                  />
                }
              >
                <span className="flex items-center gap-1 font-semibold text-green-400">
                  <CheckCircle size={14} />
                  {formatarInteiro(resumo.documentosConformes)}
                </span>
              </DicaHover>

              <DicaHover
                largura={320}
                conteudo={
                  <MemoriaCalculo
                    titulo="Documentos com divergência"
                    descricao="Notas em que ao menos um tributo destacado ficou fora da margem de 10% em relação à alíquota esperada. A divergência não indica erro automaticamente — pode haver benefício fiscal, regime especial ou substituição tributária."
                    linhas={[]}
                    resultado={{
                      rotulo: 'Com divergência',
                      valor: formatarInteiro(resumo.documentosComDivergencias),
                    }}
                  />
                }
              >
                <span className="flex items-center gap-1 font-semibold text-red-400">
                  <AlertTriangle size={14} />
                  {formatarInteiro(resumo.documentosComDivergencias)}
                </span>
              </DicaHover>
            </div>
          }
          memoria={
            <MemoriaCalculo
              titulo="Índice de Conformidade"
              descricao="Percentual de notas sem nenhuma divergência tributária apontada."
              linhas={[
                { rotulo: 'Conformes', valor: formatarInteiro(resumo.documentosConformes) },
                { rotulo: '÷ Total de documentos', valor: formatarInteiro(resumo.totalDocumentos) },
                { rotulo: '× 100', valor: '' },
              ]}
              resultado={{
                rotulo: 'Conformidade',
                valor: formatarPercentual(resumo.percentualConformidade, 1),
              }}
              origem="Comparação feita contra as alíquotas de data/tax-rules.json, com tolerância de 10%."
            />
          }
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-fundo-borda">
        <div className="flex gap-4">
          {[
            { id: 'painel', label: '📊 Painel' },
            { id: 'resumo', label: '📋 Detalhado' },
            { id: 'divergencias', label: '⚠️ Divergências' },
            { id: 'regimes', label: '🏢 Regimes' },
            { id: 'transicao', label: '📈 Transição' },
            { id: 'reforma', label: '🏛️ Reforma 2027-2033' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 font-semibold border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-marca-neon text-marca-neon'
                  : 'border-transparent text-gray-500 hover:text-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'painel' && (
          <PainelExecutivo sessionId={sessionId} token={token} />
        )}

        {activeTab === 'resumo' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Tributos */}
            <Card>
              <div className="mb-1 flex items-center gap-2">
                <h3 className="font-semibold text-lg">Distribuição de Tributos</h3>
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
              <p className="mb-4 text-sm text-gray-500">
                Total de {formatarMoeda(resumo.totalTributos)} em tributos destacados
              </p>

              {(() => {
                // Barras horizontais em vez de pizza: com 5 tributos de ordens de
                // grandeza muito diferentes, as fatias e os rótulos se sobrepõem
                // e fica impossível comparar valores.
                const tributos = [
                  { nome: 'ICMS', valor: resumo.totalICMS, cor: '#2563eb' },
                  { nome: 'COFINS', valor: resumo.totalCOFINS, cor: '#0891b2' },
                  { nome: 'PIS', valor: resumo.totalPIS, cor: '#7c3aed' },
                  { nome: 'ISS', valor: resumo.totalISS, cor: '#ea580c' },
                  { nome: 'IRRF', valor: resumo.totalIRRF, cor: '#65a30d' },
                ]
                  .filter(t => t.valor > 0)
                  .sort((a, b) => b.valor - a.valor);

                if (tributos.length === 0) {
                  return (
                    <p className="py-12 text-center text-gray-500">
                      Nenhum tributo destacado nas notas importadas.
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
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#2a2a3a" />
                        <XAxis
                          type="number"
                          tickFormatter={formatarMoedaCompacta}
                          stroke="#9ca3af"
                          fontSize={12}
                        />
                        <YAxis
                          type="category"
                          dataKey="nome"
                          width={70}
                          stroke="#9ca3af"
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
                          <span className="w-16 font-medium text-gray-200">{t.nome}</span>
                          <span className="flex-1 text-right font-mono text-gray-100">
                            {formatarMoeda(t.valor)}
                          </span>
                          <span className="w-16 text-right text-gray-500">
                            {formatarPercentual(total > 0 ? (t.valor / total) * 100 : 0, 1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </Card>

            {/* Conformidade */}
            <Card>
              <div className="mb-1 flex items-center gap-2">
                <h3 className="font-semibold text-lg">Status de Conformidade</h3>
                <AjudaIcone
                  largura={340}
                  conteudo={
                    <MemoriaCalculo
                      titulo="Como a conformidade é apurada"
                      descricao="Cada nota tem os tributos destacados comparados com a alíquota esperada para o seu regime tributário e ano de emissão, conforme a tabela em data/tax-rules.json. Variação de até 10% é aceita."
                      linhas={[
                        { rotulo: 'Dentro da margem', valor: 'conforme' },
                        { rotulo: 'Fora da margem', valor: 'divergência' },
                      ]}
                      origem="Divergência não significa erro: pode haver benefício fiscal, regime especial ou substituição tributária."
                    />
                  }
                />
              </div>
              <p className="mb-4 text-sm text-gray-500">
                {formatarInteiro(resumo.totalDocumentos)} documentos analisados
              </p>

              <div className="space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-gray-500">
                      <CheckCircle size={16} className="text-green-400" />
                      Conformes
                      <AjudaIcone
                        tamanho={14}
                        largura={330}
                        conteudo={
                          <MemoriaCalculo
                            titulo="Documentos conformes"
                            descricao="Notas em que todos os tributos destacados ficaram dentro da margem de 10% em relação à alíquota esperada para o regime e o ano de emissão."
                            linhas={[
                              { rotulo: 'Quantidade', valor: formatarInteiro(resumo.documentosConformes) },
                              {
                                rotulo: 'Participação',
                                valor: formatarPercentual(resumo.percentualConformidade, 1),
                              },
                            ]}
                            origem="Nenhum tributo da nota apresentou desvio relevante."
                          />
                        }
                      />
                    </span>
                    <span className="font-semibold text-gray-100">
                      {formatarInteiro(resumo.documentosConformes)}
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        {formatarPercentual(resumo.percentualConformidade, 1)}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-white/10">
                    <div
                      className="h-2 rounded-full bg-green-500 transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, resumo.percentualConformidade))}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-gray-500">
                      <AlertTriangle size={16} className="text-red-400" />
                      Com divergências
                      <AjudaIcone
                        tamanho={14}
                        largura={330}
                        conteudo={
                          <MemoriaCalculo
                            titulo="Documentos com divergência"
                            descricao="Notas em que ao menos um tributo destacado ficou fora da margem de 10% em relação à alíquota esperada. Cada ocorrência aparece detalhada na aba Divergências."
                            linhas={[
                              {
                                rotulo: 'Quantidade',
                                valor: formatarInteiro(resumo.documentosComDivergencias),
                              },
                              {
                                rotulo: 'Participação',
                                valor: formatarPercentual(100 - resumo.percentualConformidade, 1),
                              },
                            ]}
                            origem="Revise antes de concluir: benefício fiscal, regime especial e ST produzem divergência legítima."
                          />
                        }
                      />
                    </span>
                    <span className="font-semibold text-gray-100">
                      {formatarInteiro(resumo.documentosComDivergencias)}
                      <span className="ml-2 text-sm font-normal text-gray-500">
                        {formatarPercentual(100 - resumo.percentualConformidade, 1)}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-white/10">
                    <div
                      className="h-2 rounded-full bg-red-500 transition-all"
                      style={{
                        width: `${Math.min(100, Math.max(0, 100 - resumo.percentualConformidade))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'divergencias' && (
          <AbaDivergencias divergencias={divergencias} sessionId={sessionId} token={token} />
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
            <p className="mb-4 text-sm text-gray-500">
              {formatarInteiro(regimes.reduce((s, r) => s + r.quantidadeFornecedores, 0))}{' '}
              fornecedores distribuídos em {regimes.length} regime(s)
            </p>

            {regimes.length === 0 ? (
              <p className="py-12 text-center text-gray-500">
                Nenhum dado de regime disponível.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={380}>
                  <BarChart data={regimes} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2a3a" />
                    <XAxis dataKey="regime" stroke="#9ca3af" fontSize={12} tickLine={false} />
                    <YAxis
                      tickFormatter={formatarMoedaCompacta}
                      stroke="#9ca3af"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                      contentStyle={{ borderRadius: 8, border: '1px solid #2a2a3a', backgroundColor: '#13131c', color: '#e5e7eb', fontSize: 13 }}
                      formatter={(valor: any, nome: any) => [formatarMoeda(valor), nome]}
                      labelFormatter={(rotulo: any) => {
                        const r = regimes.find(x => x.regime === rotulo);
                        return r
                          ? `${rotulo} — ${formatarInteiro(r.quantidadeFornecedores)} fornecedor(es), ${formatarInteiro(r.quantidade)} nota(s)`
                          : rotulo;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                    <Bar dataKey="valor" fill="#2563eb" name="Valor Total" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="tributos" fill="#ea580c" name="Tributos" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>

                {/* Detalhamento com a quantidade de fornecedores de cada regime */}
                <div className="mt-6 overflow-x-auto border-t border-fundo-borda pt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-fundo-borda bg-fundo-eleva text-gray-200">
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
                          <td className="px-3 py-2 font-semibold text-gray-100">{r.regime}</td>
                          <td className="px-3 py-2 text-right">
                            <span className="inline-flex items-center gap-1 rounded-full bg-marca-azul/10 px-2.5 py-0.5 font-semibold text-blue-300">
                              <Building2 size={13} />
                              {formatarInteiro(r.quantidadeFornecedores)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gray-200">
                            {formatarInteiro(r.quantidade)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gray-100">
                            {formatarMoeda(r.valor)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-orange-300">
                            {formatarMoeda(r.tributos)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-500">
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

        {activeTab === 'transicao' && (
          <Card>
            <h3 className="font-semibold text-lg mb-4">Evolução Tributária (2024-2027)</h3>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={transicao?.dados || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ano" />
                <YAxis />
                <Tooltip formatter={(value: any) => formatarMoeda(value)} />
                <Legend />
                <Line type="monotone" dataKey="icms" stroke="#8884d8" name="ICMS" />
                <Line type="monotone" dataKey="iss" stroke="#82ca9d" name="ISS" />
                <Line type="monotone" dataKey="cofins" stroke="#ffc658" name="COFINS" />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}
        {activeTab === 'reforma' && (
          <AbaReforma sessionId={sessionId} token={token} />
        )}

      </div>

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex-1 rounded-lg bg-gradient-to-r from-marca-azul to-marca-roxo px-4 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          🔄 Atualizar Dashboard
        </button>
        <button
          onClick={handleExportExcel}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
        >
          <Download size={20} /> Exportar Excel
        </button>
      </div>
    </div>
  );
};

// ==================== MAIN APP ====================

const App: React.FC = () => {
  const { state, setToken, setSessionId, setUser, logout } = useAppStore();
  const [resumo, setResumo] = useState<ResumoGeral | null>(null);
  const [divergencias, setDivergencias] = useState<Divergencia[]>([]);
  const [regimes, setRegimes] = useState<RegimeDados[]>([]);
  const [fornecedores, setFornecedores] = useState<FornecedorDados[]>([]);
  const [transicao, setTransicao] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  useEffect(() => {
    if (state.sessionId) {
      refreshDashboard();
    }
  }, []);

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

  const refreshDashboard = async () => {
    if (!state.sessionId || !state.token) return;

    setIsLoading(true);

    try {
      const [resumoRes, divRes, regimeRes, transicaoRes, fornecedorRes] = await Promise.all([
        axios.get(`${API_URL}/api/v1/dashboard/resumo`, {
          headers: {
            'x-session-id': state.sessionId,
            'Authorization': `Bearer ${state.token}`,
          },
        }),
        axios.get(`${API_URL}/api/v1/dashboard/divergencias`, {
          headers: {
            'x-session-id': state.sessionId,
            'Authorization': `Bearer ${state.token}`,
          },
        }),
        axios.get(`${API_URL}/api/v1/dashboard/regimes`, {
          headers: {
            'x-session-id': state.sessionId,
            'Authorization': `Bearer ${state.token}`,
          },
        }),
        axios.get(`${API_URL}/api/v1/dashboard/transicao`, {
          headers: {
            'x-session-id': state.sessionId,
            'Authorization': `Bearer ${state.token}`,
          },
        }),
        axios.get(`${API_URL}/api/v1/dashboard/fornecedores`, {
          headers: {
            'x-session-id': state.sessionId,
            'Authorization': `Bearer ${state.token}`,
          },
        }),
      ]);

      setResumo(resumoRes.data.data);
      setDivergencias(divRes.data.data || []);
      setRegimes(regimeRes.data.data || []);
      setTransicao(transicaoRes.data.data);
      setFornecedores(fornecedorRes.data.data || []);
    } catch (error: any) {
      setAppError('Erro ao carregar dashboard');
    } finally {
      setIsLoading(false);
    }
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

  return (
    <div className="min-h-screen bg-fundo">
      <Header user={state.user} onLogout={logout} />
      <Banner />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {appError && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg">
            {appError}
          </div>
        )}

        <UploadSection sessionId={state.sessionId!} token={state.token} onUploadSuccess={refreshDashboard} />

        <div className="mt-8">
          <DashboardContent
            resumo={resumo}
            divergencias={divergencias}
            regimes={regimes}
            fornecedores={fornecedores}
            transicao={transicao}
            isLoading={isLoading}
            sessionId={state.sessionId!}
            token={state.token}
            onRefresh={refreshDashboard}
          />
        </div>
      </main>
    </div>
  );
};

export default App;
