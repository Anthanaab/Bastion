import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import {
  canUserAccessHost,
  filterValidHostIds,
  createGroup,
  createHost,
  createUser,
  deleteGroup,
  deleteHost,
  deleteUser,
  disableUserTotp,
  enableUserTotp,
  exportHostsBundle,
  findUserByUsername,
  getGroup,
  getHost,
  getStats,
  getUserById,
  getUserTotpSecret,
  importHosts,
  listGroups,
  listHostsForUser,
  listSessions,
  listUsers,
  revokeAllAuthSessionsForUser,
  setUserTotpPending,
  updateGroup,
  updateHost,
  updateUser,
  updateUserPassword,
  updateUserPins,
  type Protocol,
  type Host,
} from "../db";
import { logAudit, listAudit, listAuditForUser } from "../audit";
import {
  adminMiddleware,
  authMiddleware,
  issueLoginToken,
  revokeCurrentToken,
  signTotpChallenge,
  verifyTotpChallenge,
} from "../auth";
import { probeTcp } from "../probe";
import { isValidMac, wakeHost } from "../wol";
import { loginRateLimit } from "../middleware/rate-limit";
import {
  encryptTotpSecret,
  generateTotpSecret,
  totpKeyUri,
  verifyTotpToken,
} from "../totp";
import {
  listLiveSessions,
  terminateLiveSession,
} from "../session-registry";
import { endSession } from "../db";

function maskHostSecrets(host: Host): Host {
  return {
    ...host,
    password: host.password ? "••••••••" : null,
    privateKey: host.privateKey ? "[clé privée]" : null,
  };
}

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().length(6).optional(),
});

const totpLoginSchema = z.object({
  challenge: z.string().min(1),
  code: z.string().length(6),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const macAddressSchema = z
  .string()
  .max(17)
  .nullable()
  .optional()
  .transform((value) => {
    if (!value?.trim()) return null;
    return value.trim();
  })
  .refine((value) => value === null || isValidMac(value), {
    message: "Adresse MAC invalide",
  });

const hostSchema = z.object({
  name: z.string().min(1).max(100),
  hostname: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["ssh", "rdp", "vnc"]),
  username: z.string().max(255).default(""),
  password: z.string().nullable().optional(),
  privateKey: z.string().nullable().optional(),
  macAddress: macAddressSchema,
  wolBroadcast: z
    .string()
    .max(45)
    .nullable()
    .optional()
    .transform((value) => {
      if (!value?.trim()) return null;
      return value.trim();
    }),
  keyboardLayout: z.string().max(64).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f59e0b"),
  tags: z.string().max(500).default(""),
});

const importHostSchema = hostSchema.extend({
  id: z.string().uuid().optional(),
});

const importSchema = z.object({
  mode: z.enum(["merge", "replace"]),
  hosts: z.array(importHostSchema).min(1).max(200),
});

const exportBundleSchema = z.object({
  bastionExport: z.literal(1).optional(),
  hosts: z.array(importHostSchema).min(1).max(200),
});

const createUserSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(8).max(128),
  role: z.enum(["admin", "operator"]).default("operator"),
  allowedHostIds: z.array(z.string().uuid()).nullable().optional(),
  groupIds: z.array(z.string().uuid()).optional(),
});

const updateUserSchema = z.object({
  role: z.enum(["admin", "operator"]).optional(),
  password: z.string().min(8).max(128).optional(),
  allowedHostIds: z.array(z.string().uuid()).nullable().optional(),
  groupIds: z.array(z.string().uuid()).optional(),
});

const groupSchema = z.object({
  name: z.string().min(1).max(64),
  hostIds: z.array(z.string().uuid()).default([]),
});

const pinsSchema = z.object({
  pinnedHostIds: z.array(z.string().uuid()),
});

