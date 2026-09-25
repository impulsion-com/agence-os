"use client";

import "@/styles/files.css";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft, ChevronRight, CloudUpload, Download, Ellipsis, Eye, LayoutGrid, Link2, List, Pencil, Play, Search, SearchX, Trash2, X,
} from "lucide-react";

import { useOpenTask, usePref } from "@/components/tasks/calendar-utils";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/misc";
import { ConfirmModal, Menu, Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago, fileSize, fmtDate } from "@/lib/format";
import type { Attachment } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import { KINDS, canPreview, extOf, hasThumb, kindOf, safeName, type FileKind } from "./files-types";

const BUCKET = "attachments";
const URL_TTL = 3600;
const MAX_SIZE = 50 * 1048576; // limite par défaut du Storage Supabase

interface FileRow extends Attachment {
  task: { id: string; number: number; title: string; project_id: string } | null;
}
interface Upload {
  id: string;
  name: string;
  size: number;
  kind: FileKind;
  error?: string;
}

type Sort = "date" | "name" | "size";

/**
 * Fichiers du projet (y compris ceux joints à ses tâches) : grille avec vignettes pour les créas,
 * liste détaillée, envoi par glisser-déposer, aperçu, renommage et suppression.
 */
export function FilesView({ projectId }: { projectId: string }) {
  const ws = useWorkspace();
  const toast = useToast();
  const mutate = useMutate();
  const openTask = useOpenTask();
  const project = ws.project(projectId);
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [view, setView] = usePref("files-view", ["grid", "list"] as const, "grid");
  const [sort, setSort] = usePref<Sort>("files-sort", ["date", "name", "size"] as const, "date");
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<FileRow | null>(null);
  const [deleting, setDeleting] = useState<FileRow | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const signedTried = useRef(new Set<string>());

  // ----- Chargement -----
  useEffect(() => {
    let alive = true;
    const sb = supabaseBrowser();
    const sel = "*, task:tasks(id, number, title, project_id)";
    Promise.all([
      sb.from("attachments").select(sel).eq("project_id", projectId),
      sb.from("attachments").select("*, task:tasks!inner(id, number, title, project_id)").eq("task.project_id", projectId),
    ]).then(([a, b]) => {
      if (!alive) return;
      if (a.error || b.error) {
        toast((a.error ?? b.error)!.message, { error: true });
        setFiles([]);
        return;
      }
      const map = new Map<string, FileRow>();
      for (const r of [...(a.data ?? []), ...(b.data ?? [])] as unknown as FileRow[]) map.set(r.id, r);
      setFiles([...map.values()]);
    });
    return () => {
      alive = false;
    };
  }, [projectId, toast]);

  // URL signées des vignettes (images et vidéos)
  useEffect(() => {
    if (!files) return;
    const missing = files.filter((f) => hasThumb(kindOf(f.name, f.mime), f.name) && !signedTried.current.has(f.path)).map((f) => f.path);
    if (!missing.length) return;
    for (const p of missing) signedTried.current.add(p);
    // Pas d'annulation : les chemins demandés sont marqués, le résultat doit être conservé
    void supabaseBrowser()
      .storage.from(BUCKET)
      .createSignedUrls(missing, URL_TTL)
      .then(({ data }) => {
        if (!data) return;
        setUrls((u) => {
          const n = { ...u };
          for (const d of data) if (d.signedUrl && d.path) n[d.path] = d.signedUrl;
          return n;
        });
      });
  }, [files]);

  // ----- Filtres -----
  const counts = useMemo(() => {
    const c: Partial<Record<FileKind, number>> = {};
    for (const f of files ?? []) {
      const k = kindOf(f.name, f.mime);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [files]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = (files ?? []).filter((f) => (kind === "all" || kindOf(f.name, f.mime) === kind) && (!needle || f.name.toLowerCase().includes(needle) || f.task?.title.toLowerCase().includes(needle)));
    return out.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, "fr") : sort === "size" ? b.size - a.size : b.created_at.localeCompare(a.created_at)));
  }, [files, kind, q, sort]);

  // ----- Envoi -----
  const upload = useCallback(
    async (list: FileList | File[]) => {
      if (!ws.canWrite) return;
      const all = [...list].filter((f) => f.size > 0 || f.type);
      const tooBig = all.filter((f) => f.size > MAX_SIZE);
      if (tooBig.length) toast(tooBig.length > 1 ? `${tooBig.length} fichiers dépassent 50 Mo` : `${tooBig[0].name} dépasse 50 Mo`, { error: true });
      const arr = all.filter((f) => f.size <= MAX_SIZE);
      if (!arr.length) return;
      const sb = supabaseBrowser();
      const jobs = arr.map((f) => ({ id: crypto.randomUUID(), file: f }));
      setUploads((u) => [...u, ...jobs.map((j) => ({ id: j.id, name: j.file.name, size: j.file.size, kind: kindOf(j.file.name, j.file.type) }))]);
      let ok = 0;
      await Promise.all(
        jobs.map(async ({ id, file }) => {
          const path = `${ws.workspace.id}/${projectId}/${id}-${safeName(file.name)}`;
          const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
          if (up.error) {
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: up.error.message.includes("exceeded") ? "Fichier trop volumineux" : up.error.message } : x)));
            return;
          }
          const ins = await sb
            .from("attachments")
            .insert({ workspace_id: ws.workspace.id, project_id: projectId, name: file.name, path, size: file.size, mime: file.type })
            .select("*")
            .single();
          if (ins.error) {
            await sb.storage.from(BUCKET).remove([path]);
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: ins.error.message } : x)));
            return;
          }
          ok++;
          setFiles((fs) => [{ ...(ins.data as Attachment), task: null }, ...(fs ?? [])]);
          setUploads((u) => u.filter((x) => x.id !== id));
        }),
      );
      if (ok) toast(ok > 1 ? `${ok} fichiers ajoutés` : "Fichier ajouté");
    },
    [ws.canWrite, ws.workspace.id, projectId, toast],
  );

  const onDragEnter = (e: DragEvent) => {
    if (!ws.canWrite || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current++;
    setDragOver(true);
  };
  const onDragLeave = () => {
    if (!dragOver) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragOver(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (ws.canWrite) void upload(e.dataTransfer.files);
  };

  // ----- Actions -----
  const download = async (f: FileRow) => {
    const { data, error } = await supabaseBrowser().storage.from(BUCKET).createSignedUrl(f.path, 120, { download: f.name });
    if (error || !data) return toast(error?.message ?? "Téléchargement impossible", { error: true });
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const rename = async (f: FileRow, name: string) => {
    const prev = f.name;
    setFiles((fs) => fs?.map((x) => (x.id === f.id ? { ...x, name } : x)) ?? null);
    const ok = await mutate(async (sb) => must(await sb.from("attachments").update({ name }).eq("id", f.id).select("id")), { success: "Fichier renommé", refresh: false });
    if (!ok) setFiles((fs) => fs?.map((x) => (x.id === f.id ? { ...x, name: prev } : x)) ?? null);
  };
  const remove = async (f: FileRow) => {
    const before = files;
    setFiles((fs) => fs?.filter((x) => x.id !== f.id) ?? null);
    if (preview === f.id) setPreview(null);
    const ok = await mutate(
      async (sb) => {
        must(await sb.from("attachments").delete().eq("id", f.id).select("id"));
        await sb.storage.from(BUCKET).remove([f.path]);
        return true;
      },
      { success: "Fichier supprimé" },
    );
    if (!ok) setFiles(before);
  };

  const menu = (f: FileRow, trigger: (open: (e: React.MouseEvent) => void, isOpen: boolean) => ReactNode) => (
    <Menu
      align="end"
      trigger={trigger}
      items={[
        { label: "Aperçu", icon: <Eye size={14} />, onSelect: () => setPreview(f.id) },
        { label: "Télécharger", icon: <Download size={14} />, onSelect: () => void download(f) },
        ...(f.task ? [{ label: "Ouvrir la tâche", icon: <Link2 size={14} />, onSelect: () => openTask(f.task!.id) }] : []),
        ...(ws.canWrite
          ? [
              { label: "", separator: true },
              { label: "Renommer", icon: <Pencil size={14} />, onSelect: () => setRenaming(f) },
              { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleting(f) },
            ]
          : []),
      ]}
    />
  );

  const taskLink = (f: FileRow) =>
    f.task ? (
      <button
        type="button"
        className="files-tlink"
        title={`Jointe à la tâche : ${f.task.title}`}
        onClick={(e) => {
          e.stopPropagation();
          openTask(f.task!.id);
        }}
      >
        <Link2 size={10} />
        {(ws.project(f.task.project_id)?.key ?? project?.key ?? "")}-{f.task.number}
      </button>
    ) : null;

  const kindsPresent = (Object.keys(KINDS) as FileKind[]).filter((k) => counts[k]);
  const idx = preview ? shown.findIndex((f) => f.id === preview) : -1;
  const current = idx >= 0 ? shown[idx] : null;

  return (
    <div className="files" onDragEnter={onDragEnter} onDragOver={(e) => dragOver && e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="files-bar">
        <label className="files-search">
          <Search size={13} />
          <input placeholder="Rechercher un fichier" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un fichier" />
          {q && (
            <button type="button" className="faint" style={{ display: "inline-flex" }} onClick={() => setQ("")} aria-label="Effacer la recherche">
              <X size={13} />
            </button>
          )}
        </label>
        {kindsPresent.length > 1 && (
          <div className="files-kinds" role="tablist" aria-label="Type de fichier">
            <button role="tab" aria-selected={kind === "all"} className={`files-fk${kind === "all" ? " on" : ""}`} onClick={() => setKind("all")}>
              Tous <span className="n">{files?.length ?? 0}</span>
            </button>
            {kindsPresent.map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} className={`files-fk${kind === k ? " on" : ""}`} onClick={() => setKind(kind === k ? "all" : k)}>
                {KINDS[k].plural} <span className="n">{counts[k]}</span>
              </button>
            ))}
          </div>
        )}
        <span className="sp" />
        <Menu
          align="end"
          trigger={(open) => (
            <button className="btn btn-ghost btn-sm" onClick={open}>
              Tri : {sort === "date" ? "récents" : sort === "name" ? "nom" : "taille"}
            </button>
          )}
          items={[
            { label: "Plus récents", checked: sort === "date", onSelect: () => setSort("date") },
            { label: "Nom", checked: sort === "name", onSelect: () => setSort("name") },
            { label: "Taille", checked: sort === "size", onSelect: () => setSort("size") },
          ]}
        />
        <div className="seg" role="tablist" aria-label="Affichage">
          <button role="tab" aria-selected={view === "grid"} className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} aria-label="Grille">
            <LayoutGrid size={13} />
          </button>
          <button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")} aria-label="Liste">
            <List size={13} />
          </button>
        </div>
        {ws.canWrite && (
          <button className="btn btn-primary btn-sm" onClick={() => inputRef.current?.click()}>
            <CloudUpload size={14} />
            Ajouter
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="files-body">
        {ws.canWrite && (files?.length ?? 0) > 0 && (
          <button type="button" className="files-dz" onClick={() => inputRef.current?.click()}>
            <span className="ic">
              <CloudUpload size={16} />
            </span>
            <span>
              Dépose tes créas, briefs et documents ici <span className="hide-s">ou </span>
              <span className="link">parcours tes fichiers</span>
            </span>
          </button>
        )}

        {uploads.length > 0 && (
          <div className="uploads" aria-live="polite">
            {uploads.map((u) => {
              const K = KINDS[u.kind];
              return (
                <div key={u.id} className="files-upl">
                  <span className="files-ic" style={{ ["--c" as string]: K.color }}>
                    <K.icon size={14} />
                  </span>
                  <div className="grow">
                    <div className="top">
                      <span className="trunc" style={{ fontWeight: 500 }}>{u.name}</span>
                      <span className="faint num" style={{ fontSize: 11.5, marginLeft: "auto", flexShrink: 0 }}>{fileSize(u.size)}</span>
                    </div>
                    {u.error ? <span className="err">{u.error}</span> : <span className="files-indet" />}
                  </div>
                  {u.error && (
                    <button className="btn btn-ghost btn-sm btn-icon" aria-label="Ignorer" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {files === null ? (
          <div className="files-grid" aria-busy>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="files-card" style={{ cursor: "default" }}>
                <div className="files-prev">
                  <span className="sk" />
                </div>
                <div className="fi">
                  <span className="sk" style={{ height: 12, width: "70%" }} />
                  <span className="sk" style={{ height: 10, width: "45%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : !files.length ? (
          <EmptyState icon="paperclip" title="Aucun fichier pour l'instant" text="Centralise ici les créas, briefs, exports et rapports du projet. Les pièces jointes des tâches y apparaissent aussi.">
            {ws.canWrite && (
              <button className="btn btn-primary btn-sm" onClick={() => inputRef.current?.click()}>
                <CloudUpload size={14} />
                Ajouter des fichiers
              </button>
            )}
          </EmptyState>
        ) : !shown.length ? (
          <div className="empty">
            <div className="ic">
              <SearchX size={18} />
            </div>
            <h3>Aucun fichier ne correspond</h3>
            <p>Essaie un autre mot-clé ou un autre type.</p>
            <button
              className="btn btn-sm"
              style={{ marginTop: 8 }}
              onClick={() => {
                setQ("");
                setKind("all");
              }}
            >
              Réinitialiser
            </button>
          </div>
        ) : view === "grid" ? (
          <div className="files-grid">
            {shown.map((f) => (
              <FileCard key={f.id} f={f} url={urls[f.path]} onOpen={setPreview} menu={menu} taskLink={taskLink(f)} />
            ))}
          </div>
        ) : (
          <div className="files-tbl">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 14 }}>Nom</th>
                  <th>Type</th>
                  <th className="r">Taille</th>
                  <th>Ajouté par</th>
                  <th>Date</th>
                  <th className="act" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => {
                  const k = kindOf(f.name, f.mime);
                  const K = KINDS[k];
                  const m = ws.member(f.uploaded_by);
                  return (
                    <tr key={f.id} onClick={() => setPreview(f.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setPreview(f.id)}>
                      <td style={{ paddingLeft: 14, maxWidth: 420 }}>
                        <span className="nm">
                          {k === "image" && urls[f.path] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="thumb" src={urls[f.path]} alt="" loading="lazy" />
                          ) : (
                            <span className="files-ic" style={{ ["--c" as string]: K.color }}>
                              <K.icon size={14} />
                            </span>
                          )}
                          <span className="trunc" style={{ fontWeight: 500 }}>{f.name}</span>
                          {taskLink(f)}
                        </span>
                      </td>
                      <td className="muted">{K.name}</td>
                      <td className="r num muted">{fileSize(f.size)}</td>
                      <td>
                        <span className="who muted">
                          <Avatar profile={m?.profile ?? null} size={18} title={false} />
                          <span className="trunc">{m?.profile.full_name ?? "Ancien membre"}</span>
                        </span>
                      </td>
                      <td className="muted" title={fmtDate(f.created_at.slice(0, 10), true)}>{ago(f.created_at)}</td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        {menu(f, (open, isOpen) => (
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={open} aria-label={`Actions pour ${f.name}`} aria-expanded={isOpen}>
                            <Ellipsis size={14} />
                          </button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dragOver && (
        <div className="files-drop">
          <div>
            <span className="ic">
              <CloudUpload size={22} />
            </span>
            Dépose pour ajouter au projet {project?.name}
          </div>
        </div>
      )}

      {current && (
        <Lightbox
          f={current}
          url={urls[current.path]}
          index={idx}
          total={shown.length}
          onNav={(d) => setPreview(shown[(idx + d + shown.length) % shown.length].id)}
          onClose={() => setPreview(null)}
          onDownload={() => void download(current)}
          taskLink={taskLink(current)}
        />
      )}
      {renaming && <RenameModal f={renaming} onClose={() => setRenaming(null)} onSave={(n) => void rename(renaming, n)} />}
      {deleting && (
        <ConfirmModal
          title="Supprimer le fichier ?"
          text={
            <>
              <b>{deleting.name}</b> sera supprimé définitivement du projet{deleting.task ? " et de la tâche à laquelle il est joint" : ""}.
            </>
          }
          onConfirm={() => remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

const FileCard = memo(function FileCard({
  f, url, onOpen, menu, taskLink,
}: {
  f: FileRow;
  url?: string;
  onOpen: (id: string) => void;
  menu: (f: FileRow, trigger: (open: (e: React.MouseEvent) => void, isOpen: boolean) => ReactNode) => ReactNode;
  taskLink: ReactNode;
}) {
  const ws = useWorkspace();
  const k = kindOf(f.name, f.mime);
  const K = KINDS[k];
  const m = ws.member(f.uploaded_by);
  const thumb = hasThumb(k, f.name);
  return (
    <div className="files-card" role="button" tabIndex={0} onClick={() => onOpen(f.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(f.id)} aria-label={`Aperçu de ${f.name}`}>
      <div className="files-prev" style={{ ["--c" as string]: K.color }}>
        {thumb && url ? (
          k === "video" ? (
            <>
              <video src={`${url}#t=0.5`} preload="metadata" muted playsInline />
              <span className="play">
                <Play size={16} fill="currentColor" />
              </span>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" loading="lazy" />
          )
        ) : thumb ? (
          <span className="sk" />
        ) : (
          <span className="big">
            <K.icon size={24} />
          </span>
        )}
        {extOf(f.name) && <span className="ext">{extOf(f.name)}</span>}
      </div>
      {taskLink}
      <div className="fi">
        <span className="fn trunc" title={f.name}>{f.name}</span>
        <span className="fm">
          <span className="num">{fileSize(f.size)}</span>·<span className="trunc">{m?.profile.full_name.split(" ")[0] ?? "Ancien membre"}</span>·<span style={{ flexShrink: 0 }}>{ago(f.created_at)}</span>
        </span>
      </div>
      <span onClick={(e) => e.stopPropagation()}>
        {menu(f, (open, isOpen) => (
          <button className="btn btn-ghost btn-sm btn-icon more" onClick={open} aria-label={`Actions pour ${f.name}`} aria-expanded={isOpen}>
            <Ellipsis size={14} />
          </button>
        ))}
      </span>
    </div>
  );
});

function Lightbox({
  f, url: thumbUrl, index, total, onNav, onClose, onDownload, taskLink,
}: {
  f: FileRow;
  url?: string;
  index: number;
  total: number;
  onNav: (d: 1 | -1) => void;
  onClose: () => void;
  onDownload: () => void;
  taskLink: ReactNode;
}) {
  const ws = useWorkspace();
  const k = kindOf(f.name, f.mime);
  const K = KINDS[k];
  const m = ws.member(f.uploaded_by);
  const previewable = canPreview(k, f.name);
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null);
  const url = thumbUrl ?? (signed?.path === f.path ? signed.url : undefined);

  useEffect(() => {
    if (!previewable || thumbUrl) return;
    let alive = true;
    supabaseBrowser()
      .storage.from(BUCKET)
      .createSignedUrl(f.path, URL_TTL)
      .then(({ data }) => alive && data && setSigned({ path: f.path, url: data.signedUrl }));
    return () => {
      alive = false;
    };
  }, [f.path, previewable, thumbUrl]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector(".modal")) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && total > 1) onNav(-1);
      else if (e.key === "ArrowRight" && total > 1) onNav(1);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose, onNav, total]);

  return createPortal(
    <>
      <div className="flb-scrim" />
      <div className="flb" role="dialog" aria-modal="true" aria-label={`Aperçu de ${f.name}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="flb-h">
          <span className="files-ic" style={{ ["--c" as string]: K.color }}>
            <K.icon size={14} />
          </span>
          <div className="t">
            <b className="trunc">{f.name}</b>
            <span>
              {K.name} · {fileSize(f.size)} · {m?.profile.full_name ?? "Ancien membre"} · {fmtDate(f.created_at.slice(0, 10), true)}
              {total > 1 && ` · ${index + 1} sur ${total}`}
            </span>
          </div>
          {taskLink}
          <button className="flb-ib" onClick={onDownload} aria-label="Télécharger" title="Télécharger">
            <Download size={17} />
          </button>
          <button className="flb-ib" onClick={onClose} aria-label="Fermer" title="Fermer (Échap)" autoFocus>
            <X size={18} />
          </button>
        </div>
        <div className="flb-b" onClick={(e) => e.target === e.currentTarget && onClose()}>
          {total > 1 && (
            <>
              <button className="flb-ib flb-nav l" onClick={() => onNav(-1)} aria-label="Fichier précédent">
                <ChevronLeft size={22} />
              </button>
              <button className="flb-ib flb-nav r" onClick={() => onNav(1)} aria-label="Fichier suivant">
                <ChevronRight size={22} />
              </button>
            </>
          )}
          {previewable && !url ? (
            <span className="sk" style={{ width: 320, height: 220, opacity: 0.2 }} />
          ) : previewable && k === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={f.id} src={url} alt={f.name} />
          ) : previewable && k === "video" ? (
            <video key={f.id} src={url} controls autoPlay playsInline />
          ) : previewable && k === "audio" ? (
            <audio key={f.id} src={url} controls autoPlay />
          ) : previewable && k === "pdf" ? (
            <iframe key={f.id} src={url} title={f.name} />
          ) : (
            <div className="flb-none" style={{ ["--c" as string]: K.color }}>
              <span className="big">
                <K.icon size={32} />
              </span>
              <b>Pas d&apos;aperçu pour ce type de fichier</b>
              <span style={{ opacity: 0.65, fontSize: "var(--fs-sm)" }}>Télécharge-le pour l&apos;ouvrir avec l&apos;application adaptée.</span>
              <button className="btn btn-primary" onClick={onDownload} style={{ marginTop: 6 }}>
                <Download size={14} />
                Télécharger
              </button>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function RenameModal({ f, onClose, onSave }: { f: FileRow; onClose: () => void; onSave: (name: string) => void }) {
  const ext = extOf(f.name);
  const [base, setBase] = useState(ext ? f.name.slice(0, -(ext.length + 1)) : f.name);
  const next = `${base.trim()}${ext ? `.${ext}` : ""}`;
  const submit = () => {
    if (!base.trim() || next === f.name) return onClose();
    onSave(next);
    onClose();
  };
  return (
    <Modal
      title="Renommer le fichier"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={submit} disabled={!base.trim()}>
            Renommer
          </button>
        </>
      }
    >
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="file-name">Nom</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input id="file-name" className="input" autoFocus value={base} onChange={(e) => setBase(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          {ext && <span className="faint mono">.{ext}</span>}
        </div>
      </form>
    </Modal>
  );
}
