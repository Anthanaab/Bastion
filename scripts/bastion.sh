#!/usr/bin/env bash
#
# Bastion — installeur tout-en-un.
#
#   Sur l'hôte Proxmox (crée le LXC puis installe) :
#     bash -c "$(curl -fsSL https://raw.githubusercontent.com/Anthanaab/Bastion/main/scripts/bastion.sh)"
#
#   Dans un conteneur / une VM Debian déjà existants :
#     bash -c "$(curl -fsSL .../bastion.sh)" -- --install
#
#   Mise à jour, depuis la console du conteneur :
#     update
#
# Le même fichier joue les deux rôles : il détecte s'il tourne sur un hôte
# Proxmox (présence de `pct`) ou à l'intérieur du conteneur.

set -euo pipefail

REPO_OWNER="Anthanaab"
REPO_NAME="Bastion"
REPO_REF="${BASTION_REPO_REF:-main}"
REPO_URL="${BASTION_REPO_URL:-https://github.com/${REPO_OWNER}/${REPO_NAME}.git}"
SELF_URL="${BASTION_SELF_URL:-https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_REF}/scripts/bastion.sh}"

APP_DIR="/opt/bastion"
DATA_DIR="/var/lib/bastion"
CONF_DIR="/etc/bastion"
ENV_FILE="$CONF_DIR/bastion.env"
SERVICE_USER="bastion"
NODE_MAJOR=22

# Debian a retiré guacamole-server après bullseye : `guacd` n'existe plus que
# dans oldoldstable (1.3.0). Il est donc compilé depuis les sources Apache.
# 1.6.0 sait se lier à FreeRDP 3, seul disponible à partir de Debian 13.
GUACD_VERSION="${GUACD_VERSION:-1.6.0}"
GUACD_TARBALL="https://archive.apache.org/dist/guacamole/${GUACD_VERSION}/source/guacamole-server-${GUACD_VERSION}.tar.gz"

BL=$'\033[1;34m'; GN=$'\033[1;32m'; YW=$'\033[1;33m'; RD=$'\033[1;31m'; CY=$'\033[1;36m'; NC=$'\033[0m'
msg()  { echo "${BL}[+]${NC} $*"; }
ok()   { echo "${GN}[✓]${NC} $*"; }
warn() { echo "${YW}[!]${NC} $*"; }
die()  { echo "${RD}[✗]${NC} $*" >&2; exit 1; }

# /dev/tty existe comme nœud de périphérique même sans terminal de contrôle
# (cas de `pct exec`) : seule une ouverture réelle permet de trancher.
has_tty() { (: </dev/tty) 2>/dev/null; }

need_root() { [[ $EUID -eq 0 ]] || die "À exécuter en root."; }

# ============================================================================
#  PARTIE CONTENEUR — installation / mise à jour de Bastion
# ============================================================================

