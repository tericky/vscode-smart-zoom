#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_dir}/../.." && pwd)"
build_dir="${script_dir}/build"
package_dir="${repository_root}/native/linux"

cmake -S "${script_dir}" -B "${build_dir}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${build_dir}" --config Release

mkdir -p "${package_dir}"
install -m 0755 \
  "${build_dir}/smart-zoom-helper" \
  "${package_dir}/smart-zoom-helper"

echo "Packaged ${package_dir}/smart-zoom-helper"
