"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleHelp, Download, Palette, PenLine, Play, Send } from "lucide-react";

import { KINDS, kindOf } from "@/components/projects/files-types";
import { Drawer } from "@/components/ui/overlay";
import { FORMAT, platformLabel } from "@/lib/creatives/constants";
import { ago, fileSize, fmtDate } from "@/lib/format";
import type { PortalCreativeDetail, PortalCreativeItem } from "@/lib/portal/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePortal, usePortalAction, useUrlParam } from "./context";
import { Empty, PortalText, PreviewLock, REVIEW, ReviewBadge, useIsClient } from "./bits";

const formatName = (f: string) => FORMAT[f as keyof typeof FORMAT]?.name ?? "Créa";

/** Créas soumises par l'agence : à approuver ou à faire modifier. Ni métriques ni notes internes. */
export function CreativesView({ items }: { items: PortalCreativeItem[] }) {
  const { ctx, file } = usePortal();
  const [open, setOpen] = useUrlParam("c");
  const client = useIsClient(); // le tiroir se rend dans <body> : jamais côté serveur
  const pending = items.filter((c) => c.review === "pending");
  const decided = items.filter((c) => c.review !== "pending");

  const card = (c: PortalCreativeItem) => (
    <button key={c.id} type="button" className={`ptl-ccard ${c.review}`} onClick={() => setOpen(c.id)}>
      <span className="ptl-cprev">
        {c.cover?.mime.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file("asset", c.cover.id)} alt="" loading="lazy" />
        ) : c.cover ? (
          <>
            <video src={`${file("asset", c.cover.id)}#t=0.1`} preload="metadata" muted playsInline />
            <span className="play">
              <Play size={18} fill="currentColor" />
            </span>
          </>
        ) : (
          <span className="ph">
            <Palette size={22} />
            {c.hook && <span className="hook">« {c.hook} »</span>}
          </span>
        )}
        <span className="st">
          <ReviewBadge review={c.review} short />
        </span>
      </span>
      <span className="inf">
        <span className="t">{c.title}</span>
        <span className="m">
          <span>{formatName(c.format)}</span>
          {c.platforms.length > 0 && <span>{c.platforms.map(platformLabel).join(", ")}</span>}
          {c.assets > 0 && (
            <span>
              {c.assets} fichier{c.assets > 1 ? "s" : ""}
            </span>
          )}
        </span>
      </span>
    </button>
  );

  return (
    <>
      <div className="ptl-ph">
        <div>
          <h1>Créas</h1>
          <p>Les créations publicitaires que {ctx.workspace.name} vous soumet avant diffusion.</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <Empty icon={<Palette size={18} />} title="Aucune créa à valider">
            Les visuels et vidéos soumis par {ctx.workspace.name} apparaîtront ici.
          </Empty>
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <div className="ptl-sec">
                <h2>
                  À valider <span className="count hot">{pending.length}</span>
                </h2>
              </div>
              <div className="ptl-cgrid">{pending.map(card)}</div>
            </>
          )}
          {decided.length > 0 && (
            <>
              <div className="ptl-sec">
                <h2>
                  Déjà traitées <span className="count">{decided.length}</span>
                </h2>
              </div>
              <div className="ptl-cgrid">{decided.map(card)}</div>
            </>
          )}
        </>
      )}

      {open && client && <CreativePanel key={open} id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function CreativePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { companyId, preview, file } = usePortal();
  const act = usePortalAction();
  const [c, setC] = useState<PortalCreativeDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [sel, setSel] = useState(0);
  const [asking, setAsking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().rpc("portal_creative", { p_company: companyId, p_concept: id });
    if (error || !data) setMissing(true);
    else setC(data as unknown as PortalCreativeDetail);
  }, [companyId, id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement de la fiche à l'ouverture du tiroir
    void load();
  }, [load]);

  const decide = async (approve: boolean) => {
    if (!approve && !feedback.trim()) return;
    setBusy(true);
    const ok = await act(
      (sb) => sb.rpc("portal_creative_review", { p_company: companyId, p_concept: id, p_approve: approve, p_feedback: feedback }),
      approve ? "Créa approuvée, merci !" : "Votre demande a été transmise à l'agence",
    );
    setBusy(false);
    if (ok) {
      setAsking(false);
      setFeedback("");
      await load();
    }
  };

  const media = c?.assets.filter((a) => a.mime.startsWith("image/") || a.mime.startsWith("video/")) ?? [];
  const others = c?.assets.filter((a) => !a.mime.startsWith("image/") && !a.mime.startsWith("video/")) ?? [];
  const cur = media[Math.min(sel, Math.max(0, media.length - 1))];
  // Décisions antérieures à la décision courante (celle-ci est affichée dans l'encadré)
  const current = c && c.review !== "pending" && c.reviewed_at ? new Date(c.reviewed_at).getTime() : null;
  const past = c?.history.filter((h) => h.verb === "creative.reviewed" && (current === null || Math.abs(new Date(h.at).getTime() - current) > 5000)) ?? [];

  return (
    <Drawer
      onClose={onClose}
      header={<span className="ptl-d-head">{c ? <ReviewBadge review={c.review} /> : "Créa"}</span>}
    >
      {missing ? (
        <Empty icon={<CircleHelp size={18} />} title="Créa introuvable">
          Cette créa n&apos;est plus soumise à votre validation.
        </Empty>
      ) : !c ? (
        <div className="ptl-skel" aria-busy>
          <span className="sk" style={{ width: "100%", height: 260 }} />
          <span className="sk" style={{ width: "70%", height: 24 }} />
          <span className="sk" style={{ width: "90%" }} />
        </div>
      ) : (
        <div className="ptl-d">
          {media.length > 0 && cur && (
            <div className="ptl-media" style={{ marginBottom: 18 }}>
              <div className="main">
                {cur.mime.startsWith("video/") ? (
                  <video key={cur.id} src={file("asset", cur.id)} controls playsInline preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={cur.id} src={file("asset", cur.id)} alt={cur.name} />
                )}
              </div>
              {media.length > 1 && (
                <div className="strip" role="tablist" aria-label="Fichiers de la créa">
                  {media.map((a, i) => (
                    <button key={a.id} type="button" role="tab" aria-selected={i === sel} className={`th${i === sel ? " on" : ""}`} onClick={() => setSel(i)} title={a.variant ? `${a.name} (${a.variant})` : a.name}>
                      {a.mime.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={file("asset", a.id)} alt="" loading="lazy" />
                      ) : (
                        <Play size={16} />
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="faint" style={{ fontSize: "var(--fs-xs)", display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span className="trunc">
                  {cur.name}
                  {cur.variant ? ` · variante « ${cur.variant} »` : ""}
                </span>
                <a href={file("asset", cur.id, { download: true })} style={{ display: "inline-flex", gap: 4, alignItems: "center", whiteSpace: "nowrap", color: "var(--accent)", fontWeight: 500 }}>
                  <Download size={12} /> Télécharger
                </a>
              </div>
            </div>
          )}

          <h2>{c.title}</h2>
          <div className="sub">
            <span>{formatName(c.format)}</span>
            {c.platforms.length > 0 && <span>{c.platforms.map(platformLabel).join(", ")}</span>}
            {c.angle && <span>Angle : {c.angle}</span>}
          </div>

          {c.review === "pending" ? (
            <div className="ptl-callout">
              <div className="q">
                <PenLine size={16} /> Cette créa attend votre validation
              </div>
              <div className="hint">Approuvez-la pour lancer la suite, ou indiquez ce que vous souhaitez voir modifié.</div>
              {asking && (
                <textarea
                  className="textarea"
                  autoFocus
                  rows={4}
                  placeholder="Décrivez les modifications souhaitées…"
                  value={feedback}
                  maxLength={4000}
                  onChange={(e) => setFeedback(e.target.value)}
                  aria-label="Modifications souhaitées"
                />
              )}
              <div className="acts">
                {asking ? (
                  <>
                    <button className="btn btn-primary" disabled={busy || preview || !feedback.trim()} onClick={() => void decide(false)}>
                      <Send size={14} /> Envoyer la demande
                    </button>
                    <button className="btn" disabled={busy} onClick={() => setAsking(false)}>
                      Annuler
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn ptl-btn-ok" disabled={busy || preview} onClick={() => void decide(true)} title={preview ? "Désactivé en aperçu" : undefined}>
                      <CircleCheck size={15} /> Approuver
                    </button>
                    <button className="btn" disabled={busy || preview} onClick={() => setAsking(true)} title={preview ? "Désactivé en aperçu" : undefined}>
                      <PenLine size={14} /> Demander des modifications
                    </button>
                  </>
                )}
              </div>
              {preview && (
                <div style={{ marginTop: 10 }}>
                  <PreviewLock>Aperçu : seul le client peut approuver ou demander des modifications.</PreviewLock>
                </div>
              )}
            </div>
          ) : (
            <div className={`ptl-callout ${c.review === "approved" ? "ok" : "warn"}`}>
              <div className="q">
                {c.review === "approved" ? <CircleCheck size={16} /> : <PenLine size={16} />}
                {c.review === "approved" ? "Créa approuvée" : "Modifications demandées"}
              </div>
              <div className="hint">
                {c.reviewed_by ? `Par ${c.reviewed_by}` : REVIEW[c.review].long}
                {c.reviewed_at ? `, le ${fmtDate(new Date(c.reviewed_at), true)}` : ""}.
                {c.review === "changes" && " L'agence vous soumettra une nouvelle version."}
              </div>
              {c.feedback.trim() && <blockquote>{c.feedback}</blockquote>}
            </div>
          )}

          {c.hook.trim() && (
            <>
              <h3>Accroche</h3>
              <div className="ptl-quote">{c.hook}</div>
            </>
          )}
          {c.variants.filter((v) => v.hook.trim() && v.hook !== c.hook).length > 0 && (
            <>
              <h3>Variantes d&apos;accroche</h3>
              <ul className="ptl-text" style={{ paddingLeft: 20, display: "grid", gap: 4 }}>
                {c.variants
                  .filter((v) => v.hook.trim() && v.hook !== c.hook)
                  .map((v) => (
                    <li key={v.id}>
                      <b>{v.name} :</b> {v.hook}
                    </li>
                  ))}
              </ul>
            </>
          )}
          {c.script.trim() && (
            <>
              <h3>Script</h3>
              <PortalText text={c.script} />
            </>
          )}
          {c.cta.trim() && (
            <>
              <h3>Appel à l&apos;action</h3>
              <p className="ptl-text">{c.cta}</p>
            </>
          )}

          {others.length > 0 && (
            <>
              <h3>Autres fichiers</h3>
              <div className="ptl-flist">
                {others.map((f) => {
                  const k = KINDS[kindOf(f.name, f.mime)];
                  return (
                    <a key={f.id} className="ptl-fline" href={file("asset", f.id)} target="_blank" rel="noopener">
                      <span className="ptl-fic" style={{ ["--c" as string]: k.color }}>
                        <k.icon size={15} />
                      </span>
                      <span className="nm">{f.name}</span>
                      <span className="sz">{fileSize(f.size)}</span>
                      <Download size={14} className="faint" />
                    </a>
                  );
                })}
              </div>
            </>
          )}

          {past.length > 0 && (
            <>
              <h3>Décisions précédentes</h3>
              <ul className="ptl-hist">
                {past.map((h, i) => (
                  <li key={i}>
                    <span className="pt" style={{ ["--c" as string]: h.decision === "approved" ? "var(--green)" : "var(--amber)" }} />
                    <span>
                      <b>{h.decision === "approved" ? "Approuvée" : "Modifications demandées"}</b> par {h.by}
                      <span className="w" suppressHydrationWarning> · {ago(h.at)}</span>
                      {h.feedback.trim() && <span style={{ display: "block", color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{h.feedback}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
