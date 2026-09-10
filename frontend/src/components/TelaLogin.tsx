import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Eye, EyeOff, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import { API_URL, mensagemDeFalhaDeRede } from '../utils/api';


type Tela = 'entrar' | 'criar' | 'esqueci' | 'redefinir';

interface Props {
  onAutenticado: (dados: { token: string; sessionId: string; user: any }) => void;
}

/** Marca da aplicação. O ".net" em azul é o traço do logotipo. */
const Logotipo: React.FC<{ tamanho?: 'grande' | 'pequeno' }> = ({ tamanho = 'grande' }) => (
  <span
    className={`font-bold tracking-tight ${tamanho === 'grande' ? 'text-2xl' : 'text-base'}`}
  >
    <span className="text-white">Contabilidade</span>
    <span className="text-blue-500">.net</span>
  </span>
);

/**
 * Campo de formulário.
 *
 * ESTE COMPONENTE PRECISA FICAR NO ESCOPO DO MÓDULO. Definido dentro do
 * TelaLogin, ele era recriado a cada tecla digitada: o React tratava cada
 * render como um componente novo, desmontava o <input> e montava outro — o que
 * fazia o campo perder o foco a cada caractere.
 */
const Campo: React.FC<{ rotulo: string; children: React.ReactNode }> = ({
  rotulo,
  children,
}) => (
  <div className="mb-5">
    <label className="mb-2 block text-sm font-medium text-gray-300">{rotulo}</label>
    {children}
  </div>
);

const classeInput =
  'w-full rounded-md border border-fundo-borda bg-fundo-eleva px-4 py-3 text-sm text-white caret-marca-neon placeholder-gray-500 transition focus:border-marca-azul focus:outline-none focus:ring-1 focus:ring-marca-azul';

