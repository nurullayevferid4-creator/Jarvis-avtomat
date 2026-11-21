// Paylaşım: paket → yoxlama → DRAFT approval + manual paket. İcra yalnız ApprovalCenter.execute ilə (təsdiq + execute_enabled).
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { validatePackage, toPostInfo, manualPackage } from "./content.js";
import { chunkPlan, TikTokError } from "./client.js";

const TYPES = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function mediaInfo(path) {
  const type = TYPES[extname(path).toLowerCase()];
  if (!type) throw new TikTokError("invalid_request", "Video formatı yalnız mp4 / mov / webm");
  const size = statSync(path).size;
  return { path, size, content_type: type, sha256: sha256(readFileSync(path)) };
}

export async function preparePublish({ pkg, videoPath, client, approvals, workspace, accountId, facts, cfg, mode = "direct" }) {
  let creatorInfo = null, creatorError = null;
  if (client && client.connected()) {
    try { creatorInfo = await client.creatorInfo(); } catch (e) { creatorError = { code: e.code, message: e.message }; }
  }
  const check = validatePackage(pkg, { facts, creatorInfo, appAudited: cfg.appAudited });
  const media = videoPath ? mediaInfo(videoPath) : null;
  const pkgId = "pkg_" + Date.now().toString(36);
  const reasons = [];
  if (!check.ok) reasons.push("paket yoxlamasından keçmədi");
  if (!media) reasons.push("video faylı verilməyib");
  if (!cfg.executeEnabled) reasons.push("execute_enabled=false");
  if (!client || !client.connected()) reasons.push("TikTok hesabı qoşulmayıb");
  const manual = manualPackage(pkg, { reason: reasons.length ? reasons.join("; ") : "təsdiqdən sonra API ilə paylaşılacaq; ehtiyat üçün manual paket" });
  workspace.writeText(accountId, pkgId + ".md", manual);
  workspace.writeJson(accountId, pkgId + ".json", pkg);

  let approval = null;
  if (check.ok && media) {
    const kind = mode === "inbox" ? "video.inbox" : "video.publish";
    const payload = mode === "inbox" ? { package_id: pkgId, media, caption: pkg.caption } : { package_id: pkgId, media, caption: pkg.caption, post_info: toPostInfo(pkg) };
    approval = approvals.draft(kind, payload, { facts });
    if (!approval.violations.length) approval = approvals.submit(approval.id);
  }
  return { package_id: pkgId, manual_package: join("accounts", accountId, pkgId + ".md"), check, creator_info: creatorInfo, creator_error: creatorError, approval, blocked_reasons: reasons };
}

// ApprovalCenter.execute üçün icraçı. Təsdiqlənmiş payload-dakı faylın hash-i dəyişibsə icra etmir.
export function makeExecutor(client, { waitStatus = true } = {}) {
  return async (kind, payload) => {
    if (kind !== "video.publish" && kind !== "video.inbox") throw new TikTokError("UNSUPPORTED_BY_TIKTOK_API", "Bu növ üçün icraçı yoxdur: " + kind);
    const buf = readFileSync(payload.media.path);
    if (sha256(buf) !== payload.media.sha256) throw new TikTokError("media_changed", "Video faylı təsdiqdən sonra dəyişib");
    const plan = chunkPlan(buf.byteLength);
    const source_info = { source: "FILE_UPLOAD", video_size: buf.byteLength, ...plan };
    let init;
    if (kind === "video.publish") {
      const ci = await client.creatorInfo(); // TikTok qaydası: paylaşımdan dərhal əvvəl ən son creator info
      const opts = ci.privacy_level_options || [];
      if (opts.length && !opts.includes(payload.post_info.privacy_level)) throw new TikTokError("invalid_request", "privacy_level artıq icazəli deyil: " + opts.join(", "));
      init = await client.initDirectPost(payload.post_info, source_info);
    } else {
      init = await client.initInboxUpload(source_info);
    }
    if (!init.publish_id || !init.upload_url) throw new TikTokError("api_error", "init cavabı natamamdır");
    await client.uploadVideo(init.upload_url, new Uint8Array(buf), payload.media.content_type, plan);
    const status = waitStatus ? await client.fetchStatus(init.publish_id) : null;
    return { publish_id: init.publish_id, status: status && status.status, post_ids: (status && status.publicaly_available_post_id) || [] };
  };
}

export function saveResult(workspace, accountId, entry) {
  const list = workspace.readJson(accountId, "results.json", []);
  list.push(entry);
  workspace.writeJson(accountId, "results.json", list);
  return list;
}
