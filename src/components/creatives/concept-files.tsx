"use client";

import { useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { CloudUpload, Download, Ellipsis, Play, X } from "lucide-react";

import { KINDS, canPreview, hasThumb, kindOf, safeName } from "@/components/projects/files-types";
import { ConfirmModal, Menu } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fileSize } from "@/lib/format";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";
import type { Asset, Variant } from "@/lib/creatives/types";
import { useSignedUrls } from "./parts";

const BUCKET = "attachments";
const MAX_SIZE = 50 * 1048576;

/** Fichiers du concept (visuels, vidéos, sources) : envoi, aperçu, couverture, variante, suppression. */
export function ConceptFiles({
  conceptId,
  assets,
  variants,
  coverPath,
  onCover,
}: {
  conceptId: string;
  assets: Asset[];
  variants: Variant[];
  coverPath: string | null;
  onCover: (path: string | null) => void;
}) {
  const ws = useWorkspace();
  const toast = useToast();
  const mutate = useMutate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [over, setOver] = useState(false);
  const [view, setView] = useState<Asset | null>(null);
  const [del, setDel] = useState<Asset | null>(null);
  const urls = useSignedUrls(assets.filter((a) => hasThumb(kindOf(a.name, a.mime), a.name)).map((a) => a.path));

  const upload = async (list: FileList | File[]) => {
    if (!ws.canWrite) return;
    const files = [...list].filter((f) => f.size <= MAX_SIZE);
    if (files.length < [...list].length) toast("Les fichiers de plus de 50 Mo sont ignorés", { error: true });
    if (!files.length) return;
    const sb = supabaseBrowser();
    setBusy((n) => n + files.length);
    let ok = 0;
    await Promise.all(
      files.map(async (file) => {
        const path = `${ws.workspace.id}/creatives/${conceptId}/${crypto.randomUUID()}-${safeName(file.name)}`;
        const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (up.error) {
          toast(`${file.name} : ${up.error.message}`, { error: true });
        } else {
          const ins = await sb.from("creative_assets").insert({ workspace_id: ws.workspace.id, concept_id: conceptId, name: file.name, path, size: file.size, mime: file.type });
          if (ins.error) {
            await sb.storage.from(BUCKET).remove([path]);
            toast(ins.error.message, { error: true });
          } else ok++;
        }
        setBusy((n) => n - 1);
      }),
    );
    if (ok) {
      toast(ok > 1 ? `${ok} fichiers ajoutés` : "Fichier ajouté");
      // première image envoyée : elle devient la couverture
      const firstImg = files.find((f) => kindOf(f.name, f.type) === "image");
      if (!coverPath && firstImg) {
        const { data } = await sb.from("creative_assets").select("path").eq("concept_id", conceptId).eq("name", firstImg.name).order("created_at", { ascending: false }).limit(1);
        if (data?.[0]) onCover(data[0].path);
        else await mutate(async () => undefined);
      } else await mutate(async () => undefined);
    }
  };

  const remove = async (a: Asset) => {
    await supabaseBrowser().storage.from(BUCKET).remove([a.path]);
    if (coverPath === a.path) onCover(null);
    await mutate(async (sb) => must(await sb.from("creative_assets").delete().eq("id", a.id).select("id")), { success: "Fichier supprimé" });
  };
  const download = async (a: Asset) => {
    const { data, error } = await supabaseBrowser().storage.from(BUCKET).createSignedUrl(a.path, 120, { download: a.name });
    if (error || !data) return toast(error?.message ?? "Téléchargement impossible", { error: true });
    const link = document.createElement("a");
    link.href = data.signedUrl;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const setVariant = (a: Asset, v: string | null) =>
    mutate(async (sb) => must(await sb.from("creative_assets").update({ variant_id: v }).eq("id", a.id).select("id")), { success: v ? "Fichier rattaché à la variante" : "Fichier détaché" });

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setOver(false);
    void upload(e.dataTransfer.files);
  };

  return (
    <section className="card crv-sec" aria-labelledby="crv-files-h" onDragOver={(e) => ws.canWrite && e.dataTransfer.types.includes("Files") && (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className="card-h">
        <h2 id="crv-files-h">
          Fichiers <span className="sub">{assets.length ? `${assets.length}` : ""}</span>
        </h2>
        {ws.canWrite && (
          <button type="button" className="btn btn-sm" onClick={() => input.current?.click()} disabled={busy > 0}>
            <CloudUpload size={13} /> {busy ? `Envoi (${busy})…` : "Ajouter"}
          </button>
        )}
        <input ref={input} type="file" multiple hidden accept="image/*,video/*,application/pdf,.psd,.fig,.ai,.zip" onChange={(e) => e.target.files && upload(e.target.files).then(() => (e.target.value = ""))} />
      </div>
      <div className="crv-files">
        {assets.map((a) => {
          const k = kindOf(a.name, a.mime);
          const K = KINDS[k];
          const url = urls[a.path];
          const variant = variants.find((v) => v.id === a.variant_id);
          return (
            <div className="crv-file" key={a.id}>
              <button type="button" className="th" onClick={() => ((k === "image" || k === "video") && canPreview(k, a.name) && url ? setView(a) : download(a))} aria-label={`Aperçu de ${a.name}`}>
                {k === "image" && url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" loading="lazy" />
                ) : k === "video" && url ? (
                  <span style={{ position: "relative", width: "100%", height: "100%" }}>
                    <video src={`${url}#t=0.5`} muted preload="metadata" playsInline />
                    <Play size={22} style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", color: "#fff" }} />
                  </span>
                ) : (
                  <K.icon size={26} style={{ color: K.color }} />
                )}
              </button>
              {coverPath === a.path && <span className="cov">Couverture</span>}
              <div className="nm">
                <span className="trunc" title={a.name}>{a.name}</span>
              </div>
              <div className="nm faint" style={{ paddingTop: 0 }}>
                {fileSize(a.size)}
                {variant ? ` · ${variant.name}` : ""}
              </div>
              {ws.canWrite && (
                <span className="menu">
                  <Menu
                    align="end"
                    items={[
                      ...(k === "image" && coverPath !== a.path ? [{ label: "Utiliser comme couverture", onSelect: () => onCover(a.path) }] : []),
                      { label: "Télécharger", icon: <Download size={14} />, onSelect: () => download(a) },
                      ...(variants.length
                        ? [
                            { separator: true, label: "" },
                            { heading: true, label: "Variante" },
                            { label: "Aucune", checked: !a.variant_id, onSelect: () => setVariant(a, null) },
                            ...variants.map((v) => ({ label: v.name, checked: a.variant_id === v.id, onSelect: () => setVariant(a, v.id) })),
                          ]
                        : []),
                      { separator: true, label: "" },
                      { label: "Supprimer", danger: true, onSelect: () => setDel(a) },
                    ]}
                    trigger={(open) => (
                      <button type="button" className="btn btn-sm btn-icon" onClick={open} aria-label={`Actions sur ${a.name}`}>
                        <Ellipsis size={14} />
                      </button>
                    )}
                  />
                </span>
              )}
            </div>
          );
        })}
        {ws.canWrite && (
          <button type="button" className={`crv-drop${over ? " over" : ""}`} onClick={() => input.current?.click()}>
            <CloudUpload size={20} />
            <span>Dépose des visuels ou des vidéos</span>
            <span className="fainter">50 Mo max</span>
          </button>
        )}
        {!ws.canWrite && !assets.length && <p className="faint" style={{ fontSize: 12 }}>Aucun fichier.</p>}
      </div>
      {view &&
        createPortal(
          <div className="crv-viewer" role="dialog" aria-modal="true" aria-label={view.name} onClick={() => setView(null)} onKeyDown={(e) => e.key === "Escape" && setView(null)}>
            <button type="button" className="btn btn-ghost x" onClick={() => setView(null)} aria-label="Fermer" autoFocus>
              <X size={18} />
            </button>
            {kindOf(view.name, view.mime) === "video" ? (
              <video src={urls[view.path]} controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
            ) : kindOf(view.name, view.mime) === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[view.path]} alt={view.name} onClick={(e) => e.stopPropagation()} />
            ) : (
              <p style={{ color: "#fff" }}>Aperçu indisponible</p>
            )}
          </div>,
          document.body,
        )}
      {del && <ConfirmModal title="Supprimer ce fichier ?" text={`${del.name} sera supprimé définitivement.`} onConfirm={() => remove(del)} onClose={() => setDel(null)} />}
    </section>
  );
}
