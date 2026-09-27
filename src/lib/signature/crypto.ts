// Empreintes, codes à usage unique et IP pour le dossier de preuve.
// Aucune dépendance au framework : testable avec `node --experimental-strip-types --test`.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** JSON canonique : clés d'objets triées, sans espaces. Base de l'empreinte du document. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) return "null";
    return JSON.stringify(v ?? null);
  }
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Empreinte d'un instantané de document. */
export const documentHash = (snapshot: unknown) => sha256(canonicalJson(snapshot));

// ---------------------------------------------------------------------
// Codes de vérification (OTP)
// ---------------------------------------------------------------------
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** Au-delà, il faut attendre avant de redemander un code. */
export const OTP_MAX_SENDS_PER_HOUR = 5;
/** Durée de validité de la vérification d'email pour signer. */
export const OTP_PROOF_TTL_MS = 30 * 60 * 1000;

export const newOtpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const newProof = () => randomBytes(24).toString("hex");

export function otpHash(secret: string, proposalId: string, email: string, code: string) {
  return createHmac("sha256", secret).update(`${proposalId}:${email.trim().toLowerCase()}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export type OtpCheck = { ok: true } | { ok: false; reason: "expired" | "locked" | "wrong"; left?: number };

/** Vérifie un code saisi contre la ligne stockée (expiration, nombre d'essais, comparaison à temps constant). */
export function checkOtp(
  row: { code_hash: string; attempts: number; expires_at: string },
  input: string,
  expected: string,
  now = Date.now(),
): OtpCheck {
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  if (new Date(row.expires_at).getTime() < now) return { ok: false, reason: "expired" };
  if (!/^\d{6}$/.test(input) || !safeEqualHex(row.code_hash, expected)) {
    return { ok: false, reason: "wrong", left: Math.max(0, OTP_MAX_ATTEMPTS - row.attempts - 1) };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// Adresse IP : jamais stockée en entier
// ---------------------------------------------------------------------
/** IPv4 : dernier octet masqué (203.0.113.0). IPv6 : 3 premiers groupes seulement. */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.trim().replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v.split(".").slice(0, 3).join(".") + ".0";
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(":")) {
    // Développe la forme compressée (::) avant de garder les 3 premiers groupes
    const [head, tail] = v.includes("::") ? v.split("::") : [v, ""];
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    const groups = v.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
    if (groups.length !== 8) return null;
    return groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "").toLowerCase()).join(":") + "::";
  }
  return null;
}

/** Hachage salé de l'IP complète : permet de recouper deux événements sans conserver l'adresse. */
export const ipHash = (secret: string, ip: string | null | undefined) =>
  ip ? createHmac("sha256", secret).update(`ip:${ip.trim()}`).digest("hex").slice(0, 32) : null;
