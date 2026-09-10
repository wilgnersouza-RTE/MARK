/**
 * Router de Autenticação
 * POST /api/v1/auth/login - Fazer login
 * POST /api/v1/auth/register - Registrar novo usuário
 * GET /api/v1/auth/verify - Verificar token
 */
import { Router, Request, Response } from 'express';
import { authenticate, generateToken } from '../middleware/auth';
import { sessionService } from '../services/session';
import { usuarioService } from '../services/usuarios';
import { AuthRequest, AuthResponse } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';

const router = Router();

/**
 * POST /api/v1/auth/login
 * Fazer login e obter JWT token
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as AuthRequest;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'E-mail e senha são obrigatórios',
        timestamp: new Date().toISOString(),
      });
    }

    // Validação real: e-mail cadastrado e senha conferida contra o hash bcrypt
    const usuario = await usuarioService.autenticar(email, password);

    // Criar a sessão ANTES de emitir o token, e amarrar as duas coisas.
    const sessionId = `sess-${usuario.userId}-${uuidv4().slice(0, 8)}`;
    sessionService.criarOuRecuperarSessao(sessionId, usuario.userId, usuario.email);

    const token = generateToken(usuario.userId, usuario.email, sessionId);

    const response: AuthResponse = {
      token,
      sessionId,
      user: {
        userId: usuario.userId,
        email: usuario.email,
        nome: usuario.nome,
      },
      expiresIn: config.jwt.expiry,
    };

    res.json({
      success: true,
      data: response,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    // Credencial errada é 401, não 500
    res.status(401).json({
      success: false,
      error: error.message || 'E-mail ou senha incorretos.',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/v1/auth/register
 * Registrar novo usuário
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, nome } = req.body as AuthRequest & { nome?: string };

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'E-mail e senha são obrigatórios',
        timestamp: new Date().toISOString(),
      });
    }

    // Cria o usuário com senha em hash bcrypt e recusa e-mail duplicado
    const usuario = await usuarioService.criar(email, password, nome);

    const sessionId = `sess-${usuario.userId}-${uuidv4().slice(0, 8)}`;
    sessionService.criarOuRecuperarSessao(sessionId, usuario.userId, usuario.email);

    const token = generateToken(usuario.userId, usuario.email, sessionId);

    const response: AuthResponse = {
      token,
      sessionId,
      user: {
        userId: usuario.userId,
        email: usuario.email,
        nome: usuario.nome,
      },
      expiresIn: config.jwt.expiry,
    };

    res.status(201).json({
      success: true,
      data: response,
      message: 'Conta criada com sucesso',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    // Erros de validação (e-mail duplicado, senha curta) são 400
    res.status(400).json({
      success: false,
      error: error.message || 'Erro ao criar conta',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/auth/status
 * Informa se já existe algum usuário — a tela usa isso para exibir
 * "criar primeira conta" em vez de "entrar" numa instalação nova.
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: { possuiUsuarios: await usuarioService.existeAlgum() },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/v1/auth/esqueci-senha
 * Gera token de redefinição. Responde sucesso mesmo para e-mail inexistente,
 * para não revelar quais endereços possuem conta.
 */
router.post('/esqueci-senha', async (req: Request, res: Response) => {
  try {
    const { email } = req.body as { email?: string };

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Informe o e-mail',
        timestamp: new Date().toISOString(),
      });
    }

    const resultado = await usuarioService.solicitarRecuperacao(email);

    res.json({
      success: true,
      data: {
        mensagem:
          'Se houver uma conta com este e-mail, as instruções de redefinição foram geradas.',
        // Fora de produção o token volta aqui, porque não há SMTP configurado
        token: resultado.token,
        expiraEm: resultado.expiraEm,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/v1/auth/redefinir-senha
 */
router.post('/redefinir-senha', async (req: Request, res: Response) => {
  try {
    const { token, novaSenha } = req.body as { token?: string; novaSenha?: string };

    if (!token || !novaSenha) {
      return res.status(400).json({
        success: false,
        error: 'Token e nova senha são obrigatórios',
        timestamp: new Date().toISOString(),
      });
    }

    const usuario = await usuarioService.redefinirSenha(token, novaSenha);

    res.json({
      success: true,
      data: { mensagem: 'Senha redefinida com sucesso.', email: usuario.email },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/auth/verify
 * Verificar se token é válido
 */
router.get('/verify', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      data: {
        user,
        sessionId: req.sessionId,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(401).json({
      success: false,
      error: 'Token inválido',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/v1/auth/session-info
 * Obter informações da sessão
 */
router.get('/session-info', authenticate, async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        userId: req.user?.userId,
        email: req.user?.email,
        sessionId: req.sessionId,
        authenticatedAt: new Date(req.user?.iat! * 1000).toISOString(),
        expiresAt: new Date(req.user?.exp! * 1000).toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
