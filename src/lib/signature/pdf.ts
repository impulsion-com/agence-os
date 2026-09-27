import "server-only";

// PDF signé : le document figé, le bloc de signatures et le certificat (dossier de preuve).
// pdf-lib avec les polices standard (Helvetica, Courier) : aucun fichier de police à embarquer.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";

import { fmtDate, money } from "@/lib/format";
import type { ProposalBlock } from "@/lib/types";
import { EVENT_LABEL, fmtParis, type SignatureSnapshot, type SnapshotTotals } from "./types";

export interface PdfSignatureInfo {
  document_hash: string;
  signed_at: string;
  signer_email: string;
  email_verified: boolean;
  email_verified_at: string | null;
  mention: string;
  consent_text: string;
  signature_method: "drawn" | "typed";
  signature_hash: string;
  ip_trunc: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  countersign_required: boolean;
  countersigned_at: string | null;
  countersigner_name: string | null;
  countersigner_role: string | null;
  countersign_method: "drawn" | "typed" | null;
  countersign_hash: string | null;
  countersign_ip_trunc: string | null;
  countersign_user_agent: string | null;
}

export interface PdfEvent {
  kind: string;
  at: string;
  ip_trunc: string | null;
  user_agent: string | null;
  meta: Record<string, unknown> | null;
}

// A4 en points
const W = 595.28;
const H = 841.89;
const M = 56; // marge latérale
const TOP = 64;
const BOTTOM = 70;
const CW = W - 2 * M;

const INK = rgb(0.114, 0.11, 0.102);
const INK2 = rgb(0.34, 0.33, 0.305);
const MUTED = rgb(0.42, 0.404, 0.376);
const FAINT = rgb(0.6, 0.58, 0.55);
const LINE = rgb(0.9, 0.89, 0.87);
const SOFT = rgb(0.965, 0.96, 0.95);
const ACCENT = rgb(0.294, 0.357, 0.839);
const GREEN = rgb(0.145, 0.459, 0.294);

type Run = { t: string; f: PDFFont };

class Layout {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  private chars = new Map<PDFFont, Set<number>>();

  constructor(
    public pdf: PDFDocument,
    public f: { reg: PDFFont; bold: PDFFont; ital: PDFFont; mono: PDFFont },
  ) {}

  newPage() {
    this.page = this.pdf.addPage([W, H]);
    this.pages.push(this.page);
    this.y = H - TOP;
  }

  /** Saute de page si la hauteur demandée ne tient pas. */
  ensure(h: number) {
    if (this.y - h < BOTTOM) this.newPage();
  }

