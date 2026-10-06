// Sosial qatın giriş nöqtəsi: adapterləri, token anbarını və media anbarını bir yerdə qurur.

import { createTokenVault } from "./tokens.js";
import { createMediaStore } from "./media.js";
import { PLATFORMS, isPlatform } from "./platforms.js";
import { InstagramAdapter } from "./adapters/Instagram.js";
import { TikTokAdapter } from "./adapters/TikTok.js";
import { YouTubeAdapter } from "./adapters/YouTube.js";
import { TelegramAdapter } from "./adapters/Telegram.js";
import { SocialError } from "./errors.js";

export function createSocialHub(env, store, opts = {}) {
  const vault = createTokenVault(env, store);
  const media = createMediaStore(env, opts.now);
  const ctx = { env, vault, media, fetchImpl: opts.fetchImpl, now: opts.now };
  const adapters = {
    instagram: new InstagramAdapter(ctx),
    tiktok: new TikTokAdapter(ctx),
    youtube: new YouTubeAdapter(ctx),
    telegram: new TelegramAdapter(ctx),
  };
  return {
    ctx,
    vault,
    media,
    adapters,
    adapter(p) {
      if (!isPlatform(p)) throw new SocialError("invalid_request", "naməlum platforma");
      return adapters[p];
    },
    async statusAll({ verify = false } = {}) {
      const out = {};
      for (const p of PLATFORMS) {
        try {
          out[p] = await adapters[p].status({ verify });
        } catch (e) {
          out[p] = { platform: p, state: "API_ERROR", reason: String((e && e.message) || "xəta").slice(0, 160) };
        }
      }
      return out;
    },
  };
}
