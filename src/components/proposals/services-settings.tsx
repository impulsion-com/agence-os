"use client";

import "@/styles/proposals.css";

import { useState } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { ConfirmModal, Menu, Modal } from "@/components/ui/overlay";
import { money } from "@/lib/format";
import type { Billing, Service } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";

type Draft = { id?: string; name: string; description: string; unit_price: string; billing: Billing };

export function ServicesSettings({ services, usage }: { services: Service[]; usage: Record<string, number> }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const [list, setList] = useState(services);
  const [prev, setPrev] = useState(services);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [del, setDel] = useState<Service | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const cur = ws.workspace.currency || "EUR";

  // Resynchronise quand le serveur renvoie de nouvelles données
  if (services !== prev) {
    setPrev(services);
    setList(services);
  }

  const active = list.filter((s) => !s.archived);
  const archived = list.filter((s) => s.archived);
  const monthly = active.filter((s) => s.billing === "monthly");

  const reorder = async (from: number, to: number) => {
    if (to < 0 || to >= active.length || from === to) return;
    const next = [...active];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    const withPos = next.map((s, i) => ({ ...s, position: i }));
    setList([...withPos, ...archived]);
    await mutate(async (sb) => {
      for (const s of withPos) must(await sb.from("services").update({ position: s.position }).eq("id", s.id));
    }, { refresh: false });
  };

  const saveDraft = async () => {
    if (!edit) return;
    const row = {
      name: edit.name.trim(),
      description: edit.description.trim(),
      unit_price: Math.max(0, Number(edit.unit_price.replace(/\s/g, "").replace(",", ".")) || 0),
      billing: edit.billing,
    };
    if (!row.name) return;
    const ok = await mutate(
      async (sb) => {
        if (edit.id) must(await sb.from("services").update(row).eq("id", edit.id));
        else must(await sb.from("services").insert({ ...row, workspace_id: ws.workspace.id, position: active.length }));
        return true;
      },
      { success: edit.id ? "Service mis à jour" : "Service ajouté" },
    );
    if (ok) setEdit(null);
  };

  const setArchived = (s: Service, v: boolean) => {
    setList((l) => l.map((x) => (x.id === s.id ? { ...x, archived: v } : x)));
    void mutate(async (sb) => must(await sb.from("services").update({ archived: v }).eq("id", s.id)), {
      success: v ? "Service archivé" : "Service réactivé",
    });
  };

  const row = (s: Service, idx: number, isActive: boolean) => (
    <li
      key={s.id}
      className={`sv-row${drag === idx && isActive ? " dragging" : ""}${isActive && over === idx && drag !== null && drag !== idx ? (drag < idx ? " drop-after" : " drop-before") : ""}${s.archived ? " archived" : ""}`}
      onDragOver={(e) => {
        if (!isActive || drag === null) return;
        e.preventDefault();
        setOver(idx);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (isActive && drag !== null) void reorder(drag, idx);
        setDrag(null);
        setOver(null);
      }}
    >
      {ws.canWrite && isActive ? (
        <span
          className="pe-grip"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", s.id);
            setDrag(idx);
          }}
          onDragEnd={() => {
            setDrag(null);
            setOver(null);
          }}
          title="Glisser pour réordonner"
          aria-hidden
        >
          <GripVertical size={14} />
        </span>
      ) : (
        <span />
      )}
      <button type="button" className="sv-main" onClick={() => ws.canWrite && setEdit({ id: s.id, name: s.name, description: s.description, unit_price: String(s.unit_price), billing: s.billing })} disabled={!ws.canWrite}>
        <span className="sv-name">{s.name}</span>
        {s.description && <span className="sv-desc faint">{s.description}</span>}
      </button>
      <span className="sv-bill">
        <Badge color={s.billing === "monthly" ? "var(--blue)" : "var(--gray)"} plain>
          {s.billing === "monthly" ? "Mensuel" : "Ponctuel"}
        </Badge>
      </span>
      <span className="sv-price num">
        {money(s.unit_price, cur)}
        {s.billing === "monthly" && <small className="faint"> / mois</small>}
      </span>
      <span className="sv-use faint" title="Lignes de propositions qui utilisent ce service">
        {usage[s.id] ? `${usage[s.id]} proposition${usage[s.id] > 1 ? "s" : ""}` : "Jamais utilisé"}
      </span>
      {ws.canWrite ? (
        <span className="sv-act">
          {isActive && (
            <>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={idx === 0} onClick={() => void reorder(idx, idx - 1)} aria-label={`Monter ${s.name}`}>
                <ArrowUp size={13} />
              </button>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={idx === active.length - 1} onClick={() => void reorder(idx, idx + 1)} aria-label={`Descendre ${s.name}`}>
                <ArrowDown size={13} />
              </button>
            </>
          )}
          <Menu
            align="end"
            trigger={(open) => (
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label={`Actions pour ${s.name}`}>
                <Pencil size={13} />
              </button>
            )}
            items={[
              { label: "Modifier", icon: <Pencil size={14} />, onSelect: () => setEdit({ id: s.id, name: s.name, description: s.description, unit_price: String(s.unit_price), billing: s.billing }) },
              s.archived
                ? { label: "Réactiver", icon: <ArchiveRestore size={14} />, onSelect: () => setArchived(s, false) }
                : { label: "Archiver", icon: <Archive size={14} />, onSelect: () => setArchived(s, true) },
              { separator: true, label: "" },
              { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDel(s) },
            ]}
          />
        </span>
      ) : (
        <span />
      )}
    </li>
  );

  return (
    <div className="page sv-page">
      <PageHeader
        title="Catalogue de services"
        sub="Tes prestations et leurs tarifs de base : on les ajoute en un clic dans une proposition, puis on ajuste le prix au cas par cas."
      >
        {ws.canWrite && (
          <button className="btn btn-primary" onClick={() => setEdit({ name: "", description: "", unit_price: "", billing: "monthly" })}>
            <Plus size={14} />
            Nouveau service
          </button>
        )}
      </PageHeader>

      {active.length > 0 && (
        <div className="stats sv-stats">
          <div className="stat">
            <div className="k">Services actifs</div>
            <div className="v">{active.length}</div>
          </div>
          <div className="stat">
            <div className="k">Mensuels</div>
            <div className="v">{monthly.length}</div>
            <div className="d">{monthly.length ? `de ${money(Math.min(...monthly.map((s) => s.unit_price)), cur)} à ${money(Math.max(...monthly.map((s) => s.unit_price)), cur)}` : "Aucun"}</div>
          </div>
          <div className="stat">
            <div className="k">Ponctuels</div>
            <div className="v">{active.length - monthly.length}</div>
          </div>
        </div>
      )}

      <div className="card sv-card">
        {active.length === 0 ? (
          <EmptyState icon="receipt" title="Aucun service actif" text="Ajoute tes prestations (audit, setup tracking, gestion Meta Ads…) pour les insérer en un clic dans tes propositions.">
            {ws.canWrite && (
              <button className="btn btn-primary" onClick={() => setEdit({ name: "", description: "", unit_price: "", billing: "monthly" })}>
                <Plus size={14} />
                Ajouter un service
              </button>
            )}
          </EmptyState>
        ) : (
          <ul className="sv-list">{active.map((s, i) => row(s, i, true))}</ul>
        )}
      </div>

      {archived.length > 0 && (
        <div className="sv-archived">
          <button type="button" className="add-row" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            <Archive size={14} />
            {showArchived ? "Masquer" : "Afficher"} les services archivés ({archived.length})
          </button>
          {showArchived && (
            <div className="card sv-card">
              <ul className="sv-list">{archived.map((s, i) => row(s, i, false))}</ul>
            </div>
          )}
          <p className="faint sv-note">Un service archivé n&apos;apparaît plus dans le catalogue des propositions, mais les propositions existantes le conservent.</p>
        </div>
      )}

      {edit && (
        <Modal
          title={edit.id ? "Modifier le service" : "Nouveau service"}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEdit(null)}>
                Annuler
              </button>
              <button className="btn btn-primary" type="submit" form="sv-form" disabled={!edit.name.trim()}>
                {edit.id ? "Enregistrer" : "Ajouter"}
              </button>
            </>
          }
        >
          <form
            id="sv-form"
            className="sv-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
          >
            <div className="field">
              <label htmlFor="sv-name">Nom</label>
              <input id="sv-name" className="input" autoFocus placeholder="Gestion Meta Ads" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="sv-desc">Description</label>
              <textarea
                id="sv-desc"
                className="textarea"
                rows={3}
                placeholder="Ce qui est inclus, tel que le client le lira dans la proposition"
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              />
            </div>
            <div className="sv-form-row">
              <div className="field">
                <label htmlFor="sv-price">Prix HT ({cur})</label>
                <input id="sv-price" className="input" inputMode="decimal" placeholder="1500" value={edit.unit_price} onChange={(e) => setEdit({ ...edit, unit_price: e.target.value })} />
              </div>
              <div className="field">
                <span className="label" id="sv-bill-l">
                  Facturation
                </span>
                <div className="seg" role="radiogroup" aria-labelledby="sv-bill-l">
                  {(["monthly", "one_off"] as const).map((b) => (
                    <button type="button" key={b} role="radio" aria-checked={edit.billing === b} className={edit.billing === b ? "on" : ""} onClick={() => setEdit({ ...edit, billing: b })}>
                      {b === "monthly" ? "Mensuel" : "Ponctuel"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </form>
        </Modal>
      )}
      {del && (
        <ConfirmModal
          title="Supprimer ce service ?"
          text={
            usage[del.id]
              ? `« ${del.name} » est utilisé dans ${usage[del.id]} proposition${usage[del.id] > 1 ? "s" : ""}. Les lignes existantes sont conservées, seul le lien au catalogue disparaît. Pour simplement le masquer, archive-le.`
              : `« ${del.name} » sera retiré du catalogue.`
          }
          onConfirm={async () => {
            setList((l) => l.filter((x) => x.id !== del.id));
            await mutate(async (sb) => must(await sb.from("services").delete().eq("id", del.id)), { success: "Service supprimé" });
          }}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  );
}