  /** Remplace les caractères absents de l'encodage WinAnsi des polices standard. */
  clean(s: string, font: PDFFont) {
    let set = this.chars.get(font);
    if (!set) {
      set = new Set(font.getCharacterSet());
      this.chars.set(font, set);
    }
    const t = s
      .replace(/[\u202f\u00a0\u2007\u2009\u200a]/g, " ")
      .replace(/[\u2212\u2011\u2010]/g, "-")
      .replace(/\u2192/g, "->")
      .replace(/\u2264/g, "<=")
      .replace(/\u2265/g, ">=")
      .replace(/\u2248/g, "~")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "");
    let out = "";
    for (const ch of t) {
      const cp = ch.codePointAt(0)!;
      out += cp === 10 || set.has(cp) ? ch : cp < 32 ? " " : "?";
    }
    return out;
  }

  width(s: string, font: PDFFont, size: number) {
    return font.widthOfTextAtSize(this.clean(s, font), size);
  }

  draw(s: string, x: number, y: number, font: PDFFont, size: number, color: RGB = INK) {
    const t = this.clean(s, font);
    if (t) this.page.drawText(t, { x, y, size, font, color });
  }

  /** Découpe des segments de texte (polices mêlées) en lignes de largeur maximale. */
  wrapRuns(runs: Run[], size: number, maxW: number): Run[][] {
    const lines: Run[][] = [];
    let line: Run[] = [];
    let lw = 0;
    const push = () => {
      // Retire les espaces de fin de ligne
      while (line.length && !line[line.length - 1].t.trim()) line.pop();
      lines.push(line);
      line = [];
      lw = 0;
    };
    for (const r of runs) {
      const parts = r.t.split(/(\s+)/).filter((p) => p !== "");
      for (const part of parts) {
        if (/^\s+$/.test(part)) {
          if (!line.length) continue;
          const w = this.width(" ", r.f, size);
          line.push({ t: " ", f: r.f });
          lw += w;
          continue;
        }
        let word = part;
        let w = this.width(word, r.f, size);
        if (lw + w > maxW && line.length) push();
        // Mot plus long que la ligne : coupe au caractère
        while (w > maxW) {
          let n = word.length;
          while (n > 1 && this.width(word.slice(0, n), r.f, size) > maxW) n--;
          line.push({ t: word.slice(0, n), f: r.f });
          push();
          word = word.slice(n);
          w = this.width(word, r.f, size);
        }
        line.push({ t: word, f: r.f });
        lw += w;
      }
    }
    if (line.length) push();
    return lines;
  }

  /** Écrit un paragraphe (avec sauts de page). Renvoie la hauteur consommée. */
  para(runs: Run[], o: { size?: number; color?: RGB; x?: number; w?: number; lh?: number; align?: "left" | "right" } = {}) {
    const size = o.size ?? 10;
    const lh = o.lh ?? size * 1.45;
    const x = o.x ?? M;
    const w = o.w ?? CW - (x - M);
    const lines = this.wrapRuns(runs, size, w);
    for (const l of lines) {
      this.ensure(lh);
      let cx = x;
      if (o.align === "right") cx = x + w - l.reduce((s, r) => s + this.width(r.t, r.f, size), 0);
      for (const r of l) {
        this.draw(r.t, cx, this.y - size, r.f, size, o.color ?? INK);
        cx += this.width(r.t, r.f, size);
      }
      this.y -= lh;
    }
    return lines.length * lh;
  }

  text(s: string, o: { size?: number; color?: RGB; font?: PDFFont; x?: number; w?: number; lh?: number } = {}) {
    return this.para([{ t: s, f: o.font ?? this.f.reg }], o);
  }

  /** Hauteur qu'occuperait un texte, sans le dessiner. */
  measure(s: string, font: PDFFont, size: number, w: number, lh = size * 1.45) {
    return this.wrapRuns([{ t: s, f: font }], size, w).length * lh;
  }

  rule(color: RGB = LINE, gap = 10) {
    this.ensure(gap * 2);
    this.y -= gap;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.7, color });
    this.y -= gap;
  }
}

/** Gras / italique du markdown léger de l'éditeur. */
function inlineRuns(text: string, f: Layout["f"]): Run[] {
  const out: Run[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: text.slice(last, m.index), f: f.reg });
    out.push(m[1] !== undefined ? { t: m[1], f: f.bold } : { t: m[2], f: f.ital });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), f: f.reg });
  return out;
}

function drawMarkdown(L: Layout, text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      L.para(inlineRuns(para.join(" "), L.f), { size: 10, color: INK2 });
      L.y -= 5;
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = /^\s*[-•*]\s+(.*)$/.exec(line);
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const bullet = ul ? "•" : `${ol![1]}.`;
      L.ensure(15);
      L.draw(bullet, M + 4, L.y - 10, L.f.reg, 10, INK2);
      L.para(inlineRuns(ul ? ul[1] : ol![2], L.f), { size: 10, color: INK2, x: M + 18 });
      L.y -= 2;
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
}

const fmtQty = (n: number) => (Number.isInteger(Number(n)) ? String(Number(n)) : String(Number(n)).replace(".", ","));
const lineTotal = (i: { quantity: number; unit_price: number }) => Math.round(Number(i.quantity || 0) * Number(i.unit_price || 0) * 100) / 100;

