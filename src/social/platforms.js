// Dəstəklənən platformalar və doğrulanmış/ehtiyatlı limitlər.
// "verified:true" = rəsmi sənəddən oxunub. "verified:false" = bilinən, amma bu sessiyada təsdiqlənməyib.

export const PLATFORMS = ["instagram", "tiktok", "youtube", "telegram"];

export const PLATFORM_INFO = {
  instagram: {
    label: "Instagram",
    kinds: ["image", "video"], // video = Reel
    maxCaption: 2200,
    maxHashtags: 30,
    needsPublicMediaUrl: true, // Meta mediyanı özü çəkir (verified)
    needsBytes: false,
    privacy: false,
    secrets: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
    review: "Instagram Advanced Access (App Review) və professional hesab tələb olunur",
  },
  tiktok: {
    label: "TikTok",
    kinds: ["video"],
    maxCaption: 2200, // title ≤ 2200 rune (verified)
    maxHashtags: 30,
    needsPublicMediaUrl: false,
    needsBytes: true,
    privacy: true,
    secrets: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    review: "Audit olunmamış TikTok tətbiqi yalnız SELF_ONLY (şəxsi) paylaşa bilir",
  },
  youtube: {
    label: "YouTube",
    kinds: ["video"],
    maxTitle: 100, // verified:false
    maxCaption: 5000, // description, verified:false
    maxHashtags: 15,
    needsPublicMediaUrl: false,
    needsBytes: true,
    privacy: true,
    secrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    review: "Verifikasiya olunmamış API layihəsində yüklənən videolar private qalır",
  },
  telegram: {
    label: "Telegram",
    kinds: ["image", "video", "text"],
    maxCaption: 1024, // media caption (verified:false); mətn mesajı 4096 (verified)
    maxText: 4096,
    maxHashtags: 30,
    needsPublicMediaUrl: false,
    needsBytes: false,
    privacy: false,
    secrets: ["TELEGRAM_BOT_TOKEN"],
    review: "Əlavə audit yoxdur",
  },
};

export function isPlatform(p) {
  return PLATFORMS.includes(p);
}

export const PRIVACY_LEVELS = ["private", "unlisted", "public"];
