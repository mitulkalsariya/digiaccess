#!/usr/bin/env bash
# Install Docker Engine + Compose plugin on Ubuntu 22.04 / 24.04.
# Idempotent. Adds the `ubuntu` user to the docker group so subsequent
# `docker` calls don't need sudo (re-login required for group to take effect).
#
# Usage:  curl -fsSL <raw-url>/install-docker.sh | sudo bash
#    or:  sudo bash install-docker.sh

set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "must be root (try: sudo bash $0)"; exit 1
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "docker + compose plugin already installed:"
  docker --version
  docker compose version
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | tee /etc/apt/keyrings/docker.asc >/dev/null
  chmod a+r /etc/apt/keyrings/docker.asc
fi

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# Let the default `ubuntu` user run docker without sudo.
if id -u ubuntu >/dev/null 2>&1; then
  usermod -aG docker ubuntu
fi

systemctl enable --now docker

echo ""
echo "Done. If this is the first install, log out and back in (or run"
echo "\`newgrp docker\`) so 'docker' commands don't need sudo."
docker --version
docker compose version
