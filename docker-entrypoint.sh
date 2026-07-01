#!/bin/sh
set -e

DATA_DIR=$(dirname "${DATABASE_PATH:-/app/data/bastion.json}")

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Corrige les permissions d'un volume créé par une version précédente (root).
  chown -R bastion:bastion "$DATA_DIR"
  exec su-exec bastion "$@"
fi

exec "$@"
