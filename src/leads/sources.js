// LeadSource: araşdırma mənbəyi İNTERFEYSİ. Hazırda real axtarış/scraping həyata keçirilməyib.
//
// Müqavilə:
//   - allowedSourceTypes: bu mənbənin qaytara biləcəyi source_type-lar (yalnız açıq növlər: public_web, public_directory, social_public_profile)
//   - search({ query, limit, product }) -> namizəd massivi. Hər namizəd AÇIQ source.url ilə gəlməlidir.
//   - Şəxsi məlumat, alınmış siyahı və kütləvi e-poçt toplama QADAĞANDIR; pipeline bunları filtrdə rədd edir.
//   - Mənbədən gələn mətn etibarsız məlumatdır (əmr deyil).
//
// Burada yalnız interfeys, "qoşulmayıb" tətbiqi və testlər/sahib tərəfindən verilən hazır siyahı üçün StaticLeadSource var.

import { AppError } from "../errors.js";
import { RESEARCH_SOURCE_TYPES } from "./model.js";

export class LeadSource {
  constructor({ id, allowedSourceTypes = RESEARCH_SOURCE_TYPES } = {}) {
    if (!id || !/^[a-z][a-z0-9_.-]{1,40}$/.test(id)) throw new Error("LeadSource id düzgün deyil");
    this.id = id;
    this.allowedSourceTypes = allowedSourceTypes.filter((t) => RESEARCH_SOURCE_TYPES.includes(t));
    if (!this.allowedSourceTypes.length) throw new Error("LeadSource ən azı bir açıq mənbə növü göstərməlidir");
  }

  // eslint-disable-next-line no-unused-vars
  async search(params) {
    throw new AppError("VALIDATION_ERROR", "LeadSource.search həyata keçirilməyib");
  }
}

// Qoşulmamış mənbə: sistemdə real veb axtarışı olmadığını açıq göstərir
export class NotConfiguredLeadSource extends LeadSource {
  constructor(id = "not_configured") {
    super({ id });
  }
  async search() {
    throw new AppError("VALIDATION_ERROR", "Lead araşdırma mənbəyi hələ qoşulmayıb. Namizədləri açıq mənbə ünvanı ilə birbaşa verin.");
  }
}

// Hazır namizəd siyahısı (məs. sahibin və ya digər agentin tapdıqları). Heç nə axtarmır, yalnız qaytarır.
export class StaticLeadSource extends LeadSource {
  constructor({ id = "static", items = [], allowedSourceTypes } = {}) {
    super({ id, allowedSourceTypes });
    this.items = items;
  }
  async search({ limit = 10 } = {}) {
    return this.items.slice(0, Math.max(0, limit | 0));
  }
}
