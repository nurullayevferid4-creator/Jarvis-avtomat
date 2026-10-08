import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { SKILLS } from "../src/manager.js";
import { MODULE_ROOT } from "../src/config.js";

test("20 skill-in hamısı SKILL.md ilə mövcuddur", () => {
  for (const s of SKILLS) {
    const p = join(MODULE_ROOT, "skills", s, "SKILL.md");
    assert.ok(existsSync(p), s);
    const md = readFileSync(p, "utf8");
    assert.match(md, new RegExp("^---\\nname: " + s + "\\n"), s);
  }
});

test("tiktok-manager bütün skill-ləri orkestr edir", () => {
  const md = readFileSync(join(MODULE_ROOT, "skills", "tiktok-manager", "SKILL.md"), "utf8");
  for (const s of SKILLS) if (s !== "tiktok-manager") assert.ok(md.includes(s), s);
});

test("validate.py keçir", () => {
  const r = spawnSync("python3", [join(MODULE_ROOT, "scripts", "validate.py")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("validate.py uydurma endpoint-i və UNSUPPORTED-i 'dəstəklənir' kimi yazmağı tutur", () => {
  const tmp = mkdtempSync(join(tmpdir(), "tt-val-"));
  cpSync(join(MODULE_ROOT, "skills"), join(tmp, "skills"), { recursive: true });
  cpSync(join(MODULE_ROOT, "src"), join(tmp, "src"), { recursive: true });
  cpSync(join(MODULE_ROOT, "scripts"), join(tmp, "scripts"), { recursive: true });
  const p = join(tmp, "skills", "tiktok-comments", "SKILL.md");
  writeFileSync(p, readFileSync(p, "utf8") + "\nŞərhləri `POST /v2/comment/list/` ilə oxu.\n- `dm.send` real işləyir.\n");
  const r = spawnSync("python3", [join(tmp, "scripts", "validate.py")], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /reyestrdə olmayan endpoint: \/v2\/comment\/list\//);
  assert.match(r.stdout, /'dm\.send' dəstəklənmir/);
});
