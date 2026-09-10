import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Eye, EyeOff, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import { API_URL, mensagemDeFalhaDeRede } from '../utils/api';
import { MarcaRTE } from './Marca';


type Tela = 'entrar' | 'criar' | 'esqueci' | 'redefinir';

interface Props {
  onAutenticado: (dados: { token: string; sessionId: string; user: any }) => void;
}

/** Marca da aplicação. */
const Logotipo: React.FC<{ tamanho?: 'grande' | 'pequeno' }> = ({ tamanho = 'grande' }) => (
  <MarcaRTE tamanho={tamanho === 'grande' ? 26 : 17} />
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
    <label className="mb-2 block text-sm font-semibold text-tinta-forte">{rotulo}</label>
    {children}
  </div>
);

const classeInput =
  'w-full rounded-md border border-fundo-borda bg-fundo-eleva px-4 py-3 text-sm text-tinta-forte caret-marca-azul placeholder-tinta-suave transition focus:border-marca-azul focus:outline-none focus:ring-1 focus:ring-marca-azul';

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
    <div className="flex min-h-screen bg-white">
      {/* ==================== COLUNA ESQUERDA: FORMULÁRIO ==================== */}
      <div className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-[35%] lg:min-w-[480px]">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 text-center">
            <Logotipo />
          </div>

          <div className="mb-8 text-center">
            <div className="mb-1 flex items-center justify-center gap-2">
              <span className="h-4 w-4 rounded-full bg-marca-azul" />
              <span className="text-lg font-semibold text-tinta-forte">RTE</span>
            </div>
            <p className="text-sm text-tinta-media">
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

          <div className="rounded-xl border border-fundo-borda bg-fundo-card p-8 shadow-sm">
            {erro && (
              <div className="mb-5 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm leading-snug text-red-700">
                {erro}
              </div>
            )}

            {aviso && (
              <div className="mb-5 flex gap-2 rounded-md border border-marca-azul/40 bg-marca-azul/5 px-4 py-3 text-sm text-rotulo">
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
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-tinta-media transition hover:text-tinta-forte"
                      aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {verSenha ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </div>
                  {tela === 'criar' && (
                    <p className="mt-1.5 text-xs text-tinta-media">Mínimo de 8 caracteres.</p>
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
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-tinta-media transition hover:text-tinta-forte"
                      >
                        {verSenha ? <Eye size={18} /> : <EyeOff size={18} />}
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-tinta-media">Mínimo de 8 caracteres.</p>
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
              <p className="mt-3 text-center text-xs leading-snug text-tinta-media">
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
                    className="font-medium text-rotulo transition hover:underline"
                  >
                    Esqueci a senha
                  </button>
                  {!primeiroAcesso && (
                    <p className="mt-3 text-tinta-media">
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
                  className="inline-flex items-center gap-1.5 font-medium text-rotulo transition hover:underline"
                >
                  <ArrowLeft size={14} />
                  Voltar para o login
                </button>
              )}
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-tinta-media">
            Validador da Reforma Tributária do Consumo — NF-e / NFC-e
          </p>
        </div>
      </div>

      {/* ==================== COLUNA DIREITA: MARCA ==================== */}
      {/*
        Faixa roxa chapada do RTE. Se a arte oficial for usada um dia, coloque o
        arquivo em frontend/public/login-hero.jpg — ele entra como fundo e o
        roxo continua atrás, para a tela nunca quebrar por imagem ausente.
      */}
      <div
        className="relative hidden flex-1 overflow-hidden bg-marca-azul bg-cover bg-center lg:block"
        style={{ backgroundImage: "url('/login-hero.jpg')" }}
      >
        <div className="absolute inset-0 flex flex-col justify-center px-[8%]">
          <div className="rounded-xl border border-white/30 bg-fundo-borda p-10 text-center">
            <MarcaRTE tamanho={34} invertida />
            <p className="mt-3 text-sm text-white/85">
              Inteligência tributária para a reforma
            </p>
          </div>
        </div>

        <div className="absolute bottom-12 left-12 right-12">
          <p className="text-sm leading-relaxed text-white/75">
            Análise de NF-e, apuração de divergências e simulação da transição
            tributária de 2027 a 2033.
          </p>
        </div>
      </div>
    </div>
  );
};