function drawPricing(L: Layout, s: SignatureSnapshot) {
  const cur = s.document.currency;
  const groups = (["monthly", "one_off"] as const)
    .map((b) => ({ b, rows: s.items.filter((i) => i.billing === b) }))
    .filter((g) => g.rows.length);
  if (!groups.length) {
    L.text("Aucune ligne de prix.", { color: MUTED });
    return;
  }
  const amtW = 110;
  for (const g of groups) {
    L.ensure(40);
    L.y -= 6;
    L.page.drawRectangle({ x: M, y: L.y - 20, width: CW, height: 20, color: SOFT });
    L.draw(g.b === "monthly" ? "Prestations mensuelles" : "Prestations ponctuelles", M + 8, L.y - 14, L.f.bold, 9, INK2);
    const hr = "Montant HT";
    L.draw(hr, W - M - 8 - L.width(hr, L.f.bold, 9), L.y - 14, L.f.bold, 9, INK2);
    L.y -= 26;
    for (const i of g.rows) {
      const kept = !i.optional || i.selected;
      const color = kept ? INK : FAINT;
      const nameRuns: Run[] = [{ t: i.name || "Sans nom", f: L.f.bold }];
      if (i.optional) nameRuns.push({ t: kept ? " · option retenue" : " · option non retenue", f: L.f.ital });
      const descW = CW - amtW - 16;
      const h =
        L.wrapRuns(nameRuns, 10, descW).length * 14 +
        (i.description ? L.measure(i.description, L.f.reg, 9, descW, 12.5) : 0) +
        (Number(i.quantity) !== 1 ? 12.5 : 0) +
        10;
      L.ensure(h);
      const top = L.y;
      const amt = money(lineTotal(i), cur, Number.isInteger(lineTotal(i)) ? 0 : 2) + (g.b === "monthly" ? " / mois" : "");
      L.draw(amt, W - M - 8 - L.width(amt, L.f.bold, 10), top - 10, L.f.bold, 10, color);
      L.para(nameRuns, { size: 10, color, x: M + 8, w: descW, lh: 14 });
      if (i.description) L.text(i.description, { size: 9, color: kept ? MUTED : FAINT, x: M + 8, w: descW, lh: 12.5 });
      if (Number(i.quantity) !== 1) L.text(`${fmtQty(i.quantity)} × ${money(i.unit_price, cur, 2)}`, { size: 9, color: FAINT, x: M + 8, w: descW, lh: 12.5 });
      L.y -= 5;
      L.page.drawLine({ start: { x: M, y: L.y }, end: { x: W - M, y: L.y }, thickness: 0.5, color: LINE });
      L.y -= 5;
    }
  }
  drawTotals(L, s);
}

function drawTotals(L: Layout, s: SignatureSnapshot) {
  const cur = s.document.currency;
  const cols = (["monthly", "one_off"] as const).filter((b) => s.totals[b].count > 0);
  if (!cols.length) return;
  const disc = Number(s.document.discount_pct) > 0;
  const rows = (t: SnapshotTotals): [string, string, boolean][] => [
    ...(disc
      ? ([
          ["Sous-total HT", money(t.subtotal, cur, 2), false],
          [`Remise ${String(Number(s.document.discount_pct)).replace(".", ",")} %`, `- ${money(t.discount, cur, 2)}`, false],
        ] as [string, string, boolean][])
      : []),
    ["Total HT", money(t.net, cur, 2), false],
    [`TVA ${String(Number(s.document.tax_pct)).replace(".", ",")} %`, money(t.tax, cur, 2), false],
    ["Total TTC", money(t.total, cur, 2), true],
  ];
  const boxW = cols.length === 2 ? (CW - 12) / 2 : Math.min(260, CW);
  const n = rows(s.totals[cols[0]]).length;
  const boxH = 26 + n * 16 + 8;
  L.ensure(boxH + 14);
  L.y -= 12;
  cols.forEach((b, idx) => {
    const x = cols.length === 2 ? M + idx * (boxW + 12) : W - M - boxW;
    const top = L.y;
    L.page.drawRectangle({ x, y: top - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 0.8, color: rgb(1, 1, 1) });
    L.draw(b === "monthly" ? "PAR MOIS" : "PONCTUEL, UNE FOIS", x + 12, top - 18, L.f.bold, 8, MUTED);
    rows(s.totals[b]).forEach(([k, v, strong], r) => {
      const yy = top - 38 - r * 16;
      const font = strong ? L.f.bold : L.f.reg;
      const size = strong ? 11 : 9.5;
      L.draw(k, x + 12, yy, font, size, strong ? INK : INK2);
      L.draw(v, x + boxW - 12 - L.width(v, font, size), yy, font, size, strong ? INK : INK2);
    });
  });
  L.y -= boxH + 6;
}

