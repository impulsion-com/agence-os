"use client";

// Accueil des Docs : recherche dans les titres et le texte, les espaces, les pages récentes.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText, FolderPlus, Plus, Search, Upload } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/ui/misc";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import { likeSafe } from "@/lib/docs/search";
import { UNTITLED, excerpt } from "@/lib/docs/types";
import { useDocs } from "./docs-shell";

interface Hit {
  id: string;
  title: string;
  icon: string | null;
  space_id: string;
  excerpt: string;
  inTitle: boolean;
}

export function DocsHome() {
  const ws = useWorkspace();
  const docs = useDocs();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      const s = likeSafe(term);
      const { data } = await supabaseBrowser()
        .from("doc_pages")
        .select("id, title, icon, space_id, plain, updated_at")
        .eq("workspace_id", ws.workspace.id)
        .is("deleted_at", null)
        .or(`title.ilike.%${s}%,plain.ilike.%${s}%`)
        .order("updated_at", { ascending: false })
        .limit(30);
      const low = term.toLowerCase();
      setHits(
        (data ?? [])
          .map((p) => ({ id: p.id, title: p.title, icon: p.icon, space_id: p.space_id, excerpt: excerpt(p.plain, term), inTitle: p.title.toLowerCase().includes(low) }))
          .sort((a, b) => Number(b.inTitle) - Number(a.inTitle)),
      );
    }, 180);
    return () => clearTimeout(t);
  }, [term, ws.workspace.id]);

  const recent = useMemo(() => [...docs.pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 10), [docs.pages]);
  const count = (spaceId: string) => docs.pages.filter((p) => p.space_id === spaceId).length;

  return (
    <div className="docs-home">
      <PageHeader title="Docs & process" sub="Les process, checklists et la documentation de l'agence, au même endroit que le travail.">
        {ws.canWrite && docs.spaces.length > 0 && (
          <button className="btn" onClick={() => docs.openImport()}>
            <Upload size={14} /> Importer depuis Notion
          </button>
        )}
      </PageHeader>

      {!docs.spaces.length ? (
        <EmptyState icon="book-open" title="Pas encore de docs" text="Commence par un espace (Process, Agence, Clients…), puis écris ta première page ou importe tes pages Notion.">
          {ws.canWrite && (
            <button className="btn btn-primary" onClick={() => docs.editSpace("new")}>
              <FolderPlus size={14} /> Créer un espace
            </button>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="searchbox docs-search">
            <Search size={15} className="faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher dans les titres et le texte des pages" aria-label="Rechercher dans les docs" />
          </div>

          {term.length >= 2 ? (
            <section className="docs-section">
              <h2>Résultats</h2>
              {hits && !hits.length && <p className="faint">Aucune page ne contient « {term} ».</p>}
              {hits?.map((h) => {
                const s = docs.space(h.space_id);
                return (
                  <Link key={h.id} href={`${ws.base}/docs/${h.id}`} className="docs-hit">
                    <span className="docs-hit-t">
                      {h.icon ? <span className="docs-emoji">{h.icon}</span> : <FileText size={14} className="faint" />}
                      <b className="trunc">{h.title || UNTITLED}</b>
                      {s && <span className="faint">{s.icon} {s.name}</span>}
                    </span>
                    {h.excerpt && <span className="faint docs-hit-x">{h.excerpt}</span>}
                  </Link>
                );
              })}
            </section>
          ) : (
            <>
              <section className="docs-section">
                <h2>Espaces</h2>
                <div className="docs-spaces">
                  {docs.spaces.map((s) => (
                    <div key={s.id} className="card docs-space-card">
                      <div className="docs-space-card-h">
                        <span className="docs-space-emoji">{s.icon ?? "📁"}</span>
                        <b className="trunc">{s.name}</b>
                        <span className="count">{count(s.id)}</span>
                      </div>
                      {s.description && <p className="faint">{s.description}</p>}
                      <div className="docs-space-card-l">
                        {docs.children(`space:${s.id}`).slice(0, 4).map((p) => (
                          <Link key={p.id} href={`${ws.base}/docs/${p.id}`} className="docs-row">
                            {p.icon ? <span className="docs-emoji">{p.icon}</span> : <FileText size={14} className="faint" />}
                            <span className="trunc">{p.title || UNTITLED}</span>
                          </Link>
                        ))}
                      </div>
                      {ws.canWrite && (
                        <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => docs.newPage(s.id)}>
                          <Plus size={13} /> Nouvelle page
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {recent.length > 0 && (
                <section className="docs-section">
                  <h2>Modifiées récemment</h2>
                  <div className="card docs-recent">
                    {recent.map((p) => {
                      const s = docs.space(p.space_id);
                      return (
                        <Link key={p.id} href={`${ws.base}/docs/${p.id}`} className="docs-recent-row">
                          {p.icon ? <span className="docs-emoji">{p.icon}</span> : <FileText size={14} className="faint" />}
                          <span className="trunc" style={{ flex: 1 }}>{p.title || UNTITLED}</span>
                          {s && <span className="faint trunc docs-recent-s">{s.icon} {s.name}</span>}
                          <span className="faint docs-recent-w">
                            {ws.member(p.updated_by)?.profile.full_name ? `${ws.member(p.updated_by)!.profile.full_name}, ` : ""}
                            {ago(p.updated_at)}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
