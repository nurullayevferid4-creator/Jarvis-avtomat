import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText, checkAction, checkBusinessFacts, checkAd, FORBIDDEN_ACTIONS } from "../src/policy.js";
import { validatePackage } from "../src/content.js";
import { goodPackage } from "./helpers.mjs";

test("Fake engagement ifadələri (az/en/ru/tr) tutulur", () => {
  for (const s of ["Follower satın al", "buy tiktok followers cheap", "saxta şərh yazaq", "follow/unfollow strategiyası", "накрутка подписчиков", "takipçi satın al", "bot ilə like"]) {
    assert.ok(scanText(s).some((v) => v.rule === "fake_engagement"), s);
  }
  assert.equal(scanText("Real auditoriya üçün faydalı resept").length, 0);
});

test("Viral zəmanəti qadağandır", () => {
  for (const s of ["Bu video viral olacaq", "100% viral", "guaranteed viral", "milyon baxış zəmanət"]) assert.ok(scanText(s).some((v) => v.rule === "viral_guarantee"), s);
});

test("Qadağan olunmuş əməliyyat növləri", () => {
  for (const a of FORBIDDEN_ACTIONS) assert.equal(checkAction(a).length, 1);
});

test("Qiymət/çatdırılma faktı business.json-da yoxdursa uydurma sayılır", () => {
  assert.ok(checkBusinessFacts("Cəmi 25 AZN, pulsuz çatdırılma!", {}).length >= 2);
  assert.equal(checkBusinessFacts("Cəmi 25 AZN", { price: "25 AZN" }).length, 0);
});

test("Reklam: proof yalnız real sübutla, saxta review yox", () => {
  const ad = { hook: "Tortun quru alınır?", problem: "Quru biskvit", solution: "Düzgün resept", product: "Master-klass", benefit: "Yumşaq biskvit", cta: "DM yaz" };
  assert.equal(checkAd(ad).length, 0);
  assert.ok(checkAd({ ...ad, proof: "500 xoşbəxt müştəri!" }).some((v) => v.rule === "unverified_proof"));
  assert.equal(checkAd({ ...ad, proof: { text: "Google-da 4.8 reytinq", evidence: { source: "https://example.invalid/review", verified: true } } }).length, 0);
  assert.ok(checkAd({ ...ad, cta: "" }).some((v) => v.rule === "ad_missing_section"));
});

test("Paket: privacy default-suz, interaktivlik və kommersiya açıqlaması açıq seçilməlidir (TikTok qaydası)", () => {
  const p = goodPackage();
  assert.equal(validatePackage(p, {}).ok, true);
  const bad = { ...p, publish: { privacy_level: undefined } };
  const r = validatePackage(bad, {});
  assert.ok(r.errors.some((e) => /privacy_level/.test(e)));
  assert.ok(r.errors.some((e) => /allow_comment/.test(e)));
  assert.ok(r.errors.some((e) => /commercial_content/.test(e)));
  const comm = { ...p, publish: { ...p.publish, commercial_content: true } };
  assert.ok(validatePackage(comm, {}).errors.some((e) => /Kommersiya/.test(e)));
  assert.ok(validatePackage({ ...p, caption: "x".repeat(2300) }, {}).errors.some((e) => /2200/.test(e)));
});
