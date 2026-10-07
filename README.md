# JARVIS Voice Hub

Fərid-in şəxsi idarəetmə köməkçisi. Səslə və ya yazı ilə tapşırıq verirsən; **Claude** işi anlayıb idarə edir, lazım olanda **OpenAI** (axtarış, səs) və istəyə bağlı **Kimi** kömək edir. Riskli əməliyyatlar (paylaşım, Shopify yazması, mesaj, silmə) **yalnız sənin təsdiqindən sonra** icra olunur. Cloudflare Worker kimi işləyir.

> **Dürüst status (kod və testlərlə təsdiqlənən):** kod, testlər və lokal real-runtime (`wrangler dev --local`, workerd) yoxlanıb. **Real Claude / OpenAI / Kimi / Telegram / Instagram / TikTok / YouTube / Shopify hesabları ilə sınaq hələ keçirilməyib**: onlar sənin açar və hesablarını tələb edir. Real sınaq üçün `docs/SMOKE.md`. Real sınaqdan keçməyənə qədər sistemi "canlı işləyir" hesab etmə.

## Nə var, nə yoxdur

| Hissə | Vəziyyət | Necə yoxlanıb |
|---|---|---|
| Parol girişi (Base64 başlıq, ə/ı/ş/ğ parolu), cəhd limiti | işləyir | testlər + real Chromium (`scripts/ui-smoke.mjs`) |
| Claude lider + OpenAI köməkçi + Kimi ikinci rəy, avtomatik ehtiyat | kod hazır | saxta API testləri; real açarla sınanmayıb |
| Səs: STT → əmr («Jarvis, ...») → plan → alətlər → azərbaycanca cavab → TTS | kod hazır | saxta OpenAI testləri; real səs sınanmayıb |
| Təsdiq mərkəzi + atomik icra (Durable Object), çatlar arası qoruma | işləyir | testlər + real workerd-də 6 paralel təsdiq → 1 icra |
| Alət reyestri (45 alət) | işləyir | testlər |
| Media: axınla R2 yükləmə, MP4 analizi, növ/ölçü yoxlaması, silmə (təsdiqlə) | işləyir | testlər + real workerd + real ffmpeg fayllarla |
| Video iş axını (yüklə → yoxla → analiz → plan → emal → nəticəni yoxla → saxla) | emal addımı **sənin ffmpeg serverin** tələb edir | `docs/VIDEO.md`; xidmət yoxdursa redaktə lazım olan iş `FAILED` olur (plan göstərilir), "hazırdır" deyilmir |
| Telegram səsli mesaj (voice note → STT `az` → yazılı əmrlə eyni yol) | kod hazır; Telegram-a səsli cavab (TTS) yoxdur, cavab mətnlə | saxta Telegram/OpenAI testləri; real səs sınanmayıb |
| Telegram (webhook, düymələr, kanal paylaşımı) | kod hazır; webhook qurulması idempotent, `getWebhookInfo` ilə təsdiqlənir, səhvlər dəqiq səbəblə göstərilir | saxta (vəziyyətli) Bot API + real Chromium; real bot ilə sınaq üçün `docs/SMOKE.md` §4 |
| Instagram / TikTok / YouTube (OAuth, yükləmə, status, təsdiqlə paylaşım) | kod hazır | saxta API; hər biri üçün real tətbiq + platforma təsdiqi (audit/review) lazım, bax `docs/INTEGRATIONS.md` |
| Shopify (OAuth, məhsul/qiymət/stok/kolleksiya/webhook, DRAFT-by-default, silmə yox) | kod hazır | saxta API + HMAC testləri; real mağaza lazım |
| Lead sistemi (yalnız ictimai/qanuni mənbə, kütləvi göndəriş YOX) | kod hazır | testlər |
| Marketinq planlayıcı (QR Menu ayrıca iş axını) | kod hazır | testlər |
| Agent reyestri + Manager hesabatı | kod hazır | testlər; saxta agent yoxdur |
| Dropshipping / e-commerce | **yalnız interfeys** (`src/commerce/interfaces.js`); real təchizatçı/ödəniş yoxdur | — |
| UI paneli | işləyir | real Chromium tüstü yoxlaması |
| GitHub Actions (CI sirsiz, Claude workflow qorunur) | YAML hazır | real GitHub-da işə salınmayıb |

