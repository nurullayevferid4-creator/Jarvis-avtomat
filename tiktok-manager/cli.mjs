#!/usr/bin/env node
// TikTok AI Manager CLI. Skill-lər bu əmrlərlə real data alır və approval qapısından keçir.
// Çıxış həmişə JSON-dur; sirlər heç vaxt çap olunmur.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { loadConfig, configStatus, redact } from "./src/config.js";
import { TikTokClient } from "./src/client.js";
import { listCapabilities, capabilitiesMarkdown } from "./src/capabilities.js";
import { Workspace } from "./src/workspace.js";
import { analyzeAccount } from "./src/account.js";
import { ApprovalCenter } from "./src/approval.js";
import { triage } from "./src/leads.js";
import { rankIdeas, validatePackage } from "./src/content.js";
import { preparePublish, makeExecutor, saveResult } from "./src/publisher.js";
import { plan } from "./src/manager.js";
import { compareToBaseline } from "./src/analytics.js";

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) { const k = rest[i].slice(2); flags[k] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true; }
  else pos.push(rest[i]);
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

async function makeClient(cfg) {
  if (!cfg.mock) return new TikTokClient(cfg);
  const { createMockTikTok } = await import("./mock/transport.mjs");
  const mock = createMockTikTok({ audited: cfg.appAudited });
  return new TikTokClient(cfg, { fetch: mock.fetch });
}

async function main() {
  const cfg = loadConfig();
  if (cfg.mock && !process.env.TIKTOK_ACCESS_TOKEN) process.env.TIKTOK_ACCESS_TOKEN = "mock_access_cli_abcdefgh";
  const cfg2 = cfg.mock ? loadConfig() : cfg;
  const ws = new Workspace(cfg2.workspace);
  const client = await makeClient(cfg2);
  const account = () => flags.account || ws.activeAccount() || (() => { throw new Error("Aktiv hesab yoxdur: əvvəlcə `analyze` işlət"); })();
  const facts = () => ws.readJson(account(), "business.json", {});
  const approvals = () => new ApprovalCenter(ws, account(), cfg2);

  switch (cmd) {
    case "capabilities": return flags.md ? capabilitiesMarkdown() : listCapabilities();
    case "config": return { mock: cfg2.mock, execute_enabled: cfg2.executeEnabled, app_audited: cfg2.appAudited, scopes: cfg2.scopes, connected: client.connected(), env: configStatus() };
    case "auth-url": return { url: client.authUrl(flags.state || randomBytes(16).toString("hex")), note: "state-i saxla və callback-də yoxla" };
    case "exchange": return await client.exchangeCode(flags.code);
    case "analyze": return await analyzeAccount({ client, workspace: ws, maxVideos: Number(flags.max || 100) });
    case "plan": {
      const id = ws.activeAccount();
      const prof = id ? ws.readJson(id, "account.json", null) : null;
      return plan(pos.join(" ") || flags.command || "", { connected: client.connected(), executeEnabled: cfg2.executeEnabled, missingFacts: prof ? prof.missing_business_facts : [], salesGoal: !!(prof && prof.business && prof.business.goal && prof.business.goal !== "NAMƏLUM") });
    }
    case "leads": {
      const r = triage(flags.file ? readJson(flags.file) : [flags.text], facts());
      const prev = ws.readJson(account(), "leads.json", []);
      ws.writeJson(account(), "leads.json", [...prev, ...r.leads.map((l) => ({ ...l, at: new Date().toISOString() }))]);
      return r;
    }
    case "score-ideas": return rankIdeas(readJson(flags.file), ws.readJson(account(), "account.json", {}).performance);
    case "validate-package": return validatePackage(readJson(flags.file), { facts: facts(), appAudited: cfg2.appAudited });
    case "prepare": return await preparePublish({ pkg: readJson(flags.package), videoPath: flags.video, client, approvals: approvals(), workspace: ws, accountId: account(), facts: facts(), cfg: cfg2, mode: flags.mode || "direct" });
    case "approvals": return approvals().all().filter((a) => !flags.status || a.status === flags.status).map(({ payload, ...a }) => ({ ...a, caption: payload && payload.caption }));
    case "approve": return approvals().approve(pos[0], { by: flags.by });
    case "reject": return approvals().reject(pos[0], { by: flags.by, reason: flags.reason });
    case "execute": {
      const r = await approvals().execute(pos[0], makeExecutor(client));
      if (r.status === "EXECUTED") saveResult(ws, account(), { at: new Date().toISOString(), approval_id: r.id, ...r.result });
      return r;
    }
    case "track": {
      const prof = ws.readJson(account(), "account.json", {});
      const vids = await client.queryVideos(pos);
      return vids.map((v) => compareToBaseline(v, prof.performance));
    }
    case "status": return client.fetchStatus(pos[0]);
    default:
      return { usage: "node tiktok-manager/cli.mjs <capabilities [--md] | config | auth-url | exchange --code C | analyze | plan \"əmr\" | leads --file f.json | score-ideas --file f.json | validate-package --file p.json | prepare --package p.json [--video v.mp4] [--mode inbox] | approvals [--status S] | approve ID --by AD | reject ID | execute ID | track VIDEO_ID... | status PUBLISH_ID>" };
  }
}

main().then((out) => {
  process.stdout.write((typeof out === "string" ? out : JSON.stringify(out, null, 2)) + "\n");
}).catch((e) => {
  const secrets = [process.env.TIKTOK_CLIENT_SECRET, process.env.TIKTOK_ACCESS_TOKEN, process.env.TIKTOK_REFRESH_TOKEN].filter(Boolean);
  process.stderr.write(JSON.stringify({ error: e.code || "error", message: redact(e.message, secrets) }) + "\n");
  process.exit(1);
});
