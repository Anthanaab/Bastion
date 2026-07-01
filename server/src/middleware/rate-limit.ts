import type { Request, Response, NextFunction } from "express";

interface Window {
  count: number;
  resetAt: number;
}

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

export function createRateLimiter(maxAttempts: number, windowMs: number) {
  // Une Map par limiteur : deux appels à createRateLimiter() ne doivent
  // jamais partager leurs compteurs (sinon /login et /me/totp/confirm,
  // par ex., s'épuiseraient mutuellement pour une même IP).
  const windows = new Map<string, Window>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now > entry.resetAt) windows.delete(key);
    }
  }, CLEANUP_INTERVAL_MS).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip =
      (typeof req.ip === "string" && req.ip) ||
      req.socket.remoteAddress ||
      "unknown";
    const now = Date.now();

    let entry = windows.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      windows.set(ip, entry);
    }

    entry.count += 1;
    if (entry.count > maxAttempts) {
      res.status(429).json({
        error: "Trop de tentatives. Réessayez dans quelques minutes.",
      });
      return;
    }

    next();
  };
}

export const loginRateLimit = createRateLimiter(10, 15 * 60 * 1000);
export const totpConfirmRateLimit = createRateLimiter(10, 15 * 60 * 1000);
