"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CloudUpload, Download, FolderOpen, Play, Trash2, X } from "lucide-react";

import { KINDS, canPreview, extOf, hasThumb, kindOf } from "@/components/projects/files-types";
import { ConfirmModal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { fileSize, fmtDate } from "@/lib/format";
import { PORTAL_BUCKET, PORTAL_MAX_SIZE } from "@/lib/portal/files";
import type { PortalFile, PortalFiles } from "@/lib/portal/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePortal } from "./context";
import { Empty, PreviewLock } from "./bits";

interface Upload {
  id: string;
  name: string;
  size: number;
  error?: string;
}

/** Fichiers partagés par l'agence et dépôt de fichiers par le client. */
export function FilesView({ data }: { data: PortalFiles }) {
  const { ctx, companyId, preview, file, href } = usePortal();
  const router = useRouter();
  const toast = useToast();
  const [project, setProject] = useState(data.projects[0]?.id ?? "");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState<PortalFile | null>(null);
  const [removing, setRemoving] = useState<PortalFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const canUpload = !preview && data.projects.length > 0;

  const upload = useCallback(
    async (list: FileList | File[]) => {
      if (!canUpload || !project) return;
      const all = [...list].filter((f) => f.size > 0);
      const big = all.filter((f) => f.size > PORTAL_MAX_SIZE);
      if (big.length) toast(big.length > 1 ? `${big.length} fichiers dépassent 50 Mo` : `${big[0].name} dépasse 50 Mo`, { error: true });
      const jobs = all.filter((f) => f.size <= PORTAL_MAX_SIZE).slice(0, 20).map((f) => ({ id: crypto.randomUUID(), f }));
      if (!jobs.length) return;
      setUploads((u) => [...u, ...jobs.map((j) => ({ id: j.id, name: j.f.name, size: j.f.size }))]);
      let ok = 0;
      const api = (method: string, body: unknown) =>
        fetch("/api/portal/upload", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({
          ok: r.ok,
          json: (await r.json().catch(() => ({}))) as { path?: string; token?: string; error?: string },
        }));
      await Promise.all(
        jobs.map(async ({ id, f }) => {
          const fail = (error: string) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, error } : x)));
          try {
            // 1. URL signée d'envoi (le serveur vérifie le projet avec la session du client)
            const a = await api("POST", { company: companyId, project, name: f.name, size: f.size });
            if (!a.ok || !a.json.path || !a.json.token) return fail(a.json.error ?? "Envoi impossible");
            // 2. Envoi direct au stockage
            const up = await supabaseBrowser().storage.from(PORTAL_BUCKET).uploadToSignedUrl(a.json.path, a.json.token, f, { contentType: f.type || undefined });
            if (up.error) return fail("Envoi interrompu, réessayez.");
            // 3. Confirmation : la pièce est enregistrée et partagée avec l'agence
            const c = await api("PUT", { company: companyId, project, path: a.json.path, name: f.name, mime: f.type });
            if (!c.ok) return fail(c.json.error ?? "Enregistrement impossible");
            ok++;
            setUploads((u) => u.filter((x) => x.id !== id));
          } catch {
            fail("Envoi interrompu, réessayez.");
          }
        }),
      );
      if (ok) {
        toast(ok > 1 ? `${ok} fichiers envoyés à l'agence` : "Fichier envoyé à l'agence");
        router.refresh();
      }
    },
    [canUpload, project, companyId, toast, router],
  );

  const drag = (e: DragEvent, enter: boolean) => {
    if (!canUpload || !e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    depth.current += enter ? 1 : -1;
    setOver(depth.current > 0);
  };

  const remove = async (f: PortalFile) => {
    const r = await fetch("/api/portal/upload", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company: companyId, file: f.id }) });
    if (!r.ok) return toast("Suppression impossible", { error: true });
    toast("Fichier retiré");
    setOpen(null);
    router.refresh();
  };

  return (
    <div
      onDragEnter={(e) => drag(e, true)}
      onDragLeave={(e) => drag(e, false)}
      onDragOver={(e) => canUpload && e.dataTransfer?.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
      }}
    >
      <div className="ptl-ph">
        <div>
          <h1>Fichiers</h1>
          <p>Les documents partagés avec {ctx.workspace.name}. Déposez ici vos visuels, logos et contenus.</p>
        </div>
      </div>

      {data.projects.length > 0 && (
        <>
          {data.projects.length > 1 && (
            <div className="field" style={{ maxWidth: 360, marginBottom: 10 }}>
              <label htmlFor="ptl-project">Projet concerné par vos dépôts</label>
              <select id="ptl-project" className="select" value={project} onChange={(e) => setProject(e.target.value)} disabled={preview}>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="button" className={`ptl-dz${over ? " over" : ""}`} onClick={() => input.current?.click()} disabled={!canUpload} aria-describedby="ptl-dz-hint">
            <span className="ic">
              <CloudUpload size={19} />
            </span>
            <span>
              <b>{over ? "Déposez vos fichiers" : "Déposer des fichiers"}</b>
              <small id="ptl-dz-hint">
                {preview ? <PreviewLock>Aperçu : seul le client peut déposer des fichiers.</PreviewLock> : "Glissez vos fichiers ici ou cliquez pour les choisir. 50 Mo maximum par fichier."}
              </small>
            </span>
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      )}

      {uploads.length > 0 && (
        <div className="ptl-ups" aria-live="polite">
          {uploads.map((u) => (
            <div className="ptl-up" key={u.id}>
              <div className="g">
                <div className="trunc" style={{ fontWeight: 500 }}>{u.name}</div>
                {u.error ? <div className="err">{u.error}</div> : <div className="bar" aria-label="Envoi en cours" />}
              </div>
              <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>{fileSize(u.size)}</span>
              {u.error && (
                <button className="btn btn-ghost btn-sm btn-icon" aria-label="Fermer" onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {data.files.length === 0 ? (
        <div className="card">
          <Empty icon={<FolderOpen size={18} />} title="Aucun fichier partagé pour le moment">
            Les fichiers partagés par {ctx.workspace.name} et ceux que vous déposez apparaîtront ici.
          </Empty>
        </div>
      ) : (
        <div className="ptl-fgrid">
          {data.files.map((f) => {
            const kind = kindOf(f.name, f.mime);
            const k = KINDS[kind];
            const thumb = hasThumb(kind, f.name);
            return (
              <button key={f.id} type="button" className="ptl-fcard" onClick={() => setOpen(f)} title={f.name}>
                <span className="ptl-fprev" style={{ ["--c" as string]: k.color }}>
                  {thumb && kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={file("file", f.id)} alt="" loading="lazy" />
                  ) : thumb ? (
                    <>
                      <video src={`${file("file", f.id)}#t=0.1`} preload="metadata" muted playsInline />
                      <span className="play">
                        <Play size={16} fill="currentColor" />
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="big">
                        <k.icon size={24} />
                      </span>
                      {extOf(f.name) && <span className="ext">{extOf(f.name).slice(0, 5)}</span>}
                    </>
                  )}
                  {f.by.mine && <span className="mine">Déposé par vous</span>}
                </span>
                <span className="fi">
                  <span className="fn">{f.name}</span>
                  <span className="fm">
                    <span>
                      {fileSize(f.size)} · {fmtDate(new Date(f.created_at))}
                    </span>
                    {!f.by.mine && <span className="trunc">{f.by.client ? f.by.name : `${f.by.name} (agence)`}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <Lightbox
          f={open}
          taskHref={open.task ? href(`tasks?task=${open.task.id}`) : null}
          onClose={() => setOpen(null)}
          onRemove={open.by.mine && !preview && data.projects.length > 0 ? () => setRemoving(open) : undefined}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Retirer ce fichier ?"
          text={`« ${removing.name} » ne sera plus disponible pour l'agence.`}
          confirmLabel="Retirer"
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/** Aperçu plein écran : image, vidéo, PDF et audio dans la page ; téléchargement pour le reste. */
function Lightbox({ f, taskHref, onClose, onRemove }: { f: PortalFile; taskHref: string | null; onClose: () => void; onRemove?: () => void }) {
  const { file } = usePortal();
  const kind = kindOf(f.name, f.mime);
  const k = KINDS[kind];
  const url = file("file", f.id);
  const dl = file("file", f.id, { download: true });
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="ptl-lb" role="dialog" aria-modal="true" aria-label={f.name} onClick={onClose}>
      <div className="top" onClick={(e) => e.stopPropagation()}>
        <div className="nm">
          <b>{f.name}</b>
          <span>
            {k.name} · {fileSize(f.size)}
            {f.project ? ` · ${f.project}` : ""}
          </span>
        </div>
        {taskHref && (
          <a className="btn btn-sm" href={taskHref}>
            Voir la tâche
          </a>
        )}
        {onRemove && (
          <button className="btn btn-sm" onClick={onRemove}>
            <Trash2 size={13} /> Retirer
          </button>
        )}
        <a className="btn btn-sm" href={dl}>
          <Download size={13} /> Télécharger
        </a>
        <button className="btn btn-sm btn-icon" onClick={onClose} aria-label="Fermer">
          <X size={15} />
        </button>
      </div>
      <div className="stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {canPreview(kind, f.name) && kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={f.name} onClick={(e) => e.stopPropagation()} />
        ) : canPreview(kind, f.name) && kind === "video" ? (
          <video src={url} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
        ) : canPreview(kind, f.name) && kind === "audio" ? (
          <audio src={url} controls autoPlay onClick={(e) => e.stopPropagation()} />
        ) : canPreview(kind, f.name) && kind === "pdf" ? (
          <iframe src={url} title={f.name} />
        ) : (
          <div className="nope" onClick={(e) => e.stopPropagation()}>
            <span className="ptl-fic" style={{ ["--c" as string]: "#fff", width: 56, height: 56, borderRadius: 14 }}>
              <k.icon size={26} />
            </span>
            <span>Pas d&apos;aperçu pour ce type de fichier.</span>
            <a className="btn" href={dl}>
              <Download size={14} /> Télécharger
            </a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