Hər cavabın statusunu sistem təyin edir (`achieved`, `partial`, `blocked`, `pending_approval`, `clarification`, `chat`). API cavab verməsə, JARVIS bunu açıq yazır; saxta uğur bildirmir.

## Sənədlər

| Fayl | Nə üçün |
|---|---|
| `docs/SETUP.md` | Sıfırdan quraşdırma (brauzerlə, addım-addım) |
| `docs/ENVIRONMENT.md` | Bütün mühit dəyişənləri və sirlər |
| `docs/DEPLOYMENT.md` | Deploy, dry-run, geri qaytarma |
| `docs/SMOKE.md` | Real açarlar əlavə olunandan sonra ilk sınaq |
| `docs/API.md` | HTTP ünvanları |
| `docs/INTEGRATIONS.md` | Telegram / Instagram / TikTok / YouTube / Shopify / Kimi: nə lazımdır, hansı icazələr |
| `docs/VIDEO.md` | Video emal xidməti |
| `docs/TROUBLESHOOTING.md` | Tipik xətalar |
| `SECURITY.md`, `APPROVALS.md`, `TOOLS.md`, `SOCIAL.md`, `docs/SHOPIFY.md`, `docs/LEADS.md`, `docs/MARKETING.md`, `docs/AGENTS.md` | Hissə üzrə təfərrüat |

## Sistem necə işləyir

```
SƏN (səs / yazı / Telegram)
 ↓ səs: STT → «Jarvis, ...» təmizlənir
JARVIS orkestratoru
 ↓ Claude planlaşdırır: söhbət | alt tapşırıqlar | alətlər
ALƏT REYESTRİ (giriş sxemi, icazə, risk, vaxt limiti, təkrar, audit)
 ├─ oxuma/hazırlama alətləri → dərhal icra
 └─ riskli alətlər → YALNIZ təsdiq qeydi açır
        ↓ sən UI/Telegram-da təsdiq edirsən
     ActionRunner / social flow → bir dəfə icra (atomik) → audit
 ↓
Claude nəticəni yoxlayır, azərbaycanca cavab yazır → TTS → SƏN
```

Təsdiq tələb edənlər: sosial paylaşım, Shopify yazması, kritik müştəri mesajı (lead outreach), silmə, hesab/credential dəyişikliyi, maliyyə əməliyyatı, real reklam aktivləşdirmə. Səslə «hə» demək bunları icra etmir.

## Lokal yoxlama

Node.js 22 lazımdır (Windows 7-də işləmir, bax `docs/SETUP.md`).

```
npm run check        # sintaksis + statik audit + bütün testlər (açarsız, real API çağırmır)
npm run test:ui      # real Chromium-da UI yoxlaması (playwright lazım)
npm run test:live    # real Claude/OpenAI testi (yalnız öz açarlarınla, az pul xərcləyir)
```

`wrangler dev --local` + `scripts/runtime-smoke.mjs` real Cloudflare runtime-da (KV/R2/Durable Object lokal) tüstü yoxlamasıdır.

## Məhdudiyyətlər

- Real xarici hesablarla sınaq yoxdur (yuxarıdakı cədvələ bax).
- Video emalı üçün ayrı server lazımdır (Worker ffmpeg işlədə bilmir).
- Instagram/TikTok/YouTube üçün təsdiqlənməmiş tətbiqlər məhdudiyyətlə işləyir (TikTok yalnız `SELF_ONLY`, YouTube yalnız `private` ola bilər); bax `docs/INTEGRATIONS.md`.
- Düyməyə basıb danışmaq rejimidir, canlı zəng deyil.
- API açarlarını heç vaxt bu repo-ya yazma. Repo açıqdır.

`CLAUDE.md`, `AGENTS.md`, `TEAM.md`, `.github/` GitHub Issue ilə üçlü iş qaydasına aiddir (Fərid + Claude + ChatGPT) və bu sistemdən ayrıdır.
