"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { MODULE, moduleOfPath, needsCompanies, withRequirements, type ModuleId } from "@/lib/modules";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";

/** Active un module (et ses dépendances) pour l'espace courant. */
export function useEnableModule() {
  const ws = useWorkspace();
  const mutate = useMutate();
  return (id: ModuleId) =>
    mutate(
      async (sb) => must(await sb.from("workspaces").update({ modules: withRequirements([...ws.modules, id]) }).eq("id", ws.workspace.id)),
      { success: `${MODULE[id].name} activé` },
    );
}

// Affiche une page d'explication à la place d'une page dont le module est désactivé.
export function ModuleGate({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const path = usePathname();
  const enable = useEnableModule();
  const rel = path.slice(ws.base.length) || "/";
  const companies = rel === "/crm/companies" || rel.startsWith("/crm/companies/");
  const id = moduleOfPath(rel);
  if (companies ? needsCompanies(ws.modules) : !id || ws.has(id)) return <>{children}</>;
  const m = MODULE[id ?? "crm"];
  const extra = (m.requires ?? []).filter((r) => !ws.has(r));
  return (
    <div className="page">
      <div className="mod-off">
        <span className="mod-ic">
          <Icon name={m.icon} size={22} />
        </span>
        <h1>{m.name} n&apos;est pas activé</h1>
        <p className="muted">{m.desc}</p>
        <ul>
          {m.includes.map((x) => (
            <li key={x}>
              <Check size={14} />
              {x}
            </li>
          ))}
        </ul>
        {ws.isAdmin ? (
          <div className="mod-actions">
            <button className="btn btn-primary" onClick={() => void enable(m.id)}>
              Activer {m.name}
              {extra.length ? ` (et ${extra.map((r) => MODULE[r].name).join(", ")})` : ""}
            </button>
            <Link href={`${ws.base}/settings/modules`} className="btn">
              Gérer les modules
            </Link>
          </div>
        ) : (
          <p className="faint">Demande à un admin de l&apos;espace de l&apos;activer dans Réglages &gt; Modules.</p>
        )}
        <p className="fainter" style={{ fontSize: "var(--fs-xs)" }}>Tes données sont conservées quand un module est désactivé.</p>
      </div>
    </div>
  );
}
