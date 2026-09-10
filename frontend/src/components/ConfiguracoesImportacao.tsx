import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ChevronDown, Info } from 'lucide-react';
import { AjudaIcone, MemoriaCalculo } from './Tooltip';
import { API_URL } from '../utils/api';


interface Opcao {
  codigo: string;
  descricao: string;
}

interface CSTItem extends Opcao {
  grupo: string;
  exigeGrupoPadrao: boolean;
  exigeMonofasica: boolean;
  exigeTransfCred: boolean;
  exigeAjusteCompet: boolean;
}

interface CClassTribItem {
  codigo: string;
  cst: string;
  descricao: string;
  baseLegal?: string;
}

export interface ConfiguracaoImportacao {
  finalidadeNFe: string;
  tipoOperacao: string;
  crt: string;
  tipoNFeDebito: string;
  tipoNFeCredito: string;
  indicadorBemMovelUsado: string;
  nfeReferenciada: string;
  dfeReferenciado: boolean;
  compraGovernamental: boolean;
  pagamentoAntecipado: boolean;
  cst: string;
  cClassTrib: string;
}

export const CONFIGURACAO_PADRAO: ConfiguracaoImportacao = {
  finalidadeNFe: '',
  tipoOperacao: '',
  crt: '',
  tipoNFeDebito: '',
  tipoNFeCredito: '',
  indicadorBemMovelUsado: '',
  nfeReferenciada: '',
  dfeReferenciado: false,
  compraGovernamental: false,
  pagamentoAntecipado: false,
  cst: '',
  cClassTrib: '',
};

