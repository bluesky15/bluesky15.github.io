#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

BINARIES=""
if command -v wasm-opt >/dev/null 2>&1; then
  BINARIES=""
elif [ -x /opt/homebrew/opt/binaryen/bin/wasm-opt ]; then
  BINARIES=/opt/homebrew/opt/binaryen/bin
fi

if command -v cargo >/dev/null 2>&1 && rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown; then
  cd wasm
  cargo build --release -p flags --target wasm32-unknown-unknown
  cargo build --release -p quiz_csv --target wasm32-unknown-unknown
  cp target/wasm32-unknown-unknown/release/flags.wasm "$ROOT/public/data/flags.wasm"
  cp target/wasm32-unknown-unknown/release/quiz_csv.wasm "$ROOT/public/data/quiz.wasm"
  cd "$ROOT"
  if [ -n "$BINARIES" ]; then
    "$BINARIES/wasm-opt" -Oz -o public/data/flags.wasm public/data/flags.wasm
    "$BINARIES/wasm-opt" -Oz -o public/data/quiz.wasm public/data/quiz.wasm
  fi
  echo "Built public/data/flags.wasm with Rust ($(wc -c < public/data/flags.wasm | tr -d ' ') bytes)"
  echo "Built public/data/quiz.wasm with Rust ($(wc -c < public/data/quiz.wasm | tr -d ' ') bytes)"
  # also sync JSON via WASM-derived build (Node conversion matches WASM)
  node scripts/build-quiz.mjs
else
  if [ -f public/data/flags.wasm ]; then
    echo "cargo/rust wasm target not found - keeping committed flags.wasm"
    exit 0
  fi
  echo "error: cargo with wasm32-unknown-unknown not found and no prebuilt flags.wasm exists" >&2
  exit 1
fi
