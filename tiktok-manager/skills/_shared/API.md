# TikTok API statusları (avtomatik: src/capabilities.js)

SUPPORTED = rəsmi developers.tiktok.com sənədindən yoxlanıb. SUPPORTED_RESTRICTED = TikTok məhdudiyyəti ilə (audit olunmamış app → yalnız SELF_ONLY; foto üçün verifikasiya olunmuş domen). UNSUPPORTED_BY_TIKTOK_API = bu sistemin istifadə etdiyi rəsmi API-də yoxdur → manual yol.

| ID | Funksiya | Endpoint | Scope | Limit | Status |
|---|---|---|---|---|---|
| `oauth.authorize` | Hesabı qoşmaq (OAuth avtorizasiya linki) | `GET https://www.tiktok.com/v2/auth/authorize/` | — | — | **SUPPORTED** |
| `oauth.token` | Kodu tokenə dəyişmək / tokeni yeniləmək | `POST /v2/oauth/token/` | — | access_token 24 saat (86400 s), refresh_token 365 gün; refresh zamanı yeni refresh_token gələ bilər | **SUPPORTED** |
| `oauth.revoke` | Girişi ləğv etmək | `POST /v2/oauth/revoke/` | — | — | **SUPPORTED** |
| `user.info` | Profil, bio, follower/like/video sayı | `GET /v2/user/info/` | user.info.basic | user.info.profile | user.info.stats (sahəyə görə) | 600 sorğu/dəqiqə (sliding window), aşanda 429 rate_limit_exceeded | **SUPPORTED** |
| `video.list` | Hesabın ictimai videoları + views/likes/comments/shares | `POST /v2/video/list/` | video.list | max_count ≤ 20 hər səhifədə, cursor ilə səhifələmə; 600 sorğu/dəqiqə | **SUPPORTED** |
| `video.query` | Konkret videoların məlumatını yeniləmək | `POST /v2/video/query/` | video.list | bir sorğuda ≤ 20 video_id; 600 sorğu/dəqiqə | **SUPPORTED** |
| `post.creator_info` | Paylaşımdan əvvəl creator məlumatı (privacy seçimləri, max müddət) | `POST /v2/post/publish/creator_info/query/` | video.publish | 20 sorğu/dəqiqə/token | **SUPPORTED** |
| `post.video.direct` | Videonu birbaşa paylaşmaq (Direct Post) | `POST /v2/post/publish/video/init/` | video.publish | 6 sorğu/dəqiqə/token; gündəlik paylaşım limiti (spam_risk_too_many_posts); upload_url 1 saat etibarlı; chunk 5–64 MB (son ≤128 MB), ≤1000 chunk, video ≤4 GB | **SUPPORTED_RESTRICTED** |
| `post.video.inbox` | Videonu TikTok inbox-una göndərmək (istifadəçi tətbiqdə tamamlayır) | `POST /v2/post/publish/inbox/video/init/` | video.upload | 6 sorğu/dəqiqə/token; upload_url 1 saat | **SUPPORTED** |
| `post.photo` | Foto karusel paylaşımı (≤35 şəkil, URL ilə) | `POST /v2/post/publish/content/init/` | video.publish və ya video.upload | 6 sorğu/dəqiqə/token; şəkil URL-ləri verifikasiya olunmuş domendə olmalıdır | **SUPPORTED_RESTRICTED** |
| `post.status` | Paylaşım statusunu izləmək | `POST /v2/post/publish/status/fetch/` | video.upload / video.publish | 30 sorğu/dəqiqə/token | **SUPPORTED** |
| `comments.read` | Şərhləri oxumaq | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `comments.reply` | Şərhə cavab göndərmək | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `dm.read` | DM oxumaq | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `dm.send` | DM göndərmək | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `insights.saves` | Saves (favorites) sayı | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `insights.reach` | Reach / impressions | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `insights.retention` | Retention / izlənmə müddəti | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `insights.profile_views` | Profil baxışları | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `insights.audience` | Auditoriya demoqrafiyası (ölkə, yaş, cins) | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `insights.follower_history` | Follower artım tarixçəsi | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `video.file` | Video faylını yükləyib görüntü/səs analizi | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `trends.discover` | Trend hashtag/səs/mövzu kəşfi | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `profile.update` | Bio/profil dəyişmək | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `post.schedule` | Gələcək vaxta planlı paylaşım | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
| `engagement.automation` | Avtomatik like/follow/unfollow/şərh | — | — | — | **UNSUPPORTED_BY_TIKTOK_API** |
