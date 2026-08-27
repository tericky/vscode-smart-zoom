#!/usr/bin/env bash
# Build the Linux X11 helper inside Docker (useful from macOS).
# Produces: native/linux/smart-zoom-helper
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
image="${SMART_ZOOM_LINUX_IMAGE:-ubuntu:22.04}"

docker run --rm --platform linux/amd64 \
  -v "${root}:/src" \
  -w /src \
  "${image}" \
  bash -lc '
    set -euo pipefail
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential cmake pkg-config \
      libx11-dev libxrandr-dev libxinerama-dev \
      ca-certificates
    ./native/linux-x11/build.sh
    file native/linux/smart-zoom-helper
  '

echo "Linux helper ready at ${root}/native/linux/smart-zoom-helper"
