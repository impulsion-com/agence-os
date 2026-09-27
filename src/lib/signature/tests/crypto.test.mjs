// Tests des primitives de la signature électronique.
// node --experimental-strip-types --test src/lib/signature/tests/crypto.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OTP_MAX_ATTEMPTS, canonicalJson, checkOtp, documentHash, ipHash, newOtpCode, otpHash, safeEqualHex, truncateIp,
} from "../crypto.ts";

test("JSON canonique : clés triées, indépendant de l'ordre d'insertion", () => {
  const a = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: "é" } };
  const b = { a: { c: "é", d: [3, { y: 2, z: 1 }] }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"a":{"c":"é","d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(documentHash(a), documentHash(b));
  assert.match(documentHash(a), /^[0-9a-f]{64}$/);
});

test("L'empreinte change si le contenu change", () => {
  const doc = { items: [{ unit_price: 1500, selected: true }], total: 1800 };
  const h = documentHash(doc);
  assert.notEqual(h, documentHash({ ...doc, total: 1800.01 }));
  assert.notEqual(h, documentHash({ ...doc, items: [{ unit_price: 1500, selected: false }] }));
});

test("L'empreinte survit à un aller-retour JSON (stockage jsonb)", () => {
  const doc = { t: 1234.56, n: 0, s: "Prix : 1 500,00 €", nested: { x: null, arr: [] } };
  assert.equal(documentHash(JSON.parse(JSON.stringify(doc))), documentHash(doc));
});

test("Code à 6 chiffres", () => {
  for (let i = 0; i < 50; i++) assert.match(newOtpCode(), /^\d{6}$/);
});

test("Vérification du code : bon code, mauvais code, expiration, blocage", () => {
  const secret = "s3cret";
  const code = "042917";
  const hash = otpHash(secret, "p1", "Client@Exemple.fr ", code);
  assert.equal(hash, otpHash(secret, "p1", "client@exemple.fr", code), "email normalisé");
  const row = { code_hash: hash, attempts: 0, expires_at: new Date(Date.now() + 60_000).toISOString() };

  assert.deepEqual(checkOtp(row, code, otpHash(secret, "p1", "client@exemple.fr", code)), { ok: true });

  const wrong = checkOtp(row, "000000", otpHash(secret, "p1", "client@exemple.fr", "000000"));
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, "wrong");
  assert.equal(wrong.left, OTP_MAX_ATTEMPTS - 1);

  const expired = { ...row, expires_at: new Date(Date.now() - 1000).toISOString() };
  assert.equal(checkOtp(expired, code, hash).reason, "expired");

  const locked = { ...row, attempts: OTP_MAX_ATTEMPTS };
  assert.equal(checkOtp(locked, code, hash).reason, "locked", "même le bon code est refusé après 5 essais");

  assert.equal(checkOtp(row, "12345", hash).reason, "wrong", "format invalide");
  assert.notEqual(otpHash(secret, "p2", "client@exemple.fr", code), hash, "lié à la proposition");
});

test("Comparaison à temps constant", () => {
  assert.equal(safeEqualHex("abcd", "abcd"), true);
  assert.equal(safeEqualHex("abcd", "abce"), false);
  assert.equal(safeEqualHex("abcd", "ab"), false);
  assert.equal(safeEqualHex("", ""), false);
});

test("IP tronquée et hachée, jamais en clair", () => {
  assert.equal(truncateIp("203.0.113.47"), "203.0.113.0");
  assert.equal(truncateIp("::ffff:198.51.100.7"), "198.51.100.0");
  assert.equal(truncateIp("2001:db8:85a3:8d3:1319:8a2e:370:7348"), "2001:db8:85a3::");
  assert.equal(truncateIp("::1"), "0:0:0::");
  assert.equal(truncateIp("2001:db8::1"), "2001:db8:0::");
  assert.equal(truncateIp("fe80::1:2:3:4:5:6:7:8:9"), null);
  assert.equal(truncateIp(null), null);
  assert.equal(truncateIp("n'importe quoi"), null);
  const h = ipHash("k", "203.0.113.47");
  assert.match(h, /^[0-9a-f]{32}$/);
  assert.equal(h, ipHash("k", "203.0.113.47"));
  assert.notEqual(h, ipHash("k", "203.0.113.48"));
  assert.notEqual(h, ipHash("autre", "203.0.113.47"));
});
