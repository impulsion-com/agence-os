"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CalendarDays, Check, CheckSquare, ChevronDown, Layers, Mail, Phone, Plus, Radio, StickyNote } from "lucide-react";

import { SetCrumbs, type Crumb } from "@/components/shell/crumbs";
import { Popover } from "@/components/ui/overlay";
import { colorOf, COLORS, DEAL_SOURCES } from "@/lib/constants";
import { money } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace/context";
import type { CrmActivity, PipelineStage, Service } from "@/lib/types";
import { COMPANY_STATUS } from "./lib";

import "@/styles/crm.css";

export const KIND_ICON: Record<CrmActivity["kind"], typeof Phone> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  meeting: CalendarDays,
  task: CheckSquare,
};

// Pastille carrée colorée avec l'initiale de l'entreprise
export function CompanyMark({ name, color, size = 18 }: { name: string; color: string; size?: number }) {
  return (
    <span className="crm-mark" style={{ ["--s" as string]: `${size}px`, ["--c" as string]: colorOf(color) }} aria-hidden>
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

export function CompanyLink({ id, stop }: { id: string | null; stop?: boolean }) {
  const ws = useWorkspace();
  const c = ws.company(id);
  if (!c) return <span className="fainter">Aucune entreprise</span>;
  return (
    <Link href={`${ws.base}/crm/companies/${c.id}`} className="crm-co" onClick={stop ? (e) => e.stopPropagation() : undefined}>
      <CompanyMark name={c.name} color={c.color} size={16} />
      <span className="trunc">{c.name}</span>
    </Link>
  );
}

export function StatusBadge({ status }: { status: keyof typeof COMPANY_STATUS }) {
  const s = COMPANY_STATUS[status];
  return <span className="badge" style={{ ["--c" as string]: s.color }}>{s.name}</span>;
}

export function StageBadge({ stage }: { stage?: PipelineStage }) {
  if (!stage) return <span className="fainter">Sans étape</span>;
  return <span className="badge" style={{ ["--c" as string]: colorOf(stage.color) }}>{stage.name}</span>;
}

// Sous-navigation du CRM
export function CrmTabs({ counts }: { counts?: { companies?: number; contacts?: number; deals?: number } }) {
  const ws = useWorkspace();
  const path = usePathname();
  const b = `${ws.base}/crm`;
  const tabs = [
    { href: b, label: "Pipeline", on: path === b || path.startsWith(`${b}/deals`), n: counts?.deals },
    { href: `${b}/companies`, label: "Clients & prospects", on: path.startsWith(`${b}/companies`), n: counts?.companies },
    { href: `${b}/contacts`, label: "Contacts", on: path.startsWith(`${b}/contacts`), n: counts?.contacts },
  ];
  return (
    <nav className="tabs crm-tabs" aria-label="Sections du CRM">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={`tab${t.on ? " on" : ""}`} aria-current={t.on ? "page" : undefined}>
          {t.label}
          {t.n !== undefined && <span className="count">{t.n}</span>}
        </Link>
      ))}
    </nav>
  );
}

// Ligne de propriété (libellé + valeur éditable)
export function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="crm-prop">
      <span className="k">{label}</span>
      <div className="v">{children}</div>
    </div>
  );
}

export interface ComboItem {
  id: string;
  label: string;
  icon?: ReactNode;
  sub?: ReactNode;
}

/**
 * Liste filtrable au clavier, avec option « Créer … » quand la recherche ne trouve rien d'exact.
 */
