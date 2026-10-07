# Lead sistemi

Kod: `src/leads/`. Qoşulma: `registerLeadTools(registry, deps)` (`src/leads/index.js`).

**JARVIS lead-lərə özü HEÇ VAXT mesaj göndərmir.** O yalnız lead-i süzür, qiymətləndirir və mətn qaralaması hazırlayır. Mətni sahib özü göndərir.

## Nə var (real, testlərlə yoxlanıb)

| Mərhələ | Funksiya | Qayda |
|---|---|---|
| RESEARCH | `researchStage` | Ən çox 10 namizəd. Namizəd açıq mənbə ünvanı (`source.url`, https) ilə gəlməlidir. Real axtarış YOXDUR (aşağıya bax). |
| FILTER | `filterStage` | Mənbə yoxdur, qeyri-ictimai kontakt, fiziki şəxs, əlaqə yolu yoxdur, təkrar (sayt, instagram, tiktok, ad+məkan), `do_not_contact` uyğunluğu: rədd edilir və **saxlanmır**. |
| QUALIFY | `qualifyStage` | ICP-yə uyğunluq (kateqoriya, məkan, etibarlılıq). Uyğun deyilsə `filtered_out` kimi saxlanır. |
| SCORE | `scoreStage` | 0-100 bal, 6 amil və hər amilin izahı (kateqoriya 30, ehtiyac siqnalı 20, əlaqə yolu 15, onlayn mövcudluq 10, məkan 15, etibarlılıq 10). |
| SAVE | `saveStage` | `leadidx` indeksi ilə təkrar yoxlaması eyni tranzaksiyadadır. |
| PREPARE MESSAGE | `prepareMessageStage` | Limitlər yoxlanır, qaralama yaranır, lead `awaiting_approval` olur. |
| HUMAN APPROVAL | `ApprovalCenter` | Növ `lead.outreach`, risk `high`, icazə `send.message`. |
| CONTACT | `recordManualContact` | Yalnız `contacted_manually` qeydi. Nəticə mətni `manual send recorded`-dir, `sent` deyil. |

## Anti-spam qaydaları (koddadır, konfiqurasiya ilə yüksəldilə bilməz)

- Araşdırma partiyası: ən çox **10** lead. Gündə araşdırma ilə ən çox **30** yeni lead saxlanır.
- Gündə ən çox **5** outreach qaralaması (gün sərhədi Bakı vaxtı). Rədd edilən və ləğv edilən qaralama da sayılır.
- Bir lead-ə **30 gündə bir dəfə**. Gözləyən qaralama varkən ikincisi hazırlanmır.
- `do_not_contact` geri qaytarılmır. Bu statuslu lead üçün qaralama hazırlanmır, eyni sayt/instagram/ad+məkanla yeni namizəd qəbul edilmir. Təsdiq gözləyərkən qoyulsa, təsdiq icrası bloklanır və heç nə qeyd olunmur.
- Hər qaralamanın sonuna kod özü **göndərənin kimliyi** (`Göndərən: Ad (Biznes)`) və **imtina sətri** (`"Dayan" yazın, bir daha yazmayacağam.`) əlavə edir və yoxlayır. Mətndə yalnız brendin icazəli linki ola bilər.
- Lead-in `notes`, `need` və ad mətni qaralamaya daxil edilmir.
- Balı 40-dan aşağı lead üçün qaralama hazırlanmır.
- Konfiqurasiya (`deps.limits`) limitləri yalnız AŞAĞI sala bilər.

## Məlumat təhlükəsizliyi

- Yalnız ictimai biznes məlumatı: şəxsi şəxs, qapalı kontakt, alınmış/sızdırılmış siyahı və kütləvi e-poçt toplama qəbul edilmir (filtr və partiya limiti).
- Xarici mətn (qeyd, ehtiyac, ad) **məlumatdır, əmr deyil**. Şübhəli təlimat izləri `injection_findings` ilə işarələnir, nəticədə `<external_content>` qutusunda verilir, heç bir alət işə düşmür.
- Repo açıqdır: lead məlumatı KV-də saxlanır, repoya yazılmır.

