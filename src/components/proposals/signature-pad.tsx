"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, PenLine, Type } from "lucide-react";

import type { SignatureMethod } from "@/lib/signature/types";

export interface SignatureValue {
  method: SignatureMethod;
  dataUrl: string;
}

type Pt = { x: number; y: number; w: number };

const INK = "#1b2559";
const MAX_W = 1200;

/** Rend les traits (coordonnées CSS) sur un contexte, avec lissage quadratique. */
function paint(ctx: CanvasRenderingContext2D, strokes: Pt[][], dx = 0, dy = 0, k = 1) {
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc((s[0].x - dx) * k, (s[0].y - dy) * k, (s[0].w / 2) * k, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      const p0 = i > 1 ? { x: (s[i - 2].x + a.x) / 2, y: (s[i - 2].y + a.y) / 2 } : a;
      const p1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.lineWidth = ((a.w + b.w) / 2) * k;
      ctx.beginPath();
      ctx.moveTo((p0.x - dx) * k, (p0.y - dy) * k);
      ctx.quadraticCurveTo((a.x - dx) * k, (a.y - dy) * k, (p1.x - dx) * k, (p1.y - dy) * k);
      if (i === s.length - 1) ctx.lineTo((b.x - dx) * k, (b.y - dy) * k);
      ctx.stroke();
    }
  }
}

const length = (strokes: Pt[][]) =>
  strokes.reduce((t, s) => t + s.slice(1).reduce((u, p, i) => u + Math.hypot(p.x - s[i].x, p.y - s[i].y), 0), 0);

/** PNG transparent recadré sur les traits, en 2x. */
function exportStrokes(strokes: Pt[][]): string | null {
  const pts = strokes.flat();
  if (!pts.length) return null;
  const pad = 10;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const w = Math.max(...pts.map((p) => p.x)) + pad - minX;
  const h = Math.max(...pts.map((p) => p.y)) + pad - minY;
  const k = Math.min(2, MAX_W / w);
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * k);
  c.height = Math.ceil(h * k);
  paint(c.getContext("2d")!, strokes, minX, minY, k);
  return c.toDataURL("image/png");
}

async function exportTyped(text: string, fontFamily: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return null;
  const font = `600 72px ${fontFamily}`;
  try {
    await document.fonts.load(font, t);
  } catch {
    // Police indisponible : le rendu utilisera la police cursive de repli
  }
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = font;
  const w = Math.min(MAX_W, Math.ceil(ctx.measureText(t).width) + 40);
  c.width = w;
  c.height = 120;
  ctx.font = font;
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  const scale = Math.min(1, (w - 40) / ctx.measureText(t).width);
  ctx.setTransform(scale, 0, 0, scale, 20, 60);
  ctx.fillText(t, 0, 0);
  return c.toDataURL("image/png");
}

/**
 * Zone de signature : tracé à la souris, au doigt ou au stylet (avec « Effacer »),
 * ou nom tapé rendu en écriture manuscrite. Renvoie un PNG en data URL.
 */
export function SignaturePad({
  onChange,
  defaultName,
  fontFamily,
  label = "Votre signature",
}: {
  onChange: (v: SignatureValue | null) => void;
  defaultName: string;
  fontFamily: string;
  label?: string;
}) {
  const [mode, setMode] = useState<SignatureMethod>("drawn");
  const [typed, setTyped] = useState(defaultName);
  const [empty, setEmpty] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const drawing = useRef(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    paint(ctx, strokes.current);
  }, []);

  useEffect(() => {
    if (mode !== "drawn") return;
    redraw();
    const ro = new ResizeObserver(redraw);
    if (canvas.current) ro.observe(canvas.current);
    return () => ro.disconnect();
  }, [mode, redraw]);

  // Signature tapée : régénérée à chaque frappe
  useEffect(() => {
    if (mode !== "typed") return;
    let live = true;
    void exportTyped(typed, fontFamily).then((url) => live && onChangeRef.current(url ? { method: "typed", dataUrl: url } : null));
    return () => {
      live = false;
    };
  }, [mode, typed, fontFamily]);

  const emit = () => {
    const ok = length(strokes.current) > 40;
    setEmpty(!strokes.current.length);
    const url = ok ? exportStrokes(strokes.current) : null;
    onChangeRef.current(url ? { method: "drawn", dataUrl: url } : null);
  };

  const point = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: 1.6 + pressure * 1.8 };
  };

  const clear = () => {
    strokes.current = [];
    redraw();
    setEmpty(true);
    onChangeRef.current(null);
  };

  const switchMode = (m: SignatureMethod) => {
    if (m === mode) return;
    setMode(m);
    if (m === "drawn") {
      strokes.current = [];
      setEmpty(true);
      onChangeRef.current(null);
    }
  };

  return (
    <div className="sgp">
      <div className="sgp-head">
        <span className="label">{label}</span>
        <div className="seg sgp-seg" role="tablist" aria-label="Type de signature">
          <button type="button" role="tab" aria-selected={mode === "drawn"} className={mode === "drawn" ? "on" : ""} onClick={() => switchMode("drawn")}>
            <PenLine size={13} /> Dessiner
          </button>
          <button type="button" role="tab" aria-selected={mode === "typed"} className={mode === "typed" ? "on" : ""} onClick={() => switchMode("typed")}>
            <Type size={13} /> Taper
          </button>
        </div>
      </div>

      {mode === "drawn" ? (
        <div className="sgp-box">
          <canvas
            ref={canvas}
            className="sgp-canvas"
            role="img"
            aria-label="Zone de signature : signez avec la souris, le doigt ou un stylet"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drawing.current = true;
              strokes.current.push([point(e)]);
              setEmpty(false);
              redraw();
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const s = strokes.current[strokes.current.length - 1];
              const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
              if (events.length > 1) {
                const r = e.currentTarget.getBoundingClientRect();
                for (const ev of events) s.push({ x: ev.clientX - r.left, y: ev.clientY - r.top, w: point(e).w });
              } else s.push(point(e));
              redraw();
            }}
            onPointerUp={() => {
              if (!drawing.current) return;
              drawing.current = false;
              emit();
            }}
            onPointerCancel={() => {
              drawing.current = false;
              emit();
            }}
          />
          <span className="sgp-line" aria-hidden />
          {empty && (
            <span className="sgp-ph" aria-hidden>
              Signez ici
            </span>
          )}
          <button type="button" className="btn btn-ghost btn-sm sgp-clear" onClick={clear} disabled={empty}>
            <Eraser size={13} /> Effacer
          </button>
        </div>
      ) : (
        <div className="sgp-typed">
          <input
            className="input lg"
            value={typed}
            maxLength={60}
            aria-label="Nom à utiliser comme signature"
            placeholder="Prénom Nom"
            onChange={(e) => setTyped(e.target.value)}
          />
          <div className="sgp-box sgp-preview" aria-hidden>
            <span style={{ fontFamily }}>{typed.trim() || "Prénom Nom"}</span>
            <span className="sgp-line" />
          </div>
        </div>
      )}
    </div>
  );
}
