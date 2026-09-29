# JARVIS Voice Hub

Səsli şəxsi köməkçi. Danışırsan, Claude planı qurur, Claude və GPT işi bölüşür, JARVIS azərbaycanca səslə cavab verir. Tək fayldır (`worker.js`), Cloudflare Worker kimi işləyir.

## Necə işləyir

1. Səsin `/api/talk` ünvanına gedir, OpenAI Whisper mətnə çevirir (dil: az).
2. Claude sorğunu qiymətləndirir: sadə söhbətdirsə birbaşa cavab verir, iş tapşırığıdırsa 1-4 alt tapşırığa bölür.
3. Canlı axtarış və araşdırma GPT-yə, yazı və mühakimə Claude-a verilir. Asılılığı olmayan addımlar paralel işləyir.
4. Modellər bir-birinin nəticəsini yoxlayır, tapılan problem üçün bir dəfə yenidən cəhd edilir.
5. Claude qısa səsli və tam ekran cavabı yazır, OpenAI səsləndirir.
6. Paylaşım, qiymət dəyişikliyi, pul xərcləmək kimi işlər təsdiqsiz icra olunmur. JARVIS "İcra edim?" deyə soruşur və yalnız "hə" cavabından sonra davam edir.

Hər cavabın statusu sistem tərəfindən təyin olunur: `achieved`, `partial`, `blocked`, `pending_approval`, `clarification`, `chat`.

## Quraşdırma (Cloudflare)

1. Cloudflare-də pulsuz hesab aç.
2. Workers & Pages bölməsində bu GitHub repo-nu bağla (Git ilə import) və ya `worker.js` mətnini Worker redaktoruna yapışdır.
3. Worker-in Settings > Variables and Secrets bölməsində Secret əlavə et: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PASSCODE`.
4. Tövsiyə: KV namespace yarat, `JARVIS_KV` adı ilə Worker-ə bağla. Git ilə deploy edirsənsə, `wrangler.toml` içindəki `kv_namespaces` blokunu aç və id-ni yaz. Bunsuz söhbət yaddaşı və gözləyən təsdiq bir müddət sonra silinir.
5. Worker ünvanını Safari-də aç, parolu yaz, "Danış" düyməsinə bas, mikrofon icazəsini ver. Paylaş menyusundan "Ana ekrana əlavə et" seç.

İstəyə bağlı dəyişənlər: `CLAUDE_MODEL` (standart `claude-sonnet-5-5`), `OPENAI_MODEL` (standart `gpt-4o`), `TTS_VOICE` (standart `onyx`).

## Sınaq

```
npm test
```

Testlər saxta API cavabları ilə işləyir (söhbət, bölgü, təsdiq, səs, xəta halları). Real açarlarla sınaq keçirilməyib.

## Məhdudiyyətlər

- Düyməyə basıb danışmaq rejimidir, canlı zəng deyil.
- Shopify, Instagram, Telegram inteqrasiyaları hələ yoxdur. Paylaşım tapşırıqlarında yalnız qaralama hazırlanır.
- API açarlarını heç vaxt bu repo-ya yazma. Repo açıqdırsa hər kəs görür.
