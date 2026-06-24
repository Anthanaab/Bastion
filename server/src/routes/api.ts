import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import {
  createHost,
  deleteHost,
  findUserByUsername,
  getHost,
  getStats,
  listHosts,
  updateHost,
  type Protocol,
  type Host,
} from "../db";
import { authMiddleware, signToken } from "../auth";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const hostSchema = z.object({
  name: z.string().min(1).max(100),
  hostname: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(["ssh", "rdp", "vnc"]),
  username: z.string().max(255).default(""),
  password: z.string().nullable().optional(),
  privateKey: z.string().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f59e0b"),
  tags: z.string().max(500).default(""),
});

router.post("/login", (req, res) => {
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

  const token = signToken({ userId: user.id, username: user.username });
  res.cookie("bastion_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.BASTION_COOKIE_SECURE === "true",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ token, user: { username: user.username } });
});

router.post("/logout", (_req, res) => {
  res.clearCookie("bastion_token");
  res.json({ ok: true });
});

router.get("/me", authMiddleware, (req, res) => {
  res.json({ user: { username: req.user!.username } });
});

router.get("/stats", authMiddleware, (_req, res) => {
  res.json(getStats());
});

router.get("/hosts", authMiddleware, (_req, res) => {
  const hosts = listHosts().map((h: Host) => ({
    ...h,
    password: h.password ? "••••••••" : null,
    privateKey: h.privateKey ? "[clé privée]" : null,
  }));
  res.json(hosts);
});

router.get("/hosts/:id", authMiddleware, (req, res) => {
  const host = getHost(req.params.id);
  if (!host) {
    res.status(404).json({ error: "Hôte introuvable" });
    return;
  }
  res.json({
    ...host,
    password: host.password ?? "",
    privateKey: host.privateKey ?? "",
  });
});

router.post("/hosts", authMiddleware, (req, res) => {
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
  });

  res.status(201).json(host);
});

router.put("/hosts/:id", authMiddleware, (req, res) => {
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
  res.json(host);
});

router.delete("/hosts/:id", authMiddleware, (req, res) => {
  const ok = deleteHost(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Hôte introuvable" });
    return;
  }
  res.json({ ok: true });
});

router.post("/sessions/ping", authMiddleware, (req, res) => {
  const hostId = req.body?.hostId as string | undefined;
  const host = hostId ? getHost(hostId) : undefined;
  console.log(
    `[Session] ping ${host?.protocol ?? "?"} → ${host?.hostname ?? hostId} (user: ${req.user!.username})`
  );
  res.json({
    ok: true,
    version: "1.0.11",
    host: host
      ? { id: host.id, name: host.name, protocol: host.protocol }
      : null,
    wsPath: "/ws/guacd",
  });
});

export default router;

export { hostSchema };
