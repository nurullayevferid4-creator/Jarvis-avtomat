// YouTube Data API v3. Rəsmi sənədə görə:
//  - resumable yükləmə: POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//    (X-Upload-Content-Length/Type) → Location sessiya ünvanı; sonra PUT ilə fayl, 200/201 + video resursu
//  - scope: youtube.upload; kanal məlumatı: channels.list?mine=true (youtube.readonly — ümumi bilik)
//  - Verifikasiya olunmamış API layihəsi (28.07.2020-dən sonra) videoları private edir
//  - kvota: videos.insert 1 vahid ("Video Uploads" qutusu 100/gün), thumbnails.set 50 vahid
// Başlıq (100) və təsvir (5000 bayt) limitləri bu sessiyada sənəddən yoxlanmayıb; ehtiyatla tətbiq olunur.

import { BaseAdapter } from "./Base.js";
import { SocialError } from "../errors.js";
import { socialFetch, formBody, redactText } from "../http.js";
import { normalizeHashtags } from "../request.js";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const MAX_THUMB = 2 * 1024 * 1024;

export function classifyYouTubeError(status, json) {
  const e = (json && json.error) || {};
  const reason = String((Array.isArray(e.errors) && e.errors[0] && e.errors[0].reason) || e.status || "");
  const msg = redactText(typeof e === "string" ? e : e.message || "YouTube API xətası");
  const extra = { platform: "youtube", httpStatus: status, platformCode: reason || null, retriable: false };
  if (status === 401 || reason === "authError" || reason === "UNAUTHENTICATED") return new SocialError("token_expired", "YouTube tokeni etibarsızdır və ya vaxtı bitib", extra);
  if (["quotaExceeded", "rateLimitExceeded", "dailyLimitExceeded", "uploadLimitExceeded", "userRateLimitExceeded"].includes(reason) || status === 429) return new SocialError("rate_limited", "YouTube limiti/kvotası bitib: " + msg, { ...extra, retriable: false });
  if (status === 403) return new SocialError("permission_denied", "YouTube icazəsi çatmır: " + msg, extra);
  if (status === 400) return new SocialError("invalid_request", "YouTube sorğunu qəbul etmədi: " + msg, extra);
  if (status >= 500) return new SocialError("api_error", "YouTube müvəqqəti xətası: " + msg, { ...extra, retriable: true });
  return new SocialError("api_error", "YouTube xətası: " + msg, extra);
}

// Sessiya ünvanı yalnız https://*.googleapis.com ola bilər (nöqtə sərhədi ilə: evilgoogleapis.com keçmir)
export function isGoogleUploadUrl(v) {
  try {
    const u = new URL(String(v || ""));
    return u.protocol === "https:" && !u.username && !u.password && (u.hostname === "googleapis.com" || u.hostname.endsWith(".googleapis.com"));
  } catch (e) {
    return false;
  }
}

function firstLine(s, max) {
  return String(s || "").split(/\r?\n/)[0].trim().slice(0, max);
}

export class YouTubeAdapter extends BaseAdapter {
  constructor(ctx) {
    super("youtube", ctx);
    this.safeToRestartStart = false; // yükləmə tamamlanarsa video dərhal yaranır
  }

  authUrl(state, redirectUri) {
    this.requireConfigured();
    const p = new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
    return AUTHORIZE + "?" + p.toString();
  }

