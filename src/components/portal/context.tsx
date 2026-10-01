"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useToast } from "@/components/ui/toast";
import { supabaseBrowser } from "@/lib/supabase/client";
import { can, companyCookie, fileUrl, pickPortal, portalHref } from "@/lib/portal/nav";
import type { PortalContext, PortalFeature, PortalInfo } from "@/lib/portal/types";

interface PortalValue {
  ctx: PortalContext;
  portal: PortalInfo;
  companyId: string;
  // membre de l'agence en aperçu : les actions d'écriture sont désactivées
  preview: boolean;
  currency: string;
  has: (f: PortalFeature) => boolean;
  /** Lien interne : href("tasks?task=<id>") */
  href: (path?: string) => string;
  /** URL d'un fichier délivré par /api/portal/file */
  file: (kind: "file" | "task" | "asset", id: string, opt?: { task?: string; download?: boolean }) => string;
  /** Change d'entreprise (mémorisée dans un cookie) */
  setCompany: (id: string) => void;
}

const Ctx = createContext<PortalValue | null>(null);

export const PREVIEW_HINT = "Aperçu : seul le client peut effectuer cette action.";

export function writeCompanyCookie(slug: string, id: string) {
  document.cookie = `${companyCookie(slug)}=${id}; path=/c/${slug}; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
}

export function PortalProvider({ ctx, cookieCompany, children }: { ctx: PortalContext; cookieCompany: string | null; children: ReactNode }) {
  const sp = useSearchParams();
  const [remembered, setRemembered] = useState(cookieCompany);
  const portal = pickPortal(ctx, sp.get("company"), remembered);

  const setCompany = useCallback(
    (id: string) => {
      writeCompanyCookie(ctx.workspace.slug, id);
      setRemembered(id);
    },
    [ctx.workspace.slug],
  );

  const value = useMemo<PortalValue | null>(() => {
    if (!portal) return null;
    return {
      ctx,
      portal,
      companyId: portal.company_id,
      preview: ctx.preview,
      currency: ctx.workspace.currency || "EUR",
      has: (f) => can(portal, f),
      href: (path = "") => portalHref(ctx, portal.company_id, path),
      file: (kind, id, opt) => fileUrl(portal.company_id, kind, id, opt),
      setCompany,
    };
  }, [ctx, portal, setCompany]);

  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePortal() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePortal hors de PortalProvider");
  return v;
}

/** Paramètre d'URL piloté sans aller-retour serveur (ouverture d'une fiche : ?task=<id>, ?c=<id>). */
export function useUrlParam(name: string) {
  const sp = useSearchParams();
  const value = sp.get(name);
  const set = useCallback(
    (v: string | null) => {
      const u = new URL(window.location.href);
      if (v) u.searchParams.set(name, v);
      else u.searchParams.delete(name);
      window.history.pushState(null, "", u.pathname + u.search + u.hash);
    },
    [name],
  );
  return [value, set] as const;
}

/**
 * Appelle une fonction portal_* avec la session du client, affiche l'erreur éventuelle
 * (les messages de la base sont déjà rédigés pour lui) puis rafraîchit la page.
 */
export function usePortalAction() {
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    async <T,>(run: (sb: ReturnType<typeof supabaseBrowser>) => PromiseLike<{ data: T; error: { message: string; code?: string } | null }>, success?: string) => {
      const { data, error } = await run(supabaseBrowser());
      if (error) {
        const known = error.code === "22023" || error.message.startsWith("Aperçu");
        toast(known ? error.message : "Action impossible pour le moment. Rechargez la page et réessayez.", { error: true });
        return null;
      }
      if (success) toast(success);
      router.refresh();
      return data ?? (true as unknown as T);
    },
    [router, toast],
  );
}