function setAuthCookie(res: import("express").Response, token: string): void {
  res.cookie("bastion_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.BASTION_COOKIE_SECURE === "true",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function loginResponse(
  res: import("express").Response,
  user: { id: string; username: string; role: import("../db").UserRole }
) {
  const token = issueLoginToken(user);
  setAuthCookie(res, token);
  const full = getUserById(user.id);
  res.json({
    token,
    user: {
      username: user.username,
      role: user.role,
      pinnedHostIds: full?.pinnedHostIds ?? [],
      totpEnabled: !!full?.totpEnabled,
    },
  });
}

router.post("/login", loginRateLimit, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Identifiants invalides" });
    return;
  }

  const user = findUserByUsername(parsed.data.username);
  if (!user || !bcrypt.compareSync(parsed.data.password, user.passwordHash)) {
    res.status(401).json({ error: "Utilisateur ou mot de passe incorrect" });
    return;
  }

  if (user.totpEnabled) {
    if (!parsed.data.totp) {
      res.json({
        requiresTotp: true,
        challenge: signTotpChallenge(user.id),
      });
      return;
    }
    const secret = getUserTotpSecret(user.id);
    if (!secret || !verifyTotpToken(secret, parsed.data.totp)) {
      res.status(401).json({ error: "Code 2FA invalide" });
      return;
    }
  }

  logAudit(user.username, "login", "Connexion réussie");
  loginResponse(res, user);
});

router.post("/login/totp", loginRateLimit, (req, res) => {
  const parsed = totpLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Code 2FA requis" });
    return;
  }
  const challenge = verifyTotpChallenge(parsed.data.challenge);
  if (!challenge) {
    res.status(401).json({ error: "Challenge expiré — reconnectez-vous" });
    return;
  }
  const user = getUserById(challenge.userId);
  if (!user?.totpEnabled) {
    res.status(401).json({ error: "2FA non activée" });
    return;
  }
  const secret = getUserTotpSecret(user.id);
  if (!secret || !verifyTotpToken(secret, parsed.data.code)) {
    res.status(401).json({ error: "Code 2FA invalide" });
    return;
  }
  logAudit(user.username, "login", "Connexion réussie (2FA)");
  loginResponse(res, user);
});

router.post("/logout", authMiddleware, (req, res) => {
  if (req.user?.jti) revokeCurrentToken(req.user.jti);
  res.clearCookie("bastion_token");
  res.json({ ok: true });
});

router.get("/me", authMiddleware, (req, res) => {
  const user = getUserById(req.user!.userId);
  res.json({
    user: {
      username: req.user!.username,
      role: req.user!.role,
      pinnedHostIds: user?.pinnedHostIds ?? [],
      totpEnabled: !!user?.totpEnabled,
    },
  });
});

router.put("/me/pins", authMiddleware, (req, res) => {
  const parsed = pinsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Liste de favoris invalide" });
    return;
  }
  const user = updateUserPins(req.user!.userId, parsed.data.pinnedHostIds);
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }
  res.json({ pinnedHostIds: user.pinnedHostIds });
});

router.get("/users", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(listUsers());
});

router.post("/users", authMiddleware, adminMiddleware, (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données utilisateur invalides" });
    return;
  }
  if (findUserByUsername(parsed.data.username)) {
    res.status(409).json({ error: "Ce nom d'utilisateur existe déjà" });
    return;
  }
  let allowedHostIds = parsed.data.allowedHostIds;
  if (
    parsed.data.role === "operator" &&
    allowedHostIds !== undefined &&
    allowedHostIds !== null
  ) {
    allowedHostIds = filterValidHostIds(allowedHostIds);
  }
  const user = createUser(
    parsed.data.username,
    parsed.data.password,
    parsed.data.role,
    allowedHostIds,
    parsed.data.groupIds
  );
  logAudit(req.user!.username, "user.create", `Utilisateur créé : ${user.username}`, {
    meta: { role: user.role },
  });
  res.status(201).json(user);
});

router.put("/users/:id", authMiddleware, adminMiddleware, (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (
    !parsed.success ||
    (!parsed.data.role &&
      !parsed.data.password &&
      parsed.data.allowedHostIds === undefined &&
      parsed.data.groupIds === undefined)
  ) {
    res.status(400).json({
      error: "Rôle, mot de passe, groupes ou machines autorisées requis",
    });
    return;
  }
  if (req.params.id === req.user!.userId && parsed.data.role === "operator") {
    res.status(400).json({ error: "Vous ne pouvez pas retirer vos propres droits admin" });
    return;
  }
  const updateData = { ...parsed.data };
  if (
    updateData.allowedHostIds !== undefined &&
    updateData.allowedHostIds !== null
  ) {
    updateData.allowedHostIds = filterValidHostIds(updateData.allowedHostIds);
  }
  const user = updateUser(req.params.id, updateData);
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }
  logAudit(req.user!.username, "user.update", `Utilisateur modifié : ${user.username}`);
  res.json(user);
});

