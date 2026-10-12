#!/usr/bin/env bash
# Päivittää selaimen kolmannen osapuolen kirjastot suoraan niiden GitHub-repoista
# ja kirjoittaa tarkistussummat tiedostoon public/assets/vendor/VENDOR.lock.
# Käyttö: scripts/update-vendor.sh <libsodium.js-tagi> <qrcode-generator-commit>
set -euo pipefail
SODIUM_REF="${1:-0.8.4}"
QR_REF="${2:-83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/assets/vendor"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone -q --depth 1 --branch "$SODIUM_REF" https://github.com/jedisct1/libsodium.js "$TMP/sodium"
git clone -q https://github.com/kazuhikoarase/qrcode-generator "$TMP/qr"
git -C "$TMP/qr" checkout -q "$QR_REF"

cp "$TMP/sodium/dist/browsers/sodium.js" "$DEST/sodium.js"
cp "$TMP/sodium/dist/browsers-sumo/sodium.js" "$DEST/sodium-sumo.js"
cp "$TMP/sodium/LICENSE" "$DEST/LICENSE-libsodium.js.txt"
cp "$TMP/qr/js/dist/qrcode.js" "$DEST/qrcode.js"
cp "$TMP/qr/LICENSE" "$DEST/LICENSE-qrcode-generator.txt"

{
  echo "# libsodium.js $SODIUM_REF (https://github.com/jedisct1/libsodium.js)"
  echo "# qrcode-generator $QR_REF (https://github.com/kazuhikoarase/qrcode-generator)"
  (cd "$DEST" && sha256sum sodium.js sodium-sumo.js qrcode.js)
} > "$DEST/VENDOR.lock"
echo "Päivitetty. Tarkista muutokset: git diff public/assets/vendor/VENDOR.lock"