container_install() {
  need_root
  command -v apt-get >/dev/null || die "Debian ou Ubuntu attendu."

  local fresh=1
  [[ -f "$ENV_FILE" ]] && fresh=0

  msg "Dépendances système…"
  export DEBIAN_FRONTEND=noninteractive
  # pct exec propage le LANG de l'hôte, que le conteneur n'a pas généré :
  # sans ça, apt et perl inondent la sortie d'avertissements de locale.
  export LANG=C.UTF-8 LC_ALL=C.UTF-8
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    ca-certificates curl gnupg git openssl build-essential python3 >/dev/null

  install_guacd

  local current
  current=$(command -v node >/dev/null && node -v | sed 's/^v\([0-9]*\).*/\1/' || echo 0)
  if [[ "$current" -lt "$NODE_MAJOR" ]]; then
    msg "Installation de Node.js ${NODE_MAJOR}…"
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
    echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y -qq nodejs >/dev/null
  fi
  ok "Node.js $(node -v)"

  id -u "$SERVICE_USER" >/dev/null 2>&1 \
    || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
  install -d -m 0750 "$CONF_DIR"

  if [[ -d "$APP_DIR/.git" ]]; then
    msg "Récupération de la dernière version…"
    git -C "$APP_DIR" fetch --depth 1 origin "$REPO_REF"
    git -C "$APP_DIR" reset --hard FETCH_HEAD
    git -C "$APP_DIR" clean -fd -e node_modules
  else
    msg "Clonage du dépôt…"
    rm -rf "$APP_DIR"
    git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$APP_DIR"
  fi

  local version
  version=$(node -p "require('$APP_DIR/package.json').version")
  msg "Build de Bastion $version (2 à 3 minutes)…"
  cd "$APP_DIR"
  npm ci --no-audit --no-fund --silent
  npm run build --silent
  # Les devDeps (vite, tsc…) ne servent qu'au build.
  npm prune --omit=dev --no-audit --no-fund --silent
  chown -R root:root "$APP_DIR"

  [[ $fresh -eq 1 ]] && write_env_file
  write_systemd_unit
  write_update_command
  write_banner

  systemctl daemon-reload
  systemctl enable --now guacd >/dev/null 2>&1 || systemctl restart guacd
  systemctl enable bastion >/dev/null 2>&1 || true
  systemctl restart bastion

  sleep 3
  if ! systemctl is-active --quiet bastion; then
    warn "Le service n'a pas démarré. Journal :"
    journalctl -u bastion -n 30 --no-pager || true
    exit 1
  fi

  local ip port
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  port=$(sed -n 's/^PORT=//p' "$ENV_FILE")
  echo
  if [[ $fresh -eq 1 ]]; then
    echo "${CY}  ─────────────────────────────────────────────${NC}"
    echo "${CY}   Bastion $version installé${NC}"
    echo "${CY}  ─────────────────────────────────────────────${NC}"
    echo "    URL           http://${ip}:${port}"
    echo "    Utilisateur   $(sed -n 's/^BASTION_ADMIN_USER=//p' "$ENV_FILE")"
    echo "    Mot de passe  $(sed -n 's/^BASTION_ADMIN_PASSWORD=//p' "$ENV_FILE")"
    echo
    echo "    Notez ce mot de passe (il figure aussi dans $ENV_FILE)."
    echo "${CY}  ─────────────────────────────────────────────${NC}"
  else
    ok "Bastion mis à jour en $version — http://${ip}:${port}"
  fi
}

# guacd : démon Guacamole, indispensable au RDP et au VNC.
install_guacd() {
  # La recompilation prend plusieurs minutes : on la saute si la bonne version
  # est déjà en place, sinon chaque `update` la referait.
  if command -v guacd >/dev/null 2>&1 \
     && guacd -v 2>&1 | grep -qF "$GUACD_VERSION"; then
    ok "guacd $GUACD_VERSION déjà présent."
    return 0
  fi

  # Ubuntu et Debian ≤ 11 le packagent encore.
  if apt-get install -y -qq --no-install-recommends guacd >/dev/null 2>&1; then
    ok "guacd installé depuis les dépôts."
    return 0
  fi

  msg "guacd absent des dépôts — compilation de guacamole-server ${GUACD_VERSION}…"
  msg "  (5 à 10 minutes, c'est normal qu'il ne se passe rien)"

  apt-get install -y -qq --no-install-recommends \
    libcairo2-dev libjpeg62-turbo-dev libpng-dev libtool-bin libossp-uuid-dev \
    libavcodec-dev libavformat-dev libavutil-dev libswscale-dev \
    libpango1.0-dev libssh2-1-dev libssl-dev libvorbis-dev libwebp-dev \
    libtelnet-dev libvncserver-dev libwebsockets-dev libpulse-dev >/dev/null

  # FreeRDP 3 à partir de Debian 13, FreeRDP 2 avant.
  apt-get install -y -qq --no-install-recommends freerdp3-dev >/dev/null 2>&1 \
    || apt-get install -y -qq --no-install-recommends freerdp2-dev >/dev/null 2>&1 \
    || warn "Aucun paquet freerdp-dev : guacd sera construit sans RDP."

  local build log
  build=$(mktemp -d)
  log=/var/log/bastion-guacd-build.log
  curl -fsSL "$GUACD_TARBALL" -o "$build/src.tar.gz" \
    || die "Téléchargement impossible : $GUACD_TARBALL"
  tar xzf "$build/src.tar.gz" -C "$build"

  # guacamole-server compile avec -Werror. FreeRDP a déprécié codecs_free en
  # 3.6.0 et Debian 13 fournit la 3.15 : inclure freerdp/codecs.h suffit alors
  # à faire échouer le build. La dépréciation n'est pas une suppression, la
  # fonction reste utilisable — on refuse juste d'en faire une erreur.
  # CFLAGS est placé après AM_CFLAGS sur la ligne de compilation, donc gagne.
  local cflags="-g -O2 -Wno-deprecated-declarations"

  # Chaque étape porte son propre `|| exit` : dans un sous-shell membre d'une
  # liste ||, set -e est neutralisé, et un make raté enchaînerait sur
  # make install (ce qui produisait une installation partielle).
  if ! (
    cd "$build/guacamole-server-${GUACD_VERSION}" || exit 1
    ./configure --prefix=/usr/local CFLAGS="$cflags" || exit 1
    make -j"$(nproc)" || exit 1
    make install || exit 1
  ) >"$log" 2>&1; then
    warn "Échec de la compilation de guacamole-server. 40 dernières lignes :"
    tail -40 "$log" >&2
    die "Journal complet : $log"
  fi
  ldconfig
  rm -rf "$build"

  # Les greffons manquants ne font pas échouer configure : il faut vérifier
  # après coup quels protocoles ont réellement été construits.
  local built=()
  local proto
  for proto in rdp vnc ssh; do
    # `if` plutôt que `&&` : sous set -e, une dernière itération dont le test
    # échoue ferait sortir la boucle en statut non nul et tuerait le script.
    if [[ -f "/usr/local/lib/libguac-client-${proto}.so" ]]; then
      built+=("$proto")
    fi
  done
  [[ " ${built[*]} " == *" rdp "* ]] \
    || warn "guacd construit SANS support RDP — vérifiez freerdp3-dev."
  ok "guacd ${GUACD_VERSION} compilé (protocoles : ${built[*]:-aucun})."

  id -u guacd >/dev/null 2>&1 \
    || useradd --system --home-dir /var/lib/guacd --shell /usr/sbin/nologin guacd
  install -d -m 0750 -o guacd -g guacd /var/lib/guacd

  # L'unit fournie par les sources tourne en root ; celle-ci est alignée sur
  # le durcissement de bastion.service.
  cat > /etc/systemd/system/guacd.service <<'UNIT'
[Unit]
Description=Guacamole proxy daemon (guacd)
After=network.target

[Service]
Type=simple
User=guacd
Group=guacd
Environment=HOME=/var/lib/guacd
ExecStart=/usr/local/sbin/guacd -b 127.0.0.1 -L info -f
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/guacd

[Install]
WantedBy=multi-user.target
UNIT
}

