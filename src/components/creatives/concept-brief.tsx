"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Plus, Trash2 } from "lucide-react";

import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { BRIEF_FIELDS, type Brief, type BriefKey } from "@/lib/creatives/constants";
import type { AdLink, Asset, Variant } from "@/lib/creatives/types";

/** Champ texte enregistré à la sortie du champ (pas à chaque frappe). */
export function CommitField({
  value,
  onCommit,
  rows,
  placeholder,
  id,
  disabled,
  className,
  list,
}: {
  value: string;
  onCommit: (v: string) => void;
  rows?: number;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  list?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  if (rows && rows > 1)
    return (
      <textarea
        id={id}
        className={`textarea ${className ?? ""}`}
        rows={rows}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    );
  return (
    <input
      id={id}
      className={`input ${className ?? ""}`}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      list={list}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function BriefSection({ conceptId, brief, onSave }: { conceptId: string; brief: Brief; onSave: (b: Brief) => void }) {
  const ws = useWorkspace();
  const set = (k: BriefKey, v: string) => onSave({ ...brief, [k]: v });
  return (
    <section className="card crv-sec" aria-labelledby="crv-brief-h">
      <div className="card-h">
        <h2 id="crv-brief-h">Brief</h2>
        <Link href={`${ws.base}/creatives/${conceptId}/brief`} className="btn btn-sm">
          <FileText size={13} /> Brief créateur imprimable
        </Link>
      </div>
      <div className="crv-brief-form">
        {BRIEF_FIELDS.map((f) => (
          <div key={f.id} className={`field${f.rows > 2 || f.id === "context" ? " full" : ""}`}>
            <label htmlFor={`crv-b-${f.id}`}>{f.name}</label>
            <CommitField id={`crv-b-${f.id}`} value={brief[f.id] ?? ""} rows={f.rows > 1 ? f.rows : undefined} placeholder={f.placeholder} disabled={!ws.canWrite} onCommit={(v) => set(f.id, v)} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function VariantsSection({ conceptId, variants, links, assets }: { conceptId: string; variants: Variant[]; links: AdLink[]; assets: Asset[] }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const add = () =>
    mutate(
      async (sb) =>
        must(
          await sb
            .from("creative_variants")
            .insert({
              workspace_id: ws.workspace.id,
              concept_id: conceptId,
              name: `V${variants.length + 1}`,
              position: (variants.at(-1)?.position ?? 0) + 1000,
            })
            .select("id"),
        ),
      { success: "Variante ajoutée" },
    );
  const save = (v: Variant, patch: Partial<Pick<Variant, "name" | "hook" | "notes">>) =>
    mutate(async (sb) => must(await sb.from("creative_variants").update(patch).eq("id", v.id).select("id")), { refresh: false });
  const remove = (v: Variant) => mutate(async (sb) => must(await sb.from("creative_variants").delete().eq("id", v.id).select("id")), { success: "Variante supprimée" });

  return (
    <section className="card crv-sec" aria-labelledby="crv-vars-h">
      <div className="card-h">
        <h2 id="crv-vars-h">
          Variantes <span className="sub">hooks, visuels ou textes déclinés du même concept</span>
        </h2>
        {ws.canWrite && (
          <button type="button" className="btn btn-sm" onClick={add}>
            <Plus size={13} /> Variante
          </button>
        )}
      </div>
      {variants.length ? (
        <div className="crv-vars">
          {variants.map((v) => {
            const nAds = links.filter((l) => l.variant_id === v.id).length;
            const nFiles = assets.filter((a) => a.variant_id === v.id).length;
            return (
              <div className="crv-var" key={v.id}>
                <div>
                  <CommitField value={v.name} onCommit={(name) => name.trim() && save(v, { name: name.trim() })} disabled={!ws.canWrite} placeholder="Nom" />
                  <div className="meta">
                    {nAds} annonce{nAds > 1 ? "s" : ""}, {nFiles} fichier{nFiles > 1 ? "s" : ""}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <CommitField value={v.hook} onCommit={(hook) => save(v, { hook })} disabled={!ws.canWrite} placeholder="Hook de cette variante" />
                  <CommitField value={v.notes} onCommit={(notes) => save(v, { notes })} disabled={!ws.canWrite} placeholder="Notes (visuel, texte, montage…)" className="faint" />
                </div>
                {ws.canWrite && (
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => remove(v)} aria-label={`Supprimer ${v.name}`} title="Supprimer la variante">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="crv-note" style={{ paddingTop: 0 }}>Décline le concept en plusieurs hooks ou visuels, puis rattache chaque annonce à sa variante pour savoir laquelle gagne.</p>
      )}
    </section>
  );
}
