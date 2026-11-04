import type { DB } from "@/lib/workspace/context";
import { DOCS_BUCKET, fileUrl } from "./types";

export const DOC_FILE_TYPES = /^(image\/(png|jpe?g|gif|webp|svg\+xml)|application\/pdf)$/;
export const DOC_FILE_MAX = 20 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "application/pdf": "pdf",
};

/** Envoie une image ou un PDF dans le stockage de l'espace (<workspace_id>/docs/<nom tiré au hasard>). */
export async function uploadDocFile(sb: DB, workspaceId: string, file: Blob, name: string, type = file.type) {
  if (!DOC_FILE_TYPES.test(type)) throw new Error(`« ${name} » : seules les images et les PDF vont dans une page.`);
  if (file.size > DOC_FILE_MAX) throw new Error(`« ${name} » dépasse 20 Mo.`);
  const path = `${workspaceId}/docs/${crypto.randomUUID()}.${EXT[type] ?? "bin"}`;
  const { error } = await sb.storage.from(DOCS_BUCKET).upload(path, file, { contentType: type, upsert: false });
  if (error) throw new Error(`Envoi de « ${name} » impossible : ${error.message}`);
  return { url: fileUrl(path), name, image: type.startsWith("image/") };
}