write_env_file() {
  msg "Génération des secrets…"
  local jwt enc admin_pass wol_bc
  jwt=$(openssl rand -hex 32)
  enc=$(openssl rand -hex 32)
  admin_pass="${BASTION_ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)}"
  # Broadcast du LAN, lu sur l'interface du conteneur.
  wol_bc="${BASTION_WOL_BROADCAST:-$(ip -4 -o addr show scope global 2>/dev/null \
    | grep -oE 'brd [0-9.]+' | awk '{print $2}' | head -1)}"

  cat > "$ENV_FILE" <<ENV
# Configuration Bastion — générée le $(date -Iseconds)
# Ce fichier n'est PAS écrasé par les mises à jour.

NODE_ENV=production
PORT=${BASTION_PORT:-3000}
DATABASE_PATH=$DATA_DIR/bastion.json

# guacd tourne en local dans ce conteneur
GUACD_HOST=127.0.0.1
GUACD_PORT=4822

# Secrets — NE PAS partager. Changer BASTION_ENCRYPTION_KEY rendrait illisibles
# les mots de passe des hôtes déjà enregistrés.
JWT_SECRET=$jwt
BASTION_ENCRYPTION_KEY=$enc

# Compte admin, créé au tout premier démarrage uniquement.
BASTION_ADMIN_USER=${BASTION_ADMIN_USER:-admin}
BASTION_ADMIN_PASSWORD=$admin_pass

# Le conteneur est directement sur le LAN : les paquets Wake-on-LAN partent
# d'ici. Aucun relais nécessaire — ne PAS définir WOL_RELAY_URL.
BASTION_NETWORK_HOST=1
BASTION_WOL_BROADCAST=$wol_bc
ENV

  if [[ -n "${BASTION_PUBLIC_ORIGIN:-}" ]]; then
    cat >> "$ENV_FILE" <<ENV

# Derrière un reverse-proxy HTTPS
BASTION_COOKIE_SECURE=true
BASTION_CORS_ORIGIN=$BASTION_PUBLIC_ORIGIN
BASTION_TRUST_PROXY=1
ENV
  else
    cat >> "$ENV_FILE" <<'ENV'

# Derrière un reverse-proxy HTTPS (Traefik, Nginx…), décommentez :
# BASTION_COOKIE_SECURE=true
# BASTION_CORS_ORIGIN=https://bastion.example.com
# BASTION_TRUST_PROXY=1
ENV
  fi

  chmod 0640 "$ENV_FILE"
  chown root:"$SERVICE_USER" "$ENV_FILE"
}

