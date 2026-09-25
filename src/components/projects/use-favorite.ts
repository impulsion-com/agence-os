"use client";

import { useState } from "react";

import { must, useMutate, useWorkspace } from "@/lib/workspace/context";

/** Favori d'un projet (table project_favorites), avec bascule optimiste. */
export function useFavorite(projectId: string) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const server = ws.favorites.includes(projectId);
  const [fav, setFav] = useState(server);
  const [src, setSrc] = useState(server);
  if (src !== server) {
    setSrc(server);
    setFav(server);
  }
  const toggle = () => {
    const next = !fav;
    setFav(next);
    void mutate(async (sb) => {
      if (next) must(await sb.from("project_favorites").insert({ project_id: projectId, user_id: ws.me.id, position: ws.favorites.length }));
      else must(await sb.from("project_favorites").delete().eq("project_id", projectId).eq("user_id", ws.me.id));
      return true;
    }, { success: next ? "Ajouté aux favoris" : "Retiré des favoris" }).then((r) => r === undefined && setFav(!next));
  };
  return [fav, toggle] as const;
}
