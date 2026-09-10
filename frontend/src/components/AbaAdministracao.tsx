import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Shield, User, MoreHorizontal, LogIn, Pencil, Trash2, X, Eye, EyeOff, Search,
  AlertTriangle, Loader2,
} from 'lucide-react';
import { API_URL } from '../utils/api';

export interface UsuarioAdmin {
  userId: string;
  email: string;
  nome: string;
  papel: 'administrador' | 'usuario';
  criadoEm: string;
  ultimoAcesso: string | null;
  ativo: boolean;
}

interface Props {
  token: string;
  sessionId: string;
  /** Conta em uso agora — usada para impedir autoexclusão na interface. */
  usuarioAtualId: string;
  /**
   * Chamado depois de assumir outra conta. Quem trata a troca é o App:
   * ele substitui token e sessão e recarrega os dados do usuário assumido.
   */
  onAssumirUsuario: (dados: {
    token: string;
    sessionId: string;
    user: any;
    assumidoPor: { userId: string; email: string };
  }) => void;
}

const PAPEIS = [
  { valor: 'administrador' as const, nome: 'Administrador' },
  { valor: 'usuario' as const, nome: 'Usuário' },
];

export const AbaAdministracao: React.FC<Props> = ({
  token,
  sessionId,
  usuarioAtualId,
  onAssumirUsuario,
}) => {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [busca, setBusca] = useState('');
  const [filtroPapel, setFiltroPapel] = useState<'todos' | 'administrador' | 'usuario'>('todos');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [editando, setEditando] = useState<UsuarioAdmin | null>(null);
  const [assumindo, setAssumindo] = useState<UsuarioAdmin | null>(null);
  const [excluindo, setExcluindo] = useState<UsuarioAdmin | null>(null);

  const cabecalhos = {
    headers: { Authorization: `Bearer ${token}`, 'x-session-id': sessionId },
  };

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await axios.get(`${API_URL}/api/v1/admin/usuarios`, cabecalhos);
      setUsuarios(r.data.data);
    } catch (e: any) {
      setErro(e.response?.data?.error || 'Não foi possível carregar os usuários.');
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sessionId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Fecha o menu de ações ao clicar fora
  useEffect(() => {
    const fechar = () => setMenuAberto(null);
    document.addEventListener('click', fechar);
    return () => document.removeEventListener('click', fechar);
  }, []);

  const filtrados = usuarios.filter(u => {
    const alvo = `${u.nome} ${u.email}`.toLowerCase();
    const casaBusca = alvo.includes(busca.trim().toLowerCase());
    const casaPapel = filtroPapel === 'todos' || u.papel === filtroPapel;
    return casaBusca && casaPapel;
  });

  const assumir = async (u: UsuarioAdmin) => {
    try {
      const r = await axios.post(
        `${API_URL}/api/v1/admin/usuarios/${u.userId}/assumir`,
        {},
        cabecalhos
      );
      setAssumindo(null);
      onAssumirUsuario(r.data.data);
    } catch (e: any) {
      setErro(e.response?.data?.error || 'Não foi possível assumir esta conta.');
      setAssumindo(null);
    }
  };

  const excluir = async (u: UsuarioAdmin) => {
    try {
      await axios.delete(`${API_URL}/api/v1/admin/usuarios/${u.userId}`, cabecalhos);
      setExcluindo(null);
      setAviso(`${u.email} foi removido.`);
      carregar();
    } catch (e: any) {
      setErro(e.response?.data?.error || 'Não foi possível excluir este usuário.');
      setExcluindo(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-tinta-forte">Usuários</h2>
        <p className="text-sm text-tinta-suave">Gerencie os usuários da plataforma</p>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {aviso && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {aviso}
        </div>
      )}

      <div className="rounded-lg border border-fundo-borda bg-fundo-card p-4">
        {/* ==================== FILTROS ==================== */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tinta-suave"
            />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Pesquisar por nome ou e-mail"
              className="w-full rounded-lg border border-fundo-borda py-2 pl-9 pr-3 text-sm"
            />
          </div>

          <select
            value={filtroPapel}
            onChange={e => setFiltroPapel(e.target.value as typeof filtroPapel)}
            className="rounded-lg border border-fundo-borda px-3 py-2 text-sm"
          >
            <option value="todos">Todos os papéis</option>
            <option value="administrador">Administradores</option>
            <option value="usuario">Usuários</option>
          </select>

          <span className="text-xs text-tinta-suave">
            {filtrados.length} de {usuarios.length}
          </span>
        </div>

        {carregando ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-tinta-suave">
            <Loader2 size={16} className="animate-spin" />
            Carregando usuários…
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-fundo-borda text-xs text-tinta-suave">
                  <th className="py-2 text-left font-normal">Nome completo</th>
                  <th className="py-2 text-left font-normal">E-mail</th>
                  <th className="py-2 text-left font-normal">Papel</th>
                  <th className="py-2 text-right font-normal">Último acesso</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtrados.map(u => (
                  <tr
                    key={u.userId}
                    className="border-b border-fundo-borda last:border-0 hover:bg-fundo-eleva"
                  >
                    <td className="py-2.5 text-tinta-forte">{u.nome}</td>
                    <td className="py-2.5 text-tinta-media">{u.email}</td>
                    <td className="py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs ${
                          u.papel === 'administrador' ? 'text-marca-azul' : 'text-tinta-fraca'
                        }`}
                      >
                        {u.papel === 'administrador' ? <Shield size={13} /> : <User size={13} />}
                        {u.papel === 'administrador' ? 'Administrador' : 'Usuário'}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-xs text-tinta-suave">
                      {u.ultimoAcesso
                        ? new Date(u.ultimoAcesso).toLocaleDateString('pt-BR')
                        : 'nunca acessou'}
                    </td>
                    <td className="relative py-2.5 text-right">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setMenuAberto(menuAberto === u.userId ? null : u.userId);
                        }}
                        className="rounded p-1 text-tinta-suave transition hover:bg-fundo-borda hover:text-tinta-forte"
                        aria-label={`Ações para ${u.nome}`}
                      >
                        <MoreHorizontal size={16} />
                      </button>

                      {menuAberto === u.userId && (
                        <div
                          onClick={e => e.stopPropagation()}
                          className="absolute right-0 top-9 z-30 w-44 overflow-hidden rounded-lg border border-fundo-borda bg-fundo-card text-left shadow-lg"
                        >
                          <button
                            onClick={() => {
                              setMenuAberto(null);
                              setAssumindo(u);
                            }}
                            disabled={u.userId === usuarioAtualId}
                            className="flex w-full items-center justify-between px-3 py-2 text-sm text-tinta-media transition hover:bg-marca-azul hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-tinta-media"
                          >
                            Entrar como
                            <LogIn size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setMenuAberto(null);
                              setEditando(u);
                            }}
                            className="flex w-full items-center justify-between px-3 py-2 text-sm text-tinta-media transition hover:bg-fundo-eleva"
                          >
                            Editar
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setMenuAberto(null);
                              setExcluindo(u);
                            }}
                            disabled={u.userId === usuarioAtualId}
                            className="flex w-full items-center justify-between px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Excluir
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filtrados.length === 0 && (
              <p className="py-10 text-center text-sm text-tinta-suave">
                Nenhum usuário encontrado com esse filtro.
              </p>
            )}
          </div>
        )}
      </div>

      {assumindo && (
        <ConfirmarAssumir
          usuario={assumindo}
          onCancelar={() => setAssumindo(null)}
          onConfirmar={() => assumir(assumindo)}
        />
      )}

      {excluindo && (
        <ConfirmarExclusao
          usuario={excluindo}
          onCancelar={() => setExcluindo(null)}
          onConfirmar={() => excluir(excluindo)}
        />
      )}

      {editando && (
        <ModalEditar
          usuario={editando}
          cabecalhos={cabecalhos}
          onFechar={() => setEditando(null)}
          onSalvo={mensagem => {
            setEditando(null);
            setAviso(mensagem);
            carregar();
          }}
        />
      )}
    </div>
  );
};

/** Moldura comum das janelas modais. */
const Modal: React.FC<{ children: React.ReactNode; onFechar: () => void }> = ({
  children,
  onFechar,
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    onClick={onFechar}
  >
    <div
      onClick={e => e.stopPropagation()}
      className="w-full max-w-md overflow-hidden rounded-xl border border-fundo-borda bg-fundo-card shadow-2xl"
    >
      {children}
    </div>
  </div>
);

const ConfirmarAssumir: React.FC<{
  usuario: UsuarioAdmin;
  onCancelar: () => void;
  onConfirmar: () => void;
}> = ({ usuario, onCancelar, onConfirmar }) => (
  <Modal onFechar={onCancelar}>
    <div className="p-6">
      <p className="mb-3 flex items-center gap-2 font-semibold text-tinta-forte">
        <LogIn size={16} className="text-marca-azul" />
        Assumir usuário
      </p>
      <p className="text-sm leading-snug text-tinta-media">
        Você passará a atuar como <strong>{usuario.email}</strong> (papel:{' '}
        {usuario.papel === 'administrador' ? 'Administrador' : 'Usuário'}) e verá as análises
        e os documentos importados por ele.
      </p>

      <div className="mt-4 rounded-lg border border-fundo-borda bg-fundo-eleva p-3">
        <p className="text-xs font-semibold text-tinta-forte">Atenção</p>
        <p className="mt-1 text-xs leading-snug text-tinta-media">
          A ação fica registrada no log do servidor. Para voltar à sua conta, faça logout e
          entre novamente com o seu e-mail.
        </p>
      </div>
    </div>

    <div className="flex justify-end gap-2 border-t border-fundo-borda bg-fundo-eleva px-6 py-4">
      <button
        onClick={onCancelar}
        className="rounded-lg px-4 py-2 text-sm text-tinta-media transition hover:bg-fundo-borda"
      >
        Cancelar
      </button>
      <button
        onClick={onConfirmar}
        className="rounded-lg bg-marca-azul px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
      >
        Assumir
      </button>
    </div>
  </Modal>
);

const ConfirmarExclusao: React.FC<{
  usuario: UsuarioAdmin;
  onCancelar: () => void;
  onConfirmar: () => void;
}> = ({ usuario, onCancelar, onConfirmar }) => (
  <Modal onFechar={onCancelar}>
    <div className="p-6">
      <p className="mb-3 flex items-center gap-2 font-semibold text-tinta-forte">
        <Trash2 size={16} className="text-red-600" />
        Excluir usuário
      </p>
      <p className="text-sm leading-snug text-tinta-media">
        <strong>{usuario.email}</strong> perderá o acesso à plataforma. Esta ação não pode ser
        desfeita.
      </p>
    </div>

    <div className="flex justify-end gap-2 border-t border-fundo-borda bg-fundo-eleva px-6 py-4">
      <button
        onClick={onCancelar}
        className="rounded-lg px-4 py-2 text-sm text-tinta-media transition hover:bg-fundo-borda"
      >
        Cancelar
      </button>
      <button
        onClick={onConfirmar}
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
      >
        Excluir
      </button>
    </div>
  </Modal>
);

const ModalEditar: React.FC<{
  usuario: UsuarioAdmin;
  cabecalhos: any;
  onFechar: () => void;
  onSalvo: (mensagem: string) => void;
}> = ({ usuario, cabecalhos, onFechar, onSalvo }) => {
  const [nome, setNome] = useState(usuario.nome);
  const [email, setEmail] = useState(usuario.email);
  const [papel, setPapel] = useState(usuario.papel);
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const primeiroCampo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    primeiroCampo.current?.focus();
  }, []);

  const salvar = async () => {
    setErro(null);

    // A senha é opcional aqui: em branco, o hash atual é preservado.
    if (senha || confirmar) {
      if (senha.length < 8) {
        setErro('A senha deve ter ao menos 8 caracteres.');
        return;
      }
      if (senha !== confirmar) {
        setErro('As duas senhas não conferem.');
        return;
      }
    }

    setSalvando(true);
    try {
      await axios.patch(
        `${API_URL}/api/v1/admin/usuarios/${usuario.userId}`,
        { nome, email, papel, ...(senha ? { senha } : {}) },
        cabecalhos
      );
      onSalvo(
        senha
          ? `Dados de ${email} atualizados e senha redefinida.`
          : `Dados de ${email} atualizados.`
      );
    } catch (e: any) {
      setErro(e.response?.data?.error || 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const classeCampo =
    'w-full rounded-lg border border-fundo-borda px-3 py-2 text-sm text-tinta-forte';

  return (
    <Modal onFechar={onFechar}>
      <div className="p-6">
        <div className="mb-1 flex items-start justify-between">
          <p className="font-semibold text-tinta-forte">Editar usuário</p>
          <button onClick={onFechar} className="text-tinta-suave hover:text-tinta-forte">
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-sm text-tinta-suave">
          Atualize os dados abaixo e clique em salvar.
        </p>

        {erro && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {erro}
          </div>
        )}

        <label className="mb-1 block text-sm font-medium text-tinta-forte">Nome completo</label>
        <input
          ref={primeiroCampo}
          value={nome}
          onChange={e => setNome(e.target.value)}
          className={`${classeCampo} mb-4`}
        />

        <label className="mb-1 block text-sm font-medium text-tinta-forte">E-mail</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className={`${classeCampo} mb-4`}
        />

        <label className="mb-1 block text-sm font-medium text-tinta-forte">Papel</label>
        <select
          value={papel}
          onChange={e => setPapel(e.target.value as UsuarioAdmin['papel'])}
          className={`${classeCampo} mb-4`}
        >
          {PAPEIS.map(p => (
            <option key={p.valor} value={p.valor}>
              {p.nome}
            </option>
          ))}
        </select>

        <div className="rounded-lg border border-fundo-borda bg-fundo-eleva p-3">
          <p className="mb-2 text-xs text-tinta-suave">
            Deixe as senhas em branco para manter a atual.
          </p>

          <label className="mb-1 block text-sm font-medium text-tinta-forte">Nova senha</label>
          <div className="relative mb-3">
            <input
              type={verSenha ? 'text' : 'password'}
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder="mínimo de 8 caracteres"
              autoComplete="new-password"
              className={`${classeCampo} pr-10`}
            />
            <button
              type="button"
              onClick={() => setVerSenha(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-tinta-suave"
              aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {verSenha ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <label className="mb-1 block text-sm font-medium text-tinta-forte">
            Confirmar senha
          </label>
          <input
            type={verSenha ? 'text' : 'password'}
            value={confirmar}
            onChange={e => setConfirmar(e.target.value)}
            placeholder="repita a nova senha"
            autoComplete="new-password"
            className={classeCampo}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-fundo-borda bg-fundo-eleva px-6 py-4">
        <button
          onClick={onFechar}
          className="rounded-lg px-4 py-2 text-sm text-tinta-media transition hover:bg-fundo-borda"
        >
          Cancelar
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-lg bg-marca-azul px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </Modal>
  );
};
