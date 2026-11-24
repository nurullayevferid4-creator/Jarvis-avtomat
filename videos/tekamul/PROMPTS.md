# Təkamül morph videosu — ibtidai insandan müasir insana

Referens: 30 saniyəlik, 9:16, ortada 16:9 kadr, üstdə 2 sətirlik yazı.
Kadrlar bir-birinə **kəsilmədən morf olur** (daş → nizə → ox → güllə → raket → təyyarə → kosmos).
Bizim versiya: eyni texnika, mövzu — insanın özü və aləti.

## Üst yazı
- Sətir 1: `İnsanlığın milyon illik təkamülü`
- Sətir 2: `Son saniyəyə diqqət et 🤯`

## Ümumi stil (hər prompta əlavə et)
`cinematic, photorealistic, 16:9, continuous single shot, slow push-in camera, seamless morph transition, no cuts, dramatic natural light, shallow depth of field, film grain`

## Səhnələr (10 × 3 san = 30 san)
Hər klipin **son kadrı** növbəti klipin **ilk kadrı** olur (image2video / keyframe rejimi).

| # | Səhnə | Prompt (EN) | Morf körpüsü |
|---|-------|-------------|--------------|
| 1 | İlk insanabənzər | `early hominin with ape-like face, hunched posture, on an African savanna at dawn, raises its fist and shouts, close-up` | yumruq → əl |
| 2 | Daş alət | `the hairy hand opens and grips a rough stone hand axe, chips flying as another stone strikes it, savanna background` | daş |
| 3 | Od | `the stone strikes flint, sparks ignite dry grass, a primitive human with a heavier brow blows on the flame at night` | alov |
| 4 | Mağara | `firelight reveals a cave wall, a human hand presses red ochre and leaves a handprint next to painted animals` | əl izi |
| 5 | Əkinçilik | `the handprint dissolves into a field of wheat, a human in woven clothes cuts wheat with a stone sickle, golden hour` | buğda |
| 6 | Qədim şəhər | `the wheat sheaves turn into mud bricks, workers build a stepped ancient temple city, dust in the air` | kərpic → yazı lövhəsi |
| 7 | Yazı və kitab | `clay tablet with carved signs morphs into a handwritten book, then a wooden printing press stamps a page, candle light` | kağız |
| 8 | Sənaye | `printed pages fly up and become steam, a steam locomotive rushes past a factory, workers in caps` | buxar → ekran işığı |
| 9 | Müasir insan | `steam clears to reveal a modern person in a city at night looking at a smartphone, screen light on the face` | ekran |
| 10 | Son saniyə | `the smartphone light spreads over the face, the face becomes a glowing digital wireframe, camera pulls back to Earth from orbit` | twist |

## Mənbə yoxlaması
Bu faylda tarix/rəqəm yoxdur. Kadr üstünə il etiketi (məs. "2,5 mln il əvvəl") qoymaq istəsək, rəqəmləri ChatGPT etibarlı mənbə ilə yoxlamalıdır.

## Montaj
Klipləri `clips/01.mp4 … clips/10.mp4` kimi qoy, sonra:
`bash build.sh` → `out/tekamul_9x16.mp4`
