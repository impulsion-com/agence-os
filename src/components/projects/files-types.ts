import {
  File, FileArchive, FileCode, FileImage, FileMusic, FilePlay, FileSpreadsheet, FileText, PenTool, Presentation, type LucideIcon,
} from "lucide-react";

// Familles de fichiers : icône, couleur et libellé, déduits de l'extension (puis du type MIME).
export type FileKind = "image" | "video" | "pdf" | "doc" | "sheet" | "slides" | "design" | "archive" | "audio" | "code" | "other";

export const KINDS: Record<FileKind, { name: string; plural: string; icon: LucideIcon; color: string }> = {
  image: { name: "Image", plural: "Images", icon: FileImage, color: "#23918A" },
  video: { name: "Vidéo", plural: "Vidéos", icon: FilePlay, color: "#8662C9" },
  pdf: { name: "PDF", plural: "PDF", icon: FileText, color: "#B23C30" },
  doc: { name: "Document", plural: "Documents", icon: FileText, color: "#3B82C4" },
  sheet: { name: "Tableur", plural: "Tableurs", icon: FileSpreadsheet, color: "#3D8E5F" },
  slides: { name: "Présentation", plural: "Présentations", icon: Presentation, color: "#C0612B" },
  design: { name: "Design", plural: "Fichiers design", icon: PenTool, color: "#C54B78" },
  archive: { name: "Archive", plural: "Archives", icon: FileArchive, color: "#C48A1E" },
  audio: { name: "Audio", plural: "Audio", icon: FileMusic, color: "#5A67D8" },
  code: { name: "Code", plural: "Code", icon: FileCode, color: "#6B7280" },
  other: { name: "Fichier", plural: "Autres", icon: File, color: "#8A867E" },
};

const EXT: Record<string, FileKind> = {};
const add = (k: FileKind, exts: string) => exts.split(" ").forEach((e) => (EXT[e] = k));
add("image", "png jpg jpeg gif webp avif svg heic heif bmp tif tiff ico");
add("video", "mp4 mov m4v webm avi mkv wmv mpg mpeg");
add("pdf", "pdf");
add("doc", "doc docx odt rtf txt md pages");
add("sheet", "xls xlsx ods csv tsv numbers");
add("slides", "ppt pptx odp key");
add("design", "fig figma psd ai sketch xd indd eps afdesign afphoto");
add("archive", "zip rar 7z tar gz tgz bz2");
add("audio", "mp3 wav m4a aac ogg flac");
add("code", "html css js ts tsx jsx json xml yml yaml");

export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export function kindOf(name: string, mime = ""): FileKind {
  const k = EXT[extOf(name)];
  if (k) return k;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "other";
}

// Aperçu possible dans le navigateur (le SVG est exclu : il peut contenir du script)
export const canPreview = (k: FileKind, name: string) => k === "video" || k === "pdf" || k === "audio" || (k === "image" && !["heic", "heif", "tif", "tiff", "svg"].includes(extOf(name)));
export const hasThumb = (k: FileKind, name: string) => (k === "image" && canPreview(k, name)) || k === "video";

// Nom de fichier sûr pour la clé Storage (pas d'accents, d'espaces ni de caractères spéciaux)
export function safeName(name: string) {
  const ext = extOf(name);
  const base = (ext ? name.slice(0, -(ext.length + 1)) : name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "fichier";
  return ext ? `${base}.${ext.replace(/[^a-z0-9]/g, "")}` : base;
}