router.delete("/users/:id", authMiddleware, adminMiddleware, (req, res) => {
  if (req.params.id === req.user!.userId) {
    res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte" });
    return;
  }
  const target = listUsers().find((u) => u.id === req.params.id);
  const ok = deleteUser(req.params.id);
  if (!ok) {
    res.status(400).json({ error: "Impossible de supprimer cet utilisateur" });
    return;
  }
  if (target) {
    logAudit(req.user!.username, "user.delete", `Utilisateur supprimé : ${target.username}`);
  }
  res.json({ ok: true });
});

router.post("/me/password", authMiddleware, (req, res) => {
  const parsed = passwordChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Le nouveau mot de passe doit contenir au moins 8 caractères",
    });
    return;
  }

  const user = findUserByUsername(req.user!.username);
  if (!user || !bcrypt.compareSync(parsed.data.currentPassword, user.passwordHash)) {
    res.status(401).json({ error: "Mot de passe actuel incorrect" });
    return;
  }

  updateUserPassword(user.id, parsed.data.newPassword);
  logAudit(req.user!.username, "password.change", "Mot de passe admin modifié");
  res.json({ ok: true });
});

router.get("/stats", authMiddleware, (req, res) => {
  res.json(getStats(req.user!.userId));
});

router.get("/hosts", authMiddleware, (req, res) => {
  const hosts = listHostsForUser(req.user!.userId).map((h: Host) => ({
    ...h,
    password: h.password ? "••••••••" : null,
    privateKey: h.privateKey ? "[clé privée]" : null,
  }));
  res.json(hosts);
});

router.get("/hosts/status", authMiddleware, async (req, res) => {
  const hosts = listHostsForUser(req.user!.userId);
  const entries = await Promise.all(
    hosts.map(async (host) => {
      try {
        const online = await probeTcp(host.hostname, host.port);
        return [host.id, online] as const;
      } catch {
        return [host.id, false] as const;
      }
    })
  );
  res.json(Object.fromEntries(entries));
});

router.get("/hosts/export", authMiddleware, adminMiddleware, (req, res) => {
  const bundle = exportHostsBundle();
  logAudit(req.user!.username, "host.export", `${bundle.hosts.length} hôte(s) exporté(s)`);
  res.json(bundle);
});

router.post("/hosts/import", authMiddleware, adminMiddleware, (req, res) => {
  const body = req.body as { mode?: string; hosts?: unknown };
  let mode: "merge" | "replace" = "merge";
  let hostsInput: unknown[] | undefined;

  const direct = importSchema.safeParse(req.body);
  if (direct.success) {
    mode = direct.data.mode;
    hostsInput = direct.data.hosts;
  } else {
    const bundle = exportBundleSchema.safeParse(req.body);
    if (!bundle.success) {
      res.status(400).json({ error: "Format d'import invalide" });
      return;
    }
    mode =
      body.mode === "replace" || body.mode === "merge" ? body.mode : "merge";
    hostsInput = bundle.data.hosts;
  }

  const rows = hostsInput as z.infer<typeof importHostSchema>[];
  const result = importHosts(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      hostname: row.hostname,
      port: row.port,
      protocol: row.protocol,
      username: row.username,
      password: row.password ?? null,
      privateKey: row.privateKey ?? null,
      macAddress: row.macAddress ?? null,
      wolBroadcast: row.wolBroadcast ?? null,
      keyboardLayout: row.keyboardLayout ?? null,
      color: row.color,
      tags: row.tags,
    })),
    mode
  );

  logAudit(
    req.user!.username,
    "host.import",
    `Import ${mode} : ${result.created} créé(s), ${result.updated} mis à jour`,
    { meta: { mode } }
  );

  res.json({ ok: true, ...result });
});

router.get("/sessions", authMiddleware, (req, res) => {
  const limit = Math.min(
    200,
    Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50)
  );
  res.json(listSessions(limit, req.user!.userId));
});

