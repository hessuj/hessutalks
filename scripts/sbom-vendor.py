#!/usr/bin/env python3
"""Lisää Trivyn CycloneDX-SBOMiin vendoroidut selainkirjastot (public/assets/vendor/VENDOR.lock).

Trivy tunnistaa vain paketinhallinnan tiedostot (composer.lock). Selainkirjastot ovat repossa tiedostoina,
joten ne lisätään tässä nimen, version, lähteen ja tiedostojen SHA-256-summien kanssa.
Käyttö: sbom-vendor.py <sbom.json> <VENDOR.lock>   (kirjoittaa SBOMin paikalleen)
"""
import json
import re
import sys

# Lisenssit tiedostoista LICENSE-*.txt (SPDX-tunnisteet)
LICENSES = {"libsodium.js": "ISC", "qrcode-generator": "MIT"}

sbom_path, lock_path = sys.argv[1], sys.argv[2]
with open(sbom_path, encoding="utf-8") as f:
    sbom = json.load(f)

libs = []      # (nimi, versio, osoite)
files = []     # (sha256, tiedosto)
with open(lock_path, encoding="utf-8") as f:
    for line in f:
        m = re.match(r"#\s*(\S+)\s+(\S+)\s+\((https://github\.com/[\w.-]+/[\w.-]+)\)", line)
        if m:
            libs.append(m.groups())
        elif line.strip() and not line.startswith("#"):
            digest, name = line.split()
            files.append((digest, name))

added = []
for name, version, url in libs:
    stem = name.removeprefix("lib").split(".")[0].split("-")[0]
    own = [(d, n) for d, n in files if n.split(".")[0].split("-")[0] == stem]
    if not own:
        sys.exit(f"VENDOR.lock: kirjastolle {name} ei löytynyt tiedostoja")
    owner, repo = url.removeprefix("https://github.com/").split("/")
    purl = f"pkg:github/{owner}/{repo}@{version}"
    comp = {
        "bom-ref": purl,
        "type": "library",
        "name": name,
        "version": version,
        "purl": purl,
        "externalReferences": [{"type": "vcs", "url": url}],
        "hashes": [{"alg": "SHA-256", "content": d} for d, _ in own],
        "properties": [{"name": "hessutalks:vendored-file", "value": "public/assets/vendor/" + n} for _, n in own],
    }
    if name in LICENSES:
        comp["licenses"] = [{"license": {"id": LICENSES[name]}}]
    added.append(comp)

if not added:
    sys.exit("VENDOR.lock: ei kirjastoja")
sbom.setdefault("components", []).extend(added)
root = sbom.get("metadata", {}).get("component", {})
root["name"] = "hessutalks"
deps = sbom.setdefault("dependencies", [])
for d in deps:
    if d.get("ref") == root.get("bom-ref"):
        d.setdefault("dependsOn", []).extend(c["bom-ref"] for c in added)
deps.extend({"ref": c["bom-ref"], "dependsOn": []} for c in added)

with open(sbom_path, "w", encoding="utf-8") as f:
    json.dump(sbom, f, indent=2, ensure_ascii=False)
names = [c["name"] + "@" + c.get("version", "") for c in sbom["components"] if c.get("type") == "library"]
print(f"SBOM: {len(names)} kirjastoa: " + ", ".join(names))