  async tokenRequest(params) {
    const r = await socialFetch(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody({ client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET, ...params }),
    }, this.fopts(20000));
    const j = r.json || {};
    if (!r.ok || j.error || !j.access_token) {
      const code = String(j.error || "");
      const extra = { platform: "youtube", httpStatus: r.status, platformCode: code || null };
      if (code === "invalid_grant") throw new SocialError("token_expired", "Google icazəsi ləğv edilib və ya vaxtı bitib, yenidən qoşun", extra);
      throw new SocialError("api_error", "Google token xətası: " + redactText(j.error_description || code || "naməlum", 100), extra);
    }
    return j;
  }

  async exchangeCode(code, redirectUri) {
    this.requireConfigured();
    const clean = String(code || "").trim();
    if (!clean) throw new SocialError("invalid_request", "OAuth kodu boşdur", { platform: "youtube" });
    const j = await this.tokenRequest({ code: clean, grant_type: "authorization_code", redirect_uri: redirectUri });
    const prev = (await this.record()) || {};
    const rec = {
      access_token: j.access_token,
      refresh_token: j.refresh_token || prev.refresh_token || "",
      expires_at: this.now() + Number(j.expires_in || 3600) * 1000,
      scope: j.scope || SCOPES.join(" "),
      obtained_at: this.now(),
    };
    if (!rec.refresh_token) throw new SocialError("api_error", "Google refresh token vermədi (prompt=consent ilə yenidən qoşun)", { platform: "youtube" });
    const acc = await this.fetchChannel(rec).catch(() => null);
    if (acc) rec.account = acc;
    await this.ctx.vault.put("youtube", rec);
    return { account: rec.account || null, expires_at: rec.expires_at };
  }

  async refresh(rec) {
    if (!rec || !rec.refresh_token) throw new SocialError("token_expired", "YouTube tokeninin vaxtı bitib, yenidən qoşun", { platform: "youtube" });
    const j = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: rec.refresh_token });
    const next = { ...rec, access_token: j.access_token, expires_at: this.now() + Number(j.expires_in || 3600) * 1000, obtained_at: this.now() };
    await this.ctx.vault.put("youtube", next);
    return next;
  }

  async fetchChannel(rec) {
    const r = await socialFetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", { method: "GET", headers: { authorization: "Bearer " + rec.access_token } }, this.fopts(20000));
    if (!r.ok) throw classifyYouTubeError(r.status, r.json);
    const it = r.json && Array.isArray(r.json.items) ? r.json.items[0] : null;
    if (!it) throw new SocialError("not_connected", "Bu Google hesabında YouTube kanalı tapılmadı", { platform: "youtube" });
    return { channel_id: it.id, title: (it.snippet && it.snippet.title) || null, subscribers: it.statistics && it.statistics.subscriberCount !== undefined ? String(it.statistics.subscriberCount) : null };
  }

  async verifyAccount() {
    const rec = await this.validRecord();
    const acc = await this.fetchChannel(rec);
    await this.ctx.vault.put("youtube", { ...rec, account: acc });
    return acc;
  }

  buildResource(req) {
    const tags = normalizeHashtags(req.hashtags);
    const title = firstLine(req.title || req.caption, 100) || "JARVIS";
    const tagLine = tags.map((x) => "#" + x).join(" ");
    let description = req.description || req.caption || "";
    if (tagLine && !description.includes(tagLine)) description = (description + "\n\n" + tagLine).trim();
    let total = 0;
    const kept = [];
    for (const x of tags) {
      if (total + x.length + 1 > 450) break;
      total += x.length + 1;
      kept.push(x);
    }
    return {
      snippet: { title, description: description.slice(0, 4900), tags: kept, categoryId: "22" },
      status: { privacyStatus: req.privacy, selfDeclaredMadeForKids: req.made_for_kids === true },
    };
  }

  async start(req, t) {
    const rec = await this.validRecord();
    if (!req.media || !req.media.id) throw new SocialError("media_error", "YouTube üçün JARVIS_MEDIA-ya yüklənmiş video (media_id) lazımdır", { platform: "youtube" });
    const head = await this.ctx.media.head(req.media.id);
    if (!head || head.kind !== "video") throw new SocialError("media_error", "YouTube üçün video tapılmadı", { platform: "youtube" });
    const bytes = await this.ctx.media.bytes(req.media.id);
    const size = bytes.byteLength;

    const init = await socialFetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { authorization: "Bearer " + rec.access_token, "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(size), "x-upload-content-type": head.content_type },
      body: JSON.stringify(this.buildResource(req)),
    }, this.fopts(20000));
    if (!init.ok) throw classifyYouTubeError(init.status, init.json);
    const loc = init.headers && init.headers.get ? init.headers.get("location") : "";
    if (!isGoogleUploadUrl(loc)) throw new SocialError("api_error", "YouTube yükləmə sessiyası açılmadı", { platform: "youtube" });
    t.data.session = "opened";

    const up = await socialFetch(loc, { method: "PUT", headers: { "content-type": head.content_type, "content-range": "bytes 0-" + (size - 1) + "/" + size }, body: bytes }, this.fopts(240000));
    if (!up.ok || !up.json || !up.json.id) {
      // Video yaranmış ola bilər: "unknown" olsun (retriable) ki, avtomatik təkrar və səhv "failed" olmasın
      if (up.status === 308) throw new SocialError("api_error", "YouTube yükləməsi yarımçıq qaldı", { platform: "youtube", httpStatus: 308, retriable: true });
      throw up.ok ? new SocialError("api_error", "YouTube video id-si gəlmədi", { platform: "youtube", retriable: true }) : classifyYouTubeError(up.status, up.json);
    }
    t.post_id = String(up.json.id);
    t.post_url = "https://www.youtube.com/watch?v=" + t.post_id;
    const got = up.json.status && up.json.status.privacyStatus;
    if (got && got !== req.privacy) t.note = "İstənilən: " + req.privacy + ", YouTube verdi: " + got + " (API layihəsi verifikasiya olunmayıb ola bilər)";

    if (req.thumbnail_media_id) {
      try {
        await this.setThumbnail(rec, t.post_id, req.thumbnail_media_id);
      } catch (e) {
        t.note = ((t.note ? t.note + "; " : "") + "thumbnail qoyulmadı: " + String(e.message || "xəta").slice(0, 80)).slice(0, 240);
      }
    }
    // Yükləmə bitdi, amma "paylaşıldı" demirik: YouTube emalı (processed) yoxlanır
    return "waiting";
  }

  async setThumbnail(rec, videoId, mediaId) {
    const head = await this.ctx.media.head(mediaId);
    if (!head || head.kind !== "image") throw new SocialError("media_error", "thumbnail şəkli tapılmadı", { platform: "youtube" });
    if (head.size > MAX_THUMB) throw new SocialError("media_error", "thumbnail 2 MB-dan böyükdür", { platform: "youtube" });
    const bytes = await this.ctx.media.bytes(mediaId);
    const r = await socialFetch("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=" + encodeURIComponent(videoId), {
      method: "POST",
      headers: { authorization: "Bearer " + rec.access_token, "content-type": head.content_type },
      body: bytes,
    }, this.fopts(30000));
    if (!r.ok) throw classifyYouTubeError(r.status, r.json);
  }

  // Yükləmə statusu: videos.list?part=status,processingDetails (youtube.readonly icazəsi kifayətdir)
  async check(req, t) {
    const rec = await this.validRecord();
    const r = await socialFetch("https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=" + encodeURIComponent(t.post_id), { method: "GET", headers: { authorization: "Bearer " + rec.access_token } }, this.fopts(20000));
    if (!r.ok) throw classifyYouTubeError(r.status, r.json);
    const it = r.json && Array.isArray(r.json.items) ? r.json.items[0] : null;
    if (!it) throw new SocialError("api_error", "YouTube videonu tapmadı (hələ görünmür və ya silinib)", { platform: "youtube", retriable: true });
    const up = String((it.status && it.status.uploadStatus) || "");
    t.data.upload_status = up;
    if (it.status && it.status.privacyStatus) t.data.privacy_status = it.status.privacyStatus;
    if (up === "processed") return "done";
    if (up === "failed" || up === "rejected" || up === "deleted") {
      const why = (it.status && (it.status.failureReason || it.status.rejectionReason)) || up;
      throw new SocialError("api_error", "YouTube videonu qəbul etmədi: " + String(why).slice(0, 80), { platform: "youtube", platformCode: up, retriable: false });
    }
    return "waiting";
  }
  async commit() { return "done"; }
}
