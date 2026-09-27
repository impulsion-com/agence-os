"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { LOCATIONS, QUESTION_PRESETS, QUESTION_TYPES, readQuestions, slugify, type BookingType, type LocationKind, type Question, type QuestionType } from "@/lib/booking/shared";
import { COLORS, colorOf } from "@/lib/constants";
import { must, useMutate } from "@/lib/workspace/context";

const DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const NOTICES: [number, string][] = [
  [0, "Aucun"],
  [60, "1 h"],
  [120, "2 h"],
  [240, "4 h"],
  [720, "12 h"],
  [1440, "24 h"],
  [2880, "48 h"],
  [4320, "3 jours"],
];
const BUFFERS = [0, 5, 10, 15, 20, 30, 45, 60];
const INTERVALS: [number | null, string][] = [
  [null, "Durée du rendez-vous"],
  [15, "15 min"],
  [30, "30 min"],
  [60, "1 h"],
];

interface Draft {
  name: string;
  slug: string;
  description: string;
  duration_min: number;
  location_kind: LocationKind;
  location_value: string;
  min_notice_min: number;
  horizon_days: number;
  buffer_before_min: number;
  buffer_after_min: number;
  slot_interval_min: number | null;
  daily_limit: number | null;
  color: string;
  create_deal: boolean;
  active: boolean;
  presets: Record<string, { on: boolean; required: boolean }>;
  custom: Question[];
}

function toDraft(t: BookingType | null): Draft {
  const qs = t ? readQuestions(t.questions) : QUESTION_PRESETS;
  const presets: Draft["presets"] = {};
  for (const p of QUESTION_PRESETS) {
    const q = qs.find((x) => x.key === p.key);
    presets[p.key] = { on: !!q, required: !!q?.required };
  }
  return {
    name: t?.name ?? "",
    slug: t?.slug ?? "",
    description: t?.description ?? "",
    duration_min: t?.duration_min ?? 30,
    location_kind: (t?.location_kind as LocationKind) ?? "google_meet",
    location_value: t?.location_value ?? "",
    min_notice_min: t?.min_notice_min ?? 240,
    horizon_days: t?.horizon_days ?? 30,
    buffer_before_min: t?.buffer_before_min ?? 0,
    buffer_after_min: t?.buffer_after_min ?? 0,
    slot_interval_min: t?.slot_interval_min ?? null,
    daily_limit: t?.daily_limit ?? null,
    color: t?.color ?? "indigo",
    create_deal: t?.create_deal ?? true,
    active: t?.active ?? true,
    presets,
    custom: qs.filter((q) => !QUESTION_PRESETS.some((p) => p.key === q.key)),
  };
}