export function ComboList({
  items,
  value,
  onPick,
  onCreate,
  createLabel = (q) => `Créer « ${q} »`,
  placeholder = "Rechercher…",
  none,
}: {
  items: ComboItem[];
  value?: string | null | string[];
  onPick: (id: string | null) => void;
  onCreate?: (q: string) => void;
  createLabel?: (q: string) => string;
  placeholder?: string;
  none?: string;
}) {
  const [q, setQ] = useState("");
  const [act, setAct] = useState(0);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const shown = items.filter((i) => !q || norm(i.label).includes(norm(q)));
  const canCreate = !!onCreate && q.trim().length > 1 && !items.some((i) => norm(i.label) === norm(q.trim()));
  type Opt = { key: string; run: () => void; node: ReactNode };
  const isOn = (id: string | null) => (Array.isArray(value) ? !!id && value.includes(id) : (value ?? null) === id);
  const opts: Opt[] = [
    ...(none && !q ? [{ key: "__none", run: () => onPick(null), node: <><span className="crm-none-ic" /> <span className="trunc">{none}</span>{isOn(null) && <Check size={13} className="sub" />}</> }] : []),
    ...shown.map((i) => ({
      key: i.id,
      run: () => onPick(i.id),
      node: (
        <>
          {i.icon}
          <span className="trunc">{i.label}</span>
          {isOn(i.id) ? <Check size={13} className="sub" /> : i.sub && <span className="sub">{i.sub}</span>}
        </>
      ),
    })),
    ...(canCreate ? [{ key: "__create", run: () => onCreate!(q.trim()), node: <><Plus size={14} className="faint" /><span className="trunc">{createLabel(q.trim())}</span></> }] : []),
  ];
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAct((a) => Math.min(opts.length - 1, a + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setAct((a) => Math.max(0, a - 1));
        } else if (e.key === "Enter" && opts[act]) {
          e.preventDefault();
          opts[act].run();
        }
      }}
    >
      <input autoFocus className="pop-search" placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setAct(0); }} />
      {opts.map((o, k) => (
        <button key={o.key} type="button" className={`mi${k === act ? " act" : ""}`} onMouseEnter={() => setAct(k)} onClick={o.run}>
          {o.node}
        </button>
      ))}
      {!opts.length && <div className="mi faint">{onCreate ? "Tape un nom pour créer" : "Aucun résultat"}</div>}
    </div>
  );
}

type Trigger = (open: (e: React.MouseEvent) => void) => ReactNode;

export function StagePicker({ stages, value, onChange, trigger }: { stages: PipelineStage[]; value: string | null; onChange: (id: string) => void; trigger?: Trigger }) {
  const s = stages.find((x) => x.id === value);
  return (
    <Popover
      trigger={(open) =>
        trigger ? trigger(open) : (
          <button type="button" className={`pill${s ? "" : " empty"}`} onClick={open}>
            <i className="crm-dot" style={{ ["--c" as string]: colorOf(s?.color) }} />
            <span className="trunc">{s?.name ?? "Étape"}</span>
          </button>
        )
      }
    >
      {(close) => (
        <ComboList
          placeholder="Déplacer vers…"
          value={value}
          items={stages.map((x) => ({
            id: x.id,
            label: x.name,
            icon: <i className="crm-dot" style={{ ["--c" as string]: colorOf(x.color) }} />,
            sub: x.kind === "open" ? `${x.probability} %` : x.kind === "won" ? "gagné" : "perdu",
          }))}
          onPick={(id) => {
            if (id) onChange(id);
            close();
          }}
        />
      )}
    </Popover>
  );
}

export function SourcePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Popover
      trigger={(open) => (
        <button type="button" className={`pill${value ? "" : " empty"}`} onClick={open}>
          <Radio size={14} />
          <span className="trunc">{value || "Source"}</span>
        </button>
      )}
    >
      {(close) => (
        <ComboList
          placeholder="Source…"
          value={value || null}
          none="Aucune"
          items={DEAL_SOURCES.map((s) => ({ id: s, label: s }))}
          onCreate={(q) => { onChange(q); close(); }}
          createLabel={(q) => `Utiliser « ${q} »`}
          onPick={(id) => { onChange(id ?? ""); close(); }}
        />
      )}
    </Popover>
  );
}

