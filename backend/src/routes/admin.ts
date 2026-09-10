/**
 * Área administrativa.
 *
 * GET    /api/v1/admin/usuarios          - lista de usuários
 * PATCH  /api/v1/admin/usuarios/:id      - edita nome, e-mail, papel e senha
 * DELETE /api/v1/admin/usuarios/:id      - remove o usuário
 * POST   /api/v1/admin/usuarios/:id/assumir - emite token para atuar como ele
 *
 * Toda rota aqui passa por authenticate seguido de apenasAdministrador. A
 * verificação de papel consulta o cadastro, não o token, para que rebaixar
 * alguém tenha efeito imediato.
 */
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, apenasAdministrador, generateToken } from '../middleware/auth';
import { usuarioService, PapelUsuario } from '../services/usuarios';
import { sessionService } from '../services/session';
import { config } from '../config';

const router = Router();

router.use(authenticate, apenasAdministrador);

/** Lista de usuários para a tela de administração. */
router.get('/usuarios', async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: await usuarioService.listar(),
      timestamp: new Date().toISOString(),
    });
  } catch (erro: any) {
    res.status(500).json({ success: false, error: erro.message });
  }
});

/** Edita dados do usuário. A senha só é trocada quando vier preenchida. */
router.patch('/usuarios/:id', async (req: Request, res: Response) => {
  try {
    const { nome, email, papel, senha } = req.body as {
      nome?: string;
      email?: string;
      papel?: PapelUsuario;
      senha?: string;
    };

    if (papel && papel !== 'administrador' && papel !== 'usuario') {
      return res.status(400).json({ success: false, error: 'Papel inválido.' });
    }

    const atualizado = await usuarioService.atualizarComoAdmin(req.params.id, {
      nome,
      email,
      papel,
      senha,
    });

    // Registro mínimo de auditoria: trocar a senha de outra pessoa é uma
    // ação sensível e precisa deixar rastro no log do servidor.
    if (senha) {
      console.log(
        `[admin] ${req.user?.email} redefiniu a senha de ${atualizado.email} em ${new Date().toISOString()}`
      );
    }

    res.json({ success: true, data: atualizado, timestamp: new Date().toISOString() });
  } catch (erro: any) {
    res.status(400).json({ success: false, error: erro.message });
  }
});

/** Remove um usuário. O último administrador não pode ser removido. */
router.delete('/usuarios/:id', async (req: Request, res: Response) => {
  try {
    if (req.params.id === req.user?.userId) {
      return res.status(400).json({
        success: false,
        error: 'Você não pode excluir a própria conta.',
      });
    }

    const resultado = await usuarioService.excluir(req.params.id);
    console.log(`[admin] ${req.user?.email} excluiu ${resultado.removido}`);

    res.json({ success: true, data: resultado, timestamp: new Date().toISOString() });
  } catch (erro: any) {
    res.status(400).json({ success: false, error: erro.message });
  }
});

/**
 * Assume a conta de outro usuário.
 *
 * Emite um token novo em nome dele, marcado com `assumidoPor`. A sessão é
 * criada com o id do usuário assumido, então o painel carrega os documentos
 * e as análises dele — que é o objetivo. O administrador volta para a própria
 * conta fazendo logout, porque o token original continua válido no navegador
 * até ser descartado.
 */
router.post('/usuarios/:id/assumir', async (req: Request, res: Response) => {
  try {
    const alvo = await usuarioService.buscarPorId(req.params.id);

    if (!alvo) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
    }
    if (!alvo.ativo) {
      return res.status(400).json({ success: false, error: 'Esta conta está inativa.' });
    }
    if (alvo.id === req.user?.userId) {
      return res.status(400).json({ success: false, error: 'Você já está nesta conta.' });
    }

    // Reaproveita a sessão em que o usuário importou as notas. Criar uma
    // sessão nova entregaria um painel vazio, e ver as análises dele é o
    // motivo de existir esta rota. Só quando ele não tem nada importado é
    // que uma sessão limpa é criada.
    const existente = sessionService.sessaoComDocumentosDoUsuario(alvo.id);
    const sessionId = existente?.sessionId ?? `sess-${alvo.id}-${uuidv4().slice(0, 8)}`;

    if (!existente) {
      sessionService.criarOuRecuperarSessao(sessionId, alvo.id, alvo.email);
    }

    const assumidoPor = { userId: req.user!.userId, email: req.user!.email };

    const token = generateToken(alvo.id, alvo.email, sessionId, {
      papel: alvo.papel ?? 'usuario',
      assumidoPor,
    });

    console.log(
      `[admin] ${req.user?.email} assumiu a conta de ${alvo.email} em ${new Date().toISOString()}`
    );

    res.json({
      success: true,
      data: {
        token,
        sessionId,
        user: {
          userId: alvo.id,
          email: alvo.email,
          nome: alvo.nome,
          papel: alvo.papel ?? 'usuario',
        },
        assumidoPor,
        expiresIn: config.jwt.expiry,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (erro: any) {
    res.status(400).json({ success: false, error: erro.message });
  }
});

export default router;
