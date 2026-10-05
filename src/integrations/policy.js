// İnteqrasiya siyasəti. Bu mərhələdə YAZMA əməliyyatları (paylaşım, DM, mesaj, yükləmə, qiymət/stok dəyişikliyi) HEÇ VAXT icra olunmur.
// Bu sabit koddan başqa heç nə ilə (env, təsdiq id-si, mock rejimi) açıla bilmir. Açmaq üçün ayrıca mərhələ, kod dəyişikliyi və
// təsdiq mərkəzi ilə bağlama lazımdır (bax APPROVALS.md, src/approval/gate.js "YES" budağı).
export const INTEGRATION_POLICY = Object.freeze({
  writesEnabled: false,
  directMessagesEnabled: false,
  bulkMessagingEnabled: false,
});
