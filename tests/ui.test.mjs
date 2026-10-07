// UI: CSP, nonce, təhlükəsiz DOM, skript sintaksisi, sirr yoxdur.
import test from "node:test";
import assert from "node:assert/strict";
import { PAGE, renderPage, pageCsp } from "../src/ui/page.js";
import { worker, baseEnv } from "./helpers.mjs";

test("səhifədəki skript sintaksis baxımından düzgündür (şablon qaçışı pozmur)", () => {
  const m = renderPage("abc").match(/<script nonce="abc">([\s\S]*)<\/script>/);
  assert.ok(m);
  assert.doesNotThrow(() => new Function(m[1]));
});

test("səhifə: innerHTML/eval/inline handler/style atributu yoxdur; xarici mənbə yoxdur", () => {
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(PAGE));
  assert.ok(!/\son(click|load|error)=/i.test(PAGE));
  assert.ok(!/<[a-z][^>]*\sstyle=/i.test(PAGE), "CSP üçün markupda style atributu olmamalıdır");
  assert.ok(!/(src|href)=["']https?:/i.test(PAGE), "xarici skript/stil yoxdur");
});

test("səhifə: tələb olunan panellər var", () => {
  for (const id of ["pass", "login", "mic", "txt", "send", "out", "appr", "media", "mjobs", "jl", "sp", "audit", "status", "errs", "upload"]) assert.ok(PAGE.includes('id="' + id + '"'), id);
});

test("GET /: hər sorğuda yeni nonce, CSP nonce ilə üst-üstə düşür, skript və stil nonce daşıyır", async () => {
  const get = () => worker.fetch(new Request("https://x.dev/"), baseEnv());
  const a = await get(), b = await get();
  const csp = a.headers.get("content-security-policy");
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)[1];
  const html = await a.text();
  assert.ok(html.includes('<script nonce="' + nonce + '">') && html.includes('<style nonce="' + nonce + '">'));
  assert.ok(!html.includes("__NONCE__"));
  assert.notEqual(nonce, /script-src 'nonce-([^']+)'/.exec(b.headers.get("content-security-policy"))[1]);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.ok(/frame-ancestors 'none'/.test(csp) && /connect-src 'self'/.test(csp) && /default-src 'none'/.test(csp));
  assert.equal(a.headers.get("x-frame-options"), "DENY");
  assert.equal(a.headers.get("cache-control"), "no-store");
});

test("səhifədə sirr və ya real dəyər yoxdur", () => {
  assert.ok(!/sk-[A-Za-z0-9]{10,}|shpat_|AKIA[0-9A-Z]{8,}|-----BEGIN/.test(PAGE));
  assert.equal(pageCsp("n").includes("'nonce-n'"), true);
});
