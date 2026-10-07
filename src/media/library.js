// Media kitabxanası: yükləmə, doğrulama, metadata və silmə siyasəti.
//
// Yükləmə axını: Content-Type siyahısı → ölçü limiti → R2-yə AXINLA yazma (Worker yaddaşına yığılmır) →
// başlıq baytlarına görə real növ yoxlaması → video üçün MP4 analizi. Uyğunsuz fayl DƏRHAL silinir.
// Metadata "mediafile" sənədində, bayt R2-də "m/<id>" açarında saxlanır. Silmə YALNIZ təsdiqlə (media.delete aləti).
// Saxlama siyasəti: yüklənmiş fayl sahib silənə qədər qalır; emaldan yaranan törəmə fayllar (source:"derived") 14 gündən sonra təmizlənir.

import { AppError } from "../errors.js";
import { sniffType } from "./sniff.js";
import { analyzeMp4 } from "./mp4.js";
import { MAX_VIDEO_BYTES, MAX_IMAGE_BYTES, MAX_DOC_BYTES } from "./rules.js";

export const UPLOAD_TYPES = {
  "image/jpeg": { ext: "jpg", kind: "image", max: MAX_IMAGE_BYTES },
  "image/png": { ext: "png", kind: "image", max: MAX_IMAGE_BYTES },
  "video/mp4": { ext: "mp4", kind: "video", max: MAX_VIDEO_BYTES },
  "video/quicktime": { ext: "mov", kind: "video", max: MAX_VIDEO_BYTES },
  "application/pdf": { ext: "pdf", kind: "document", max: MAX_DOC_BYTES },
};
const DERIVED_TTL_MS = 14 * 86400000;

// JPEG/PNG ölçüsü (başlıqdan). Oxuna bilməzsə null.
export function imageSize(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const u32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    return { width: u32(16), height: u32(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const m = b[p + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8] };
      p += 2 + ((b[p + 2] << 8) | b[p + 3]);
    }
  }
  return null;
}

function cleanName(n) {
  return String(n || "").replace(/[^\p{L}\p{N}._ -]/gu, "").replace(/\.{2,}/g, ".").trim().slice(0, 80);
}

export function createMediaLibrary({ media, store, audit = null, now = () => Date.now() }) {
  const log = async (e, d) => { if (audit) await audit.log(e, d); };
  const reader = (id, size) => ({ size, read: (o, l) => media.range(id, o, l) });

  async function inspect(id, size, declared) {
    const head = await media.range(id, 0, Math.min(65536, size));
    const sniffed = sniffType(head);
    if (!sniffed) throw new AppError("VALIDATION_ERROR", "Fayl növü tanınmadı və ya dəstəklənmir");
    const sameFamily = sniffed.kind === declared.kind && (sniffed.content_type === declared.ct || (sniffed.kind === "video" && declared.kind === "video"));
    if (!sameFamily) throw new AppError("VALIDATION_ERROR", "Faylın məzmunu bəyan olunan növə uyğun deyil");
    if (sniffed.kind === "video") return { sniffed, analysis: await analyzeMp4(reader(id, size)) };
    if (sniffed.kind === "image") {
      const dim = imageSize(head);
      if (!dim || !dim.width || !dim.height) throw new AppError("VALIDATION_ERROR", "Şəkil ölçüsü oxuna bilmədi (fayl korlanıb)");
      return { sniffed, analysis: { ...dim, aspect: Math.round((dim.width / dim.height) * 1000) / 1000 } };
    }
    return { sniffed, analysis: null };
  }

  async function ingest({ body, contentType, length, filename, source = "upload", derivedFrom = null }) {
    const ct = String(contentType || "").split(";")[0].trim().toLowerCase();
    const t = UPLOAD_TYPES[ct];
    if (!t) throw new AppError("VALIDATION_ERROR", "Fayl növü dəstəklənmir. İcazəli: JPEG, PNG, MP4, MOV, PDF");
    if (!Number.isInteger(length) || length <= 0) throw new AppError("VALIDATION_ERROR", "Content-Length lazımdır (boş və ya naməlum ölçülü fayl qəbul edilmir)");
    if (length > t.max) throw new AppError("VALIDATION_ERROR", "Fayl çox böyükdür (" + t.kind + " üçün maksimum " + Math.round(t.max / 1048576) + " MB)");
    let stored;
    try {
      stored = await media.putStream(body, { contentType: ct, kind: t.kind, ext: t.ext, length, meta: { source } });
    } catch (e) {
      throw e instanceof AppError ? e : new AppError("PROVIDER_ERROR", "Media anbarına yazıla bilmədi", { source: "r2", detail: String(e && e.message), retryable: true });
    }
    // Real saxlanan ölçü yoxlanılır (başlıq yalan danışa bilər)
    const real = await media.size(stored.id);
    if (real !== length) {
      await media.remove(stored.id);
      throw new AppError("VALIDATION_ERROR", "Yüklənən faylın ölçüsü bəyan olunanla uyğun gəlmir");
    }
    let info;
    try {
      info = await inspect(stored.id, real, { ct, kind: t.kind });
    } catch (e) {
      await media.remove(stored.id);
      await log("media.rejected", { reason: e.code, kind: t.kind });
      throw e;
    }
    const doc = { id: stored.id, kind: t.kind, content_type: info.sniffed.content_type, ext: info.sniffed.content_type === "video/quicktime" ? "mov" : t.ext, size: real, filename: cleanName(filename), source, derived_from: derivedFrom, created_at: now(), analysis: info.analysis };
    await store.putRaw("mediameta:" + stored.id, doc);
    await idxAdd(stored.id);
    await log("media.uploaded", { id: doc.id, kind: doc.kind, size: doc.size, source });
    return doc;
  }

  async function idx() {
    const v = await store.getRaw("mediaidx");
    return v && Array.isArray(v.ids) ? v.ids.filter((x) => /^[0-9a-f]{24}$/.test(x)) : [];
  }
  async function idxAdd(id) {
    const ids = await idx();
    if (!ids.includes(id)) await store.putRaw("mediaidx", { ids: [...ids, id].slice(-200) });
  }

  async function get(id) {
    if (!/^[0-9a-f]{24}$/.test(String(id))) return null;
    return await store.getRaw("mediameta:" + id);
  }

  async function list(limit = 30) {
    const out = [];
    for (const id of (await idx()).slice(-limit).reverse()) {
      const d = await get(id);
      if (d) out.push(d);
    }
    return out;
  }

  // Silmə: yalnız təsdiq edilmiş alətdən çağırılır. Bayt və metadata silinir, indeksdən çıxarılır.
  async function remove(id) {
    const d = await get(id);
    if (!d) return false;
    await media.remove(id);
    await store.deleteRaw("mediameta:" + id);
    const ids = await idx();
    await store.putRaw("mediaidx", { ids: ids.filter((x) => x !== id) });
    await log("media.deleted", { id, kind: d.kind });
    return true;
  }

  // Törəmə (emaldan çıxan) faylların saxlanma müddəti keçibsə silinir. Sahibin yüklədiklərinə TOXUNULMUR.
  async function cleanupDerived() {
    let n = 0;
    for (const id of await idx()) {
      const d = await get(id);
      if (d && d.source === "derived" && now() - d.created_at > DERIVED_TTL_MS) {
        await remove(id);
        n++;
      }
    }
    return n;
  }

  return { ingest, inspect, get, list, remove, cleanupDerived, reader, UPLOAD_TYPES };
}
