"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

function useEscape(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose, active]);
}

/**
 * Popover ancré sur un déclencheur. Usage :
 *   <Popover trigger={(open) => <button onClick={open}>…</button>}>{(close) => …}</Popover>
 */
export function Popover({
  trigger,
  children,
  align = "start",
  width,
}: {
  trigger: (open: (e: React.MouseEvent) => void, isOpen: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  width?: number;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
  };
  return (
    <>
      {trigger(open, !!anchor)}
      {anchor && (
        <PopLayer anchor={anchor} onClose={close} align={align} width={width}>
          {children(close)}
        </PopLayer>
      )}
    </>
  );
}

export function PopLayer({
  anchor,
  onClose,
  children,
  align = "start",
  width,
}: {
  anchor: DOMRect | { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEscape(onClose);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = "width" in anchor ? anchor : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = align === "end" ? r.right - w : r.left;
    let top = r.bottom + 4;
    if (left + w > innerWidth - 8) left = innerWidth - w - 8;
    if (left < 8) left = 8;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 4);
    setPos({ left, top });
  }, [anchor, align]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", h), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", h);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      className="pop"
      role="dialog"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  sub?: ReactNode;
  danger?: boolean;
  onSelect?: () => void;
  checked?: boolean;
  separator?: boolean;
  heading?: boolean;
}

// Liste d'items avec recherche et navigation clavier.
export function MenuList({ items, onClose, search }: { items: MenuItem[]; onClose: () => void; search?: string }) {
  const [q, setQ] = useState("");
  const [act, setAct] = useState(0);
  const shown = items.filter((i) => i.separator || i.heading || !q || i.label.toLowerCase().includes(q.toLowerCase()));
  const selectable = shown.filter((i) => !i.separator && !i.heading);
  const pick = (i: MenuItem) => {
    i.onSelect?.();
    onClose();
  };
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAct((a) => Math.min(selectable.length - 1, a + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setAct((a) => Math.max(0, a - 1));
        } else if (e.key === "Enter" && selectable[act]) {
          e.preventDefault();
          pick(selectable[act]);
        }
      }}
    >
      {search !== undefined && (
        <input autoFocus className="pop-search" placeholder={search || "Rechercher…"} value={q} onChange={(e) => { setQ(e.target.value); setAct(0); }} />
      )}
      {!search && <input autoFocus className="sr" aria-hidden readOnly />}
      {shown.map((i, k) =>
        i.separator ? (
          <div key={k} className="mi-sep" />
        ) : i.heading ? (
          <div key={k} className="mi-h">{i.label}</div>
        ) : (
          <button
            key={k}
            type="button"
            className={`mi${i.danger ? " danger" : ""}${selectable[act] === i ? " act" : ""}`}
            onMouseEnter={() => setAct(selectable.indexOf(i))}
            onClick={() => pick(i)}
          >
            {i.icon}
            <span className="trunc">{i.label}</span>
            {i.checked !== undefined ? <span className="sub">{i.checked ? "✓" : ""}</span> : i.sub && <span className="sub">{i.sub}</span>}
          </button>
        ),
      )}
      {!selectable.length && <div className="mi faint">Aucun résultat</div>}
    </div>
  );
}

export function Menu({ trigger, items, align, search, width }: { trigger: (open: (e: React.MouseEvent) => void, isOpen: boolean) => ReactNode; items: MenuItem[]; align?: "start" | "end"; search?: string; width?: number }) {
  return (
    <Popover trigger={trigger} align={align} width={width}>
      {(close) => <MenuList items={items} onClose={close} search={search} />}
    </Popover>
  );
}

// Menu contextuel (clic droit) à une position donnée
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  return (
    <PopLayer anchor={at} onClose={onClose}>
      <MenuList items={items} onClose={onClose} />
    </PopLayer>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "lg";
}) {
  useEscape(onClose);
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className={`modal${size ? " " + size : ""}`} role="dialog" aria-modal="true">
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Fermer">
            <X size={15} />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export function Drawer({ header, onClose, children }: { header: ReactNode; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} style={{ background: "transparent" }} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-h">
          {header}
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Fermer" style={{ marginLeft: "auto" }}>
            <X size={15} />
          </button>
        </div>
        <div className="drawer-b">{children}</div>
      </aside>
    </>,
    document.body,
  );
}

export function ConfirmModal({
  title,
  text,
  confirmLabel = "Supprimer",
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  text: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            disabled={busy}
            autoFocus
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{text}</p>
    </Modal>
  );
}
