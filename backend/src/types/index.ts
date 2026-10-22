/**
 * Tipos principais da aplicação
 */

// ==================== Autenticação ====================
export interface JWTPayload {
  userId: string;
  email: string;
  /** Sessão vinculada ao token, para que upload e dashboard leiam o mesmo estado */
  sessionId?: string;
  /** Papel do usuário no sistema */
  papel?: 'administrador' | 'usuario';
  /**
   * Preenchido quando um administrador assumiu esta conta. Guarda quem
   * assumiu, para que a ação fique rastreável e a interface possa avisar
   * que a sessão não é do dono da conta.
   */
  assumidoPor?: { userId: string; email: string };
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
    papel?: 'administrador' | 'usuario';
  };
  /** Presente apenas em sessão assumida por um administrador */
  assumidoPor?: { userId: string; email: string };
  expiresIn: string;
}

// ==================== NF-e e Modelos ====================
/**
 * 55 = NF-e, 65 = NFC-e, 57 = CT-e de carga, 67 = CT-e OS, 'NFSE' = NFS-e.
 *
 * A NFS-e não tem código numérico de modelo porque não é documento estadual;
 * o padrão nacional a identifica pela própria estrutura do XML.
 */
export type NFeModel = 55 | 65 | 57 | 67 | 'NFSE';
/**
 * Sentido da nota do ponto de vista da empresa analisada.
 *
 * 'indefinido' vale para a nota recém-lida, antes de a empresa ser
 * identificada, e para a nota em que a empresa não é emitente nem
 * destinatária ou tomadora.
 */
export type DocumentType = 'entrada' | 'saida' | 'indefinido';
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
  /**
   * Parcela dos valores acima que foi retida pelo tomador.
   *
   * Os campos iss, pis, cofins e irrf continuam guardando o total, para que
   * as somas existentes não mudem de significado. Este bloco diz quanto
   * daquele total não é recolhido pelo prestador — na NFS-e as retenções
   * federais são sempre do tomador, e o ISS é dele quando a nota traz
   * IssRetido.
   */
  retido?: {
    iss: number;
    pis: number;
    cofins: number;
    irrf: number;
  };
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
  /** Conferência de preenchimento dos campos tributários da nota */
  camposTributarios?: CampoTributario[];
  /**
   * CFOPs distintos da nota: dos itens na NF-e e NFC-e, da operação no
   * CT-e. Vazio na NFS-e, que não tem CFOP.
   */
  cfops: string[];
  /** NCMs distintos dos itens. Só NF-e e NFC-e têm NCM; vazio nos demais. */
  ncms: string[];
  /**
   * Pares CST do IBS/CBS e cClassTrib, base da regra de vínculo da reforma.
   * Um por item na NF-e e NFC-e; um só, o da nota, no CT-e e na NFS-e.
   * Campo ausente no XML fica undefined.
   */
  reformaItens?: ParReforma[];
  /**
   * true quando o XML não traz data de emissão (dhEmi, dEmi ou equivalente).
   * Nesse caso dataEmissao guarda o momento da leitura, que não serve para
   * a data de corte da reforma.
   */
  semDataEmissao?: boolean;
  /**
   * Dia de emissão (AAAA-MM-DD) no fuso do próprio emitente, tirado do texto
   * do XML. É ele que decide a data de corte da reforma. Ausente quando a
   * nota não tem data válida.
   */
  diaEmissao?: string;
  /**
   * Leiaute do XML da NFS-e (padrão nacional, Paulistana, municipal...).
   * Só a NFS-e tem leiautes diferentes; nos demais fica ausente.
   */
  leiaute?: string;
  /** Código do serviço declarado na NFS-e (cTribNac, CodigoServico...) */
  codigoServico?: string;
  /** De que tag veio o código do serviço (cTribNac, item da LC 116, código municipal) */
  tipoCodigoServico?: string;
}

/** CST do IBS/CBS e cClassTrib declarados num item (ou na nota). */
export interface ParReforma {
  cst?: string;
  cClassTrib?: string;
  /**
   * Campos de valor da reforma informados com zero neste item (ou na nota),
   * pelo nome usado em camposTributarios ("CBS", "IBS estadual"...).
   * Ausente quando nenhum veio zerado.
   */
  zerados?: string[];
}

/**
 * Situação de um campo tributário na nota.
 *
 * 'parcial' existe porque em NF-e os campos vivem no item, não na nota: uma
 * nota com cinco produtos pode trazer o grupo de IBS/CBS em três deles.
 * Reportar isso como preenchido ou ausente esconderia o problema.
 */
export interface CampoTributario {
  grupo: 'atual' | 'reforma';
  campo: string;
  situacao: 'preenchido' | 'parcial' | 'ausente';
  /** Valor lido, quando houver */
  valor?: string;
  /** Em documentos com itens, em quantos deles o campo aparece e em quantos veio zerado */
  itens?: { com: number; total: number; zerados?: number };
  /** Alíquota como consta na nota, sem conversão de escala */
  aliquota?: number;
  /** Base de cálculo do tributo, como consta na nota (soma dos itens na NF-e) */
  base?: number;
  /** Valor do tributo, como consta na nota (soma dos itens na NF-e) */
  valorNumerico?: number;
  /**
   * true quando o campo foi informado com valor zero (em NF-e e NFC-e, em
   * todos os itens que o trazem). Distingue zero de ausente.
   */
  zerado?: boolean;
  /**
   * true quando todo zero do campo é aceito pela conferência (CST que não
   * exige o grupo padrão, ou IBS municipal em 2026). Preenchido só na
   * resposta de /dashboard/campos, onde CST e data são conhecidos.
   */
  zeroAceito?: boolean;
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
}

export interface ResumoGeral {
  totalDocumentos: number;
  totalValor: number;
  totalTributos: number;
  totalICMS: number;
  /** ICMS retido por substituição tributária (vST) */
  totalICMSST: number;
  /** IPI destacado (vIPI) */
  totalIPI: number;
  totalISS: number;
  totalPIS: number;
  totalCOFINS: number;
  totalIRRF: number;
  /** Parcela do total que é retida pelo tomador */
  totalRetidoTomador: number;
  /** Parcela do total recolhida pelo próprio emitente ou prestador */
  totalDoPrestador: number;
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
    icmsST: number;
    ipi: number;
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

// ==================== Upload e Processamento ====================
export interface ImportacaoArquivo {
  sessionId: string;
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
  idioma: 'pt-BR' | 'en-US';
}

// ==================== Sessão ====================
/** Empresa cujo ponto de vista define entrada e saída no lote. */
export interface EmpresaAnalisada {
  cnpj: string;
  nome: string;
  /** true quando o sistema identificou sozinho; false quando o contador escolheu */
  inferida: boolean;
}

export interface UserSession {
  sessionId: string;
  userId: string;
  email: string;
  documentos: NFeDocument[];
  dashboard: DashboardData | null;
  ultimaAtualizacao: string;
  importacoes: ImportacaoArquivo[];
  /** Empresa analisada no lote vigente; ausente enquanto não identificada */
  empresa?: EmpresaAnalisada;
  /** Análise salva que corresponde ao lote vigente, quando foi salva */
  analiseId?: string;
  /**
   * De onde veio a análise ligada: 'upload' quando esta sessão a criou
   * (importação ou troca de empresa), 'aberta' quando foi aberta da lista.
   * Só a criada pela sessão pode ser atualizada no lugar.
   */
  analiseOrigem?: 'upload' | 'aberta';
  /** Muda a cada lote carregado; diz se o lote ainda é o mesmo depois de um await */
  loteId?: string;
}
