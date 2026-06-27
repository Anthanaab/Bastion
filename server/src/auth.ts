import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getUserById, type UserRole } from "./db";

export interface AuthPayload {
  userId: string;
  username: string;
  role: UserRole;
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
    const payload = verifyToken(token);
    const user = getUserById(payload.userId);
    if (!user) {
      res.status(401).json({ error: "Utilisateur introuvable" });
      return;
    }
    req.user = {
      userId: user.id,
      username: user.username,
      role: user.role,
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
    const user = getUserById(payload.userId);
    if (!user) return null;
    return {
      userId: user.id,
      username: user.username,
      role: user.role,
    };
  } catch {
    return null;
  }
}

export function wsAuthFromUrl(url: string): AuthPayload | null {
  return wsAuthFromRequest(url);
}