router.get("/audit", authMiddleware, (req, res) => {
  const limit = Math.min(
    500,
    Math.max(1, parseInt(String(req.query.limit ?? "100"), 10) || 100)
  );
  if (req.user!.role === "admin") {
    res.json(listAudit(limit));
    return;
  }
  const allowed = new Set(listHostsForUser(req.user!.userId).map((h) => h.id));
  res.json(listAuditForUser(req.user!.username, allowed, limit));
});

router.get("/groups", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(listGroups());
});

router.post("/groups", authMiddleware, adminMiddleware, (req, res) => {
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données groupe invalides" });
    return;
  }
  const group = createGroup(parsed.data.name, parsed.data.hostIds);
  logAudit(req.user!.username, "group.create", `Groupe créé : ${group.name}`);
  res.status(201).json(group);
});

router.put("/groups/:id", authMiddleware, adminMiddleware, (req, res) => {
  const parsed = groupSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Données groupe invalides" });
    return;
  }
  const group = updateGroup(req.params.id, parsed.data);
  if (!group) {
    res.status(404).json({ error: "Groupe introuvable" });
    return;
  }
  logAudit(req.user!.username, "group.update", `Groupe modifié : ${group.name}`);
  res.json(group);
});

router.delete("/groups/:id", authMiddleware, adminMiddleware, (req, res) => {
  const existing = getGroup(req.params.id);
  const ok = deleteGroup(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Groupe introuvable" });
    return;
  }
  if (existing) {
    logAudit(req.user!.username, "group.delete", `Groupe supprimé : ${existing.name}`);
  }
  res.json({ ok: true });
});

router.get("/sessions/live", authMiddleware, adminMiddleware, (_req, res) => {
  res.json(listLiveSessions());
});

router.post(
  "/sessions/:id/terminate",
  authMiddleware,
  adminMiddleware,
  (req, res) => {
    const ok = terminateLiveSession(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Session active introuvable" });
      return;
    }
    endSession(req.params.id);
    logAudit(req.user!.username, "session.terminate", `Session terminée : ${req.params.id}`);
    res.json({ ok: true });
  }
);

router.post(
  "/users/:id/revoke-sessions",
  authMiddleware,
  adminMiddleware,
  (req, res) => {
    const live = listLiveSessions().filter((s) => s.userId === req.params.id);
    for (const s of live) {
      terminateLiveSession(s.sessionId);
      endSession(s.sessionId);
    }
    const count = revokeAllAuthSessionsForUser(req.params.id);
    const target = getUserById(req.params.id);
    if (target) {
      logAudit(
        req.user!.username,
        "auth.revoke",
        `Sessions révoquées : ${target.username}`,
        { meta: { count: String(count) } }
      );
    }
    res.json({ ok: true, revoked: count });
  }
);

router.post("/me/totp/setup", authMiddleware, (req, res) => {
  const user = getUserById(req.user!.userId);
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }
  const secret = generateTotpSecret();
  setUserTotpPending(user.id, encryptTotpSecret(secret));
  res.json({
    secret,
    uri: totpKeyUri(user.username, secret),
  });
});

router.post("/me/totp/confirm", authMiddleware, (req, res) => {
  const code = String(req.body?.code ?? "");
  const secret = getUserTotpSecret(req.user!.userId);
  if (!secret || !verifyTotpToken(secret, code)) {
    res.status(400).json({ error: "Code 2FA invalide" });
    return;
  }
  enableUserTotp(req.user!.userId);
  logAudit(req.user!.username, "totp.enable", "2FA activée");
  res.json({ ok: true });
});

router.delete("/me/totp", authMiddleware, (req, res) => {
  const parsed = passwordChangeSchema
    .pick({ currentPassword: true })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Mot de passe actuel requis" });
    return;
  }
  const user = findUserByUsername(req.user!.username);
  if (!user || !bcrypt.compareSync(parsed.data.currentPassword, user.passwordHash)) {
    res.status(401).json({ error: "Mot de passe actuel incorrect" });
    return;
  }
  disableUserTotp(user.id);
  logAudit(req.user!.username, "totp.disable", "2FA désactivée");
  res.json({ ok: true });
});

