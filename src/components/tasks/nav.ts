"use client";

import { useEffect } from "react";

// Ordre des tâches de la vue affichée, pour la navigation J/K du tiroir.
let ids: string[] = [];

export const getNavIds = () => ids;

export function useNavIds(list: string[]) {
  const key = list.join(",");
  useEffect(() => {
    ids = key ? key.split(",") : [];
  }, [key]);
}
