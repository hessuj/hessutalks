#!/usr/bin/env bash
# Varmistaa, että vendoroidut selainkirjastot vastaavat lukittuja SHA-256-summia.
set -euo pipefail
cd "$(dirname "$0")/../public/assets/vendor"
grep -v '^#' VENDOR.lock | sha256sum --check --strict