write_systemd_unit() {
  cat > /etc/systemd/system/bastion.service <<'UNIT'
[Unit]
Description=Bastion — passerelle d'accès distant (SSH/RDP/VNC)
Documentation=https://github.com/Anthanaab/Bastion
After=network-online.target guacd.service
Wants=network-online.target
Requires=guacd.service

[Service]
Type=simple
User=bastion
Group=bastion
# Le serveur résout client/dist depuis process.cwd().
WorkingDirectory=/opt/bastion
EnvironmentFile=/etc/bastion/bastion.env
ExecStart=/usr/bin/node server/dist/index.js
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/bastion
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT
}

write_update_command() {
  cat > /usr/local/bin/update <<UPD
#!/usr/bin/env bash
# Met à jour Debian puis Bastion (code, dépendances, rebuild, redémarrage).
set -euo pipefail
[[ \$EUID -eq 0 ]] || { echo "À exécuter en root."; exit 1; }

echo -e "\033[1;34m[+]\033[0m Mise à jour du système…"
export DEBIAN_FRONTEND=noninteractive
export LANG=C.UTF-8 LC_ALL=C.UTF-8
apt-get update -qq && apt-get upgrade -y -qq && apt-get autoremove -y -qq

echo -e "\033[1;34m[+]\033[0m Mise à jour de Bastion…"
# On retélécharge l'installeur : sa dernière version sait gérer les nouvelles
# dépendances qu'une future version de Bastion pourrait exiger.
TMP=\$(mktemp); trap 'rm -f "\$TMP"' EXIT
if curl -fsSL --max-time 20 "$SELF_URL" -o "\$TMP" && [[ -s "\$TMP" ]]; then
  bash "\$TMP" --install
elif [[ -f "$APP_DIR/scripts/bastion.sh" ]]; then
  echo -e "\033[1;33m[!]\033[0m GitHub injoignable — installeur local."
  bash "$APP_DIR/scripts/bastion.sh" --install
else
  echo "Installeur introuvable." >&2; exit 1
fi
UPD
  chmod +x /usr/local/bin/update
  ln -sf /usr/local/bin/update /usr/local/bin/bastion-update

  cat > /usr/local/bin/bastion-restore <<RST
#!/usr/bin/env bash
# Importe les données d'une ancienne installation Docker.
#   bastion-restore /root/bastion-data.tar.gz
set -euo pipefail
TMP=\$(mktemp); trap 'rm -f "\$TMP"' EXIT
if curl -fsSL --max-time 20 "$SELF_URL" -o "\$TMP" && [[ -s "\$TMP" ]]; then
  bash "\$TMP" --restore "\$@"
else
  bash "$APP_DIR/scripts/bastion.sh" --restore "\$@"
fi
RST
  chmod +x /usr/local/bin/bastion-restore
}

write_banner() {
  # Affichée à chaque console interactive : pct enter, pct console, SSH.
  cat > /etc/profile.d/bastion-banner.sh <<'BANNER'
#!/bin/sh
case $- in *i*) ;; *) return 2>/dev/null || exit 0 ;; esac
_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
_port=$(sed -n 's/^PORT=//p' /etc/bastion/bastion.env 2>/dev/null)
_ver=$(node -p "require('/opt/bastion/package.json').version" 2>/dev/null)
if systemctl is-active --quiet bastion 2>/dev/null; then
  _state=$(printf '\033[1;32mactif\033[0m')
else
  _state=$(printf '\033[1;31mARRETE\033[0m')
fi
printf '\n\033[1;36m  Bastion %s\033[0m — service %s\n' "$_ver" "$_state"
printf '  Interface    http://%s:%s\n' "$_ip" "${_port:-3000}"
printf '  Mise a jour  \033[1mupdate\033[0m\n'
printf '  Journal      journalctl -u bastion -f\n\n'
unset _ip _port _ver _state
BANNER
  chmod +x /etc/profile.d/bastion-banner.sh
}

# ============================================================================
#  MIGRATION depuis une installation Docker
# ============================================================================

