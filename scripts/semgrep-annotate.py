#!/usr/bin/env python3
"""Muuntaa Semgrepin JSON-tuloksen GitHub Actions -annotaatioiksi ja palauttaa 1, jos löydöksiä on."""
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)

results = data.get("results", [])
for r in results:
    extra = r.get("extra", {})
    sev = extra.get("severity", "WARNING")
    level = "error" if sev == "ERROR" else "warning"
    msg = (r.get("check_id", "") + ": " + extra.get("message", "")).replace("\n", " ")[:900]
    print(f"::{level} file={r['path']},line={r['start']['line']}::{msg}")
for e in data.get("errors", []):
    print("::warning::semgrep error: " + str(e.get("message", e))[:500].replace("\n", " "))
print(f"Semgrep: {len(results)} löydöstä")
sys.exit(1 if results else 0)
