// Lead sistemi üçün SƏRT anti-spam limitləri. Bunlar koddadır: konfiqurasiya ilə yuxarı qaldırıla bilməz,
// yalnız aşağı salına bilər (limitMin). Məqsəd: JARVIS kütləvi yazışma və ya spam maşınına çevrilməsin.

export const MAX_RESEARCH_BATCH = 10; // bir araşdırma partiyasında maksimum lead
export const MAX_RESEARCH_SAVED_PER_DAY = 30; // gündə araşdırma ilə saxlanan maksimum yeni lead (kütləvi toplama qarşısı)
export const MAX_DRAFTS_PER_DAY = 5; // gündə maksimum outreach qaralaması
export const OUTREACH_COOLDOWN_DAYS = 30; // bir lead-ə 30 gündə bir dəfə
export const MAX_LEADS_TOTAL = 1000; // indeksin ölçü tavanı
export const MIN_OUTREACH_SCORE = 40; // bu balın altında outreach hazırlanmır

// Gün sərhədi: Bakı vaxtı (UTC+4). Yalnız sayğac üçün; konfiqurasiya ilə dəyişdirilə bilər.
export const DEFAULT_TZ_OFFSET_MIN = 240;

// Konfiqurasiya dəyəri yalnız limiti AZALDA bilər
export function limitMin(configured, hard) {
  const n = Number(configured);
  if (!Number.isFinite(n) || n <= 0) return hard;
  return Math.min(hard, Math.floor(n));
}

// Vaxt damğasının "gün açarı" (YYYY-MM-DD), verilmiş ofsetlə
export function dayKey(ts, offsetMin = DEFAULT_TZ_OFFSET_MIN) {
  return new Date(ts + offsetMin * 60000).toISOString().slice(0, 10);
}
