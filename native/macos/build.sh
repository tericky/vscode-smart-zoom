#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../darwin"
BUILD_ARGS=(
  --package-path "$SCRIPT_DIR"
  --configuration release
  --arch arm64
  --arch x86_64
)

swift build "${BUILD_ARGS[@]}"
BIN_DIR="$(swift build "${BUILD_ARGS[@]}" --show-bin-path)"

mkdir -p "$OUTPUT_DIR"
install -m 755 "$BIN_DIR/SmartZoomHelper" "$OUTPUT_DIR/smart-zoom-helper"

echo "Built $OUTPUT_DIR/smart-zoom-helper"
