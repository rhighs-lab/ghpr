#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
bin_dir="${GHPR_BIN_DIR:-${HOME}/.local/bin}"
entrypoint="${repo_dir}/bin/ghpr.js"
command_path="${bin_dir}/ghpr"

for dependency in node gh; do
  if ! command -v "${dependency}" >/dev/null 2>&1; then
    printf 'ghpr needs %s on PATH.\n' "${dependency}" >&2
    exit 1
  fi
done

node_major="$(node -p "process.versions.node.split('.')[0]")"
if (( node_major < 18 )); then
  printf 'ghpr needs Node.js 18 or newer (found %s).\n' "$(node --version)" >&2
  exit 1
fi

mkdir -p "${bin_dir}"

if [[ -L "${command_path}" && "$(readlink "${command_path}")" == "${entrypoint}" ]]; then
  :
elif [[ -e "${command_path}" || -L "${command_path}" ]]; then
  printf 'Refusing to replace the existing %s. Remove it and run this installer again.\n' "${command_path}" >&2
  exit 1
else
  ln -s "${entrypoint}" "${command_path}"
fi

printf 'Installed ghpr at %s\n' "${command_path}"
resolved_command="$(command -v ghpr || true)"
if [[ -z "${resolved_command}" ]]; then
  printf 'Add %s to PATH, then open a new shell.\n' "${bin_dir}"
elif [[ "${resolved_command}" != "${command_path}" ]]; then
  printf 'Warning: ghpr resolves to %s, not %s. Remove the older install or reorder PATH.\n' \
    "${resolved_command}" "${command_path}" >&2
fi
