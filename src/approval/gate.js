// Təsdiq qapısı.
// Paylaşım, qiymət/stok dəyişikliyi, pul xərcləmək, mesaj göndərmək, silmək kimi
// real xarici əməliyyatlar yalnız Fərid "hə" dedikdən sonra mümkün ola bilər.
//
// DİQQƏT: Bu versiyada heç bir real xarici əməliyyat inteqrasiyası YOXDUR.
// "Hə" cavabından sonra da heç nə icra olunmur, yalnız qaralama qaytarılır.
// Gələcəkdə real icra əlavə olunsa, YALNIZ burada, "YES" budağında və təsdiq alındıqdan sonra olmalıdır.

export const YES = new Set(["hə", "he", "həə", "hə tamam", "tamam", "olar", "bəli", "yaxşı", "davam et", "hə davam et", "ok", "okay", "yes"]);
export const NO = new Set(["yox", "xeyr", "ləğv et", "lazım deyil", "dayan", "yox lazım deyil"]);

// Qaytarır: { handled:false } (normal axın davam edir) və ya { handled:true, save, response }.
// Gözləyən iş varkən əlaqəsiz mesaj gəlsə, gözləyən iş təmizlənir və normal axın davam edir.
export function resolvePending(state, norm) {
  if (!state.pending) return { handled: false };

  if (YES.has(norm)) {
    const p = state.pending;
    state.pending = null;
    const spoken = "Təsdiqi aldım, amma «" + p.external + "» üçün inteqrasiya bu versiyada qoşulmayıb. Qaralama hazırdır, özün icra etməlisən.";
    return { handled: true, save: true, decision: "approved", response: { status: "blocked", spoken, screen: spoken + "\n\n" + (p.draft || ""), tasks: [] } };
  }

  if (NO.has(norm)) {
    state.pending = null;
    return { handled: true, save: true, decision: "rejected", response: { status: "chat", spoken: "Yaxşı, ləğv etdim.", screen: "Gözləyən iş ləğv edildi.", tasks: [] } };
  }

  if (norm.includes("harada dayandıq")) {
    const spoken = "Gözləyən iş: " + state.pending.external + ". İcra edim? Hə və ya yox de.";
    return { handled: true, save: false, response: { status: "pending_approval", spoken, screen: spoken, tasks: [] } };
  }

  state.pending = null;
  return { handled: false };
}
