#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp wasm/flags/main.go "$TMP/"
cp public/data/flags.json "$TMP/"
printf 'module flags\n\ngo 1.23\n' > "$TMP/go.mod"

cd "$TMP"
if command -v tinygo >/dev/null 2>&1; then
  tinygo build -o "$ROOT/public/data/flags.wasm" -target wasm -opt z .
  cd "$ROOT"
  cp "$(tinygo env TINYGOROOT)/targets/wasm_exec.js" public/wasm_exec.js
  echo "Built public/data/flags.wasm with TinyGo ($(du -h public/data/flags.wasm | cut -f1 | tr -d ' '))"
elif command -v go >/dev/null 2>&1; then
  cd "$TMP"
  GOOS=js GOARCH=wasm go build -o "$ROOT/public/data/flags.wasm" .
  cd "$ROOT"
  GLUE=""
  for p in "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$(go env GOROOT)/misc/wasm/wasm_exec.js"; do
    if [ -f "$p" ]; then
      GLUE="$p"
      break
    fi
  done
  if [ -z "$GLUE" ]; then
    echo "error: wasm_exec.js not found under GOROOT ($(go env GOROOT))" >&2
    exit 1
  fi
  cp "$GLUE" public/wasm_exec.js
  echo "Built public/data/flags.wasm with Go ($(du -h public/data/flags.wasm | cut -f1 | tr -d ' '))"
else
  if [ -f public/data/flags.wasm ] && [ -f public/wasm_exec.js ]; then
    echo "no go/tinygo found - keeping committed flags.wasm"
    exit 0
  fi
  echo "error: no go or tinygo found and no prebuilt flags.wasm exists" >&2
  exit 1
fi
