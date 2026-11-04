"use client";

// Une page des Docs : icône, titre, contenu, sous-pages. Enregistrement automatique peu
// après la frappe (doc_save_page). Si quelqu'un d'autre a enregistré la page entre-temps,
// la base refuse (AO409) et on propose de recharger plutôt que d'écraser son travail.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Ellipsis, FileText, History, Plus, RotateCcw, Trash2 } from "lucide-react";

import { SetCrumbs } from "@/components/shell/crumbs";
import { Menu } from "@/components/ui/overlay";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { CONFLICT_CODE, PAGE_COLS, UNTITLED, type DocPage } from "@/lib/docs/types";
import { ancestors, useDocs } from "./docs-shell";
import { DocEditor } from "./editor";
import { HistoryModal } from "./history";

const SAVE_DELAY_MS = 800;

type State = "saved" | "dirty" | "saving" | "conflict" | "error";
type Fields = { title?: string; content?: string; plain?: string };

export function DocPageView({ initial }: { initial: DocPage }) {
  const ws = useWorkspace();
  const docs = useDocs();
  const router = useRouter();
  const mutate = useMutate();
  const id = initial.id;
  const [page, setPage] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [icon, setIcon] = useState(initial.icon ?? "");
  const [editIcon, setEditIcon] = useState(false);
  const [state, setState] = useState<State>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  // Remonte l'éditeur quand le contenu est remplacé de l'extérieur (restauration, rechargement)
  const [editorKey, setEditorKey] = useState(0);

  const readAt = useRef<string | null>(initial.version_at);
  const pending = useRef<Fields>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = ws.canWrite && !page.deleted_at;

  const reload = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data: p }, { data: v }] = await Promise.all([
      sb.from("doc_pages").select(PAGE_COLS).eq("id", id).maybeSingle(),
      sb.from("doc_versions").select("updated_at").eq("page_id", id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!p) return;
    pending.current = {};
    readAt.current = v?.updated_at ?? null;
    setPage({ ...p, version_at: readAt.current });
    setTitle(p.title);
    setIcon(p.icon ?? "");
    docs.patch(id, { title: p.title, icon: p.icon });
    setState("saved");
    setMessage(null);
    setEditorKey((k) => k + 1);
  }, [id, docs]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const f = pending.current;
    if (!Object.keys(f).length) return;
    pending.current = {};
    setState("saving");
    const { data, error } = await supabaseBrowser().rpc("doc_save_page", {
      p_id: id, p_title: f.title, p_content: f.content, p_plain: f.plain, p_read: readAt.current ?? undefined,
    });
    if (error) {
      pending.current = { ...f, ...pending.current };
      setState(error.code === CONFLICT_CODE ? "conflict" : "error");
      setMessage(error.message);
      return;
    }
    readAt.current = ((data as { version_at?: string } | null)?.version_at) ?? readAt.current;
    setState(Object.keys(pending.current).length ? "dirty" : "saved");
  }, [id]);

  const schedule = useCallback(
    (f: Fields) => {
      pending.current = { ...pending.current, ...f };
      setState((s) => (s === "conflict" ? s : "dirty"));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  // Rien ne se perd en changeant de page ; en fermant l'onglet, le navigateur prévient
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("beforeunload", before);
      void flush();
    };
  }, [flush]);

  const changeTitle = (t: string) => {
    setTitle(t);
    docs.patch(id, { title: t });
    schedule({ title: t });
  };
  const changeIcon = (i: string) => {
    setIcon(i);
    docs.patch(id, { icon: i || null });
  };
  const saveIcon = () => {
    setEditIcon(false);
    if ((page.icon ?? "") === icon) return;
    setPage((p) => ({ ...p, icon: icon || null }));
    void mutate(async (sb) => must(await sb.from("doc_pages").update({ icon: icon || null }).eq("id", id)), { refresh: false });
  };

  const trash = async () => {
    await flush();
    await mutate(async (sb) => must(await sb.rpc("doc_trash_page", { p_id: id })), { success: "Page mise à la corbeille" });
    router.push(page.parent_id ? `${ws.base}/docs/${page.parent_id}` : `${ws.base}/docs`);
  };
  const restore = async () => {
    await mutate(async (sb) => must(await sb.rpc("doc_restore_page", { p_id: id })), { success: "Page restaurée" });
    await reload();
  };

  const space = docs.space(page.space_id);
  const parents = ancestors(docs, id);
  const subpages = docs.children(id);
  const author = ws.member(page.updated_by)?.profile.full_name;
  const creator = ws.member(page.created_by)?.profile.full_name;

  return (
    <div className="docs-page">
      <SetCrumbs
        items={[
          { label: "Docs", href: `${ws.base}/docs` },
          ...(space ? [{ label: `${space.icon ? space.icon + " " : ""}${space.name}` }] : []),
          ...parents.map((p) => ({ label: `${p.icon ? p.icon + " " : ""}${p.title || UNTITLED}`, href: `${ws.base}/docs/${p.id}` })),
          { label: title || UNTITLED },
        ]}
      />

      <div className="docs-bar">
        <span className="docs-status" aria-live="polite">
          {state === "saving" ? "Enregistrement…" : state === "dirty" ? "Modifié" : state === "saved" && editable ? "Enregistré" : null}
        </span>
        <button className="btn btn-ghost btn-sm btn-icon" title="Historique des versions" aria-label="Historique des versions" onClick={() => setHistory(true)}>
          <History size={15} />
        </button>
        <Menu
          align="end"
          trigger={(o) => (
            <button className="btn btn-ghost btn-sm btn-icon" onClick={o} aria-label="Actions de la page">
              <Ellipsis size={15} />
            </button>
          )}
          items={[
            {
              label: copied ? "Lien copié" : "Copier le lien",
              icon: copied ? <Check size={14} /> : <Copy size={14} />,
              onSelect: () => {
                navigator.clipboard?.writeText(`${location.origin}${ws.base}/docs/${id}`).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
            },
            { label: "Historique des versions", icon: <History size={14} />, onSelect: () => setHistory(true) },
            ...(editable
              ? [
                  { label: "Ajouter une sous-page", icon: <Plus size={14} />, onSelect: () => void docs.newPage(page.space_id, id) },
                  { label: "", separator: true },
                  { label: "Mettre à la corbeille", icon: <Trash2 size={14} />, danger: true, onSelect: () => void trash() },
                ]
              : []),
          ]}
        />
      </div>

      {page.deleted_at && (
        <div className="docs-banner danger">
          Cette page est à la corbeille.
          {ws.canWrite && (
            <button className="btn btn-sm" onClick={restore}>
              <RotateCcw size={13} /> Restaurer
            </button>
          )}
        </div>
      )}
      {(state === "conflict" || state === "error") && message && (
        <div className="docs-banner warn">
          <span>{message}</span>
          {state === "conflict" ? (
            <button className="btn btn-sm" onClick={reload}>Recharger (mes dernières modifications seront perdues)</button>
          ) : (
            <button className="btn btn-sm" onClick={flush}>Réessayer</button>
          )}
        </div>
      )}

      <article className="docs-article">
        <div className="docs-icon-row">
          {editIcon ? (
            <input
              autoFocus
              className="input"
              style={{ width: 120, height: 34, fontSize: 18 }}
              value={icon}
              onChange={(e) => changeIcon(e.target.value.slice(0, 8))}
              onBlur={saveIcon}
              onKeyDown={(e) => e.key === "Enter" && saveIcon()}
              placeholder="Un emoji"
              aria-label="Icône de la page"
            />
          ) : icon ? (
            <button type="button" className="docs-icon" onClick={() => editable && setEditIcon(true)} title={editable ? "Changer l'icône" : undefined}>
              {icon}
            </button>
          ) : (
            editable && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditIcon(true)}>
                + Ajouter une icône
              </button>
            )
          )}
        </div>
        <textarea
          className="docs-title"
          value={title}
          readOnly={!editable}
          onChange={(e) => changeTitle(e.target.value.replace(/\n/g, ""))}
          placeholder={UNTITLED}
          rows={1}
          aria-label="Titre de la page"
        />
        <p className="docs-meta">
          {author ? `Modifiée par ${author} ` : "Modifiée "}
          {ago(page.updated_at)}
          {creator && creator !== author ? ` · créée par ${creator}` : ""}
        </p>

        <DocEditor
          key={editorKey}
          content={page.content}
          editable={editable}
          onChange={(content, plain) => schedule({ content, plain })}
          onError={(m) => {
            setState("error");
            setMessage(m);
          }}
        />

        {subpages.length > 0 && (
          <section className="docs-subpages">
            <h2>Sous-pages</h2>
            {subpages.map((p) => (
              <Link key={p.id} href={`${ws.base}/docs/${p.id}`} className="docs-row">
                {p.icon ? <span className="docs-emoji">{p.icon}</span> : <FileText size={14} className="faint" />}
                <span className="trunc">{p.title || UNTITLED}</span>
              </Link>
            ))}
          </section>
        )}
      </article>

      {history && (
        <HistoryModal
          pageId={id}
          canRestore={editable}
          onClose={() => setHistory(false)}
          onRestore={async (v) => {
            await flush();
            const { error } = await supabaseBrowser().rpc("doc_save_page", { p_id: id, p_title: v.title, p_content: v.content, p_plain: v.plain });
            if (error) {
              setState("error");
              setMessage(error.message);
              return;
            }
            setHistory(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}
