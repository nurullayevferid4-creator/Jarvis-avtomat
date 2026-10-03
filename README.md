# JARVIS Voice Hub

Səsli şəxsi köməkçi. Sən danışırsan, **Claude** işi anlayır və idarə edir, lazım olanda **OpenAI**-a köməkçi iş verir, nəticəni yoxlayır və sənə azərbaycanca səslə cavab verir. Cloudflare Worker kimi işləyir.

## JARVIS nədir?

JARVIS bir "idarəçidir". Sən ona səslə və ya yazı ilə tapşırıq verirsən. O özü qərar verir: sadə sualı birbaşa cavablayır, böyük işi kiçik addımlara bölür. Heç vaxt sənin təsdiqin olmadan real iş (paylaşım, mesaj, pul, qiymət dəyişikliyi) etmir.

## Claude nə edir?

Claude **əsas modeldir (lider)**:

- tapşırığı anlayır;
- sadə şeyləri özü cavablayır;
- böyük işi 1-4 alt tapşırığa bölür;
- lazım olanda alt tapşırığı OpenAI-a verir;
- OpenAI-ın cavabını **yoxlayır** (uydurma link, rəqəm, səhv fakt axtarır);
- yekun cavabı hazırlayır.

## OpenAI nə edir?

OpenAI **köməkçidir**. Claude-un yerini tutmur. Yalnız Claude ona alt tapşırıq verəndə işləyir, əsasən canlı internet axtarışı, təzə məlumat və araşdırma üçün. OpenAI Claude-un cavabını yoxlamır. Bundan əlavə OpenAI **səs xidməti** kimi də işləyir (danışığı mətnə çevirir və cavabı səsləndirir).

## Sistem necə işləyir?

```
SƏN
 ↓
JARVIS
 ↓
CLAUDE (əsas AI)
 ↓  lazım olsa
OPENAI (köməkçi)
 ↓
CLAUDE nəticəni yoxlayır və yekunlaşdırır
 ↓
JARVIS
 ↓
SƏN
```

1. Səsin `/api/talk` ünvanına gedir, OpenAI Whisper onu mətnə çevirir (dil: az).
2. Claude sorğunu qiymətləndirir: söhbətdirsə birbaşa cavab verir, işdirsə alt tapşırıqlara bölür.
3. Asılılığı olmayan addımlar paralel işləyir.
4. Köməkçinin nəticəsini Claude yoxlayır. Problem tapsa, bir neçə dəfəyə qədər yenidən cəhd edilir.
5. Claude qısa səsli və tam ekran cavabı yazır, OpenAI səsləndirir.
6. Paylaşım, qiymət dəyişikliyi, pul xərcləmək, mesaj göndərmək, silmək kimi işlər üçün JARVIS "İcra edim?" deyə soruşur. **Bu versiyada real icra inteqrasiyası yoxdur**: "hə" desən belə yalnız qaralama qaytarılır, özün icra etməlisən.

Hər cavabın statusu sistem tərəfindən təyin olunur: `achieved`, `partial`, `blocked`, `pending_approval`, `clarification`, `chat`. API cavab verməsə, JARVIS bunu açıq yazır, saxta uğur bildirmir.

### Təhlükəsizlik limitləri

| Limit | Standart |
|---|---|
| Bir sorğuda alt tapşırıq | 4 |
| Bir sorğuda ümumi model çağırışı | 12 |
| Hər API çağırışının gözləmə vaxtı | 25 saniyə |
| Səhv parol cəhdi (sonra bloklanır) | 5 cəhd, 15 dəqiqə |

Hamısı dəyişdirilə bilər (`.env.example` faylına bax), amma həmişə təhlükəsiz aralıqda qalır.

## API açarları hara yazılacaq?

**Açarları heç vaxt GitHub-a yazma.** Repo açıqdır, hər kəs görər.

- **Cloudflare-də (real istifadə):** Worker → Settings → Variables and Secrets bölməsində **Secret** kimi əlavə et:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `PASSCODE` (tətbiqə girmək üçün öz seçdiyin parol)
- **Lokal sınaq üçün:** `.dev.vars.example` faylını kopyala, adını `.dev.vars` qoy, açarları orada yaz. `.dev.vars` və `.env` faylları `.gitignore` ilə qorunur.
- `.env.example` yalnız **nümunədir**: adları göstərir, dəyərləri boşdur.

## Lokal test necə ediləcək?

Node.js lazımdır. Repo qovluğunda:

```
npm test
```

Bu, **açarsız** işləyir, çünki testlər saxta API cavabları ilə gedir. Test nələri yoxlayır: söhbət, iş bölgüsü, Claude-un yoxlaması, limitlər, xəta halları, təsdiq qapısı, parol limiti, gizli açar qoruması.

