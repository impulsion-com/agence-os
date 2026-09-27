"use client";

import Link from "next/link";
import { ArrowLeft, CircleCheck, CircleX, Printer } from "lucide-react";

import "@/styles/creatives.css";
import { Crumbs } from "@/components/reporting/common";
import { fmtDate, initials, iso, today } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import { AWARE, FORMAT, platformLabel } from "@/lib/creatives/constants";
import type { Concept, Variant } from "@/lib/creatives/types";

const lines = (s?: string) => (s ?? "").split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

/** Brief créateur (UGC, vidéaste, designer) : document lisible et imprimable en PDF. */
export function BriefDoc({ concept: c, variants, company }: { concept: Concept; variants: Variant[]; company: { name: string; website: string; industry: string } | null }) {
  const ws = useWorkspace();
  const b = c.brief ?? {};
  const dos = lines(b.dos);
  const donts = lines(b.donts);
  const shots = lines(b.shots);
  const hooks = variants.filter((v) => v.hook.trim());
  return (
    <div className="crv-brief-page">
      <Crumbs items={[{ label: "Bibliothèque créa", href: `${ws.base}/creatives` }, { label: c.title, href: `${ws.base}/creatives/${c.id}` }, { label: "Brief créateur" }]} />
      <div className="crv-brief-bar crv-no-print">
        <Link href={`${ws.base}/creatives/${c.id}`} className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Retour au concept
        </Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={14} /> Imprimer ou enregistrer en PDF
        </button>
      </div>
      <article className="crv-brief">
        <header className="top">
          <div className="agency">
            <span className="mark">{initials(ws.workspace.name).slice(0, 1)}</span>
            {ws.workspace.name}
          </div>
          <span className="faint" style={{ fontSize: 12 }}>Brief créateur · {fmtDate(iso(today()), true)}</span>
        </header>
        <h1>{c.title}</h1>
        <div className="facts">
          <div>
            <span>Marque</span>
            <b>{company?.name ?? "–"}</b>
          </div>
          <div>
            <span>Format</span>
            <b>{FORMAT[c.format]?.name}</b>
          </div>
          <div>
            <span>Durée</span>
            <b>{b.duration || "–"}</b>
          </div>
          <div>
            <span>Diffusion</span>
            <b>{c.platforms.map(platformLabel).join(", ") || "–"}</b>
          </div>
        </div>

        {b.context && (
          <>
            <h2>Contexte marque</h2>
            <p className="txt">{b.context}</p>
            {company?.website && <p className="faint" style={{ marginTop: 6, fontSize: 13 }}>Site : {company.website}</p>}
          </>
        )}

        <h2>Angle et cible</h2>
        <div className="box">
          <p className="txt">
            <b>Angle :</b> {c.angle || "à préciser"}
            {c.persona ? (
              <>
                <br />
                <b>À qui on parle :</b> {c.persona}
              </>
            ) : null}
          </p>
          {c.awareness && (
            <p className="aware">
              <b>{AWARE[c.awareness].name}.</b> {AWARE[c.awareness].help}
            </p>
          )}
        </div>

        <h2>Le hook (3 premières secondes)</h2>
        <p className="hookq">« {c.hook || "à écrire"} »</p>
        {hooks.length > 1 && (
          <>
            <h2>Variantes de hook à tourner</h2>
            <div className="box vars">
              {hooks.map((v) => (
                <div key={v.id}>
                  <b>{v.name}</b>
                  <span>« {v.hook} »{v.notes ? ` (${v.notes})` : ""}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {b.script && (
          <>
            <h2>Script</h2>
            <div className="box">
              <p className="txt">{b.script}</p>
            </div>
          </>
        )}

        {shots.length > 0 && (
          <>
            <h2>Plans à tourner</h2>
            <ol className="shots">
              {shots.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </>
        )}

        {b.instructions && (
          <>
            <h2>Consignes</h2>
            <p className="txt">{b.instructions}</p>
          </>
        )}

        {(dos.length > 0 || donts.length > 0) && (
          <>
            <h2>À faire, à éviter</h2>
            <div className="dd">
              <div className="box do">
                <h3>
                  <CircleCheck size={15} /> À faire
                </h3>
                <ul>{dos.length ? dos.map((d, i) => <li key={i}>{d}</li>) : <li className="faint">Rien de particulier</li>}</ul>
              </div>
              <div className="box dont">
                <h3>
                  <CircleX size={15} /> À éviter
                </h3>
                <ul>{donts.length ? donts.map((d, i) => <li key={i}>{d}</li>) : <li className="faint">Rien de particulier</li>}</ul>
              </div>
            </div>
          </>
        )}

        {b.cta && (
          <>
            <h2>Appel à l&apos;action</h2>
            <p className="txt">{b.cta}</p>
          </>
        )}

        {b.references && (
          <>
            <h2>Références</h2>
            <p className="txt" style={{ wordBreak: "break-word" }}>{b.references}</p>
          </>
        )}

        <footer className="foot">
          <span>{ws.workspace.name} · {company?.name ?? ""}</span>
          <span>Document confidentiel, ne pas diffuser.</span>
        </footer>
      </article>
    </div>
  );
}