export function TypeModal({
  type,
  profileId,
  workspaceId,
  nextPosition,
  googleOn,
  onClose,
}: {
  type: BookingType | null;
  profileId: string;
  workspaceId: string;
  nextPosition: number;
  googleOn: boolean;
  onClose: () => void;
}) {
  const mutate = useMutate();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => toDraft(type));
  const [slugTouched, setSlugTouched] = useState(!!type);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const questions = (): Question[] => [
    ...QUESTION_PRESETS.filter((p) => d.presets[p.key]?.on).map((p) => ({ ...p, required: d.presets[p.key].required })),
    ...d.custom.filter((q) => q.label.trim()).map((q) => ({ ...q, label: q.label.trim(), options: q.type === "select" ? (q.options ?? []).filter(Boolean) : undefined })),
  ];

  async function save() {
    const slug = slugify(d.slug || d.name);
    if (!d.name.trim()) return toast("Donne un nom à ce type de rendez-vous", { error: true });
    if (!slug) return toast("Adresse invalide", { error: true });
    if ((d.location_kind === "video" || d.location_kind === "address") && !d.location_value.trim())
      return toast(d.location_kind === "video" ? "Indique le lien de ta visio" : "Indique l'adresse du rendez-vous", { error: true });
    const row = {
      name: d.name.trim(),
      slug,
      description: d.description.trim(),
      duration_min: Math.max(5, Math.min(480, Math.round(d.duration_min))),
      location_kind: d.location_kind,
      location_value: d.location_value.trim(),
      min_notice_min: d.min_notice_min,
      horizon_days: Math.max(1, Math.min(180, Math.round(d.horizon_days))),
      buffer_before_min: d.buffer_before_min,
      buffer_after_min: d.buffer_after_min,
      slot_interval_min: d.slot_interval_min,
      daily_limit: d.daily_limit && d.daily_limit > 0 ? Math.min(50, Math.round(d.daily_limit)) : null,
      color: d.color,
      create_deal: d.create_deal,
      active: d.active,
      questions: questions() as unknown as never,
    };
    setBusy(true);
    const ok = await mutate(
      async (sb) => {
        const res = type
          ? await sb.from("booking_types").update(row).eq("id", type.id)
          : await sb.from("booking_types").insert({ ...row, workspace_id: workspaceId, profile_id: profileId, position: nextPosition });
        if (res.error?.code === "23505") throw new Error("Cette adresse est déjà utilisée par un autre de tes types de rendez-vous.");
        must(res);
        return true;
      },
      { success: type ? "Type de rendez-vous enregistré" : "Type de rendez-vous créé" },
    );
    setBusy(false);
    if (ok) onClose();
  }

  const setPreset = (key: string, patch: Partial<{ on: boolean; required: boolean }>) =>
    setD((x) => ({ ...x, presets: { ...x.presets, [key]: { ...x.presets[key], ...patch } } }));
  const setCustom = (i: number, patch: Partial<Question>) => setD((x) => ({ ...x, custom: x.custom.map((q, k) => (k === i ? { ...q, ...patch } : q)) }));

  return (
    <Modal
      size="lg"
      title={type ? "Modifier le type de rendez-vous" : "Nouveau type de rendez-vous"}
      onClose={onClose}
      footer={
        <>
          <label className="bk-inline" style={{ marginRight: "auto", fontSize: "var(--fs-sm)", color: "var(--text-2)" }}>
            <input type="checkbox" className="toggle" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> Proposé sur ta page
          </label>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {type ? "Enregistrer" : "Créer"}
          </button>
        </>
      }
    >
      <div className="bk-g2">
        <div className="field">
          <label htmlFor="bt-name">Nom</label>
          <input
            id="bt-name"
            className="input"
            autoFocus
            value={d.name}
            placeholder="Appel découverte"
            onChange={(e) => {
              set("name", e.target.value);
              if (!slugTouched) set("slug", slugify(e.target.value));
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="bt-slug">Adresse</label>
          <div className="bk-prefix">
            <span>…/</span>
            <input
              id="bt-slug"
              className="input"
              value={d.slug}
              placeholder="appel-decouverte"
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
              }}
            />
          </div>
        </div>
      </div>
      <div className="field">
        <label htmlFor="bt-desc">Description (visible par le prospect)</label>
        <textarea id="bt-desc" className="textarea" rows={3} value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Ce que le prospect peut attendre de ce rendez-vous." />
      </div>

      <div className="bk-g3">
        <div className="field">
          <label htmlFor="bt-dur">Durée</label>
          <select id="bt-dur" className="select" value={DURATIONS.includes(d.duration_min) ? d.duration_min : "x"} onChange={(e) => e.target.value !== "x" && set("duration_min", Number(e.target.value))}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>
            ))}
            {!DURATIONS.includes(d.duration_min) && <option value="x">{d.duration_min} min</option>}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bt-int">Créneaux proposés toutes les</label>
          <select id="bt-int" className="select" value={d.slot_interval_min ?? ""} onChange={(e) => set("slot_interval_min", e.target.value ? Number(e.target.value) : null)}>
            {INTERVALS.map(([v, l]) => (
              <option key={l} value={v ?? ""}>{l}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Couleur</label>
          <div className="bk-colors" style={{ height: "var(--h-md)", alignItems: "center" }}>
            {Object.keys(COLORS)
              .filter((c) => c !== "gray")
              .map((c) => (
                <button key={c} type="button" aria-label={c} className={d.color === c ? "on" : ""} style={{ ["--c" as string]: colorOf(c) }} onClick={() => set("color", c)} />
              ))}
          </div>
        </div>
      </div>

      <div className="field">
        <label>Lieu</label>
        <div className="seg" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
          {LOCATIONS.map((l) => (
            <button key={l.id} type="button" className={d.location_kind === l.id ? "on" : ""} onClick={() => set("location_kind", l.id)}>
              {l.name}
            </button>
          ))}
        </div>
        <span className="hint">
          {LOCATIONS.find((l) => l.id === d.location_kind)?.hint}
          {d.location_kind === "google_meet" && !googleOn && " : sans agenda connecté, pense à envoyer le lien toi-même."}
        </span>
        {(d.location_kind === "video" || d.location_kind === "address") && (
          <input
            className="input"
            value={d.location_value}
            onChange={(e) => set("location_value", e.target.value)}
            placeholder={d.location_kind === "video" ? "https://zoom.us/j/…" : "12 rue de la Paix, 75002 Paris"}
          />
        )}
      </div>

      <div className="bk-g3">
        <div className="field">
          <label htmlFor="bt-notice">Délai minimum avant réservation</label>
          <select id="bt-notice" className="select" value={d.min_notice_min} onChange={(e) => set("min_notice_min", Number(e.target.value))}>
            {NOTICES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bt-hz">Réservable jusqu&apos;à (jours)</label>
          <input id="bt-hz" className="input" type="number" min={1} max={180} value={d.horizon_days} onChange={(e) => set("horizon_days", Number(e.target.value) || 30)} />
        </div>
        <div className="field">
          <label htmlFor="bt-lim">Maximum par jour</label>
          <input id="bt-lim" className="input" type="number" min={0} max={50} value={d.daily_limit ?? ""} placeholder="Illimité" onChange={(e) => set("daily_limit", e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div className="field">
          <label htmlFor="bt-bb">Tampon avant</label>
          <select id="bt-bb" className="select" value={d.buffer_before_min} onChange={(e) => set("buffer_before_min", Number(e.target.value))}>
            {BUFFERS.map((b) => (
              <option key={b} value={b}>{b ? `${b} min` : "Aucun"}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="bt-ba">Tampon après</label>
          <select id="bt-ba" className="select" value={d.buffer_after_min} onChange={(e) => set("buffer_after_min", Number(e.target.value))}>
            {BUFFERS.map((b) => (
              <option key={b} value={b}>{b ? `${b} min` : "Aucun"}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>CRM</label>
          <label className="bk-inline" style={{ height: "var(--h-md)", fontSize: "var(--fs-sm)" }}>
            <input type="checkbox" className="toggle" checked={d.create_deal} onChange={(e) => set("create_deal", e.target.checked)} />
            Créer un deal
          </label>
        </div>
      </div>

      <div className="field">
        <label>Questions du formulaire</label>
        <span className="hint">Le nom et l&apos;email sont toujours demandés. Téléphone, entreprise et site web complètent la fiche CRM.</span>
        <div>
          <div className="bk-q">
            <span className="fixed">Nom et prénom, email</span>
            <span />
            <span className="fainter" style={{ fontSize: "var(--fs-xs)" }}>Toujours</span>
            <span />
          </div>
          {QUESTION_PRESETS.map((p) => (
            <div className="bk-q" key={p.key}>
              <label className="chk" style={{ fontSize: "var(--fs)", color: "var(--text)" }}>
                <input type="checkbox" className="check" checked={d.presets[p.key]?.on ?? false} onChange={(e) => setPreset(p.key, { on: e.target.checked })} />
                {p.label}
              </label>
              <span className="fainter" style={{ fontSize: "var(--fs-xs)" }}>{QUESTION_TYPES.find((t) => t.id === p.type)?.name}</span>
              <label className="chk">
                <input type="checkbox" className="check" disabled={!d.presets[p.key]?.on} checked={d.presets[p.key]?.required ?? false} onChange={(e) => setPreset(p.key, { required: e.target.checked })} />
                Obligatoire
              </label>
              <span />
            </div>
          ))}
          {d.custom.map((q, i) => (
            <div key={i}>
              <div className="bk-q">
                <input className="input" value={q.label} placeholder="Votre question" onChange={(e) => setCustom(i, { label: e.target.value })} />
                <select className="select" value={q.type} onChange={(e) => setCustom(i, { type: e.target.value as QuestionType })}>
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <label className="chk">
                  <input type="checkbox" className="check" checked={q.required} onChange={(e) => setCustom(i, { required: e.target.checked })} />
                  Obligatoire
                </label>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Retirer" onClick={() => setD((x) => ({ ...x, custom: x.custom.filter((_, k) => k !== i) }))}>
                  <Trash2 size={13} />
                </button>
              </div>
              {q.type === "select" && (
                <input
                  className="input"
                  style={{ margin: "2px 0 6px" }}
                  value={(q.options ?? []).join(", ")}
                  placeholder="Choix séparés par des virgules"
                  onChange={(e) => setCustom(i, { options: e.target.value.split(",").map((s) => s.trim()) })}
                />
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setD((x) => ({ ...x, custom: [...x.custom, { key: `q${Date.now().toString(36)}`, label: "", type: "text", required: false }] }))}
        >
          <Plus size={13} /> Ajouter une question
        </button>
      </div>
    </Modal>
  );
}