**Real API testi** ayrıdır və yalnız açarları əlavə etdikdən sonra işlədilir. Özünün açarlarını mühit dəyişəni kimi ver, sonra:

```
npm run test:live
```

> **Vacib:** saxta testlərin keçməsi o demək deyil ki, real API ilə işləyir. Real açarlarla sınaq hələ keçirilməyib. Real testi keçməyənə qədər sistemi "işləyir" hesab etmə.

Real testdə yoxlanmalı ola biləcək iki şey: `OPENAI_MODEL` (standart `gpt-4o`, hesabında işləyən modeli seç) və `OPENAI_WEB_SEARCH_TOOL` (standart `web_search`, köhnəsi `web_search_preview`).

## Gələcəkdə Cloudflare-ə necə yerləşdiriləcək?

1. Cloudflare-də pulsuz hesab aç.
2. Workers & Pages bölməsində bu GitHub repo-nu Git ilə bağla. Cloudflare `wrangler.toml` faylını (`main = "worker.js"`) oxuyub bütün `src/` qovluğunu özü birləşdirir.
3. Yuxarıdakı 3 Secret-i əlavə et.
4. Tövsiyə: KV namespace yarat, `JARVIS_KV` adı ilə Worker-ə bağla (`wrangler.toml` içindəki `kv_namespaces` blokunu aç, id-ni yaz). KV olmasa söhbət yaddaşı, gözləyən təsdiq və parol cəhd sayğacı Worker yenidən başlayanda silinir.
5. Worker ünvanını Safari-də aç, parolu yaz, "Danış" düyməsinə bas, mikrofon icazəsini ver. Paylaş menyusundan "Ana ekrana əlavə et" seç.

> **Dəyişiklik:** kod indi bir neçə fayla bölünüb. Əvvəlki kimi `worker.js` mətnini Cloudflare redaktoruna **yapışdırmaq artıq işləmir**. Git ilə bağlamaq lazımdır (yuxarıdakı 2-ci addım).

Parol limiti KV olmadan zəifdir, KV ilə də tam dəqiq deyil. Güclü qoruma üçün Cloudflare-in öz Rate Limiting qaydasını da əlavə etmək məsləhətdir.

## Gələcəkdə Kimi (və ya başqa AI) necə əlavə edilə bilər?

**Kimi hələlik sistemdə YOXDUR.** Amma quruluş buna hazırdır. Yeni model əlavə etmək 3 addımdır və orkestratora toxunmur:

1. `src/adapters/KimiAdapter.js` yarat. `BaseAdapter`-dən törət və `run(task, ctx)` funksiyasını yaz. API formatını **Kimi-nin rəsmi sənədindən** götür, təxmini yazma. Şablon `src/adapters/BaseAdapter.js` içindəki izahatdadır (hər API çağırışından əvvəl `ctx.budget.spend()`, sorğunu `httpRequest` ilə göndər).
2. `src/adapters/registry.js` içində adapteri import et və `createRegistry` funksiyasına bir sətir əlavə et (orada nümunə şərh kimi yazılıb).
3. Lazım olan açarı (məsələn `KIMI_API_KEY`) Cloudflare Secrets-ə yaz.

Claude lider modelin təlimatı köməkçi siyahısını reyestrdən özü oxuyur, ona görə yeni model avtomatik planlamaya düşür. Bunun mümkün olduğunu `tests/registry.test.mjs` göstərir (saxta adapterlə).

## Fayl quruluşu

```
worker.js                  Cloudflare giriş faylı (src/index.js-i çağırır)
src/index.js               ünvanlar, parol, parol cəhd limiti
src/orchestrator/          ClaudeOrchestrator (planlama, yoxlama, yekun cavab)
src/adapters/              ClaudeAdapter, OpenAIAdapter, səs, reyestr, BaseAdapter
src/guards/                limitlər (çağırış sayı, vaxt, parol)
src/approval/              təsdiq qapısı
src/state/                 söhbət yaddaşı və iş tarixçəsi
src/ui/                    telefon səhifəsi
tests/                     yeni testlər
test.mjs                   köhnə testlər (dəyişdirilməyib)
.env.example               açar adlarının nümunəsi (dəyərlər boş)
```

`CLAUDE.md`, `AGENTS.md`, `TEAM.md` və `.github/` GitHub Issue ilə üçlü iş qaydasına aiddir və bu sistemdən ayrıdır.

## Məhdudiyyətlər

- Düyməyə basıb danışmaq rejimidir, canlı zəng deyil.
- Shopify, Instagram, Telegram inteqrasiyaları hələ yoxdur. Paylaşım tapşırıqlarında yalnız qaralama hazırlanır.
- Real API ilə sınaq hələ keçirilməyib (yuxarıya bax).
- API açarlarını heç vaxt bu repo-ya yazma. Repo açıqdırsa hər kəs görür.
