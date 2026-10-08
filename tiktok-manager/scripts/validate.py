#!/usr/bin/env python3
"""TikTok AI Manager skill-lərini yoxlayır (yalnız stdlib).

Yoxlamalar:
  - 20 gözlənilən skill, hər birində düzgün frontmatter (name = qovluq adı, description)
  - tiktok-manager bütün skill-ləri orkestr edir
  - hər skill ortaq qaydalara istinad edir
  - skill-lərdə adı çəkilən hər /v2/ endpoint rəsmi reyestrdədir (src/capabilities.js) — API uydurulmur
  - UNSUPPORTED funksiya adı çəkilən sətir UNSUPPORTED deyir
  - _shared/API.md reyestrlə sinxrondur
  - sirr nümunələri yoxdur
Çıxış kodu: 0 = keçdi, 1 = xəta.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS_DIR = os.path.join(ROOT, "skills")
EXPECTED = [
    "tiktok-account-analyzer", "tiktok-strategy", "tiktok-research", "tiktok-content-planner", "tiktok-video-ideas",
    "tiktok-hooks", "tiktok-script-writer", "tiktok-video-production", "tiktok-caption", "tiktok-hashtags",
    "tiktok-ad-creator", "tiktok-publisher", "tiktok-comments", "tiktok-dm", "tiktok-leads", "tiktok-sales",
    "tiktok-analytics", "tiktok-humanizer", "tiktok-growth", "tiktok-manager",
]
SECRET_RE = re.compile(r"(act|rft)\.[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----")


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def registry():
    src = read(os.path.join(ROOT, "src", "capabilities.js"))
    ids = re.findall(r'^\s+"([a-z_]+\.[a-z_.]+)":\s*(\{|unsupported\()', src, re.M)
    endpoints = set(re.findall(r'endpoint:\s*"(/v2/[^"]+)"', src))
    unsupported = {i for i, kind in ids if kind.startswith("unsupported")}
    return [i for i, _ in ids], endpoints, unsupported


def frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None
    out = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def main():
    errors = []
    ids, endpoints, unsupported = registry()
    if len(ids) < 10 or not endpoints:
        errors.append("capabilities.js oxunmadı")

    present = sorted(d for d in os.listdir(SKILLS_DIR) if not d.startswith("_") and os.path.isdir(os.path.join(SKILLS_DIR, d)))
    if present != sorted(EXPECTED):
        errors.append("skill dəsti uyğun deyil: artıq=%s çatışmayan=%s" % (sorted(set(present) - set(EXPECTED)), sorted(set(EXPECTED) - set(present))))

    for name in EXPECTED:
        p = os.path.join(SKILLS_DIR, name, "SKILL.md")
        if not os.path.exists(p):
            errors.append("%s: SKILL.md yoxdur" % name)
            continue
        text = read(p)
        fm = frontmatter(text)
        if not fm:
            errors.append("%s: frontmatter yoxdur" % name)
            continue
        if fm.get("name") != name:
            errors.append("%s: name '%s' qovluq adı ilə eyni deyil" % (name, fm.get("name")))
        if not re.fullmatch(r"[a-z0-9-]{1,64}", name):
            errors.append("%s: ad kebab-case və ≤64 olmalıdır" % name)
        desc = fm.get("description", "")
        if not desc or len(desc) > 1024 or "<" in desc or ">" in desc:
            errors.append("%s: description boş, çox uzun və ya bucaq mötərizəli" % name)
        if "_shared/RULES.md" not in text:
            errors.append("%s: ortaq qaydalara istinad yoxdur" % name)
        for ep in re.findall(r"/v2/[a-z_/]+/", text):
            if ep not in endpoints:
                errors.append("%s: reyestrdə olmayan endpoint: %s" % (name, ep))
        for line in text.splitlines():
            for cap in unsupported:
                if "`%s`" % cap in line and "UNSUPPORTED" not in line:
                    errors.append("%s: '%s' dəstəklənmir, amma sətir bunu demir: %s" % (name, cap, line.strip()[:100]))
        if SECRET_RE.search(text):
            errors.append("%s: sirr nümunəsi" % name)

    mgr = os.path.join(SKILLS_DIR, "tiktok-manager", "SKILL.md")
    if os.path.exists(mgr):
        t = read(mgr)
        for s in EXPECTED:
            if s != "tiktok-manager" and s not in t:
                errors.append("tiktok-manager: %s orkestr edilmir" % s)

    rules = os.path.join(SKILLS_DIR, "_shared", "RULES.md")
    if not os.path.exists(rules):
        errors.append("_shared/RULES.md yoxdur")
    else:
        r = read(rules)
        for must in ["fake followers", "spam", "UNSUPPORTED_BY_TIKTOK_API", "execute_enabled=false", "NAMƏLUM"]:
            if must not in r:
                errors.append("RULES.md: '%s' yoxdur" % must)

    api = os.path.join(SKILLS_DIR, "_shared", "API.md")
    if not os.path.exists(api):
        errors.append("_shared/API.md yoxdur (build_bundles.py yaradır)")
    else:
        a = read(api)
        for i in ids:
            if "`%s`" % i not in a:
                errors.append("API.md reyestrlə sinxron deyil: %s yoxdur" % i)

    for e in errors:
        print("XƏTA: " + e)
    print("%d skill yoxlandı, %d xəta." % (len(present), len(errors)))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
