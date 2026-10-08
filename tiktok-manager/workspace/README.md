# workspace

Hesab yaddaşı burada yaranır və **GitHub-a getmir** (`.gitignore`).

```
workspace/
  account-profile.md            # aktiv hesabın profili
  active.json                   # aktiv hesab (open_id)
  accounts/<open_id>/
    account.json  videos.json  snapshots.json  business.json
    approvals.json  results.json  leads.json  pkg_*.md / pkg_*.json
```
`business.json`-u sahib doldurur (məhsul, qiymət, çatdırılma, ödəniş, əlaqə, auditoriya, bazar, məqsəd, real proof). Boş sahə = `NAMƏLUM`, sistem uydurmur.
