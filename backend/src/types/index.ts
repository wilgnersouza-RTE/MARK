/**
 * Tipos principais da aplicação
 */

// ==================== Autenticação ====================
export interface JWTPayload {
  userId: string;
  email: string;
  /** Sessão vinculada ao token, para que upload e dashboard leiam o mesmo estado */
  sessionId?: string;
  iat: number;
  exp: number;
}

export interface AuthRequest {
  email: string;
  password?: string; // Para JWT básico
  provider?: 'auth0' | 'jwt';
}

export interface AuthResponse {
  token: string;
  /** Identificador da sessão em memória criada no login */
  sessionId: string;
  user: {
    userId: string;
    email: string;
    nome?: string;
  };
  expiresIn: string;
}

// ==================== NF-e e Modelos ====================
export type NFeModel = 55 | 65;
export type DocumentType = 'Entrada' | 'Saída' | 'entrada' | 'saida';
export type RegimeTributario = 'Regime-Regular' | 'Simples-Nacional' | 'Lucro-Real' | 'Lucro-Presumido';

export type RegimeTributarioAlias = RegimeTributario | 'simples' | 'lucro-real' | 'lucro-presumido' | 'regime-regular';

export interface NFeValues {
  baseCalculo: number;
  icms: number;
  /** ICMS retido por substituicao tributaria (tag vST) */
  icmsST: number;
  /** IPI destacado (tag vIPI) */
  ipi: number;
  iss: number;
  pis: number;
  cofins: number;
  irrf: number;
  aliquota: number;
  cbs: number;
  ibs: number;
  total: number;
  Icms?: number;
  ISS?: number;
  Pis?: number;
  Cofins?: number;
  Irrf?: number;
  Alíquota?: number;
  CBS?: number;
  IBS?: number;
  Total?: number;
}

export interface NFeDocument {
  id: string;
  modelo: NFeModel;
  tipo: DocumentType;
  chaveNFe: string;
  dataEmissao: string;
  cnpjEmitente: string;
  nomeEmitente: string;
  cnpjDestino: string;
  nomeDestino: string;
  regimeTributario: RegimeTributario;
  values: NFeValues;
  validacoes: Validacao[];
  divergencias: Divergencia[];
}

// ==================== Validação e Tributos ====================
export interface Validacao {
  tipo: 'icms' | 'iss' | 'pis' | 'cofins' | 'irrf'|'IBS'|'CBS';
  conforme: boolean;
  mensagem: string;
  ano: number;
}

export interface Divergencia {
  tributo: string;
  ano: number;
  valorAtual: number;
  valorPrevisto: number;
  diferenca: number;
  percentual: number;
}

export interface RegrasTributarias {
  ano: number;
  icms: AliquotaTributaria;
  iss: AliquotaTributaria;
  pis: AliquotaTributaria;
  cofins: AliquotaTributaria;
  irrf: AliquotaTributaria;
}

export interface AliquotaTributaria {
  RegimeRegular?: number;
  SimplesNacional?: number;
  LucroReal?: number;
  LucroPresumido?: number;
  simples?: number;
  'lucro-real'?: number;
  'lucro-presumido'?: number;
  'regime-regular'?: number;
  descricao?: string;
  [key: string]: number | string | undefined;
}

// ==================== Dashboard e Análise ====================
export interface DashboardData {
  resumoGeral: ResumoGeral;
  porCategoria: CategoriaDados[];
  porRegime: RegimeDados[];
  porFornecedor: FornecedorDados[];
  divergencias: Divergencia[];
  transicaoAnual: TransicaoAnual;
}

export interface ResumoGeral {
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

export interface CategoriaDados {
  categoria: string;
  quantidade: number;
  valor: number;
  tributos: number;
  percentualTributos: number;
}

export interface RegimeDados {
  regime: RegimeTributario;
  /** Quantidade de notas fiscais no regime */
  quantidade: number;
  /** Quantidade de fornecedores (CNPJs distintos) no regime */
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

export interface FornecedorDados {
  cnpj: string;
  nome: string;
  regime: RegimeTributario;
  quantidade: number;
  valor: number;
  tributos: number;
  conformidade: number;
}

export interface TransicaoAnual {
  anos: number[];
  tributos: {
    icms: number[];
    iss: number[];
    pis: number[];
    cofins: number[];
    irrf: number[];
  };
  projecoes: {
    icms: number[];
    iss: number[];
    pis: number[];
    cofins: number[];
    irrf: number[];
  };
}

// ==================== Upload e Processamento ====================
export interface ImportacaoArquivo {
  sessionId: string;
  tipo: DocumentType;
  modelo: NFeModel;
  quantidadeArquivos: number;
  arquivosProcessados: number;
  arquivosComErro: number;
  erros: ErroProcessamento[];
  documentos: NFeDocument[];
  timestamp: string;
}

export interface ErroProcessamento {
  nomeArquivo: string;
  erro: string;
  linha?: number;
}

// ==================== Respostas API ====================
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

// ==================== Excel Export ====================
export interface ExcelExportOptions {
  incluirGraficos: boolean;
  incluirValidacoes: boolean;
  incluirDivergencias: boolean;
  incluirTransicao: boolean;
  idioma: 'pt-BR' | 'en-US';
}

// ==================== Sessão ====================
export interface UserSession {
  sessionId: string;
  userId: string;
  email: string;
  documentos: NFeDocument[];
  dashboard: DashboardData | null;
  ultimaAtualizacao: string;
  importacoes: ImportacaoArquivo[];
}
