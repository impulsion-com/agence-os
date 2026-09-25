"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Database, LogOut, Trash2 } from "lucide-react";

import { ConfirmModal, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { slugify } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Accent } from "@/lib/types";
import { ACCENTS } from "./preferences";
import { SetPage, SetRow, SetSection } from "./shell";

const CURRENCIES = [
  { id: "EUR", name: "Euro (€)" },
  { id: "USD", name: "Dollar américain ($)" },
  { id: "GBP", name: "Livre sterling (£)" },
  { id: "CHF", name: "Franc suisse (CHF)" },
  { id: "CAD", name: "Dollar canadien (CA$)" },
  { id: "MAD", name: "Dirham marocain (MAD)" },
  { id: "XOF", name: "Franc CFA (XOF)" },
  { id: "MUR", name: "Roupie mauricienne (MUR)" },
];

export function WorkspaceSettings({ hasDemo }: { hasDemo: boolean }) {
  const ws = useWorkspace();
  const router = useRouter();
  const mutate = useMutate();
  const toast = useToast();
  const w = ws.workspace;
  const [name, setName] = useState(w.name);
  const [slug, setSlug] = useState(w.slug);
  const [accent, setAccent] = useState<Accent>(w.accent);
  const [currency, setCurrency] = useState(w.currency);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<"load" | "clear" | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const owners = ws.members.filter((m) => m.role === "owner").length;
  const isOwner = ws.role === "owner";
  const slugOk = /^[a-z0-9-]{2,40}$/.test(slug);
  const dirty = name.trim() !== w.name || slug !== w.slug || accent !== w.accent || currency !== w.currency;
  const ro = !ws.isAdmin;

  const save = async () => {
    if (!name.trim()) return toast("Donne un nom à l'espace", { error: true });
    if (!slugOk) return toast("L'adresse ne peut contenir que des minuscules, chiffres et tirets (2 à 40 caractères)", { error: true });
    setBusy(true);
    const ok = await mutate(
      async (sb) => {
        const res = await sb.from("workspaces").update({ name: name.trim(), slug, accent, currency }).eq("id", w.id).select("id");
        if (res.error?.code === "23505") throw new Error("Cette adresse est déjà prise par un autre espace");
        must(res);
        return true;
      },
      { success: "Espace enregistré", refresh: slug === w.slug },
    );
    setBusy(false);
    if (ok && slug !== w.slug) router.replace(`/w/${slug}/settings/workspace`);
  };

  const runDemo = async (kind: "load" | "clear") => {
    setDemoBusy(true);
    await mutate(
      async (sb) => {
        const { error } = kind === "load" ? await sb.rpc("load_demo_data", { ws: w.id }) : await sb.rpc("clear_demo_data", { ws: w.id });
        if (error) throw new Error(error.message);
      },
      { success: kind === "load" ? "Données de démo chargées" : "Données de démo supprimées" },
    );
    setDemoBusy(false);
  };

  return (
    <SetPage title="Espace de travail" lead={ro ? "Seuls les propriétaires et admins peuvent modifier ces réglages." : "Les réglages communs à tous les membres de l'espace."}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <SetSection title="Général">
          <SetRow label="Nom de l'espace" hint="En général, le nom de ton agence." htmlFor="ws-name">
            <input id="ws-name" className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={ro} />
          </SetRow>
          <SetRow
            label="Adresse"
            hint={
              <>
                L&apos;URL de l&apos;espace : <span className="mono">/w/{slug || "…"}</span>. La changer casse les liens déjà partagés.
              </>
            }
            htmlFor="ws-slug"
          >
            <input
              id="ws-slug"
              className="input mono"
              value={slug}
              onChange={(e) => setSlug(slugify(e.target.value).replace(/^-+/, ""))}
              disabled={ro}
              aria-invalid={!slugOk}
              style={!slugOk ? { borderColor: "var(--red)" } : undefined}
            />
          </SetRow>
          <SetRow label="Accent par défaut" hint="Appliqué aux membres qui n'ont pas choisi le leur, et aux propositions et rapports partagés.">
            <div className="swatches" role="radiogroup" aria-label="Accent par défaut">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={accent === a.id}
                  aria-label={a.name}
                  title={a.name}
                  disabled={ro}
                  className={`swatch${accent === a.id ? " on" : ""}`}
                  style={{ ["--c" as string]: a.color }}
                  onClick={() => setAccent(a.id)}
                >
                  {accent === a.id && <Check size={13} strokeWidth={3} />}
                </button>
              ))}
            </div>
          </SetRow>
          <SetRow label="Devise" hint="Montants des deals, propositions et du reporting." htmlFor="ws-cur">
            <select id="ws-cur" className="select" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={ro}>
              {CURRENCIES.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </SetRow>
          {!ro && (
            <div className="set-actions" style={{ paddingTop: 16 }}>
              <button type="submit" className="btn btn-primary" disabled={!dirty || busy}>
                Enregistrer
              </button>
              {dirty && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setName(w.name);
                    setSlug(w.slug);
                    setAccent(w.accent);
                    setCurrency(w.currency);
                  }}
                >
                  Annuler
                </button>
              )}
            </div>
          )}
        </SetSection>
      </form>

      {ws.isAdmin && (
        <SetSection title="Données de démonstration">
          <SetRow
            label={hasDemo ? "Données de démo présentes" : "Aucune donnée de démo"}
            hint="Une agence fictive complète (7 clients et prospects, 5 projets, deals, propositions et 90 jours de métriques publicitaires) pour découvrir l'outil ou le montrer."
          >
            {hasDemo ? (
              <button type="button" className="btn" onClick={() => setDemo("clear")} disabled={demoBusy}>
                <Trash2 size={14} />
                Supprimer la démo
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setDemo("load")} disabled={demoBusy}>
                <Database size={14} />
                {demoBusy ? "Chargement…" : "Charger la démo"}
              </button>
            )}
          </SetRow>
        </SetSection>
      )}

      <SetSection title="Zone de danger">
        <div className="danger-zone">
          <SetRow
            label="Quitter l'espace"
            hint={isOwner && owners <= 1 ? "Tu es le seul propriétaire : nomme un autre propriétaire avant de partir." : "Tu perdras l'accès à cet espace jusqu'à une nouvelle invitation."}
          >
            <button type="button" className="btn" onClick={() => setLeaving(true)} disabled={isOwner && owners <= 1}>
              <LogOut size={14} />
              Quitter
            </button>
          </SetRow>
          {isOwner && (
            <SetRow label="Supprimer l'espace" hint="Supprime définitivement projets, tâches, CRM, propositions et rapports. Irréversible.">
              <button type="button" className="btn btn-danger" onClick={() => setDeleting(true)}>
                <Trash2 size={14} />
                Supprimer l&apos;espace
              </button>
            </SetRow>
          )}
        </div>
      </SetSection>

      {demo === "load" && (
        <ConfirmModal
          title="Charger les données de démo ?"
          text="Des clients, projets, tâches, deals, propositions et métriques fictifs seront ajoutés à côté de tes données. Tu pourras les supprimer en un clic."
          confirmLabel="Charger la démo"
          danger={false}
          onClose={() => setDemo(null)}
          onConfirm={() => runDemo("load")}
        />
      )}
      {demo === "clear" && (
        <ConfirmModal
          title="Supprimer les données de démo ?"
          text="Les entreprises de démo et tout ce qui leur est rattaché (projets, tâches, deals, propositions, comptes publicitaires) seront supprimés. Tes propres données ne sont pas touchées."
          confirmLabel="Supprimer la démo"
          onClose={() => setDemo(null)}
          onConfirm={() => runDemo("clear")}
        />
      )}
      {leaving && (
        <ConfirmModal
          title={`Quitter ${w.name} ?`}
          text="Tu n'auras plus accès à ses projets ni à son CRM. Un admin pourra t'inviter de nouveau."
          confirmLabel="Quitter l'espace"
          onClose={() => setLeaving(false)}
          onConfirm={async () => {
            const ok = await mutate(async (sb) => must(await sb.from("workspace_members").delete().eq("workspace_id", w.id).eq("user_id", ws.me.id).select("user_id")), { refresh: false });
            if (ok) router.replace("/");
          }}
        />
      )}
      {deleting && (
        <Modal
          title="Supprimer définitivement l'espace"
          onClose={() => {
            setDeleting(false);
            setConfirmName("");
          }}
          footer={
            <>
              <button className="btn" onClick={() => setDeleting(false)}>Annuler</button>
              <button
                className="btn btn-danger"
                disabled={confirmName !== w.name}
                onClick={async () => {
                  const ok = await mutate(async (sb) => must(await sb.from("workspaces").delete().eq("id", w.id).select("id")), { refresh: false });
                  if (ok) router.replace("/");
                }}
              >
                Supprimer pour toujours
              </button>
            </>
          }
        >
          <p className="muted">
            Toutes les données de <b>{w.name}</b> seront effacées pour les {ws.members.length} membre{ws.members.length > 1 ? "s" : ""}. Pour confirmer, saisis le nom de l&apos;espace.
          </p>
          <input className="input" autoFocus value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={w.name} aria-label="Nom de l'espace" />
        </Modal>
      )}
    </SetPage>
  );
}
