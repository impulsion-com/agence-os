"use client";

import { ArrowRight, CalendarPlus, ClipboardList, Clock3, Download, FileSignature, FileText, Video } from "lucide-react";

import { Badge, Progress } from "@/components/ui/misc";
import { fmtDate } from "@/lib/format";
import type { PortalBooking, PortalOnboardingForm, PortalProposal } from "@/lib/portal/types";
import { usePortal } from "./context";
import { Empty, LocalTime } from "./bits";

const day = (ts: string | null) => (ts ? fmtDate(new Date(ts), true) : "");

function proposalState(p: PortalProposal): { name: string; color: string } {
  if (p.status === "accepted") return p.signed_at ? { name: "Signée", color: "var(--green)" } : { name: "Acceptée", color: "var(--green)" };
  if (p.status === "declined") return { name: "Refusée", color: "var(--red)" };
  if (p.expired || p.status === "expired") return { name: "Expirée", color: "var(--gray)" };
  return { name: "À signer", color: "var(--amber)" };
}

const FORM_STATE: Record<PortalOnboardingForm["status"], { name: string; color: string }> = {
  sent: { name: "À remplir", color: "var(--amber)" },
  in_progress: { name: "En cours", color: "var(--blue)" },
  completed: { name: "Terminé", color: "var(--green)" },
};

const PLACE: Record<string, string> = { google_meet: "Visio Google Meet", phone: "Par téléphone", video: "Visio", address: "Sur place" };

/**
 * Documents : propositions (signature et PDF signé), formulaire d'accueil, prise de rendez-vous.
 * Chaque bloc n'est fourni que si sa fonctionnalité est ouverte (null sinon).
 */
