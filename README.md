# Bastion — Passerelle d'accès distant

Interface web pour se connecter à vos machines en **SSH**, **RDP** et **VNC** depuis un navigateur.

**Version actuelle : 1.11.0**

## Installation LXC (Proxmox)

Depuis le shell de l'hôte Proxmox :

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Anthanaab/Bastion/main/scripts/bastion.sh)"
```

Un assistant propose **Paramètres recommandés** (2 vCPU / 2 Go / 8 Go, DHCP,
mot de passe admin généré) ou **Paramètres avancés** : CTID, nom d'hôte, CPU,
RAM, disque, stockage, pont réseau, IP fixe ou DHCP, mot de passe root, serveur
SSH, puis port HTTP, compte admin et URL publique si Bastion passe derrière un
reverse-proxy HTTPS.

Le script crée ensuite un conteneur Debian non privilégié, y installe Node 22,
`guacd` et Bastion, génère les secrets et affiche l'URL et le mot de passe admin.

Sans assistant (CI, ou `whiptail` absent), tout est surchargeable par variable :
`CTID`, `CT_HOSTNAME`, `CORES`, `RAM`, `DISK`, `STORAGE`, `BRIDGE`, `ENABLE_SSH`,
`BASTION_PORT`, `NET_CONF` (ex. `NET_CONF="ip=192.168.1.50/24,gw=192.168.1.1"`).

Le même script s'utilise dans un conteneur ou une VM Debian déjà existants :

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Anthanaab/Bastion/main/scripts/bastion.sh)" -- --install
```

**Mise à jour** — dans la console du conteneur (`pct enter <CTID>`), tapez :

```bash
update
```

Cela met à jour Debian puis Bastion (git pull, dépendances, rebuild, redémarrage
du service). La configuration (`/etc/bastion/bastion.env`) et les données
(`/var/lib/bastion/`) ne sont jamais touchées.

| Chemin | Contenu |
|--------|---------|
| `/opt/bastion` | code (lecture seule pour le service) |
| `/etc/bastion/bastion.env` | secrets et configuration |
| `/var/lib/bastion/` | `bastion.json`, `backups/`, `ssh-known-hosts.json` |

En LXC le conteneur est directement sur le LAN : le **Wake-on-LAN part de
Bastion lui-même**, le service `wol-relay` (nécessaire uniquement pour
contourner le réseau bridge de Docker) n'est pas déployé.

### Migrer une installation Docker existante

Les mots de passe d'hôtes et les secrets TOTP sont chiffrés en AES-256-GCM.
**Reprenez impérativement les secrets de l'ancienne installation**, sinon ils
seront illisibles. Si `BASTION_ENCRYPTION_KEY` était vide dans votre `.env`, la
clé est dérivée de `JWT_SECRET` : ce dernier suffit alors.

Sur la machine Docker — archivez le volume de données :

```bash
docker compose stop bastion
docker cp bastion:/app/data ./bastion-data
tar czf bastion-data.tar.gz -C ./bastion-data .
grep -E '^(JWT_SECRET|BASTION_ENCRYPTION_KEY)=' .env
```

(`docker cp` s'appuie sur le nom de conteneur `bastion` fixé par
`container_name`, ce qui évite d'avoir à deviner le nom du volume.)

Sur l'hôte Proxmox, après avoir créé le LXC :

```bash
pct push <CTID> bastion-data.tar.gz /root/bastion-data.tar.gz
pct enter <CTID>
bastion-restore /root/bastion-data.tar.gz
```

L'import demande les secrets de façon interactive : passez par `pct enter`,
qui fournit un terminal, plutôt que par `pct exec`. En non interactif,
donnez-les par variable :

```bash
pct exec <CTID> -- env OLD_JWT_SECRET='…' OLD_ENCRYPTION_KEY='' \
  bastion-restore /root/bastion-data.tar.gz
```

La restauration sauvegarde les données courantes dans
`/var/lib/bastion.avant-import-<date>`, restaure `bastion.json`, les backups et
`ssh-known-hosts.json`, puis redémarre le service. Vérifiez ensuite qu'un hôte
SSH ou RDP se connecte : c'est ce qui valide le déchiffrement.

Gardez la pile Docker à l'arrêt (mais pas supprimée) le temps de valider.

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

### Page Infrastructure (v1.11+)
- Vue d'ensemble : machines en ligne/hors ligne, par protocole et par tag
- **Métriques CPU / RAM / disque** des machines SSH en ligne (collecte via SSH, sans agent)
- État des services : base de données, guacd, relais WoL
- Sessions actives (avec coupure à distance pour les admins) et historique récent
- Infos système (admin) : version, uptime, mémoire, utilisateurs, sauvegardes

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
- Journal d'audit
(les sessions actives en temps réel vivent sur la page Infrastructure)

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
| **1.11.0** | Page **Infrastructure** (état services, machines, sessions, système), métriques CPU/RAM/disque via SSH, performances : code-splitting des pages (bundle initial ~3× plus léger), compression HTTP, cache navigateur des assets, cache serveur des probes de statut (moins de charge réseau multi-clients) |
| **1.10.0** | Polish : mot de passe admin par défaut à changer obligatoirement, désactivation 2FA par un admin, badge "identifiants à ressaisir", CSP, healthcheck guacd/DB, migration `@xterm/*` |
| **1.9.0** | Durcissement sécurité : rejet du `JWT_SECRET` par défaut au démarrage, sessions liées au `userId`, `trust proxy` désactivé par défaut, token retiré des URL WebSocket, CORS resserré, conteneur non-root, déchiffrement défensif des secrets hôtes/TOTP |
| **1.8.1** | QR 2FA, révocation sessions UI, groupes à la création user |
| **1.8.0** | Groupes, 2FA, favoris, WoL intelligent, sessions live, réglages RDP (résolution/qualité) |
| **1.7.0** | Accès par machine pour opérateurs |
| **1.6.0** | Multi-user, reconnexion auto, polling statut |
| **1.5.0** | Historique sessions, audit, import/export |
