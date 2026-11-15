# Video Studio ↔ Instapilot AI körpüsü

İki layihə bir-birinin fayllarını görmür: CLAUDE AI VIDEO STUDIO claude.ai-dakı Project-dir, Instapilot AI isə ayrıca Claude Code mühitidir. Onları **video paketi** bağlayır (`docs/VIDEO-PAKET.md`): Studio paketi hazırlayır, Instapilot yoxlayır, Fərid-in "bəli"sindən sonra paylaşır, nəticəni paketə yazır və paket Studio-ya geri qayıdır.

```
VIDEO STUDIO ──(video paketi: video.mp4 + caption.txt + meta.json)──► INSTAPILOT AI
     ▲                                                                     │
     └──────────────── meta.json (linklər, nəticə) ◄───────────────────────┘
```

Paketi bir tərəfdən o biri tərəfə hələlik Fərid özü daşıyır (Studio-dan yüklə → Instapilot sessiyasına əlavə et). Ortaq qovluq (məs. Google Drive) sonrakı addımdır və ayrıca təsdiq tələb edir.

| Fayl | Hara gedir |
|---|---|
| `studio-paket-qaydasi.md` | CLAUDE AI VIDEO STUDIO layihəsinin fayllarına (Project knowledge) |
| `instapilot-video-paket/SKILL.md` | Instapilot AI repo-sunda `.claude/skills/instapilot-video-paket/SKILL.md` |
| `../../scripts/video-paket.mjs` | yerində qalır: hər iki tərəf onu GitHub-dan götürüb işlədir |

## Qurulum (telefondan)

Əvvəl bu PR merge olunmalıdır, çünki linklər `main` budağını göstərir.

**1. Video Studio.** Telefonda bu faylı aç, mətnini kopyala:
https://github.com/nurullayevferid4-creator/Jarvis-avtomat/blob/main/integrations/video-studio-instapilot/studio-paket-qaydasi.md
Sonra claude.ai → CLAUDE AI VIDEO STUDIO → Project knowledge → mətn kimi əlavə et (adı: "Video paketi qaydası"). Studio-nun mövcud fayllarına toxunma.

**2. Instapilot AI.** `instapilot-ai` Claude Code sessiyasını aç və bunu yapışdır:

> Mövcud paylaşım koduna toxunma, yalnız yoxla. 1) `git clone --depth 1 https://github.com/nurullayevferid4-creator/Jarvis-avtomat /tmp/jarvis` et. 2) `/tmp/jarvis/integrations/video-studio-instapilot/instapilot-video-paket/SKILL.md` faylını bu repo-da `.claude/skills/instapilot-video-paket/SKILL.md` kimi əlavə et (`.claude/` gitignore-dadırsa, `git add -f` ilə). Ayrıca branch-da commit et, PR aç, merge etmə. 3) Bu repo-da Instagram və TikTok-a hansı funksiya ilə paylaşıldığını tap və mənə bir cümlə ilə yaz. Heç nə paylaşma.

**3. Sınaq.** Studio-dan ilk paketi al, Instapilot sessiyasına əlavə et və yaz: "Bu paketi yoxla, paylaşma." Yoxlayıcının hesabatı gəlməlidir.

## Nə yoxlanılıb

- Yoxlanılıb: paket aləti və qaydaları (`tests/video-package.test.mjs`, real ffmpeg videosu ilə də).
- Yoxlanılmayıb: Instapilot AI-nın öz paylaşım kodu (bu repo-da deyil) və real hesabda paylaşım. Studio Project-də kod icrası və GitHub-a çıxış olub-olmadığı yoxlanmayıb; yoxdursa `meta.json`-u Instapilot tərəfi `yarat` ilə yaradır.
