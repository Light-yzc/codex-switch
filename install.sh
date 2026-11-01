#!/bin/sh
set -eu

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    printf '%s\n' 'Install Node.js 20 or newer (with npm), then retry.' >&2
    exit 1
fi
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || {
    printf '%s\n' 'Node.js 20 or newer is required.' >&2
    exit 1
}
source_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
prefix=${CODEXSW_PREFIX:-"$HOME/.local"}
temporary=$(mktemp -d "${TMPDIR:-/tmp}/codexsw-install.XXXXXXXX")
cleanup() {
    case "$temporary" in
        "${TMPDIR:-/tmp}"/codexsw-install.*) rm -rf -- "$temporary" ;;
    esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
npm pack --silent --json --pack-destination "$temporary" "$source_dir" > "$temporary/pack.json"
filename=$(node -e 'const fs=require("node:fs");process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))[0].filename)' "$temporary/pack.json")
npm install --global --prefix "$prefix" --offline --ignore-scripts --no-audit --no-fund "$temporary/$filename"
printf '%s\n' "Installed: $prefix/bin/codexsw"
case ":$PATH:" in
    *":$prefix/bin:"*) ;;
    *) printf '%s\n' 'If codexsw is not found, add the install directory to PATH and reopen your terminal.' "Default: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
printf '%s\n' 'Use codexsw <N>, where N is any positive integer (1, 2, 3, ...).'
