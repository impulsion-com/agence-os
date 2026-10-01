"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell as BellIcon, BellOff } from "lucide-react";

import { Popover } from "@/components/ui/overlay";
import { ago } from "@/lib/format";
import { safePortalLink } from "@/lib/portal/nav";
import type { PortalNotification } from "@/lib/portal/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { usePortal } from "./context";

/**
 * Cloche du portail : les notifications de l'utilisateur pour cet espace (policy « notifs perso » :
 * chacun ne lit que les siennes). Le lien est un chemin relatif au portail (colonne portal_link),
 * lu de façon tolérante : sans lien, on ouvre la tâche liée ou l'accueil.
 */
export function Bell() {
  const { ctx, preview, href } = usePortal();
  const router = useRouter();
  const [items, setItems] = useState<PortalNotification[] | null>(null);
  const [unread, setUnread] = useState(ctx.unread);
  // Le layout renvoie un nouveau compteur après router.refresh()
  const [seen, setSeen] = useState(ctx.unread);
  if (seen !== ctx.unread) {
    setSeen(ctx.unread);
    setUnread(ctx.unread);
  }

  const load = useCallback(async () => {
    let q = supabaseBrowser()
      .from("notifications")
      .select("*")
      .eq("workspace_id", ctx.workspace.id)
      .eq("user_id", ctx.user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(30);
    // En aperçu, un membre ne voit pas ses notifications internes ici
    if (preview) q = q.eq("kind", "portal");
    const { data } = await q;
    const list = (data ?? []) as unknown as PortalNotification[];
    setItems(list);
    setUnread(list.filter((n) => !n.read_at).length);
  }, [ctx.workspace.id, ctx.user.id, preview]);

  const markAll = async () => {
    const now = new Date().toISOString();
    setItems((l) => l?.map((n) => ({ ...n, read_at: n.read_at ?? now })) ?? l);
    setUnread(0);
    let q = supabaseBrowser().from("notifications").update({ read_at: now }).eq("workspace_id", ctx.workspace.id).eq("user_id", ctx.user.id).is("read_at", null);
    if (preview) q = q.eq("kind", "portal");
    await q;
  };

  const open = async (n: PortalNotification, close: () => void) => {
    close();
    if (!n.read_at) {
      const now = new Date().toISOString();
      setItems((l) => l?.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)) ?? l);
      setUnread((u) => Math.max(0, u - 1));
      void supabaseBrowser().from("notifications").update({ read_at: now }).eq("id", n.id).eq("user_id", ctx.user.id).then(() => undefined);
    }
    const link = safePortalLink(n.portal_link) ?? (n.task_id ? `tasks?task=${n.task_id}` : "");
    router.push(href(link));
  };

  return (
    <Popover
      align="end"
      width={320}
      trigger={(openPop, isOpen) => (
        <button
          type="button"
          className="ptl-iconbtn"
          aria-label={unread ? `Notifications, ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={(e) => {
            openPop(e);
            void load();
          }}
        >
          <BellIcon size={18} strokeWidth={1.8} />
          {unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="ptl-notifs">
          <div className="hd">
            Notifications
            {unread > 0 && (
              <button type="button" onClick={() => void markAll()}>
                Tout marquer comme lu
              </button>
            )}
          </div>
          {items === null ? (
            <div className="ptl-empty">Chargement…</div>
          ) : items.length === 0 ? (
            <div className="ptl-empty">
              <div className="ic">
                <BellOff size={17} />
              </div>
              <b>Aucune notification</b>
              Vous serez prévenu ici dès qu&apos;un élément attend votre validation.
            </div>
          ) : (
            items.map((n) => (
              <button key={n.id} type="button" className={`ptl-notif${n.read_at ? " read" : ""}`} onClick={() => void open(n, close)}>
                <span className="pt" aria-hidden />
                <span style={{ minWidth: 0 }}>
                  <span className="bd">{n.body || "Nouvelle activité sur votre espace"}</span>
                  <span className="at">
                    {ago(n.created_at)}
                    {!n.read_at && <span className="sr"> (non lue)</span>}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </Popover>
  );
}
