// İnteqrasiya siyasəti.
//  - writesEnabled=false: YAZMA əməliyyatları (paylaşım, DM, mesaj, yükləmə, qiymət/stok dəyişikliyi) adapter.run() ilə HEÇ VAXT icra olunmur.
//  - approvedWritesEnabled=true: yazma yalnız adapter.runApproved() ilə, etibarlı ApprovalProof (Fərid-in təsdiqi, tək istifadəlik) və
//    rəsmi sənədlə yoxlanmış endpoint ("verified:true") varsa mümkündür. Endpoint yoxlanmayıbsa "not_implemented" olur.
//  - directMessagesEnabled / bulkMessagingEnabled=false: kütləvi/avtomatik mesaj mexanizmi yoxdur və yaradılmır.
// Bu sabitlər koddan başqa heç nə ilə (env, mock rejimi) dəyişdirilə bilmir.
export const INTEGRATION_POLICY = Object.freeze({
  writesEnabled: false,
  approvedWritesEnabled: true,
  directMessagesEnabled: false,
  bulkMessagingEnabled: false,
});
