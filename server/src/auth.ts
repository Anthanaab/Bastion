import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  userId: string;
  username: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set and at least 16 characters");
    }
    return secret || "dev-secret-change-in-prod";
  }
  return secret;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
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
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Session expirée" });
  }
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
    return verifyToken(token);
  } catch {
    return null;
  }
}

export function wsAuthFromUrl(url: string): AuthPayload | null {
  return wsAuthFromRequest(url);
}
