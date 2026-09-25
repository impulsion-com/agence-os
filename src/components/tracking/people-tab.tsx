"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Trash2, UserRound, UsersRound } from "lucide-react";

import { ConfirmModal } from "@/components/ui/overlay";
import { ago, fmtDate } from "@/lib/format";
import { fmtKpi } from "@/lib/ads/metrics";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Person, SiteRow } from "@/lib/tracking/load";
import { useQueryNav } from "./shared";

export function PeopleTab({ site, people, q }: { site: SiteRow; people: Person[]; q: string }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const go = useQueryNav();
  const [text, setText] = useState(q);
  const [del, setDel] = useState<Person | null>(null);
  const currency = ws.workspace.currency || "EUR";

  return (
    <>
      <div className="trk-filters">
        <form
          className="trk-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: text.trim() || null });
          }}
        >
          <Search size={14} className="faint" aria-hidden />
          <input className="input bare" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Rechercher un email ou un nom…" aria-label="Rechercher une personne" />
        </form>
        <span className="faint" style={{ fontSize: 12 }}>
          {people.length >= 100 ? "100 personnes les plus récentes" : `${people.length} personne${people.length > 1 ? "s" : ""}`}
          {q ? ` pour « ${q} »` : ""}
        </span>
      </div>

      <div className="card">
        {!people.length ? (
          <div className="empty" style={{ padding: 32 }}>
            <div className="ic">
              <UsersRound size={18} />
            </div>
            <h3>{q ? "Aucun résultat" : "Aucun visiteur identifié"}</h3>
            <p>
              {q
                ? "Aucune personne ne correspond à cette recherche."
                : "Un visiteur est identifié quand il remplit un formulaire avec son email, ou quand le site appelle aos('identify', …)."}
            </p>
          </div>
        ) : (
          <div className="rp-scroll">
            <table className="tbl rp-tbl trk-people" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>Téléphone</th>
                  <th className="r" title="Nombre d'appareils ou de navigateurs reliés à cet email">Appareils</th>
                  <th>Première visite</th>
                  <th>Dernière visite</th>
                  <th className="r">Achats</th>
                  <th className="r">CA</th>
                  {ws.canWrite && <th className="r"><span className="sr">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.email}>
                    <td style={{ maxWidth: 300 }}>
                      <span className="client">
                        <UserRound size={14} className="faint" />
                        <span style={{ minWidth: 0 }}>
                          <span className="trunc" style={{ display: "block", fontWeight: 500 }}>{p.email}</span>
                          <span className="sub trunc" style={{ display: "block" }}>
                            {p.name || "Nom inconnu"}
                            {p.contact_id && (
                              <>
                                {" · "}
                                <Link href={`${ws.base}/crm/contacts/${p.contact_id}`} style={{ textDecoration: "underline" }}>
                                  contact CRM
                                </Link>
                              </>
                            )}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="muted">{p.phone || <span className="fainter">–</span>}</td>
                    <td className="r">{p.visitors}</td>
                    <td className="muted" title={p.first_seen}>{fmtDate(p.first_seen.slice(0, 10))}</td>
                    <td className="muted" title={p.last_seen}>{ago(p.last_seen)}</td>
                    <td className="r">{p.purchases || <span className="fainter">0</span>}</td>
                    <td className="r">{p.revenue ? fmtKpi("value", p.revenue, currency) : <span className="fainter">–</span>}</td>
                    {ws.canWrite && (
                      <td className="r">
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setDel(p)} aria-label={`Supprimer les données de ${p.email}`} title="Supprimer ses données (RGPD)">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="trk-foot" style={{ padding: "12px 2px" }}>
        Les emails ne sont visibles que des membres de l&apos;espace. Aucune adresse IP n&apos;est conservée, seulement le pays. Sur demande d&apos;une personne (droit à
        l&apos;effacement), supprime ses données ici : visiteurs, points de contact et évènements sont effacés sur tous ses appareils.
      </p>

      {del && (
        <ConfirmModal
          title="Supprimer les données de cette personne ?"
          text={`Tous les visiteurs reliés à ${del.email} sur « ${site.name} » seront effacés, avec leurs points de contact, pages vues et conversions. Cette action est définitive.`}
          confirmLabel="Supprimer définitivement"
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await mutate(async (sb) => must(await sb.from("visitors").delete().eq("site_id", site.id).eq("email", del.email)), { success: "Données supprimées" });
          }}
        />
      )}
    </>
  );
}