function drawBlocks(L: Layout, s: SignatureSnapshot) {
  const blocks: ProposalBlock[] =
    s.document.blocks.some((b) => b.type === "pricing") || !s.items.length ? s.document.blocks : [...s.document.blocks, { id: "_p", type: "pricing" }];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        if (!b.text) break;
        L.ensure(40);
        L.y -= 14;
        L.text(b.text, { size: 14, font: L.f.bold, lh: 20 });
        L.y -= 4;
        break;
      case "text":
        if (b.text.trim()) drawMarkdown(L, b.text);
        break;
      case "timeline": {
        const steps = b.steps.filter((x) => x.title || x.detail || x.duration);
        steps.forEach((st, i) => {
          L.ensure(34);
          L.page.drawCircle({ x: M + 8, y: L.y - 7, size: 8, color: SOFT, borderColor: LINE, borderWidth: 0.7 });
          const num = String(i + 1);
          L.draw(num, M + 8 - L.width(num, L.f.bold, 8) / 2, L.y - 10, L.f.bold, 8, INK2);
          const runs: Run[] = [{ t: st.title || "Étape", f: L.f.bold }];
          if (st.duration) runs.push({ t: ` · ${st.duration}`, f: L.f.reg });
          L.para(runs, { size: 10, x: M + 24, lh: 14 });
          if (st.detail) L.text(st.detail, { size: 9, color: MUTED, x: M + 24, lh: 12.5 });
          L.y -= 6;
        });
        break;
      }
      case "kpis": {
        const items = b.items.filter((k) => k.label || k.value);
        if (!items.length) break;
        const per = Math.min(items.length, 3);
        const gap = 10;
        const bw = (CW - gap * (per - 1)) / per;
        for (let r = 0; r < items.length; r += per) {
          const row = items.slice(r, r + per);
          const bh = Math.max(...row.map((k) => 22 + L.measure(k.label, L.f.reg, 8.5, bw - 20, 11))) + 14;
          L.ensure(bh + 8);
          L.y -= 4;
          row.forEach((k, i) => {
            const x = M + i * (bw + gap);
            L.page.drawRectangle({ x, y: L.y - bh, width: bw, height: bh, color: SOFT });
            L.draw(k.value, x + 10, L.y - 20, L.f.bold, 13, INK);
            const save = L.y;
            L.y = L.y - 26;
            L.text(k.label, { size: 8.5, color: MUTED, x: x + 10, w: bw - 20, lh: 11 });
            L.y = save;
          });
          L.y -= bh + 6;
        }
        break;
      }
      case "pricing":
        drawPricing(L, s);
        break;
    }
  }
}