/** Select padronizado com rótulo e ajuda opcional */
const Seletor: React.FC<{
  rotulo: string;
  valor: string;
  opcoes: Opcao[];
  onChange: (v: string) => void;
  ajuda?: React.ReactNode;
  desabilitado?: boolean;
  placeholder?: string;
}> = ({ rotulo, valor, opcoes, onChange, ajuda, desabilitado, placeholder = 'Selecione...' }) => (
  <div>
    <label className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-200">
      {rotulo}
      {ajuda && <AjudaIcone tamanho={15} largura={340} conteudo={ajuda} />}
    </label>
    <div className="relative">
      <select
        value={valor}
        onChange={e => onChange(e.target.value)}
        disabled={desabilitado}
        className="w-full appearance-none rounded-lg border border-fundo-borda bg-fundo-card px-3 py-2 pr-9 text-sm text-gray-100 transition focus:border-marca-azul focus:outline-none focus:ring-1 focus:ring-marca-azul disabled:cursor-not-allowed disabled:bg-fundo-eleva disabled:text-gray-500"
      >
        <option value="">{placeholder}</option>
        {opcoes.map(o => (
          <option key={o.codigo} value={o.codigo}>
            {o.codigo} – {o.descricao}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
      />
    </div>
  </div>
);

/** Toggle no estilo do validador oficial */
const Chave: React.FC<{
  rotulo: string;
  ativo: boolean;
  onChange: (v: boolean) => void;
  ajuda?: React.ReactNode;
}> = ({ rotulo, ativo, onChange, ajuda }) => (
  <div className="flex items-center justify-between rounded-lg border border-fundo-borda bg-fundo-eleva px-3 py-2.5">
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={ativo}
        onClick={() => onChange(!ativo)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          ativo ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-fundo-card shadow transition-transform ${
            ativo ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      <span className="text-sm font-medium text-gray-200">{rotulo}</span>
    </div>
    {ajuda && <AjudaIcone tamanho={15} largura={320} conteudo={ajuda} />}
  </div>
);

const Secao: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
  <fieldset className="rounded-lg border border-fundo-borda px-4 pb-4 pt-2">
    <legend className="px-2 text-sm font-bold text-blue-300">{titulo}</legend>
    {children}
  </fieldset>
);

export const ConfiguracoesImportacao: React.FC<{
  valor: ConfiguracaoImportacao;
  onChange: (c: ConfiguracaoImportacao) => void;
}> = ({ valor, onChange }) => {
  const [opcoes, setOpcoes] = useState<Record<string, Opcao[]>>({});
  const [listaCST, setListaCST] = useState<CSTItem[]>([]);
  const [listaClass, setListaClass] = useState<CClassTribItem[]>([]);
  const [metadados, setMetadados] = useState<any>(null);
  const [validacao, setValidacao] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);

  const set = <K extends keyof ConfiguracaoImportacao>(
    campo: K,
    v: ConfiguracaoImportacao[K]
  ) => onChange({ ...valor, [campo]: v });

  useEffect(() => {
    (async () => {
      try {
        const [op, cst, meta] = await Promise.all([
          axios.get(`${API_URL}/api/v1/rtc/opcoes`),
          axios.get(`${API_URL}/api/v1/rtc/cst`),
          axios.get(`${API_URL}/api/v1/rtc/metadados`),
        ]);
        setOpcoes(op.data.data);
        setListaCST(cst.data.data);
        setMetadados(meta.data.data);
      } catch {
        // A tela continua utilizável; os seletores ficam vazios
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  // cClassTrib depende do CST: os 3 primeiros dígitos do código são o CST.
  useEffect(() => {
    if (!valor.cst) {
      setListaClass([]);
      if (valor.cClassTrib) set('cClassTrib', '');
      return;
    }

    (async () => {
      try {
        const r = await axios.get(`${API_URL}/api/v1/rtc/cclasstrib`, {
          params: { cst: valor.cst },
        });
        setListaClass(r.data.data.codigos);

        // Se o cClassTrib atual não pertence ao novo CST, limpa
        if (valor.cClassTrib && !valor.cClassTrib.startsWith(valor.cst)) {
          set('cClassTrib', '');
        }
      } catch {
        setListaClass([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor.cst]);

  // Validação da combinação, feita no backend
  useEffect(() => {
    if (!valor.cst) {
      setValidacao(null);
      return;
    }

    const id = setTimeout(async () => {
      try {
        const r = await axios.post(`${API_URL}/api/v1/rtc/validar`, {
          cst: valor.cst,
          cClassTrib: valor.cClassTrib,
        });
        setValidacao(r.data.data);
      } catch {
        setValidacao(null);
      }
    }, 250);

    return () => clearTimeout(id);
  }, [valor.cst, valor.cClassTrib]);

  const cstSelecionado = listaCST.find(c => c.codigo === valor.cst);

  return (
    <div className="space-y-4">
      {metadados && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-marca-azul/10 px-3 py-2 text-xs text-blue-300">
          <Info size={14} />
          <span>
            Informe Técnico {metadados.informeTecnico} v{metadados.versaoTabela} —{' '}
            {metadados.totalCClassTrib} códigos cClassTrib e {metadados.totalCST} CST carregados
          </span>
        </div>
      )}

      {/* ==================== CONFIGURAÇÕES ==================== */}
      <Secao titulo="Configurações">
        <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Seletor
            rotulo="Finalidade da NF-e"
            valor={valor.finalidadeNFe}
            opcoes={opcoes.finalidadeNFe || []}
            onChange={v => set('finalidadeNFe', v)}
            ajuda={
              <MemoriaCalculo
                titulo="Finalidade da NF-e"
                descricao="Tag <finNFe> do grupo <ide>. Define se a nota é normal, complementar, de ajuste ou de devolução."
                linhas={[]}
                origem="Notas de crédito e débito (5 e 6) foram introduzidas pela Reforma Tributária do Consumo."
              />
            }
          />
          <Seletor
            rotulo="Tipo de Operação"
            valor={valor.tipoOperacao}
            opcoes={opcoes.tipoOperacao || []}
            onChange={v => set('tipoOperacao', v)}
            ajuda={
              <MemoriaCalculo
                titulo="Tipo de Operação"
                descricao="Tag <tpNF>. Indica se a nota é de entrada ou de saída na visão do emitente."
                linhas={[]}
              />
            }
          />
          <Seletor
            rotulo="CRT – Regime do Emitente"
            valor={valor.crt}
            opcoes={opcoes.crt || []}
            onChange={v => set('crt', v)}
            ajuda={
              <MemoriaCalculo
                titulo="CRT – Código de Regime Tributário"
                descricao="Tag <CRT> do grupo <emit>. Quando informado, substitui a inferência automática de regime feita a partir dos tributos da nota."
                linhas={[]}
                origem="Preferir sempre o CRT do XML: a inferência é apenas um substituto quando o campo não vem preenchido."
              />
            }
          />
          <Seletor
            rotulo="Tipo de NF-e – Débito"
            valor={valor.tipoNFeDebito}
            opcoes={opcoes.tipoNFeDebito || []}
            onChange={v => set('tipoNFeDebito', v)}
          />
          <Seletor
            rotulo="Tipo de NF-e – Crédito"
            valor={valor.tipoNFeCredito}
            opcoes={opcoes.tipoNFeCredito || []}
            onChange={v => set('tipoNFeCredito', v)}
          />
          <Seletor
            rotulo="Indicador de Bem Móvel Usado"
            valor={valor.indicadorBemMovelUsado}
            opcoes={opcoes.indicadorBemMovelUsado || []}
            onChange={v => set('indicadorBemMovelUsado', v)}
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-semibold text-gray-200">
            NF-e Referenciada
          </label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={44}
            value={valor.nfeReferenciada}
            onChange={e => set('nfeReferenciada', e.target.value.replace(/\D/g, ''))}
            placeholder="Chave de Acesso (44 dígitos)"
            className={`w-full max-w-2xl rounded-lg border px-3 py-2 font-mono text-sm transition focus:outline-none focus:ring-1 ${
              valor.nfeReferenciada && valor.nfeReferenciada.length !== 44
                ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500'
                : 'border-fundo-borda focus:border-blue-500 focus:ring-blue-500'
            }`}
          />
          {valor.nfeReferenciada && valor.nfeReferenciada.length !== 44 && (
            <p className="mt-1 text-xs text-red-400">
              A chave de acesso tem 44 dígitos — informados: {valor.nfeReferenciada.length}.
            </p>
          )}
        </div>

        <div className="mt-4 space-y-2 border-t border-fundo-borda pt-4">
          <Chave
            rotulo="DF-e Referenciado"
            ativo={valor.dfeReferenciado}
            onChange={v => set('dfeReferenciado', v)}
          />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Chave
              rotulo="Compra Governamental"
              ativo={valor.compraGovernamental}
              onChange={v => set('compraGovernamental', v)}
              ajuda={
                <MemoriaCalculo
                  titulo="Compra Governamental"
                  descricao="Operações destinadas à administração pública têm tratamento próprio de IBS e CBS na LC 214/2025."
                  linhas={[]}
                />
              }
            />
            <Chave
              rotulo="Pagamento Antecipado"
              ativo={valor.pagamentoAntecipado}
              onChange={v => set('pagamentoAntecipado', v)}
            />
          </div>
        </div>
      </Secao>

      {/* ==================== INFORMAÇÕES INICIAIS DO ITEM ==================== */}
      <Secao titulo="Informações Iniciais do Item">
        <div className="mt-2 space-y-4">
          <Seletor
            rotulo="CST (Código de Situação Tributária)"
            valor={valor.cst}
            opcoes={listaCST}
            onChange={v => set('cst', v)}
            placeholder={carregando ? 'Carregando...' : 'Selecione um CST...'}
            ajuda={
              <MemoriaCalculo
                titulo="CST do IBS e da CBS"
                descricao="Indica a situação tributária do item: tributação integral, alíquota reduzida, imunidade, diferimento, suspensão, monofásica ou ajuste."
                linhas={[]}
                origem="Tabela de Indicadores de CST do Informe Técnico 2025.002. Define quais grupos do XML são obrigatórios, permitidos ou vedados."
              />
            }
          />

          <Seletor
            rotulo="cClassTrib (Código de Classificação Tributária)"
            valor={valor.cClassTrib}
            opcoes={listaClass.map(c => ({
              codigo: c.codigo,
              descricao: c.descricao.length > 110 ? c.descricao.slice(0, 110) + '…' : c.descricao,
            }))}
            onChange={v => set('cClassTrib', v)}
            desabilitado={!valor.cst}
            placeholder={
              !valor.cst
                ? 'Selecione um CST primeiro...'
                : listaClass.length === 0
                  ? 'Nenhum código para este CST na tabela carregada'
                  : 'Selecione um cClassTrib...'
            }
            ajuda={
              <MemoriaCalculo
                titulo="cClassTrib"
                descricao="Código de 6 dígitos que aponta o dispositivo da LC 214/2025 aplicável ao item."
                linhas={[
                  { rotulo: '3 primeiros dígitos', valor: 'CST' },
                  { rotulo: '3 últimos dígitos', valor: 'hipótese legal' },
                ]}
                origem="Por isso a lista só abre depois que o CST é escolhido: o vínculo entre os dois campos é estrutural."
              />
            }
          />

          {/* Descrição completa do código escolhido */}
          {valor.cClassTrib && (
            <div className="rounded-lg border border-fundo-borda bg-fundo-eleva p-3">
              {(() => {
                const item = listaClass.find(c => c.codigo === valor.cClassTrib);
                if (!item) return null;
                return (
                  <>
                    <p className="mb-1 font-mono text-sm font-bold text-gray-100">{item.codigo}</p>
                    <p className="text-sm leading-snug text-gray-200">{item.descricao}</p>
                    {item.baseLegal && (
                      <p className="mt-2 text-xs text-gray-500">Base legal: {item.baseLegal}</p>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* Resultado da validação do vínculo */}
          {validacao && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                validacao.valido
                  ? 'border-green-500/30 bg-green-500/10 text-green-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-800'
              }`}
            >
              <p className="font-semibold">
                {validacao.valido ? 'Combinação válida' : 'Combinação inválida'}
                {validacao.grupoExigido && validacao.grupoExigido !== 'nenhum' && (
                  <span className="ml-2 font-mono text-xs font-normal">
                    grupo exigido no XML: {validacao.grupoExigido}
                  </span>
                )}
              </p>
              {validacao.erros?.map((e: string, i: number) => (
                <p key={i} className="mt-1 leading-snug">
                  {e}
                </p>
              ))}
              {validacao.avisos?.map((a: string, i: number) => (
                <p key={i} className="mt-1 leading-snug text-amber-300">
                  {a}
                </p>
              ))}
            </div>
          )}
        </div>
      </Secao>

      {/* ==================== REGIME DE TRIBUTAÇÃO ==================== */}
      <Secao titulo="Regime de Tributação">
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { id: 'padrao', rotulo: 'Tributação Padrão', cst: null, ativo: cstSelecionado?.exigeGrupoPadrao },
            { id: 'mono', rotulo: 'Tributação Monofásica', cst: 'CST 620', ativo: cstSelecionado?.exigeMonofasica },
            { id: 'transf', rotulo: 'Transferência de Crédito', cst: 'CST 800', ativo: cstSelecionado?.exigeTransfCred },
            { id: 'ajuste', rotulo: 'Ajuste de Competência', cst: 'CST 811', ativo: cstSelecionado?.exigeAjusteCompet },
          ].map(op => (
            <div
              key={op.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                op.ativo
                  ? 'border-green-500/50 bg-green-500/10 font-semibold text-green-300'
                  : 'border-fundo-borda bg-fundo-card text-gray-500'
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  op.ativo ? 'border-green-600 bg-green-600' : 'border-fundo-borda'
                }`}
              >
                {op.ativo && <span className="h-1.5 w-1.5 rounded-full bg-fundo-card" />}
              </span>
              <span className="leading-tight">
                {op.rotulo}
                {op.cst && <span className="ml-1 text-xs font-normal opacity-70">({op.cst})</span>}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          O regime é determinado pelo CST escolhido, conforme a Tabela de Indicadores do Informe
          Técnico — não é uma escolha livre.
        </p>
      </Secao>
    </div>
  );
};
