"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

// Ouvre le tiroir global d'une tâche en ajoutant ?task=<id> à l'URL courante
// (les autres paramètres, comme ?q= de la recherche, sont conservés).
export function useOpenTask() {
  const router = useRouter();
  const path = usePathname();
  return useCallback(
    (id: string) => {
      const p = new URLSearchParams(window.location.search);
      p.set("task", id);
      router.push(`${path}?${p.toString()}`, { scroll: false });
    },
    [router, path],
  );
}

// Props d'accessibilité pour une ligne cliquable qui contient d'autres boutons
export function rowProps(onOpen: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
        e.preventDefault();
        onOpen();
      }
    },
  };
}
