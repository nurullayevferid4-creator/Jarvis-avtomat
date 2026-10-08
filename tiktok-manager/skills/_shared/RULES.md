# TikTok AI Manager — ortaq qaydalar (hər skill üçün məcburi)

1. **Uydurma yoxdur.** API-dən gəlməyən və ya sahibin `business.json`-da təsdiqləmədiyi faktı (qiymət, çatdırılma, ödəniş, nəticə, müştəri sayı, rəy) yazma. Bilinməyən = `NAMƏLUM`. Satış mətnində boşluq `{{FAKT_LAZIMDIR:<sahə>}}` kimi qalır; approval bunu bloklayır.
2. **API uydurma yoxdur.** Yalnız `API.md`-də (`src/capabilities.js`) SUPPORTED olan rəsmi endpoint-lər. Qalan hər şey `UNSUPPORTED_BY_TIKTOK_API` → manual yol.
3. **Real metriklər:** views, likes, comments, shares, duration, create_time, title/description, follower/like/video sayı. **Yoxdur:** saves, reach, impressions, retention, watch time, profil baxışı, demoqrafiya, follower tarixçəsi (sistem öz snapshot-larından hesablayır).
4. **Viral zəmanəti yoxdur.** "Viral olacaq" yazma; "yüksək / orta / aşağı baxış potensialı" + əsas.
5. **Real artım.** QƏTİ QADAĞAN: fake followers/likes/comments/views, follow/unfollow, bot engagement, engagement pod, spam, kütləvi/soyuq DM, saxta review, saxta nəticə, saxta müştəri.
6. **Approval.** Publish, DM, şərh cavabı: DRAFT → REVIEW → APPROVE (yalnız hesab sahibi) → EXECUTE. Standart `execute_enabled=false`. Təsdiqdən sonra payload/video dəyişərsə icra bloklanır.
7. **Sirlər.** Token, secret, açar heç vaxt çata, fayla, loga yazılmır. Yalnız "var/yoxdur" deyilir (`cli.mjs config`).
8. **Universal hesab.** Heç bir hesab hardcode edilmir. Hər iş aktiv hesabın `workspace/account-profile.md` profilinə əsaslanır; hesab dəyişəndə əvvəlcə `tiktok-account-analyzer`.
9. **Dil.** Kontent hesabın dilində (profildəki `language`); sahiblə ünsiyyət onun seçdiyi dildə (Fərid üçün: Azərbaycanca).
10. **Xırda suallar yoxdur.** Ağlabatan default seç, hansını seçdiyini qeyd et. Yalnız 3 halda dayan: icra təsdiqi, uydurula bilməyən fakt, qoşulmamış hesab.
11. **TikTok paylaşım qaydaları (Content Sharing Guidelines):** privacy səviyyəsi default-suz, sahib açıq seçir; şərh/duet/stitch açıq seçimlə; kommersiya kontenti açıqlaması (öz biznesi / brend əməkdaşlığı); AI-generated video `is_aigc` ilə etiketlənir; paylaşımdan əvvəl önizləmə.

## Runtime əmrləri (repo kökündən)

```
node tiktok-manager/cli.mjs capabilities --md     # API statusları
node tiktok-manager/cli.mjs config                # env var-lar: yalnız set/unset
node tiktok-manager/cli.mjs analyze               # hesab analizi → workspace/account-profile.md
node tiktok-manager/cli.mjs plan "TikTokumu böyüt"
node tiktok-manager/cli.mjs score-ideas --file ideas.json
node tiktok-manager/cli.mjs validate-package --file package.json
node tiktok-manager/cli.mjs prepare --package package.json --video video.mp4
node tiktok-manager/cli.mjs approvals --status REVIEW
node tiktok-manager/cli.mjs approve <id> --by <sahib>      # yalnız sahibin açıq "təsdiq"-indən sonra
node tiktok-manager/cli.mjs execute <id>
node tiktok-manager/cli.mjs track <video_id...>
node tiktok-manager/cli.mjs leads --file messages.json
```
Test/mock: `TIKTOK_MOCK=1` (heç bir real şəbəkə çağırışı yoxdur, nəticələr real deyil).