/** Bloc « Signatures » à la fin du document. */
function drawSignatures(L: Layout, s: SignatureSnapshot, sig: PdfSignatureInfo, client: PDFImage, agency: PDFImage | null) {
  const showAgency = sig.countersign_required || !!sig.countersigned_at;
  const boxH = 176;
  L.ensure(boxH + 50);
  L.y -= 18;
  L.text("Signatures", { size: 14, font: L.f.bold, lh: 20 });
  L.y -= 6;
  const bw = showAgency ? (CW - 12) / 2 : Math.min(300, CW);
  const top = L.y;

  const box = (x: number, title: string, lines: [string, PDFFont, RGB][], img: PDFImage | null, empty?: string) => {
    L.page.drawRectangle({ x, y: top - boxH, width: bw, height: boxH, borderColor: LINE, borderWidth: 0.8 });
    L.draw(title.toUpperCase(), x + 12, top - 18, L.f.bold, 8, MUTED);
    let yy = top - 34;
    for (const [t, f, c] of lines) {
      const wrapped = L.wrapRuns([{ t, f }], 9, bw - 24);
      for (const w of wrapped) {
        L.draw(w.map((r) => r.t).join(""), x + 12, yy, f, 9, c);
        yy -= 12;
      }
    }
    const areaTop = yy - 4;
    const areaH = areaTop - (top - boxH) - 10;
    if (img) {
      const scale = Math.min((bw - 24) / img.width, areaH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      L.page.drawImage(img, { x: x + 12, y: areaTop - h, width: w, height: h });
    } else if (empty) {
      L.draw(empty, x + 12, areaTop - 20, L.f.ital, 9, FAINT);
    }
  };

  box(
    M,
    "Le client",
    [
      [`${s.signer.first_name} ${s.signer.last_name}`, L.f.bold, INK],
      ...(s.signer.role || s.signer.company
        ? ([[[s.signer.role, s.signer.company].filter(Boolean).join(", "), L.f.reg, INK2]] as [string, PDFFont, RGB][])
        : []),
      [`Signé électroniquement le ${fmtParis(sig.signed_at)} (heure de Paris)`, L.f.reg, MUTED],
      [`« ${sig.mention || "Bon pour accord"} »`, L.f.ital, INK2],
    ],
    client,
  );
  if (showAgency) {
    box(
      M + bw + 12,
      `L'agence, ${s.parties.agency}`,
      sig.countersigned_at
        ? [
            [sig.countersigner_name ?? "", L.f.bold, INK],
            ...(sig.countersigner_role ? ([[sig.countersigner_role, L.f.reg, INK2]] as [string, PDFFont, RGB][]) : []),
            [`Contre-signé le ${fmtParis(sig.countersigned_at)} (heure de Paris)`, L.f.reg, MUTED],
          ]
        : [[s.parties.owner?.full_name ?? s.parties.agency, L.f.bold, INK]],
      agency,
      sig.countersigned_at ? undefined : "En attente de contre-signature",
    );
  }
  L.y = top - boxH - 8;
  L.text(`Empreinte SHA-256 du contenu signé : ${sig.document_hash}`, { size: 7.5, color: FAINT, font: L.f.mono, lh: 10 });
}

/** Ligne « clé : valeur » du certificat. */
function kv(L: Layout, k: string, v: string, o: { mono?: boolean; color?: RGB } = {}) {
  const kw = 150;
  const font = o.mono ? L.f.mono : L.f.reg;
  const size = o.mono ? 8 : 9.5;
  const h = L.measure(v || "-", font, size, CW - kw, 13);
  L.ensure(h + 2);
  L.draw(k, M, L.y - 9.5, L.f.reg, 9, MUTED);
  const save = L.y;
  L.text(v || "-", { size, font, x: M + kw, w: CW - kw, lh: 13, color: o.color ?? INK });
  if (L.y > save - 13) L.y = save - 13;
  L.y -= 3;
}

function section(L: Layout, title: string) {
  L.ensure(80);
  L.y -= 14;
  L.text(title, { size: 11.5, font: L.f.bold, lh: 16 });
  L.page.drawLine({ start: { x: M, y: L.y + 2 }, end: { x: W - M, y: L.y + 2 }, thickness: 0.6, color: LINE });
  L.y -= 8;
}

function uaShort(ua: string | null) {
  if (!ua) return "-";
  return ua.length > 220 ? ua.slice(0, 220) + "…" : ua;
}

function drawCertificate(L: Layout, s: SignatureSnapshot, sig: PdfSignatureInfo, events: PdfEvent[]) {
  L.newPage();
  L.page.drawRectangle({ x: M, y: L.y - 4, width: 34, height: 4, color: ACCENT });
  L.y -= 18;
  L.text("Certificat de signature électronique", { size: 19, font: L.f.bold, lh: 24 });
  L.text(`Dossier de preuve de la proposition commerciale n° ${s.document.number}`, { size: 10.5, color: MUTED });
  L.y -= 4;

  // Bandeau de statut
  const both = !!sig.countersigned_at;
  const status = both
    ? "Signée par les deux parties"
    : sig.countersign_required
      ? "Signée par le client, contre-signature de l'agence en attente"
      : "Signée par le client";
  L.ensure(34);
  L.page.drawRectangle({ x: M, y: L.y - 28, width: CW, height: 28, color: rgb(0.93, 0.96, 0.94) });
  L.draw(status, M + 12, L.y - 18, L.f.bold, 10, GREEN);
  L.y -= 36;

  section(L, "Document");
  kv(L, "Titre", s.document.title);
  kv(L, "Émetteur", s.parties.agency + (s.parties.owner ? `, représenté par ${s.parties.owner.full_name}` : ""));
  kv(L, "Destinataire", [s.parties.client, s.parties.contact].filter(Boolean).join(", à l'attention de ") || "-");
  kv(L, "Date du document", fmtDate(s.document.date, true));
  kv(L, "Identifiant", s.proposal_id, { mono: true });
  kv(L, "Empreinte SHA-256", sig.document_hash, { mono: true });
  kv(L, "Méthode d'empreinte", "SHA-256 du JSON canonique (clés triées) de l'instantané figé à la signature : contenu, lignes, options retenues, totaux, identité du signataire, consentement et empreinte de l'image de signature.");

  section(L, "Signataire");
  kv(L, "Nom", `${s.signer.first_name} ${s.signer.last_name}`);
  if (s.signer.role) kv(L, "Fonction", s.signer.role);
  if (s.signer.company) kv(L, "Société", s.signer.company);
  kv(L, "Email", sig.signer_email);
  kv(
    L,
    "Vérification de l'email",
    sig.email_verified && sig.email_verified_at
      ? `Vérifiée par code à usage unique (6 chiffres) le ${fmtParis(sig.email_verified_at)}`
      : "Non vérifiée : l'envoi d'emails n'est pas configuré sur cette instance, l'adresse est déclarée par le signataire.",
    { color: sig.email_verified ? GREEN : INK },
  );
  kv(L, "Date de signature", `${fmtParis(sig.signed_at)} (heure de Paris), ${sig.signed_at} UTC`);
  kv(L, "Signature", sig.signature_method === "drawn" ? "Manuscrite, tracée à l'écran" : "Nom tapé, rendu en écriture manuscrite");
  kv(L, "Empreinte de l'image", sig.signature_hash, { mono: true });
  kv(L, "Mention recopiée", `« ${sig.mention} »`);
  kv(L, "Adresse IP", sig.ip_trunc ? `${sig.ip_trunc} (tronquée)` : "-");
  if (sig.ip_hash) kv(L, "Empreinte de l'IP", sig.ip_hash, { mono: true });
  kv(L, "Navigateur", uaShort(sig.user_agent));

  L.ensure(30);
  L.y -= 6;
  L.text("Consentement exprimé (case cochée par le signataire) :", { size: 9, color: MUTED });
  L.y -= 2;
  const ch = L.measure(sig.consent_text, L.f.ital, 9.5, CW - 24, 13.5) + 16;
  L.ensure(ch);
  L.page.drawRectangle({ x: M, y: L.y - ch, width: CW, height: ch, color: SOFT });
  L.y -= 8;
  L.text(sig.consent_text, { size: 9.5, font: L.f.ital, x: M + 12, w: CW - 24, lh: 13.5, color: INK2 });
  L.y -= 8;

  if (sig.countersign_required || sig.countersigned_at) {
    section(L, "Contre-signature de l'agence");
    if (sig.countersigned_at) {
      kv(L, "Nom", sig.countersigner_name ?? "-");
      if (sig.countersigner_role) kv(L, "Fonction", sig.countersigner_role);
      kv(L, "Date", `${fmtParis(sig.countersigned_at)} (heure de Paris), ${sig.countersigned_at} UTC`);
      kv(L, "Signature", sig.countersign_method === "typed" ? "Nom tapé, rendu en écriture manuscrite" : "Manuscrite, tracée à l'écran");
      if (sig.countersign_hash) kv(L, "Empreinte de l'image", sig.countersign_hash, { mono: true });
      kv(L, "Adresse IP", sig.countersign_ip_trunc ? `${sig.countersign_ip_trunc} (tronquée)` : "-");
      kv(L, "Navigateur", uaShort(sig.countersign_user_agent));
    } else {
      kv(L, "Statut", "En attente");
    }
  }

  section(L, "Journal des événements");
  const cols = [M, M + 150, M + 300];
  L.ensure(20);
  L.draw("Date et heure (Paris)", cols[0], L.y - 9, L.f.bold, 8.5, MUTED);
  L.draw("Événement", cols[1], L.y - 9, L.f.bold, 8.5, MUTED);
  L.draw("Détail", cols[2], L.y - 9, L.f.bold, 8.5, MUTED);
  L.y -= 16;
  for (const e of events) {
    const detail = [
      typeof e.meta?.email === "string" ? e.meta.email : typeof e.meta?.to === "string" ? e.meta.to : "",
      e.ip_trunc ? `IP ${e.ip_trunc}` : "",
      e.kind === "signed" && typeof e.meta?.hash === "string" ? `empreinte ${String(e.meta.hash).slice(0, 12)}…` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const dh = L.measure(detail || "-", L.f.reg, 8.5, W - M - cols[2], 11.5);
    L.ensure(Math.max(dh, 12) + 4);
    const top = L.y;
    L.draw(fmtParis(e.at), cols[0], top - 8.5, L.f.reg, 8.5, INK2);
    L.draw(EVENT_LABEL[e.kind] ?? e.kind, cols[1], top - 8.5, L.f.reg, 8.5, INK);
    L.text(detail || "-", { size: 8.5, x: cols[2], w: W - M - cols[2], lh: 11.5, color: MUTED });
    L.y = Math.min(L.y, top - 12) - 4;
  }

  section(L, "Valeur juridique");
  L.text(
    "Signature électronique simple au sens de l'article 3.10 du règlement (UE) n° 910/2014 (eIDAS). Conformément à l'article 25 de ce règlement, " +
      "elle ne peut être privée d'effet juridique au seul motif de sa forme électronique ; les articles 1366 et 1367 du Code civil reconnaissent " +
      "l'écrit et la signature électroniques dès lors que l'auteur est identifié et l'intégrité du document garantie. Ce certificat, l'instantané " +
      "figé du document et la piste d'audit sont conservés par l'émetteur.",
    { size: 8.5, color: MUTED, lh: 12 },
  );
  L.y -= 4;
  L.text(
    "Vérification de l'intégrité : recalculer l'empreinte SHA-256 de l'instantané conservé et la comparer à l'empreinte indiquée ci-dessus. " +
      "Toute modification du contenu signé produit une empreinte différente.",
    { size: 8.5, color: MUTED, lh: 12 },
  );
}

export async function renderSignedPdf(input: {
  snapshot: SignatureSnapshot;
  sig: PdfSignatureInfo;
  events: PdfEvent[];
  clientPng: Uint8Array;
  agencyPng?: Uint8Array | null;
}): Promise<Uint8Array> {
  const { snapshot: s, sig } = input;
  const pdf = await PDFDocument.create();
  const f = {
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    ital: await pdf.embedFont(StandardFonts.HelveticaOblique),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
  const client = await pdf.embedPng(input.clientPng);
  const agency = input.agencyPng ? await pdf.embedPng(input.agencyPng) : null;
  const L = new Layout(pdf, f);

  // ---- En-tête du document
  L.newPage();
  L.page.drawRectangle({ x: M, y: L.y - 16, width: 16, height: 16, color: ACCENT });
  L.draw(s.parties.agency.slice(0, 1).toUpperCase(), M + 8 - L.width(s.parties.agency.slice(0, 1).toUpperCase(), f.bold, 10) / 2, L.y - 12, f.bold, 10, rgb(1, 1, 1));
  L.draw(s.parties.agency, M + 24, L.y - 12, f.bold, 11, INK);
  L.y -= 40;
  L.text(`PROPOSITION COMMERCIALE N° ${s.document.number}`, { size: 8.5, font: f.bold, color: MUTED });
  L.y -= 2;
  L.text(s.document.title, { size: 22, font: f.bold, lh: 28 });
  L.y -= 6;
  const meta: [string, string][] = [];
  if (s.parties.client) meta.push(["Pour", s.parties.client + (s.parties.contact ? `, à l'attention de ${s.parties.contact}` : "")]);
  meta.push(["Date", fmtDate(s.document.date, true)]);
  if (s.document.valid_until) meta.push(["Valable jusqu'au", fmtDate(s.document.valid_until, true)]);
  for (const [k, v] of meta) {
    L.ensure(14);
    L.draw(k, M, L.y - 9.5, f.reg, 9, MUTED);
    L.text(v, { size: 9.5, x: M + 100, w: CW - 100, lh: 13 });
  }
  L.rule(LINE, 12);

  drawBlocks(L, s);
  drawSignatures(L, s, sig, client, agency);
  const docPages = L.pages.length;
  drawCertificate(L, s, sig, input.events);

  // ---- Pieds de page
  const total = L.pages.length;
  L.pages.forEach((p, i) => {
    L.page = p;
    const left = i < docPages ? `Proposition n° ${s.document.number} · ${s.parties.agency}` : `Certificat de signature · proposition n° ${s.document.number}`;
    L.draw(left, M, 34, f.reg, 7.5, FAINT);
    const right = `Page ${i + 1} / ${total}`;
    L.draw(right, W - M - L.width(right, f.reg, 7.5), 34, f.reg, 7.5, FAINT);
    const hash = `SHA-256 ${sig.document_hash.slice(0, 16)}…${sig.document_hash.slice(-8)}`;
    L.draw(hash, W / 2 - L.width(hash, f.mono, 7) / 2, 34, f.mono, 7, FAINT);
  });

  pdf.setTitle(`Proposition n° ${s.document.number} : ${s.document.title} (signée)`);
  pdf.setAuthor(s.parties.agency);
  pdf.setSubject("Proposition commerciale signée électroniquement, avec certificat de signature");
  pdf.setKeywords([`sha256:${sig.document_hash}`]);
  pdf.setCreator("Agence OS");
  pdf.setProducer("Agence OS (pdf-lib)");
  pdf.setCreationDate(new Date());
  return pdf.save();
}
