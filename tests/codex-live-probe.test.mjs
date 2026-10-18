// Canlı yoxlama qaralaması (.github/workflow-drafts/codex-probe.yml) aktiv deyil və təhlükəsizdir: statik yoxlamalar.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const DRAFT = ".github/workflow-drafts/codex-probe.yml";
const text = () => readFileSync(DRAFT, "utf8");
const code = () => text().replace(/^\s*#.*$/gm, "");
const job = (name) => {
  const y = code();
  const start = y.search(new RegExp("^  " + name + ":\\s*$", "m"));
  assert.ok(start >= 0, name);
  const rest = y.slice(start + 1);
  const next = rest.search(/^  [a-z_]+:\s*$/m);
  return y.slice(start, next < 0 ? undefined : start + 1 + next);
};

test("probe qaralaması aktiv deyil: workflows qovluğunda yoxdur, main-ə getməməli olduğu yazılıb", () => {
  assert.ok(existsSync(DRAFT));
  assert.equal(existsSync(".github/workflows/codex-probe.yml"), false);
  assert.match(text(), /DRAFT: AKTİV DEYİL/);
  assert.match(text(), /main-ə getməməlidir/);
});

test("probe: yalnız pull_request(synchronize) və pull_request_review(submitted); təhlükəli trigger yoxdur", () => {
  const y = code();
  const on = y.slice(y.indexOf("\non:"), y.indexOf("\npermissions:"));
  assert.deepEqual([...on.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]).sort(), ["pull_request", "pull_request_review"]);
  assert.match(on, /types: \[synchronize\]/);
  assert.match(on, /types: \[submitted\]/);
  assert.ok(!/pull_request_target|workflow_run|issue_comment|workflow_dispatch|schedule/.test(y));
});

test("probe: secret yoxdur, default icazə boşdur, yalnız post job issues:write alır, contents icazəsi yoxdur", () => {
  const y = code();
  assert.ok(!/secrets\./.test(y), "secret istifadə olunmur");
  assert.match(y, /^permissions: \{\}/m);
  assert.ok(!/contents:|pull-requests:|id-token:|actions:/.test(y), "başqa icazə yoxdur");
  assert.match(job("post"), /permissions:\s*\n\s+issues: write/);
  assert.match(job("observe"), /permissions: \{\}/);
  assert.ok(!/GH_TOKEN|github\.token|gh api/.test(job("observe")), "observe token istifadə etmir və heç nə yazmır");
});

test("probe: yalnız draft, yalnız eyni repo, yalnız claude/codex-probe* budağı; bir şərh, idempotent, timeout var", () => {
  const post = job("post");
  assert.match(post, /github\.event\.pull_request\.draft == true/);
  assert.match(post, /startsWith\(github\.event\.pull_request\.head\.ref, 'claude\/codex-probe'\)/);
  assert.match(post, /head\.repo\.full_name == github\.repository/);
  assert.match(post, /timeout-minutes: 3/);
  assert.equal((code().match(/body="@codex review"/g) || []).length, 1, "bir yerdə @codex review");
  assert.ok(!/@codex(?! review")/.test(code()), "başqa @codex yoxdur");
  assert.match(post, /artıq göndərilib, təkrar yoxdur/);
  assert.match(post, /\.body=="@codex review"/);
  assert.ok(!/(merge|close|--force|retry|while |until |for )/.test(post.replace(/for_each/g, "")), "təkrar/merge/bağlama yoxdur");
  assert.match(code(), /group: codex-probe-/);
});

test("plan sənədi mövcuddur və əsas bölmələri ehtiva edir", () => {
  const d = readFileSync("docs/CODEX-LIVE-PROBE.md", "utf8");
  for (const h of ["Tək sual", "Niyə `.github/workflows/` qaçılmazdır", "Test PR-ının dəqiq scope-u", "Gözlənilən siqnallar", "Nəticələr və qərar ağacı", "Təhlükəsiz dayanma", "Risklər", "Səndən tələb olunanlar"]) assert.ok(d.includes(h), h);
  assert.match(d, /PAT\/App token tələb olunurmuş kimi fərz \*\*edilmir\*\*/);
});
