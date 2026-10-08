---
name: tiktok-video-production
description: Ssenarini çəkiliş/montaj planına çevirir: səhnələr, kadrlar, ekran mətni, voice-over, B-roll, səs, örtük kadrı. Video paketinin 'scenes' hissəsini yaradır.
---

# TikTok Video Production

## Səhnə cədvəli
Hər səhnə: `{ "start", "end", "visual", "shot": "close-up|medium|wide|screen", "on_screen_text", "voiceover", "b_roll", "sfx_music" }`
- Səhnə 1 = hook, `start: 0`, `end ≤ 3`.
- Vaxtlar ardıcıl, boşluqsuz; son səhnə = CTA.
- Format 9:16 (1080×1920). Rəsmi API: MP4/MOV/WebM, H.264 tövsiyə, ≤ 4 GB.
- Örtük: `cover_timestamp_ms` (Direct Post `video_cover_timestamp_ms`) — mətnli, aydın kadr.

## Musiqi
API ilə TikTok səs kitabxanası seçilmir. Lisenziyalı musiqi istifadə et və ya sahib paylaşım zamanı tətbiqdə səs əlavə etsin (inbox axını: `video.inbox`).

## AI ilə yaradılmış görüntü
AI ilə yaradılmış video `publish.is_aigc: true` ilə etiketlənməlidir (TikTok qaydası).

## Çıxış
`scenes[]`, `voiceover`, çəkiliş siyahısı (lazımi kadrlar, rekvizit), montaj qeydləri.

## Ortaq qaydalar
Bax `_shared/RULES.md` (bundle-da `references/RULES.md`) və API statusları `_shared/API.md`.
