#!/usr/bin/env python3
"""Hər skill üçün paylanan bundle (.skill = zip) yaradır: SKILL.md + references/RULES.md + references/API.md.

Addımlar: _shared/API.md-ni rəsmi reyestrdən yenidən yarat (node cli.mjs capabilities --md) → validate.py → dist/*.skill + dist/manifest.json.
"""
import hashlib
import json
import os
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS = os.path.join(ROOT, "skills")
SHARED = os.path.join(SKILLS, "_shared")
DIST = os.path.join(ROOT, "dist")
FIXED_TIME = (2026, 1, 1, 0, 0, 0)  # təkrarlana bilən build


def gen_api_md():
    r = subprocess.run(["node", os.path.join(ROOT, "cli.mjs"), "capabilities", "--md"], capture_output=True, text=True, env={**os.environ, "TIKTOK_MOCK": ""})
    if r.returncode != 0:
        sys.exit("API.md yaradılmadı: " + r.stderr)
    head = ("# TikTok API statusları (avtomatik: src/capabilities.js)\n\n"
            "SUPPORTED = rəsmi developers.tiktok.com sənədindən yoxlanıb. SUPPORTED_RESTRICTED = TikTok məhdudiyyəti ilə "
            "(audit olunmamış app → yalnız SELF_ONLY; foto üçün verifikasiya olunmuş domen). "
            "UNSUPPORTED_BY_TIKTOK_API = bu sistemin istifadə etdiyi rəsmi API-də yoxdur → manual yol.\n\n")
    with open(os.path.join(SHARED, "API.md"), "w", encoding="utf-8") as f:
        f.write(head + r.stdout)


def add(z, arc, path):
    info = zipfile.ZipInfo(arc, FIXED_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    with open(path, "rb") as f:
        z.writestr(info, f.read())


def main():
    gen_api_md()
    v = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "validate.py")], capture_output=True, text=True)
    sys.stdout.write(v.stdout)
    if v.returncode != 0:
        sys.exit("validate.py keçmədi: bundle yaradılmır")
    os.makedirs(DIST, exist_ok=True)
    manifest = []
    for name in sorted(os.listdir(SKILLS)):
        d = os.path.join(SKILLS, name)
        if name.startswith("_") or not os.path.isdir(d):
            continue
        out = os.path.join(DIST, name + ".skill")
        with zipfile.ZipFile(out, "w") as z:
            for root, _, files in os.walk(d):
                for fn in sorted(files):
                    p = os.path.join(root, fn)
                    add(z, os.path.join(name, os.path.relpath(p, d)), p)
            add(z, name + "/references/RULES.md", os.path.join(SHARED, "RULES.md"))
            add(z, name + "/references/API.md", os.path.join(SHARED, "API.md"))
        with open(out, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        with zipfile.ZipFile(out) as z:
            if z.testzip() is not None:
                sys.exit("zədəli bundle: " + out)
            entries = z.namelist()
        manifest.append({"skill": name, "file": os.path.basename(out), "sha256": sha, "entries": entries})
    with open(os.path.join(DIST, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("%d bundle yaradıldı: %s" % (len(manifest), DIST))


if __name__ == "__main__":
    main()
