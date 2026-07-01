import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import {
  createAuthSession,
  getUserById,
  isAuthSessionValid,
  revokeAuthSession,
  type UserRole,
} from "./db";

export interface AuthPayload {
  userId: string;
  username: string;
  role: UserRole;
  jti: string;
}

export interface TotpChallengePayload {
  userId: string;
  purpose: "totp";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

const INSECURE_DEFAULT_SECRETS = new Set([
  "changez-moi-en-production-avec-une-longue-chaine-aleatoire",
  "dev-secret-change-in-prod",
]);

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret || secret.length < 16) {
    if (isProd) {
      throw new Error("JWT_SECRET must be set and at least 16 characters");
    }
    return secret || "dev-secret-change-in-prod";
  }

  if (isProd && INSECURE_DEFAULT_SECRETS.has(secret)) {
    throw new Error(
      "JWT_SECRET utilise la valeur d'exemple par défaut du dépôt — générez un secret aléatoire (ex: openssl rand -hex 32) avant de démarrer en production."
    );
  }

  return secret;
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

export function signTotpChallenge(userId: string): string {
  return jwt.sign({ userId, purpose: "totp" } satisfies TotpChallengePayload, getJwtSecret(), {
    expiresIn: "5m",
  });
}

export function verifyTotpChallenge(token: string): TotpChallengePayload | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as TotpChallengePayload;
    if (payload.purpose !== "totp") return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueLoginToken(user: {
  id: string;
  username: string;
  role: UserRole;
}): string {
  const jti = uuid();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  createAuthSession(user.id, jti, expiresAt);
  return signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    jti,
  });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, getJwtSecret()) as AuthPayload;
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  const cookieToken = req.cookies?.bastion_token as string | undefined;
  const token =
    header?.startsWith("Bearer ") ? header.slice(7) : cookieToken;

  if (!token) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  try {
    const payload = verifyToken(token);
    if (!payload.jti || !isAuthSessionValid(payload.jti, payload.userId)) {
      res.status(401).json({ error: "Session révoquée ou expirée" });
      return;
    }
    const user = getUserById(payload.userId);
    if (!user) {
      res.status(401).json({ error: "Utilisateur introuvable" });
      return;
    }
    req.user = {
      userId: user.id,
      username: user.username,
      role: user.role,
      jti: payload.jti,
    };
    next();
  } catch {
    res.status(401).json({ error: "Session expirée" });
  }
}

export function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Droits administrateur requis" });
    return;
  }
  next();
}

export function revokeCurrentToken(jti: string): void {
  revokeAuthSession(jti);
}

export function wsAuthFromRequest(
  url: string,
  cookieHeader?: string
): AuthPayload | null {
  try {
    const params = new URL(url, "http://localhost").searchParams;
    let token = params.get("token")?.trim();
    if (!token && cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)bastion_token=([^;]+)/);
      if (match?.[1]) token = decodeURIComponent(match[1]);
    }
    if (!token) return null;
    const payload = verifyToken(token);
    if (!payload.jti || !isAuthSessionValid(payload.jti, payload.userId)) return null;
    const user = getUserById(payload.userId);
    if (!user) return null;
    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      jti: payload.jti,
    };
  } catch {
    return null;
  }
}

export function wsAuthFromUrl(url: string): AuthPayload | null {
  return wsAuthFromRequest(url);
}
