"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { TaskDrawerHost } from "@/components/tasks/task-drawer";
import { applyPrefs } from "@/lib/prefs";
import { useWorkspace } from "@/lib/workspace/context";
import { CrumbsProvider } from "./crumbs";
import { CommandPalette } from "./palette";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { UIProvider, useUI } from "./ui-context";

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
};

// Raccourcis globaux : C tâche, P projet, D deal, [ barre latérale, G puis H/I/M/P/C/R pour naviguer.
function Shortcuts({ onToggle }: { onToggle: () => void }) {
  const ui = useUI();
  const ws = useWorkspace();
  const router = useRouter();
  useEffect(() => {
    let g = 0;
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e) || document.querySelector(".modal, .palette")) return;
      const k = e.key.toLowerCase();
      if (Date.now() - g < 900) {
        const dest: Record<string, string> = { h: "", i: "/inbox", m: "/my-tasks", p: "/projects", c: "/crm", r: "/reporting", t: "/tasks", s: "/settings" };
        if (k in dest) {
          e.preventDefault();
          router.push(ws.base + dest[k]);
        }
        g = 0;
        return;
      }
      if (k === "g") g = Date.now();
      else if (k === "[") onToggle();
      else if (k === "/") {
        e.preventDefault();
        ui.setPalette(true);
      } else if (ws.canWrite && k === "c") {
        e.preventDefault();
        ui.create({ kind: "task" });
      } else if (ws.canWrite && k === "p" && !document.querySelector(".drawer")) {
        e.preventDefault();
        ui.create({ kind: "project" });
      } else if (ws.canWrite && k === "d" && !document.querySelector(".drawer")) {
        e.preventDefault();
        ui.create({ kind: "deal" });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [ui, ws, router, onToggle]);
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const path = usePathname();
  const [hidden, setHidden] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => applyPrefs(ws.me.prefs ?? {}, ws.workspace.accent), [ws.me.prefs, ws.workspace.accent]);
  useEffect(() => setMobileOpen(false), [path]);

  const toggle = () => {
    if (window.innerWidth < 900) setMobileOpen((v) => !v);
    else setHidden((v) => !v);
  };

  return (
    <UIProvider>
      <CrumbsProvider>
        <div className={`app${hidden ? " side-hidden" : ""}${mobileOpen ? " side-open" : ""}`}>
          <Sidebar onToggle={toggle} />
          {mobileOpen && <div className="scrim" style={{ zIndex: 54 }} onClick={() => setMobileOpen(false)} />}
          <div className="main">
            <Topbar sideHidden={hidden} onToggle={toggle} />
            <main className="content" id="content">{children}</main>
          </div>
        </div>
        <CommandPalette />
        <Shortcuts onToggle={toggle} />
        <Suspense>
          <TaskDrawerHost />
        </Suspense>
      </CrumbsProvider>
    </UIProvider>
  );
}
