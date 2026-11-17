#!/usr/bin/env bash
# smugan-antigravity installer — thin guard; the real work lives in
# tools/install.mjs (plain node, so the steering transform is testable).
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "smugan-antigravity install: node is required but was not found on PATH" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# This adapter lives at adapters/antigravity/ inside the smugan repo: the engine
# and the rules it installs are two levels up, in the same checkout.
SMUGAN_DIR="${SMUGAN_DIR:-$(dirname "$(dirname "$ROOT")")}"
# On Git Bash/Cygwin, hand node native paths (D:/smugan, not /d/smugan).
if command -v cygpath >/dev/null 2>&1; then
  ROOT="$(cygpath -m "$ROOT")"
  SMUGAN_DIR="$(cygpath -m "$SMUGAN_DIR")"
fi

exec node "$ROOT/tools/install.mjs" "$ROOT" "$SMUGAN_DIR"
