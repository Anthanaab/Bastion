# Bastion — Passerelle d'accès distant

Interface web pour se connecter à vos machines en **SSH**, **RDP** et **VNC** depuis un navigateur.

**Version actuelle : 1.9.0**

## Démarrage rapide (Docker)

```bash
cp .env.example .env
# Modifiez JWT_SECRET et BASTION_ADMIN_PASSWORD dans .env

docker compose up -d --build
```

Ouvrez **http://localhost:3000** — identifiants par défaut : `admin` / `admin`

## Fonctionnalités

### Connexions
- Terminal SSH (xterm.js)
- Bureau distant RDP/VNC via guacd
- Reconnexion automatique (RDP/VNC/SSH) avec backoff
- Outils RDP : plein écran, Ctrl+Alt+Suppr, presse-papiers
- **Réglages RDP** en session : résolution (auto/manuel) et profils qualité (performance / équilibré / qualité)

### Gestion des machines
- Tableau de bord : recherche, filtres protocole/tags
- Statut en ligne/hors ligne (polling 10 s) + notifications
- Favoris (machines épinglées)
- Wake-on-LAN intelligent (attente mise en ligne)
- Import / export JSON des hôtes

### Multi-utilisateur (v1.6+)
- Rôles **admin** / **opérateur**
- Accès par machine et par **groupes** réutilisables
- Journal d'audit filtré pour les opérateurs

### Sécurité
- JWT + sessions révocables (déconnexion forcée admin)
- 2FA TOTP avec **QR code** (Google Authenticator, etc.)
- Chiffrement AES des identifiants hôtes
- Rate limit login, SSH TOFU, relais WoL authentifié

### Activité
- Historique des sessions
- Sessions distantes actives (admin) + coupure à distance
- Journal d'audit

### Ops
- Healthcheck Docker (`/api/health`)
- Sauvegarde auto de `bastion.json` (toutes les 6 h, 14 rotations)

## HTTPS avec Traefik

Exemple de labels (adapter le domaine) :

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.bastion.rule=Host(`bastion.example.com`)
  - traefik.http.routers.bastion.entrypoints=websecure
  - traefik.http.routers.bastion.tls.certresolver=letsencrypt
  - traefik.http.services.bastion.loadbalancer.server.port=3000
```

Variables à activer :

```env
BASTION_COOKIE_SECURE=true
BASTION_CORS_ORIGIN=https://bastion.example.com
BASTION_TRUST_PROXY=1
```

Les WebSockets (`/ws/ssh`, `/ws/guacd`) doivent passer par le même routeur Traefik.

> L'authentification (HTTP comme WebSocket) repose sur un cookie httpOnly —
> utilisez HTTPS en production pour qu'il transite chiffré.

## Wake-on-LAN

1. Renseignez la **MAC** (broadcast optionnel, ex. `192.168.50.255`)
2. Cliquez **Réveiller** — Bastion attend jusqu'à 2 min que la machine réponde

Avec Docker, le service `wol-relay` (réseau host) envoie les paquets sur le LAN.

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port HTTP | `3000` |
| `JWT_SECRET` | Secret JWT (16+ car., ≠ valeur d'exemple) | *(obligatoire en prod)* |
| `BASTION_ENCRYPTION_KEY` | Clé AES-256 hôtes (64 hex) | dérivée de `JWT_SECRET` |
| `BASTION_COOKIE_SECURE` | Cookie HTTPS only | `false` |
| `BASTION_CORS_ORIGIN` | Origines CORS (virgules) | aucune (CORS désactivé) |
| `BASTION_TRUST_PROXY` | Sauts de reverse-proxy à faire confiance (IP rate-limit) | désactivé |
| `BASTION_ADMIN_USER` / `BASTION_ADMIN_PASSWORD` | Compte initial | `admin` / `admin` |
| `WOL_RELAY_URL` / `WOL_RELAY_SECRET` | Relais WoL | voir `.env.example` |
| `DATABASE_PATH` | Fichier JSON | `/app/data/bastion.json` |

## Architecture

```
Navigateur ──► Bastion (Node.js) ──► SSH direct
                    │
                    └── WebSocket ──► guacd ──► RDP / VNC
```

## Changelog récent

| Version | Highlights |
|---------|------------|
| **1.9.0** | Durcissement sécurité : rejet du `JWT_SECRET` par défaut au démarrage, sessions liées au `userId`, `trust proxy` désactivé par défaut, token retiré des URL WebSocket, CORS resserré, conteneur non-root, déchiffrement défensif des secrets hôtes/TOTP |
| **1.8.1** | QR 2FA, révocation sessions UI, groupes à la création user |
| **1.8.0** | Groupes, 2FA, favoris, WoL intelligent, sessions live, réglages RDP (résolution/qualité) |
| **1.7.0** | Accès par machine pour opérateurs |
| **1.6.0** | Multi-user, reconnexion auto, polling statut |
| **1.5.0** | Historique sessions, audit, import/export |
