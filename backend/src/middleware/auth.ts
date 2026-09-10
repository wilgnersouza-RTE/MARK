import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { JWTPayload } from '../types';

// Estender tipos do Express
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
      sessionId?: string;
    }
  }
}

/**
 * Resolve qual sessão a requisição pode acessar.
 *
 * O header x-session-id só é aceito se a sessão pertencer ao dono do token —
 * caso contrário qualquer usuário autenticado poderia ler os documentos de
 * outro apenas trocando o header. Não sendo válido, cai no sessionId do token.
 */
function resolverSessionId(req: Request, decoded: JWTPayload): string {
  const doToken = decoded.sessionId || `sess-${decoded.userId}`;
  const doHeader = req.headers['x-session-id'] as string | undefined;

  if (!doHeader) {
    return doToken;
  }

  const prefixoDoUsuario = `sess-${decoded.userId}-`;
  const pertenceAoUsuario =
    doHeader === doToken ||
    doHeader === `sess-${decoded.userId}` ||
    doHeader.startsWith(prefixoDoUsuario);

  return pertenceAoUsuario ? doHeader : doToken;
}

/**
 * Middleware de autenticação JWT
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido',
        timestamp: new Date().toISOString(),
      });
    }

    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
    req.user = decoded;

    // O sessionId precisa ser ESTÁVEL entre requisições, senão o upload grava
    // numa sessão e o dashboard lê de outra. Ordem de precedência:
    // header enviado pelo cliente > sessionId embutido no token > derivado do userId.
    req.sessionId = resolverSessionId(req, decoded);

    next();
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      error: err.message === 'jwt expired' ? 'Token expirado' : 'Token inválido',
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Middleware opcional de autenticação (não falha se não tiver token)
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);

    if (token) {
      const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
      req.user = decoded;
      req.sessionId = resolverSessionId(req, decoded);
    } else {
      // Usar UUID como session anônima
      req.sessionId = `anonymous-${Date.now()}`;
    }

    next();
  } catch (err) {
    // Se token existe mas é inválido, falhar
    return res.status(401).json({
      success: false,
      error: 'Token inválido',
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Extrai token do header Authorization
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2) {
    return null;
  }

  const [scheme, token] = parts;

  if (scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token;
}

/**
 * Gerar JWT token
 */
export function generateToken(userId: string, email: string, sessionId?: string): string {
  const options: SignOptions = {
    expiresIn: config.jwt.expiry as SignOptions['expiresIn'],
    algorithm: 'HS256',
  };

  return jwt.sign(
    {
      userId,
      email,
      sessionId,
    },
    config.jwt.secret,
    options
  );
}

/**
 * Validar JWT token
 */
export function validateToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, config.jwt.secret) as JWTPayload;
  } catch (err) {
    return null;
  }
}
