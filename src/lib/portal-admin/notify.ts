// Demande au serveur d'envoyer l'email récapitulatif au client (tâche ou créa à valider, rapport publié).
// Sans effet si l'envoi d'emails n'est pas configuré : la notification dans le portail est créée par la base.
export function emailClient(kind: "task" | "creative" | "report", ids: string[]) {
  if (!ids.length) return;
  void fetch("/api/portal-admin/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ids: ids.slice(0, 50) }),
  }).catch(() => {});
}
