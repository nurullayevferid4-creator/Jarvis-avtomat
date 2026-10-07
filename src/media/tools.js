// Media alətləri (Claude və ya UI çağırır). Heç biri dərc etmir. Silmə təsdiq tələb edir.
import { AppError } from "../errors.js";
import { analyzeMp4 } from "./mp4.js";
import { platformFit, editPlan } from "./rules.js";
import { publicJob } from "./jobs.js";

const PLATFORMS = ["instagram", "tiktok", "youtube", "telegram"];
const idProp = { type: "string", pattern: "^[0-9a-f]{24}$", maxLength: 24 };
const pub = (d) => d && ({ id: d.id, kind: d.kind, content_type: d.content_type, size: d.size, filename: d.filename, source: d.source, created_at: d.created_at, analysis: d.analysis });

export const MEDIA_PERMISSIONS = ["read.media", "write.media"];

export function registerMediaTools(registry, { library, jobs, media }) {
  const base = { risk: "low", requiresApproval: false, timeoutMs: 20000 };

  registry.register({
    ...base,
    name: "media.list",
    description: "Yüklənmiş media faylları (şəkil, video, sənəd): id, növ, ölçü, video analizi.",
    inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } },
    outputSchema: { type: "object", required: ["items"], properties: { items: { type: "array" } } },
    permissions: ["read.media"],
    async handler(input) {
      return { items: (await library.list(input.limit || 20)).map(pub) };
    },
  });

  registry.register({
    ...base,
    name: "media.get",
    description: "Bir media faylının metadata və analizi (müddət, ölçü, kodek, en/boy).",
    inputSchema: { type: "object", required: ["media_id"], additionalProperties: false, properties: { media_id: idProp } },
    outputSchema: { type: "object", required: ["media"], properties: { media: { type: "object" } } },
    permissions: ["read.media"],
    async handler(input) {
      const d = await library.get(input.media_id);
      if (!d) throw new AppError("NOT_FOUND", "Belə media tapılmadı");
      return { media: pub(d) };
    },
  });

  registry.register({
    ...base,
    name: "media.analyze",
    description: "Videonu platformaya uyğunluq üçün yoxlayır (bloklayıcılar, xəbərdarlıqlar, lazım olan redaktələr). Heç nə dəyişmir.",
    inputSchema: { type: "object", required: ["media_id", "platform"], additionalProperties: false, properties: { media_id: idProp, platform: { type: "string", enum: PLATFORMS } } },
    outputSchema: { type: "object", required: ["analysis", "fit", "plan"], properties: { analysis: { type: "object" }, fit: { type: "object" }, plan: { type: "object" } } },
    permissions: ["read.media"],
    async handler(input) {
      const d = await library.get(input.media_id);
      if (!d || d.kind !== "video") throw new AppError("NOT_FOUND", "Belə video tapılmadı");
      const analysis = await analyzeMp4(library.reader(d.id, d.size));
      const fit = platformFit(analysis, input.platform, { size: d.size });
      return { analysis, fit: { ok: fit.ok, blockers: fit.blockers, warnings: fit.warnings }, plan: editPlan(fit, analysis) };
    },
  });

  registry.register({
    ...base,
    name: "media.prepare_video",
    description: "Videonu platforma üçün hazırlama İŞİ yaradır (yoxla, analiz et, redaktə planı, emal, nəticəni yenidən yoxla). İş QUEUED olur; nəticə hazır olana qədər 'hazırdır' demə, media.job.get ilə yoxla. Dərc etmir.",
    inputSchema: { type: "object", required: ["media_id", "platform"], additionalProperties: false, properties: { media_id: idProp, platform: { type: "string", enum: PLATFORMS }, goal: { type: "string", maxLength: 300 } } },
    outputSchema: { type: "object", required: ["job"], properties: { job: { type: "object" } } },
    permissions: ["write.media"],
    async handler(input) {
      const job = await jobs.submitVideoJob(input);
      const advanced = (await jobs.advance(job.id, { deadlineMs: 8000 })) || job;
      return { job: publicJob(advanced) };
    },
  });

  registry.register({
    ...base,
    name: "media.job.get",
    description: "Video hazırlama işinin vəziyyəti (QUEUED/RUNNING/SUCCESS/FAILED), mərhələlər, nəticə və ya xəta. Gedişatı irəlilədir.",
    inputSchema: { type: "object", required: ["job_id"], additionalProperties: false, properties: { job_id: { type: "string", pattern: "^\\d{13}-[0-9a-f]{6}$", maxLength: 20 } } },
    outputSchema: { type: "object", required: ["job"], properties: { job: { type: "object" } } },
    permissions: ["read.media"],
    async handler(input) {
      const j = (await jobs.advance(input.job_id, { deadlineMs: 8000 })) || (await jobs.get(input.job_id));
      if (!j) throw new AppError("NOT_FOUND", "İş tapılmadı");
      return { job: publicJob(j) };
    },
  });

  // Silmə: geri qaytarılmazdır → təsdiq məcburidir, xülasə faylın özünü göstərir.
  registry.register({
    name: "media.delete",
    description: "Yüklənmiş media faylını (bayt + metadata) SİLİR. Geri qaytarılmaz, həmişə təsdiq tələb edir.",
    inputSchema: { type: "object", required: ["media_id", "label"], additionalProperties: false, properties: { media_id: idProp, label: { type: "string", maxLength: 200 } } },
    outputSchema: { type: "object", required: ["deleted"], properties: { deleted: { type: "boolean" }, media_id: { type: "string" } } },
    permissions: ["delete.data"],
    risk: "high",
    requiresApproval: true,
    timeoutMs: 15000,
    auditEvent: "media.delete",
    approval: {
      kind: "media.delete",
      // label təsdiq mətnində görünür; icra anında faylın real adı/növü ilə uyğunluğu yoxlanır
      describe: (p) => "Media SİLİNƏCƏK: id " + p.input.media_id + " (" + p.input.label + "). Geri qaytarılmaz.",
      async execute(input) {
        const d = await library.get(input.media_id);
        if (!d) throw new AppError("NOT_FOUND", "Media artıq yoxdur");
        const ok = await library.remove(input.media_id);
        const still = await media.size(input.media_id);
        if (!ok || still) throw new AppError("PROVIDER_ERROR", "Media silinmədi, yoxlayın");
        return { deleted: true, media_id: input.media_id };
      },
    },
    async handler() { throw new Error("yalnız təsdiq axını ilə"); },
  });
}
