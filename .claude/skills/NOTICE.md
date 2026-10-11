# Skill-lər: mənbə və lisenziya

Bu qovluqdakı 13 skill [aitmpl.com](https://aitmpl.com) kataloqunun mənbəyi olan
[davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) reposundan
(`cli-tool/components/skills/`) **dəyişdirilmədən** götürülüb. Hər skill üçün rəsmi quraşdırma əmri:

```
npx claude-code-templates@latest --skill <kateqoriya>/<ad>
```

| Skill | Kataloq yolu |
|---|---|
| ab-test-setup | business-marketing/ab-test-setup |
| analytics-tracking | business-marketing/analytics-tracking |
| competitive-ads-extractor | business-marketing/competitive-ads-extractor |
| copy-editing | business-marketing/copy-editing |
| copywriting | business-marketing/copywriting |
| humanizer | productivity/humanizer |
| lead-research-assistant | business-marketing/lead-research-assistant |
| marketing-psychology | business-marketing/marketing-psychology |
| paid-ads | business-marketing/paid-ads |
| remotion | video/remotion |
| ship-learn-next | productivity/ship-learn-next |
| social-content | business-marketing/social-content |
| transcribe | media/transcribe |

## Lisenziya

Mənbə repo MIT lisenziyalıdır. Skill-lərin çoxunun kataloqdakı öz lisenziya sahəsi boşdur: hər skill-in
orijinal müəllifinin ayrıca lisenziyası **təsdiqlənməyib**. Aşağıdakı hallar məlumdur:

- `transcribe/LICENSE.txt`: Apache 2.0 (skill qovluğunda saxlanılıb).
- `remotion`: skill mətni MIT-dir. Remotion proqramının özü ayrı lisenziyadır (fərdlər, ən çox 3 işçisi olan kommersiya şirkətləri və qeyri-kommersiya təşkilatları üçün pulsuz; digərləri üçün ödənişli). İstifadədən əvvəl https://www.remotion.dev yoxlanmalıdır.
- `humanizer`: müəllifi @blader (skill mətnində qeyd olunub), README-də lisenziya MIT göstərilib.

## davila7/claude-code-templates MIT lisenziyası

```
MIT License

Copyright (c) 2025 Daniel (San) Ávila

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## İstifadə qeydləri

- `transcribe` canlı işləmək üçün `OPENAI_API_KEY` tələb edir (açar heç vaxt repoya yazılmır, yalnız mühit dəyişəni kimi).
- `paid-ads` və `social-content` mətnində "platformaya birbaşa giriş var" ifadəsi var. Bu repoda belə giriş yoxdur: mətni həqiqət kimi qəbul etmə.
- `competitive-ads-extractor` Facebook Ad Library-yə çıxış tələb edir.