# Reprend une archive du volume bastion-data et, surtout, les secrets de
# l'ancienne installation : sans eux les mots de passe d'hôtes et les secrets
# TOTP — chiffrés en AES-256-GCM — sont définitivement illisibles.
container_restore() {
  need_root
  local archive="${1:-}"
  [[ -n "$archive" ]] || die "Usage : bastion.sh --restore <archive.tar.gz>"
  [[ -f "$archive" ]] || die "Archive introuvable : $archive"
  [[ -f "$ENV_FILE" ]] || die "Bastion n'est pas installé ici (pas de $ENV_FILE)."

  local old_jwt="${OLD_JWT_SECRET:-}"
  local old_key="${OLD_ENCRYPTION_KEY:-}"

  if [[ -z "$old_jwt" && -z "$old_key" ]] && has_tty; then
    echo
    echo "Secrets de l'ancienne installation (fichier .env du docker-compose)."
    echo "Si BASTION_ENCRYPTION_KEY y était vide, seul JWT_SECRET compte :"
    echo "la clé AES en est dérivée."
    echo
    read -rp "  Ancien JWT_SECRET            : " old_jwt </dev/tty
    read -rp "  Ancien BASTION_ENCRYPTION_KEY (vide si non défini) : " old_key </dev/tty
  fi

  if [[ -z "$old_jwt" && -z "$old_key" ]]; then
    warn "Aucun secret fourni : les identifiants d'hôtes chiffrés seront illisibles"
    warn "et devront être ressaisis dans l'interface."
    if has_tty; then
      local answer
      read -rp "Continuer quand même ? [o/N] " answer </dev/tty
      [[ "$answer" =~ ^[oOyY]$ ]] || die "Import annulé."
    fi
  fi

  msg "Arrêt du service…"
  systemctl stop bastion || true

  # Sauvegarde de l'état courant avant d'écraser quoi que ce soit.
  if [[ -f "$DATA_DIR/bastion.json" ]]; then
    local backup="/var/lib/bastion.avant-import-$(date +%Y%m%d-%H%M%S)"
    cp -a "$DATA_DIR" "$backup"
    ok "Données actuelles sauvegardées dans $backup"
  fi

  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  msg "Extraction de l'archive…"
  tar xzf "$archive" -C "$tmp"

  # L'archive peut contenir soit le contenu de /app/data, soit un dossier data/.
  local src
  src=$(dirname "$(find "$tmp" -name bastion.json -print -quit)")
  [[ -n "$src" && -d "$src" ]] || die "Aucun bastion.json trouvé dans l'archive."

  cp -a "$src"/. "$DATA_DIR"/
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR"
  ok "Données importées depuis $src"

  # Report des secrets dans l'env : sans eux, decryptSecret() échouera.
  if [[ -n "$old_jwt" ]]; then
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$old_jwt|" "$ENV_FILE"
    ok "JWT_SECRET repris de l'ancienne installation."
  fi
  if [[ -n "$old_key" ]]; then
    sed -i "s|^BASTION_ENCRYPTION_KEY=.*|BASTION_ENCRYPTION_KEY=$old_key|" "$ENV_FILE"
    ok "BASTION_ENCRYPTION_KEY reprise de l'ancienne installation."
  elif [[ -n "$old_jwt" ]]; then
    # L'ancienne install dérivait la clé du JWT_SECRET : on doit faire pareil,
    # donc laisser BASTION_ENCRYPTION_KEY vide plutôt que la clé générée ici.
    sed -i "s|^BASTION_ENCRYPTION_KEY=.*|BASTION_ENCRYPTION_KEY=|" "$ENV_FILE"
    ok "Clé AES dérivée du JWT_SECRET, comme avant."
  fi

  msg "Redémarrage…"
  systemctl start bastion
  sleep 3
  if systemctl is-active --quiet bastion; then
    local ip port
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    port=$(sed -n 's/^PORT=//p' "$ENV_FILE")
    ok "Import terminé — http://${ip}:${port}"
    echo "    Connectez-vous avec vos anciens identifiants et vérifiez qu'un hôte"
    echo "    RDP ou SSH se connecte : cela valide le déchiffrement."
  else
    warn "Le service n'a pas redémarré :"
    journalctl -u bastion -n 30 --no-pager || true
    exit 1
  fi
}

# ============================================================================
#  PARTIE HÔTE PROXMOX — assistant + création du LXC
# ============================================================================

# Valeurs par défaut, toutes surchargeables par variable d'environnement.
CTID="${CTID:-}"
TEMPLATE="${TEMPLATE:-}"
CT_HOSTNAME="${CT_HOSTNAME:-bastion}"
CORES="${CORES:-2}"
RAM="${RAM:-2048}"
SWAP="${SWAP:-512}"
DISK="${DISK:-10}"
STORAGE="${STORAGE:-}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-}"
BRIDGE="${BRIDGE:-vmbr0}"
NET_CONF="${NET_CONF:-ip=dhcp}"
CT_PASSWORD="${CT_PASSWORD:-}"
ENABLE_SSH="${ENABLE_SSH:-0}"
ONBOOT="${ONBOOT:-1}"
BASTION_PORT="${BASTION_PORT:-3000}"
BASTION_ADMIN_USER="${BASTION_ADMIN_USER:-admin}"
BASTION_ADMIN_PASSWORD="${BASTION_ADMIN_PASSWORD:-}"
BASTION_PUBLIC_ORIGIN="${BASTION_PUBLIC_ORIGIN:-}"