export function ServicesPicker({ services, value, onChange, currency = "EUR" }: { services: Service[]; value: string[]; onChange: (v: string[]) => void; currency?: string }) {
  const names = Array.from(new Set([...services.filter((s) => !s.archived).map((s) => s.name), ...value]));
  return (
    <Popover
      width={300}
      trigger={(open) => (
        <button type="button" className={`pill crm-services-pill${value.length ? "" : " empty"}`} onClick={open}>
          {value.length ? (
            <span className="crm-chips">
              {value.map((v) => <span key={v} className="chip">{v}</span>)}
            </span>
          ) : (
            <>
              <Layers size={14} />
              <span>Services</span>
            </>
          )}
        </button>
      )}
    >
      {() => (
        <div>
          <div className="mi-h">Catalogue de services</div>
          {names.map((n) => {
            const on = value.includes(n);
            const svc = services.find((s) => s.name === n);
            return (
              <button key={n} type="button" className="mi" onClick={() => onChange(on ? value.filter((x) => x !== n) : [...value, n])}>
                <input type="checkbox" className="check" readOnly checked={on} tabIndex={-1} />
                <span className="trunc">{n}</span>
                {svc && <span className="sub num">{money(svc.unit_price, currency)}{svc.billing === "monthly" ? "/m" : ""}</span>}
              </button>
            );
          })}
          {!names.length && <div className="mi faint">Aucun service dans le catalogue</div>}
        </div>
      )}
    </Popover>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hexes = Object.values(COLORS);
  return (
    <Popover
      trigger={(open) => (
        <button type="button" className="pill" onClick={open} aria-label="Couleur">
          <i className="crm-dot lg" style={{ ["--c" as string]: colorOf(value) }} />
        </button>
      )}
    >
      {(close) => (
        <div className="crm-swatches">
          {hexes.map((h) => (
            <button
              key={h}
              type="button"
              className={`crm-swatch${colorOf(value).toLowerCase() === h.toLowerCase() ? " on" : ""}`}
              style={{ ["--c" as string]: h }}
              aria-label={h}
              onClick={() => { onChange(h); close(); }}
            />
          ))}
        </div>
      )}
    </Popover>
  );
}

// Champ texte éditable en place : enregistre à la sortie ou sur Entrée, Échap annule.
export function InlineText({
  value,
  onSave,
  placeholder,
  className = "",
  type = "text",
  disabled,
  ariaLabel,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  className?: string;
  type?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  if (prev !== value) {
    setPrev(value);
    setV(value);
  }
  const commit = () => {
    if (v.trim() !== value.trim()) onSave(v.trim());
  };
  return (
    <input
      ref={ref}
      className={`crm-inline ${className}`}
      value={v}
      type={type}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") ref.current?.blur();
        if (e.key === "Escape") {
          setV(value);
          e.stopPropagation();
          setTimeout(() => ref.current?.blur());
        }
      }}
    />
  );
}

// Menu déroulant simple, rendu en pastille
export function PillSelect<T extends string>({ value, options, onChange, icon }: { value: T; options: { id: T; name: string; color?: string }[]; onChange: (v: T) => void; icon?: ReactNode }) {
  const cur = options.find((o) => o.id === value);
  return (
    <Popover
      trigger={(open) => (
        <button type="button" className="pill" onClick={open}>
          {icon}
          {cur?.color && <i className="crm-dot" style={{ ["--c" as string]: cur.color }} />}
          <span className="trunc">{cur?.name}</span>
          <ChevronDown size={12} className="faint" />
        </button>
      )}
    >
      {(close) => (
        <ComboList
          value={value}
          items={options.map((o) => ({ id: o.id, label: o.name, icon: o.color ? <i className="crm-dot" style={{ ["--c" as string]: o.color }} /> : undefined }))}
          onPick={(id) => { if (id) onChange(id as T); close(); }}
        />
      )}
    </Popover>
  );
}

// En-tête de colonne triable
export function SortTh<K extends string>({
  col,
  sort,
  onSort,
  children,
  r,
  cls,
}: {
  col: K;
  sort: { col: K; dir: 1 | -1 };
  onSort: (s: { col: K; dir: 1 | -1 }) => void;
  children: ReactNode;
  r?: boolean;
  cls?: string;
}) {
  const on = sort.col === col;
  return (
    <th className={`${r ? "r " : ""}${cls ?? ""}`} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="crm-th" onClick={() => onSort({ col, dir: on ? (sort.dir === 1 ? -1 : 1) : 1 })}>
        {children}
        {on && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );
}

export function sortRows<T>(rows: T[], key: (r: T) => string | number, dir: 1 | -1) {
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (typeof x === "string" && typeof y === "string" ? x.localeCompare(y, "fr") : x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

/**
 * Fil d'Ariane de page. Monté un tick après la page : le CrumbsProvider réinitialise la surcharge
 * dans son propre effet (exécuté après ceux des enfants), ce qui effacerait un SetCrumbs monté immédiatement.
 */
export function PageCrumbs({ items }: { items: Crumb[] }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, []);
  return ready ? <SetCrumbs items={items} /> : null;
}