export function DocumentsView({
  proposals,
  forms,
  booking,
}: {
  proposals: PortalProposal[] | null;
  forms: PortalOnboardingForm[] | null;
  booking: PortalBooking | null;
}) {
  const { ctx } = usePortal();
  return (
    <>
      <div className="ptl-ph">
        <div>
          <h1>Documents</h1>
          <p>Vos propositions, votre formulaire d&apos;accueil et vos rendez-vous avec {ctx.workspace.name}.</p>
        </div>
      </div>

      {proposals && (
        <>
          <div className="ptl-sec">
            <h2>
              Propositions <span className="count">{proposals.length}</span>
            </h2>
          </div>
          <div className="ptl-rows">
            {proposals.length === 0 ? (
              <Empty icon={<FileSignature size={18} />} title="Aucune proposition">
                Les propositions commerciales envoyées par {ctx.workspace.name} apparaîtront ici.
              </Empty>
            ) : (
              proposals.map((p) => {
                const st = proposalState(p);
                const open = (p.status === "sent" || p.status === "viewed") && !p.expired;
                return (
                  <div key={p.id} className="ptl-row" style={{ flexWrap: "wrap" }}>
                    <span className="ic" style={{ ["--c" as string]: st.color }}>
                      <FileSignature size={17} />
                    </span>
                    <span className="tx" style={{ minWidth: 180 }}>
                      <span className="t" style={{ display: "block" }}>{p.title}</span>
                      <span className="s">
                        <Badge color={st.color}>{st.name}</Badge>
                        {p.signed_at ? <span>signée le {day(p.signed_at)}</span> : p.accepted_at ? <span>acceptée le {day(p.accepted_at)}</span> : p.sent_at ? <span>reçue le {day(p.sent_at)}</span> : null}
                        {open && p.valid_until && <span>valable jusqu&apos;au {fmtDate(p.valid_until, true)}</span>}
                        {p.signed_at && p.countersign_required && !p.countersigned_at && <span>contre-signature de l&apos;agence en attente</span>}
                      </span>
                    </span>
                    <span className="end" style={{ color: "inherit", flexWrap: "wrap" }}>
                      {p.signed_at && (
                        <a className="btn" href={`/api/signature/${p.token}/pdf`}>
                          <Download size={14} /> PDF signé
                        </a>
                      )}
                      <a className={`btn${open ? " btn-primary" : ""}`} href={`/p/${p.token}`} target="_blank" rel="noopener">
                        {open ? "Lire et signer" : "Consulter"} <ArrowRight size={14} />
                      </a>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {forms && (
        <>
          <div className="ptl-sec">
            <h2>Formulaire d&apos;accueil</h2>
          </div>
          <div className="ptl-rows">
            {forms.length === 0 ? (
              <Empty icon={<ClipboardList size={18} />} title="Aucun formulaire">
                Si {ctx.workspace.name} a besoin d&apos;informations pour démarrer, le formulaire apparaîtra ici.
              </Empty>
            ) : (
              forms.map((f) => {
                const st = FORM_STATE[f.status] ?? FORM_STATE.sent;
                const doneForm = f.status === "completed";
                return (
                  <div key={f.id} className="ptl-row" style={{ flexWrap: "wrap" }}>
                    <span className="ic" style={{ ["--c" as string]: st.color }}>
                      <ClipboardList size={17} />
                    </span>
                    <span className="tx" style={{ minWidth: 180 }}>
                      <span className="t" style={{ display: "block" }}>{f.title}</span>
                      <span className="s">
                        <Badge color={st.color}>{st.name}</Badge>
                        {doneForm && f.completed_at ? <span>envoyé le {day(f.completed_at)}</span> : f.sent_at ? <span>reçu le {day(f.sent_at)}</span> : null}
                      </span>
                    </span>
                    <span className="end" style={{ color: "inherit", flexWrap: "wrap" }}>
                      <span className="ptl-prog">
                        <Progress value={f.progress} color={doneForm ? "var(--green)" : undefined} />
                        <span className="n">{f.progress} %</span>
                      </span>
                      <a className={`btn${doneForm ? "" : " btn-primary"}`} href={`/f/${f.token}`} target="_blank" rel="noopener">
                        {doneForm ? "Revoir" : f.progress > 0 ? "Reprendre" : "Commencer"} <ArrowRight size={14} />
                      </a>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {booking && (
        <>
          <div className="ptl-sec">
            <h2>Rendez-vous</h2>
          </div>
          {booking.upcoming.length > 0 && (
            <div className="ptl-rows" style={{ marginBottom: 14 }}>
              {booking.upcoming.map((b) => (
                <div key={b.id} className="ptl-row" style={{ flexWrap: "wrap" }}>
                  <span className="ic">
                    <Clock3 size={17} />
                  </span>
                  <span className="tx" style={{ minWidth: 180 }}>
                    <span className="t" style={{ display: "block" }}>{b.title || "Rendez-vous"}</span>
                    <span className="s">
                      <span>
                        <LocalTime iso={b.start_at} mode="day" /> à <LocalTime iso={b.start_at} mode="time" />
                      </span>
                      {b.host && <span>avec {b.host}</span>}
                      <span>{b.location || PLACE[b.location_kind] || ""}</span>
                    </span>
                  </span>
                  <span className="end" style={{ color: "inherit", flexWrap: "wrap" }}>
                    {b.manage_token && (
                      <a className="btn" href={`/b/r/${b.manage_token}`} target="_blank" rel="noopener">
                        Reporter ou annuler
                      </a>
                    )}
                    {b.meet_url && (
                      <a className="btn btn-primary" href={b.meet_url} target="_blank" rel="noopener noreferrer">
                        <Video size={14} /> Rejoindre
                      </a>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {!booking.host ? (
            <div className="ptl-rows">
              <Empty icon={<CalendarPlus size={18} />} title="Prise de rendez-vous indisponible">
                Contactez directement {ctx.workspace.name} pour convenir d&apos;un créneau.
              </Empty>
            </div>
          ) : booking.types.length === 0 ? (
            <a className="ptl-type" href={`/b/${booking.host.slug}`} target="_blank" rel="noopener">
              <span className="t">
                Prendre rendez-vous avec {booking.host.name} <ArrowRight size={15} />
              </span>
              {booking.host.headline && <p>{booking.host.headline}</p>}
            </a>
          ) : (
            <div className="ptl-types">
              {booking.types.map((t) => (
                <a key={t.slug} className="ptl-type" href={`/b/${booking.host!.slug}/${t.slug}`} target="_blank" rel="noopener">
                  <span className="t">
                    {t.name} <ArrowRight size={15} className="faint" />
                  </span>
                  {t.description && <p>{t.description}</p>}
                  <span className="m">
                    <span>
                      <Clock3 size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {t.duration_min} min
                    </span>
                    <span>{PLACE[t.location_kind] ?? ""}</span>
                    <span>avec {booking.host!.name.split(/\s+/)[0]}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {!proposals && !forms && !booking && (
        <div className="card">
          <Empty icon={<FileText size={18} />} title="Aucun document disponible" />
        </div>
      )}
    </>
  );
}
