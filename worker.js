// JARVIS Voice Hub: Cloudflare giriş faylı.
// Bütün məntiq src/ qovluğundadır (orkestrator, adapterlər, limitlər, təsdiq qapısı).
// wrangler.toml-dakı main = "worker.js" dəyişməyib, ona görə mövcud deploy pozulmur.
export { default } from "./src/index.js";