# whiptail écrit l'interface sur stderr et le résultat sur stdout : on les
# échange pour récupérer la valeur choisie.
W() { whiptail --backtitle "Bastion — installeur LXC" "$@" 3>&1 1>&2 2>&3; }

ask_text() { # titre, question, défaut
  local v
  v=$(W --title "$1" --inputbox "$2" 10 68 "$3") || die "Installation annulée."
  echo "${v:-$3}"
}

# pveam liste plusieurs architectures pour un même template. Un tri seul
# choisirait arm64 (« arm » > « amd »), d'où le filtrage explicite sur
# l'architecture de l'hôte.
HOST_ARCH="${HOST_ARCH:-$(dpkg --print-architecture 2>/dev/null || echo amd64)}"

pick_template() {
  pveam available --section system 2>/dev/null | awk '{print $2}' \
    | grep -E "^$1" | grep -E "_${HOST_ARCH}\.tar" | sort -V | tail -1
}

wizard() {
  local choice
  choice=$(W --title "Installation" --menu \
    "Comment configurer le conteneur ?" 13 70 2 \
    "defaut" "Paramètres recommandés (2 vCPU, 2 Go, 10 Go, DHCP)" \
    "avance" "Choisir chaque paramètre") || die "Installation annulée."
  [[ "$choice" == "defaut" ]] && return 0

  CTID=$(ask_text "Conteneur" "Identifiant (CTID) :" "$CTID")
  CT_HOSTNAME=$(ask_text "Conteneur" "Nom d'hôte :" "$CT_HOSTNAME")
  CORES=$(ask_text "Ressources" "Nombre de vCPU :" "$CORES")
  RAM=$(ask_text "Ressources" "Mémoire en Mo (2048 recommandé : le build est le moment le plus gourmand) :" "$RAM")
  DISK=$(ask_text "Ressources" "Taille du disque en Go :" "$DISK")

  local opts=() name
  while read -r name; do opts+=("$name" "stockage rootdir"); done < <(
    pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}')
  if [[ ${#opts[@]} -gt 0 ]]; then
    STORAGE=$(W --title "Stockage" --menu "Où placer le disque du conteneur ?" \
      16 70 6 "${opts[@]}") || die "Installation annulée."
  fi

  opts=()
  while read -r name; do opts+=("$name" "pont réseau"); done < <(
    ip -br link show type bridge 2>/dev/null | awk '{print $1}')
  if [[ ${#opts[@]} -gt 0 ]]; then
    BRIDGE=$(W --title "Réseau" --menu "Sur quel pont brancher le conteneur ?" \
      16 70 6 "${opts[@]}") || die "Installation annulée."
  fi

  if W --title "Réseau" --yesno "Adresse IP en DHCP ?\n\nNon = adresse fixe." 10 70; then
    NET_CONF="ip=dhcp"
  else
    local cidr gw
    cidr=$(ask_text "Réseau" "Adresse IP au format CIDR (ex. 192.168.1.50/24) :" "")
    gw=$(ask_text "Réseau" "Passerelle (ex. 192.168.1.1) :" "")
    NET_CONF="ip=${cidr},gw=${gw}"
  fi

  CT_PASSWORD=$(W --title "Conteneur" --passwordbox \
    "Mot de passe root du conteneur.\n\nLaisser vide : accès par 'pct enter' uniquement." 12 70) || true

  if W --title "Conteneur" --yesno "Installer et activer le serveur SSH ?" 9 70; then
    ENABLE_SSH=1
  else
    ENABLE_SSH=0
  fi

  # ---- options propres à Bastion ----
  BASTION_PORT=$(ask_text "Bastion" "Port HTTP :" "$BASTION_PORT")
  BASTION_ADMIN_USER=$(ask_text "Bastion" "Nom du compte administrateur :" "$BASTION_ADMIN_USER")

  if W --title "Bastion" --yesno \
      "Générer un mot de passe administrateur aléatoire ?\n\nNon = le saisir vous-même." 11 70; then
    BASTION_ADMIN_PASSWORD=""
  else
    BASTION_ADMIN_PASSWORD=$(W --title "Bastion" --passwordbox \
      "Mot de passe administrateur :" 10 70) || die "Installation annulée."
  fi

  if W --title "Bastion" --yesno \
      "Bastion sera-t-il exposé derrière un reverse-proxy HTTPS ?\n(Traefik, Nginx Proxy Manager…)" 11 70; then
    BASTION_PUBLIC_ORIGIN=$(ask_text "Bastion" \
      "URL publique (ex. https://bastion.mondomaine.fr) :" "")
  fi
  return 0
}

host_main() {
  need_root
  command -v pveversion >/dev/null || die "Cet hôte n'est pas un Proxmox VE."

  if [[ -z "$CTID" ]]; then
    CTID=$(pvesh get /cluster/nextid 2>/dev/null) \
      || die "Impossible de déterminer un CTID libre — précisez CTID=xxx."
  fi

  if command -v whiptail >/dev/null && has_tty; then
    wizard </dev/tty
  else
    warn "whiptail indisponible — paramètres par défaut (surchargeables par variables)."
  fi

  pct status "$CTID" >/dev/null 2>&1 && die "Le CTID $CTID est déjà utilisé."

  if [[ -z "$STORAGE" ]]; then
    STORAGE=$(pvesm status -content rootdir 2>/dev/null \
      | awk 'NR>1 && $3=="active" {print $1; exit}')
  fi
  [[ -n "$STORAGE" ]] || die "Aucun stockage 'rootdir' actif — précisez STORAGE=nom."

  if [[ -z "$TEMPLATE_STORAGE" ]]; then
    TEMPLATE_STORAGE=$(pvesm status -content vztmpl 2>/dev/null \
      | awk 'NR>1 && $3=="active" {print $1; exit}')
  fi
  [[ -n "$TEMPLATE_STORAGE" ]] || die "Aucun stockage 'vztmpl' actif — précisez TEMPLATE_STORAGE=nom."

  msg "Recherche du template Debian…"
  pveam update >/dev/null 2>&1 || warn "pveam update a échoué, utilisation du cache local."
  [[ -n "$TEMPLATE" ]] || TEMPLATE=$(pick_template 'debian-13-standard')
  [[ -n "$TEMPLATE" ]] || TEMPLATE=$(pick_template 'debian-12-standard')
  [[ -n "$TEMPLATE" ]] || die "Aucun template Debian 12/13 disponible."
  if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -q "$TEMPLATE"; then
    msg "Téléchargement de $TEMPLATE…"
    pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
  fi

  cat <<SUMMARY

  Récapitulatif
  ──────────────────────────────────────────────
  CTID            $CTID
  Nom d'hôte      $CT_HOSTNAME
  Template        $TEMPLATE
  CPU / RAM       ${CORES} vCPU / ${RAM} Mo (+${SWAP} Mo swap)
  Disque          ${DISK} Go sur ${STORAGE}
  Réseau          ${BRIDGE} — ${NET_CONF}
  Architecture    ${HOST_ARCH}
  Type            non privilégié, nesting activé
  Port Bastion    ${BASTION_PORT}
  Compte admin    ${BASTION_ADMIN_USER}
  ──────────────────────────────────────────────

SUMMARY

  if command -v whiptail >/dev/null && has_tty; then
    whiptail --backtitle "Bastion" --title "Confirmation" \
      --yesno "Créer le conteneur $CTID avec ces paramètres ?" 9 60 </dev/tty \
      || die "Installation annulée."
  fi

  msg "Création du conteneur $CTID…"
  local -a create=(
    "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}"
    --hostname "$CT_HOSTNAME" --ostype debian
    --cores "$CORES" --memory "$RAM" --swap "$SWAP"
    --rootfs "${STORAGE}:${DISK}"
    --net0 "name=eth0,bridge=${BRIDGE},${NET_CONF}"
    --unprivileged 1 --onboot "$ONBOOT"
    # systemd 257 (Debian 13) refuse de démarrer dans un conteneur non
    # privilégié sans nesting : il lui faut ses propres montages cgroup.
    --features nesting=1
    --description "Bastion — passerelle SSH/RDP/VNC. Mise a jour : pct exec $CTID -- update"
  )
  [[ -n "$CT_PASSWORD" ]] && create+=(--password "$CT_PASSWORD")
  pct create "${create[@]}"

  msg "Démarrage…"
  if ! pct start "$CTID"; then
    warn "Le conteneur $CTID n'a pas démarré ; il est laissé en place pour inspection."
    echo "    pct config $CTID                # vérifier arch et features"
    echo "    lxc-start -n $CTID -F -l DEBUG  # démarrage verbeux"
    echo "    pct destroy $CTID               # repartir de zéro"
    exit 1
  fi

  msg "Attente du réseau…"
  local i
  for i in $(seq 1 60); do
    pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
    [[ $i -eq 60 ]] && die "Pas de réseau dans le conteneur — vérifiez le pont ${BRIDGE}."
    sleep 1
  done

  if [[ "$ENABLE_SSH" == "1" ]]; then
    msg "Installation du serveur SSH…"
    pct exec "$CTID" -- bash -c "export DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8; apt-get update -qq && apt-get install -y -qq openssh-server >/dev/null && systemctl enable --now ssh"
  fi

  msg "Installation de Bastion dans le conteneur…"
  local -a envs=(
    "BASTION_REPO_URL=$REPO_URL"
    "BASTION_REPO_REF=$REPO_REF"
    "BASTION_SELF_URL=$SELF_URL"
    "BASTION_PORT=$BASTION_PORT"
    "BASTION_ADMIN_USER=$BASTION_ADMIN_USER"
  )
  [[ -n "$BASTION_ADMIN_PASSWORD" ]] && envs+=("BASTION_ADMIN_PASSWORD=$BASTION_ADMIN_PASSWORD")
  [[ -n "$BASTION_PUBLIC_ORIGIN" ]] && envs+=("BASTION_PUBLIC_ORIGIN=$BASTION_PUBLIC_ORIGIN")

  # Le script est toujours poussé depuis l'hôte : le template Debian standard
  # ne fournit ni curl ni wget, et les installer d'abord ajouterait un
  # aller-retour apt avant même de savoir si le réseau du conteneur sort.
  local source="${BASH_SOURCE[0]:-}"
  local tmp=""
  if [[ ! -f "$source" ]]; then
    # Exécution via `curl | bash` : pas de fichier source, on le récupère
    # sur l'hôte, qui lui dispose forcément d'un client HTTP.
    tmp=$(mktemp)
    curl -fsSL "$SELF_URL" -o "$tmp" 2>/dev/null \
      || wget -qO "$tmp" "$SELF_URL" 2>/dev/null \
      || die "Impossible de récupérer l'installeur depuis $SELF_URL"
    [[ -s "$tmp" ]] || die "Installeur vide téléchargé depuis $SELF_URL"
    source="$tmp"
  fi

  pct push "$CTID" "$source" /root/bastion.sh --perms 755
  [[ -n "$tmp" ]] && rm -f "$tmp"
  pct exec "$CTID" -- env "${envs[@]}" bash /root/bastion.sh --install

  echo
  ok "Terminé."
  echo "    Console       pct enter $CTID"
  echo "    Mise à jour   pct exec $CTID -- update"
}

# ============================================================================
#  Aiguillage
# ============================================================================

usage() {
  cat <<USAGE
Bastion — installeur tout-en-un

  (aucun argument)  Hôte Proxmox : assistant de création du LXC.
                    Conteneur Debian : installation directe.
  --install         Force l'installation locale (dans le conteneur).
  --update          Met à jour le système puis Bastion.
  --restore <archive>
                    Importe les données d'une installation Docker existante
                    (archive du volume bastion-data). Demande les anciens
                    JWT_SECRET / BASTION_ENCRYPTION_KEY, sans lesquels les
                    identifiants d'hôtes chiffrés seraient perdus.
  --help            Affiche cette aide.

Variables utiles (mode hôte) : CTID, CT_HOSTNAME, CORES, RAM, DISK, STORAGE,
BRIDGE, NET_CONF, ENABLE_SSH, BASTION_PORT, BASTION_ADMIN_USER.
USAGE
}

case "${1:-}" in
  --install)
    container_install
    ;;
  --restore)
    shift
    container_restore "${1:-}"
    ;;
  --update)
    need_root
    export DEBIAN_FRONTEND=noninteractive
    export LANG=C.UTF-8 LC_ALL=C.UTF-8
    msg "Mise à jour du système…"
    apt-get update -qq && apt-get upgrade -y -qq && apt-get autoremove -y -qq
    container_install
    ;;
  --help|-h)
    usage
    ;;
  "")
    if command -v pct >/dev/null && command -v pveversion >/dev/null; then
      host_main
    else
      container_install
    fi
    ;;
  *)
    usage
    exit 1
    ;;
esac