## Alətlər

| Alət | Risk | Təsdiq | İcazə | Nə edir |
|---|---|---|---|---|
| `lead.research` | low | yox | `write.leads` | Namizədləri (≤10) süzür, qiymətləndirir, saxlayır. `dry_run:true` saxlamır. |
| `lead.save` | low | yox | `write.leads` | Tək lead (sahibin əl ilə və ya tövsiyə mənbəli lead-i də olur: `manual_owner`, `referral`). |
| `lead.filter` | low | yox | `read.leads` | Dry-run: saxlamadan nəticə və bal. |
| `lead.list` | low | yox | `read.leads` | Siyahı (status, ad parçası). |
| `lead.get` | low | yox | `read.leads` | Tam məlumat (xarici mətn qutuda). |
| `lead.score` | low | yox | `write.leads` | Yenidən qiymətləndirir. |
| `lead.update_status` | low | yox | `write.leads` | Status cədvəli üzrə keçid. `awaiting_approval`, `contacted_manually`, `do_not_contact` bu alətlə qoyulmur. |
| `lead.do_not_contact` | low | yox | `write.leads` | Geri qaytarılmayan blok. Siyahıda olmayan biznes üçün blok qeydi yaradır. |
| `lead.outreach.prepare` | **high** | **bəli** | `send.message`, `write.leads` | Qaralama + təsdiq qeydi. Heç nə göndərmir. |

İcazə adları `src/policy.js` `DEFAULT_PERMISSIONS` siyahısına əlavə olunmalıdır: `read.leads`, `write.leads`.

## Sahib necə istifadə edir

1. Namizədləri açıq mənbə ünvanı ilə `lead.research` ilə (və ya tək-tək `lead.save` ilə) əlavə edir. Nəticədə hər lead üçün bal və amillərin izahı olur.
2. `lead.outreach.prepare` ilə qaralama yaradılır. Təsdiq qeydində tam mətn görünür (və `lead.get` ilə lead-in `draft` sahəsində).
3. Sahib mətni **özü** Instagram/e-poçt/sayt formasından göndərir.
4. Göndərdikdən sonra təsdiq qeydini təsdiq edir: bu, "mən özüm göndərdim" bəyanıdır. Lead `contacted_manually` olur. Göndərmədisə **rədd edin** və ya `lead.update_status` ilə `message_ready`-ə qaytarın: 30 gün saatı da dayanır.
5. Cavab gəlsə `lead.update_status` ilə `replied`, sonra `won`/`lost`. İstəmədiyini bildirənlər üçün dərhal `lead.do_not_contact`.

## İnterfeys-yalnız və yoxlanmayanlar

- **Real lead axtarışı yoxdur; `lead.research`-də `source_id` hələlik heç bir mənbə ilə işləmir** (həmişə «LeadSource qoşulmayıb» → `NOT_FOUND`, saxta nəticə yoxdur). Namizədlər `candidates` ilə verilir.
- **Real lead axtarışı yoxdur.** `LeadSource` yalnız interfeysdir (`src/leads/sources.js`); `NotConfiguredLeadSource` və hazır siyahı üçün `StaticLeadSource` var. Veb/direktoriya axtarışı və ya scraping həyata keçirilməyib. Namizədlər hazır verilir (sahib, ChatGPT-nin araşdırması).
- ICP siyahıları (`src/leads/icp.js`) sahibin məhsulları üçün **başlanğıc fərziyyədir**, ölçülmüş bazar məlumatı deyil. `deps.icp` ilə dəyişdirilir.
- Bal formulu deterministikdir, amma proqnoz gücü yoxlanmayıb.
- Lead anbarı KV-də sənəd + indeks kimidir (ən çox 1000 lead). Çoxlu Worker nüsxəsində atomiklik koordinator kilidindən asılıdır (`deps.coord`); koordinator əlçatmazdırsa yazı icra olunmur.
- Real KV/Durable Object üzərində sınanmayıb: testlər yaddaş anbarı və `MemoryCoordinator` ilə işləyir.
- E-poçt, Instagram və ya digər kanala **göndərmə kodu yoxdur** və olmayacaq.
