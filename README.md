# Bastion — Passerelle d'accès distant

Interface web moderne pour se connecter à vos machines en **SSH**, **RDP** et **VNC** depuis un navigateur.

## Démarrage rapide (Docker)

```bash
cp .env.example .env
# Modifiez JWT_SECRET et BASTION_ADMIN_PASSWORD dans .env

docker compose up -d --build
```

Ouvrez **http://localhost:3000** — identifiants par défaut : `admin` / `admin`

## Développement local

```bash
npm install
cp .env.example .env

# Terminal 1 — lancez guacd (nécessaire pour RDP/VNC)
docker run -d --name guacd -p 4822:4822 guacamole/guacd:1.6.0

# Terminal 2
npm run dev
```

- Frontend : http://localhost:5173
- Backend : http://localhost:3000

## Fonctionnalités

- Tableau de bord avec recherche et filtres par protocole
- Terminal SSH intégré (xterm.js)
- Bureau distant RDP/VNC via guacd
- Gestion des hôtes (tags, couleurs, clés SSH, Wake-on-LAN)
- Changement de mot de passe admin
- Authentification JWT + cookie sécurisé
- Persistance JSON locale, sans base de données externe

## Sécurité

> Ne exposez pas Bastion directement sur Internet sans protection.

- Changez `JWT_SECRET`, `BASTION_ENCRYPTION_KEY` et le mot de passe admin
- Passez par un VPN (Tailscale, WireGuard) ou un reverse proxy HTTPS
- Limitez l'accès réseau au conteneur

### Wake-on-LAN (Docker)

Depuis un conteneur Docker, les paquets magiques peuvent ne pas atteindre le réseau local. Si le réveil ne fonctionne pas, définissez le broadcast de votre sous-réseau :

```env
BASTION_WOL_BROADCAST=192.168.50.255
```

Sur certaines installations, `network_mode: host` sur le service `bastion` peut être nécessaire.

## Architecture

```
Navigateur ──► Bastion (Node.js) ──► SSH direct
                    │
                    └── WebSocket ──► guacd ──► RDP / VNC
```

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port HTTP | `3000` |
| `JWT_SECRET` | Secret de signature JWT | *(obligatoire en prod)* |
| `BASTION_ENCRYPTION_KEY` | Clé AES-256 pour mots de passe hôtes (64 hex) | dérivée de `JWT_SECRET` |
| `BASTION_WOL_BROADCAST` | Adresse broadcast pour Wake-on-LAN | auto (255.255.255.255 + sous-réseau) |
| `BASTION_ADMIN_USER` | Utilisateur admin initial | `admin` |
| `BASTION_ADMIN_PASSWORD` | Mot de passe admin initial | `admin` |
| `GUACD_HOST` | Hôte guacd | `guacd` |
| `GUACD_PORT` | Port guacd | `4822` |
| `DATABASE_PATH` | Fichier de données JSON | `./data/bastion.json` |
