#!/usr/bin/env python3
"""Muuntaa ZAP-raportin (report_json.json) GitHub Actions -annotaatioiksi."""
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as f:
        data = json.load(f)
except FileNotFoundError:
    print("::warning::ZAP-raporttia ei löytynyt")
    sys.exit(0)

for site in data.get("site", []):
    for a in site.get("alerts", []):
        urls = sorted({i.get("uri", "") for i in a.get("instances", [])})[:3]
        msg = f"ZAP {a.get('pluginid')} [{a.get('riskdesc')}] {a.get('alert')} – {', '.join(urls)}"
        print(f"::warning file=.zap/rules.tsv,line=1::{msg[:900]}")
