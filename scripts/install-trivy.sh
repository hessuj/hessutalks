#!/usr/bin/env bash
# Asentaa Trivyn (SCA ja SBOM) CI:hin lukitulla SHA-256-summalla.
#
# Trivyä ei käytetä GitHub Actionina: aquasecurity/trivy-action ja Trivyn julkaisuja kaapattiin
# maaliskuussa 2026 (CVE-2026-33634). Binaari ladataan julkaisusta ja tarkistetaan kiinteää summaa vasten,
# joten jälkikäteen vaihdettu tiedosto ei mene läpi.
# Päivitys: vaihda VERSION ja SHA256 yhdessä. Summa julkaisun tiedostosta trivy_<versio>_checksums.txt
# (Linux-64bit.tar.gz). Valitse versio, joka on ollut julkaistuna vähintään 7 päivää (vrt. Dependabot).
set -euo pipefail
VERSION=0.76.0
SHA256=e24b1c51293c1b15e4ba8d45bbc7891ba053f90278ec2698f3562c993e145fe7
DEST="${1:-$HOME/.local/bin}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/trivy.tar.gz" \
  "https://github.com/aquasecurity/trivy/releases/download/v${VERSION}/trivy_${VERSION}_Linux-64bit.tar.gz"
echo "${SHA256}  $tmp/trivy.tar.gz" | sha256sum --check --strict
mkdir -p "$DEST"
tar -xzf "$tmp/trivy.tar.gz" -C "$DEST" trivy
"$DEST/trivy" --version
