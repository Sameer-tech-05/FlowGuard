import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db } from './db';

const JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET !== 'replace-with-strong-random-secret'
    ? process.env.JWT_SECRET
    : crypto.createHash('sha256').update('flowguard-local-dev-secret-2026').digest('hex');

export const SESSION_COOKIE_NAME = 'fg_session';

export interface AuthContext {
  userId: string;
  email: string;
  fullName: string;
  role: 'owner' | 'member' | 'admin';
  businessId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function signSessionToken(payload: AuthContext): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifySessionToken(token: string): AuthContext | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthContext;
  } catch {
    return null;
  }
}

function isHttpsRequest(req?: Request): boolean {
  if (!req) return process.env.NODE_ENV === 'production';
  const proto = req.headers['x-forwarded-proto'];
  return req.secure || (typeof proto === 'string' && proto.split(',')[0].trim() === 'https');
}

export function setSessionCookie(res: Response, token: string, req?: Request): void {
  const https = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: https ? 'none' : 'lax',
    secure: https,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response, req?: Request): void {
  const https = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: https ? 'none' : 'lax',
    secure: https,
  });
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }

  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken) return cookieToken;

  return null;
}

export function resolveAuthFromToken(token: string): AuthContext | null {
  const decoded = verifySessionToken(token);
  if (!decoded) return null;

  const user = db
    .prepare('SELECT id, email, full_name, role FROM users WHERE id = ?')
    .get(decoded.userId) as
    | { id: string; email: string; full_name: string; role: 'owner' | 'member' | 'admin' }
    | undefined;

  if (!user) return null;

  // Always re-resolve authoritative business membership from DB
  let activeBusinessId: string | null = null;
  if (decoded.businessId) {
    const member = db
      .prepare('SELECT business_id FROM business_memberships WHERE business_id = ? AND user_id = ?')
      .get(decoded.businessId, user.id) as { business_id: string } | undefined;
    if (member) {
      activeBusinessId = member.business_id;
    }
  }
  if (!activeBusinessId) {
    const firstMember = db
      .prepare('SELECT business_id FROM business_memberships WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
      .get(user.id) as { business_id: string } | undefined;
    activeBusinessId = firstMember?.business_id ?? null;
  }

  return {
    userId: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    businessId: activeBusinessId,
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const auth = resolveAuthFromToken(token);
  if (!auth) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  req.auth = auth;
  next();
}

export function requireBusiness(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!req.auth.businessId) {
    res.status(403).json({
      error: 'Business profile onboarding required before accessing workspace records.',
      code: 'ONBOARDING_REQUIRED',
    });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (req.auth.role !== 'admin') {
    res.status(403).json({ error: 'Administrator privileges required.' });
    return;
  }
  next();
}

// Simple sliding-window in-memory rate limiter for auth & AI endpoints
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || 'local';
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (bucket.count >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please wait a moment before trying again.',
      });
      return;
    }
    bucket.count += 1;
    next();
  };
}