router.get("/hosts/:id", authMiddleware, (req, res) => {
  const host = getHost(req.params.id);
  if (!host) {
    res.status(404).json({ error: "Hôte introuvable" });
    return;
  }
  if (!canUserAccessHost(req.user!.userId, host.id)) {
    res.status(403).json({ error: "Accès à cette machine non autorisé" });
    return;
  }
  if (req.user!.role === "admin") {
    res.json({
      ...host,
      password: host.password ?? "",
      privateKey: host.privateKey ?? "",
    });
    return;
  }
  res.json(maskHostSecrets(host));
});

router.post("/hosts", authMiddleware, adminMiddleware, (req, res) => {
  const parsed = hostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const host = createHost({
    id: uuid(),
    ...parsed.data,
    password: parsed.data.password ?? null,
    privateKey: parsed.data.privateKey ?? null,
    macAddress: parsed.data.macAddress ?? null,
    keyboardLayout: parsed.data.keyboardLayout ?? null,
    wolBroadcast: parsed.data.wolBroadcast ?? null,
  });

  logAudit(req.user!.username, "host.create", `Hôte créé : ${host.name}`, {
    hostId: host.id,
    hostName: host.name,
  });

  res.status(201).json(maskHostSecrets(host));
});

router.put("/hosts/:id", authMiddleware, adminMiddleware, (req, res) => {
  const parsed = hostSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const existing = getHost(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Hôte introuvable" });
    return;
  }

  const data = { ...parsed.data };
  if (data.password === "••••••••" || data.password === "") {
    delete data.password;
  }
  if (data.privateKey === "[clé privée]" || data.privateKey === "") {
    delete data.privateKey;
  }

  const host = updateHost(req.params.id, data);
  if (!host) {
    res.status(404).json({ error: "Hôte introuvable" });
    return;
  }
  logAudit(req.user!.username, "host.update", `Hôte modifié : ${host.name}`, {
    hostId: host.id,
    hostName: host.name,
  });
  res.json(maskHostSecrets(host));
});

router.delete("/hosts/:id", authMiddleware, adminMiddleware, (req, res) => {
  const existing = getHost(req.params.id);
  const ok = deleteHost(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Hôte introuvable" });
    return;
  }
  if (existing) {
    logAudit(req.user!.username, "host.delete", `Hôte supprimé : ${existing.name}`, {
      hostId: existing.id,
      hostName: existing.name,
    });
  }
  res.json({ ok: true });
});

router.post("/hosts/:id/wake", authMiddleware, async (req, res) => {
  const host = getHost(req.params.id);
  if (!host) {
    res.status(404).json({ error: "Hôte introuvable" });
    return;
  }
  if (!canUserAccessHost(req.user!.userId, host.id)) {
    res.status(403).json({ error: "Accès à cette machine non autorisé" });
    return;
  }
  if (!host.macAddress) {
    res.status(400).json({ error: "Aucune adresse MAC configurée pour cet hôte" });
    return;
  }

  try {
    const result = await wakeHost(host.macAddress, {
      hostname: host.hostname,
      wolBroadcast: host.wolBroadcast,
    });
    logAudit(req.user!.username, "wol", `Wake-on-LAN : ${host.name}`, {
      hostId: host.id,
      hostName: host.name,
    });

    const wait = req.body?.wait === true;
    let online = false;
    if (wait) {
      for (let i = 0; i < 60; i++) {
        online = await probeTcp(host.hostname, host.port);
        if (online) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    res.json({ ok: true, sentTo: result.sentTo, hint: result.hint, online });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Échec Wake-on-LAN";
    console.error(`[WOL] ${host.name}:`, message);
    res.status(500).json({ error: message });
  }
});

router.post("/sessions/ping", authMiddleware, (req, res) => {
  const hostId = req.body?.hostId as string | undefined;
  const host = hostId ? getHost(hostId) : undefined;
  if (host && !canUserAccessHost(req.user!.userId, host.id)) {
    res.status(403).json({ error: "Accès à cette machine non autorisé" });
    return;
  }
  console.log(
    `[Session] ping ${host?.protocol ?? "?"} → ${host?.hostname ?? hostId} (user: ${req.user!.username})`
  );
  res.json({
    ok: true,
    version: "1.9.0",
    host: host
      ? { id: host.id, name: host.name, protocol: host.protocol }
      : null,
    wsPath: "/ws/guacd",
  });
});

export default router;

export { hostSchema };
