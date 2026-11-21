// Test köməkçiləri: hər test öz müvəqqəti workspace-i və mock transport-u ilə işləyir. Real şəbəkə yoxdur.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { TikTokClient } from "../src/client.js";
import { Workspace } from "../src/workspace.js";
import { createMockTikTok } from "../mock/transport.mjs";

export function setup({ env = {}, mock = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tt-test-"));
  const cfg = loadConfig({ TIKTOK_WORKSPACE_DIR: join(dir, "ws"), TIKTOK_TOKEN_FILE: join(dir, "secrets", "token.json"), TIKTOK_ACCESS_TOKEN: "mock_access_test_abcdefgh", TIKTOK_CLIENT_KEY: "mock_client_key", TIKTOK_CLIENT_SECRET: "mock_client_secret_value", TIKTOK_REDIRECT_URI: "https://example.invalid/cb", ...env });
  const m = createMockTikTok(mock);
  const client = new TikTokClient(cfg, { fetch: m.fetch });
  const ws = new Workspace(cfg.workspace);
  return { dir, cfg, mock: m, client, ws };
}

export function fakeVideo(dir, bytes = 2048) {
  const p = join(dir, "clip.mp4");
  writeFileSync(p, Buffer.alloc(bytes, 7));
  return p;
}

export const goodPackage = (privacy = "SELF_ONLY") => ({
  hook: "3 səhv ki, biskvitini quru edir",
  script: [{ label: "Hook", text: "3 səhv ki, biskvitini quru edir" }, { label: "Body", text: "Birinci səhv: sobanı əvvəlcədən qızdırmamaq." }, { label: "CTA", text: "Hansı səhvi edirdin? Şərhdə yaz." }],
  scenes: [
    { start: 0, end: 2.5, visual: "Quru biskvitin yaxın planı", on_screen_text: "3 SƏHV", voiceover: "3 səhv ki, biskvitini quru edir" },
    { start: 2.5, end: 20, visual: "Soba, xəmir", on_screen_text: "1. Soba", voiceover: "Birinci səhv..." },
    { start: 20, end: 24, visual: "Kamera üzə", on_screen_text: "Şərhdə yaz", voiceover: "Hansı səhvi edirdin?" },
  ],
  voiceover: "3 səhv ki, biskvitini quru edir. Birinci səhv... Hansı səhvi edirdin?",
  caption: "Biskvit niyə quru alınır? 3 səhv 👇",
  hashtags: ["#tort", "#resept", "#biskvit"],
  cta: "Hansı səhvi edirdin? Şərhdə yaz.",
  publish: { privacy_level: privacy, allow_comment: true, allow_duet: false, allow_stitch: false, commercial_content: false, is_aigc: false },
});