export const TelaLogin: React.FC<Props> = ({ onAutenticado }) => {
  const [tela, setTela] = useState<Tela>('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('');
  const [token, setToken] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);

  const [carregando, setCarregando] = useState(false);
  const [demorando, setDemorando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [primeiroAcesso, setPrimeiroAcesso] = useState(false);

  // Instalação nova, sem nenhum usuário: a tela abre já em "criar conta"
  useEffect(() => {
    axios
      .get(`${API_URL}/api/v1/auth/status`)
      .then(r => {
        if (!r.data.data.possuiUsuarios) {
          setPrimeiroAcesso(true);
          setTela('criar');
        }
      })
      .catch(() => undefined);
  }, []);

  // Depois de alguns segundos carregando, avisa que o servidor pode estar
  // acordando — comportamento normal de plano gratuito, não travamento.
  useEffect(() => {
    if (!carregando) {
      setDemorando(false);
      return;
    }
    const id = setTimeout(() => setDemorando(true), 6000);
    return () => clearTimeout(id);
  }, [carregando]);

  const limparMensagens = () => {
    setErro(null);
    setAviso(null);
  };

  /**
   * Traduz a falha do axios em algo acionável.
   *
   * Sem isso, qualquer problema virava "não foi possível criar a conta", que
   * não distingue senha curta (erro do usuário) de backend fora do ar (erro
   * de ambiente) — que são problemas completamente diferentes.
   */
  const descreverErro = (e: any, acaoPadrao: string): string => {
    if (e.response?.data?.error) return e.response.data.error;

    if (e.code === 'ERR_NETWORK' || !e.response) {
      return mensagemDeFalhaDeRede();
    }

    if (e.response?.status >= 500) {
      return 'O servidor encontrou um erro interno. Consulte o terminal do backend.';
    }

    return acaoPadrao;
  };

  const entrar = async () => {
    setCarregando(true);
    limparMensagens();
    try {
      const r = await axios.post(`${API_URL}/api/v1/auth/login`, { email, password: senha });
      onAutenticado(r.data.data);
    } catch (e: any) {
      setErro(descreverErro(e, 'Não foi possível entrar.'));
    } finally {
      setCarregando(false);
    }
  };

  const criarConta = async () => {
    setCarregando(true);
    limparMensagens();
    try {
      const r = await axios.post(`${API_URL}/api/v1/auth/register`, {
        email,
        password: senha,
        nome,
      });
      onAutenticado(r.data.data);
    } catch (e: any) {
      setErro(descreverErro(e, 'Não foi possível criar a conta.'));
    } finally {
      setCarregando(false);
    }
  };

  const solicitarRecuperacao = async () => {
    setCarregando(true);
    limparMensagens();
    try {
      const r = await axios.post(`${API_URL}/api/v1/auth/esqueci-senha`, { email });
      const dados = r.data.data;

      if (dados.token) {
        // Sem SMTP configurado, o token vem na resposta em desenvolvimento
        setToken(dados.token);
        setAviso(
          'Envio de e-mail não configurado neste ambiente. O código foi preenchido automaticamente para você prosseguir.'
        );
        setTela('redefinir');
      } else {
        setAviso(dados.mensagem);
      }
    } catch (e: any) {
      setErro(descreverErro(e, 'Não foi possível processar a solicitação.'));
    } finally {
      setCarregando(false);
    }
  };

  const redefinir = async () => {
    setCarregando(true);
    limparMensagens();
    try {
      await axios.post(`${API_URL}/api/v1/auth/redefinir-senha`, { token, novaSenha });
      setAviso('Senha redefinida. Faça login com a nova senha.');
      setSenha('');
      setTela('entrar');
    } catch (e: any) {
      setErro(descreverErro(e, 'Não foi possível redefinir a senha.'));
    } finally {
      setCarregando(false);
    }
  };

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (carregando) return;

    if (tela === 'entrar') entrar();
    else if (tela === 'criar') criarConta();
    else if (tela === 'esqueci') solicitarRecuperacao();
    else redefinir();
  };

  return (
    <div className="flex min-h-screen bg-[#1c1c1e]">
      {/* ==================== COLUNA ESQUERDA: FORMULÁRIO ==================== */}
      <div className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-[35%] lg:min-w-[480px]">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 text-center">
            <Logotipo />
          </div>

          <div className="mb-8 text-center">
            <div className="mb-1 flex items-center justify-center gap-2">
              <span className="h-4 w-4 rounded-full bg-gradient-to-br from-blue-400 to-blue-600" />
              <span className="text-lg font-semibold text-white">Contabilidade.net</span>
            </div>
            <p className="text-sm text-gray-300">
              {tela === 'criar'
                ? primeiroAcesso
                  ? 'Crie a primeira conta de acesso'
                  : 'Criar conta'
                : tela === 'esqueci'
                  ? 'Recuperar acesso'
                  : tela === 'redefinir'
                    ? 'Definir nova senha'
                    : 'Acesso exclusivo'}
            </p>
          </div>

          <div className="rounded-xl border border-fundo-borda bg-fundo-card p-8 shadow-2xl">
            {erro && (
              <div className="mb-5 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm leading-snug text-red-300">
                {erro}
              </div>
            )}

            {aviso && (
              <div className="mb-5 flex gap-2 rounded-md border border-marca-azul/30 bg-marca-azul/10 px-4 py-3 text-sm text-blue-200">
                <CheckCircle size={16} className="mt-0.5 shrink-0" />
                <span className="leading-snug">{aviso}</span>
              </div>
            )}

            <form onSubmit={enviar}>
              {tela === 'criar' && (
                <Campo rotulo="Nome">
                  <input
                    type="text"
                    value={nome}
                    onChange={e => setNome(e.target.value)}
                    placeholder="Seu nome"
                    className={classeInput}
                  />
                </Campo>
              )}

              {tela !== 'redefinir' && (
                <Campo rotulo="E-mail">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="E-mail"
                    required
                    autoComplete="email"
                    className={classeInput}
                  />
                </Campo>
              )}

              {(tela === 'entrar' || tela === 'criar') && (
                <Campo rotulo="Senha">
                  <div className="relative">
                    <input
                      type={verSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={e => setSenha(e.target.value)}
                      placeholder="Senha"
                      required
                      autoComplete={tela === 'criar' ? 'new-password' : 'current-password'}
                      className={`${classeInput} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setVerSenha(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-700"
                      aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {verSenha ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </div>
                  {tela === 'criar' && (
                    <p className="mt-1.5 text-xs text-gray-500">Mínimo de 8 caracteres.</p>
                  )}
                </Campo>
              )}

              {tela === 'redefinir' && (
                <>
                  <Campo rotulo="Código de verificação">
                    <input
                      type="text"
                      value={token}
                      onChange={e => setToken(e.target.value)}
                      placeholder="Cole o código recebido"
                      required
                      className={`${classeInput} font-mono text-xs`}
                    />
                  </Campo>
                  <Campo rotulo="Nova senha">
                    <div className="relative">
                      <input
                        type={verSenha ? 'text' : 'password'}
                        value={novaSenha}
                        onChange={e => setNovaSenha(e.target.value)}
                        placeholder="Nova senha"
                        required
                        className={`${classeInput} pr-11`}
                      />
                      <button
                        type="button"
                        onClick={() => setVerSenha(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-700"
                      >
                        {verSenha ? <Eye size={18} /> : <EyeOff size={18} />}
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500">Mínimo de 8 caracteres.</p>
                  </Campo>
                </>
              )}

              <button
                type="submit"
                disabled={carregando}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-marca-azul to-marca-roxo px-6 py-3.5 text-sm font-semibold text-white shadow-neon transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {carregando && <Loader2 size={16} className="animate-spin" />}
                {carregando
                  ? 'Aguarde...'
                  : tela === 'entrar'
                    ? 'Entrar'
                    : tela === 'criar'
                      ? 'Criar conta'
                      : tela === 'esqueci'
                        ? 'Enviar instruções'
                        : 'Redefinir senha'}
              </button>
            </form>

            {demorando && carregando && (
              <p className="mt-3 text-center text-xs leading-snug text-gray-500">
                O servidor pode estar iniciando após período ocioso. A primeira
                requisição costuma levar até 30 segundos.
              </p>
            )}

            <div className="mt-6 text-center text-sm">
              {tela === 'entrar' && (
                <>
                  <button
                    onClick={() => {
                      limparMensagens();
                      setTela('esqueci');
                    }}
                    className="text-gray-400 transition hover:text-gray-200 hover:underline"
                  >
                    Esqueci a senha
                  </button>
                  {!primeiroAcesso && (
                    <p className="mt-3 text-gray-500">
                      Não tem acesso?{' '}
                      <button
                        onClick={() => {
                          limparMensagens();
                          setTela('criar');
                        }}
                        className="font-semibold text-marca-neon hover:underline"
                      >
                        Criar conta
                      </button>
                    </p>
                  )}
                </>
              )}

              {tela !== 'entrar' && (
                <button
                  onClick={() => {
                    limparMensagens();
                    setTela('entrar');
                  }}
                  className="inline-flex items-center gap-1.5 text-gray-400 transition hover:text-gray-200 hover:underline"
                >
                  <ArrowLeft size={14} />
                  Voltar para o login
                </button>
              )}
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-gray-500">
            Validador da Reforma Tributária do Consumo — NF-e / NFC-e
          </p>
        </div>
      </div>

      {/* ==================== COLUNA DIREITA: IMAGEM ==================== */}
      {/*
        Para usar a arte oficial, coloque o arquivo em frontend/public/login-hero.jpg.
        Enquanto ele não existir, o gradiente abaixo aparece no lugar — assim a tela
        nunca fica com a área quebrada por imagem ausente.
      */}
      <div
        className="relative hidden flex-1 overflow-hidden bg-[#0a1929] bg-cover bg-center lg:block"
        style={{ backgroundImage: "url('/login-hero.jpg')" }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a1929] via-[#0d2847] to-[#061320]" />

        {/* Faixas de luz, no espírito da arte de referência */}
        <div className="absolute inset-0 opacity-70">
          <div className="absolute left-0 top-[12%] h-[2px] w-full bg-gradient-to-r from-transparent via-blue-400 to-transparent blur-[1px]" />
          <div className="absolute left-0 top-[14%] h-[60px] w-full bg-gradient-to-b from-blue-500/25 to-transparent blur-2xl" />
          <div className="absolute bottom-[28%] left-[8%] h-[1px] w-[45%] bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
          <div className="absolute bottom-[20%] right-[10%] h-[1px] w-[35%] bg-gradient-to-r from-transparent via-blue-300/60 to-transparent" />
          <div className="absolute -left-24 top-1/3 h-[420px] w-[420px] rounded-full bg-blue-500/20 blur-[120px]" />
          <div className="absolute -right-20 bottom-1/4 h-[380px] w-[380px] rounded-full bg-cyan-400/15 blur-[110px]" />
        </div>

        {/* Painel com a marca, como o monitor da arte de referência */}
        <div className="absolute right-[8%] top-[22%] w-[52%] rounded-lg border border-blue-400/30 bg-gradient-to-br from-blue-900/40 to-blue-950/60 p-8 shadow-[0_0_60px_rgba(59,130,246,0.25)] backdrop-blur-sm">
          <div className="text-center">
            <span className="text-3xl font-bold tracking-tight">
              <span className="text-white">Contabilidade</span>
              <span className="text-blue-400">.net</span>
            </span>
            <p className="mt-3 text-sm text-blue-200/70">
              Inteligência tributária para a reforma
            </p>
          </div>
        </div>

        <div className="absolute bottom-12 left-12 right-12">
          <p className="text-sm leading-relaxed text-blue-100/50">
            Análise de NF-e, apuração de divergências e simulação da transição
            tributária de 2027 a 2033.
          </p>
        </div>
      </div>
    </div>
  );
};
