// Dépôt de fichiers par le client : règles partagées entre le navigateur et les routes /api/portal/*.

export const PORTAL_BUCKET = "attachments";
export const PORTAL_MAX_SIZE = 50 * 1048576; // 50 Mo

/** Nom sûr pour la clé Storage : lettres, chiffres, point, tiret, tiret bas (140 caractères au plus). */
export function portalSafeName(name: string) {
  const clean = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? clean.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toLowerCase() : "";
  const base = (dot > 0 ? clean.slice(0, dot) : clean).slice(0, 100) || "fichier";
  return ext ? `${base}.${ext}` : base;
}

/** Chemin d'un dépôt du portail : <workspace>/<projet>/portal/<uuid>-<nom>. La base n'accepte que cette forme. */
export const portalUploadPath = (workspaceId: string, projectId: string, name: string) =>
  `${workspaceId}/${projectId}/portal/${crypto.randomUUID()}-${portalSafeName(name)}`;

export const isPortalUploadPath = (path: string, workspaceId: string, projectId: string) =>
  path.startsWith(`${workspaceId}/${projectId}/portal/`) &&
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/portal\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,140}$/.test(path);
