// Charge ou supprime les données d'exemple d'un espace (voir /api/demo).
export async function runDemo(workspaceId: string, action: "load" | "clear") {
  const res = await fetch("/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId, action }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Échec du chargement des données d'exemple");
}
