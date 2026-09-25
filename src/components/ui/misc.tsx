import type { ReactNode } from "react";

import { colorOf } from "@/lib/constants";
import { Icon } from "./icon";

export function EmptyState({ icon = "inbox", title, text, children }: { icon?: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ic">
        <Icon name={icon} size={18} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div style={{ marginTop: 8, display: "flex", gap: 8 }}>{children}</div>}
    </div>
  );
}

export function Progress({ value, color }: { value: number; color?: string }) {
  return (
    <span className="prog" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} style={color ? { ["--c" as string]: color } : undefined}>
      <i style={{ ["--p" as string]: Math.max(0, Math.min(100, value)) / 100 }} />
    </span>
  );
}

export function LabelChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="chip" style={{ ["--c" as string]: colorOf(color) }}>
      <i />
      {name}
    </span>
  );
}

export function ObjIcon({ icon, color, size = 26 }: { icon: string; color: string; size?: number }) {
  return (
    <span className="obj-ic" style={{ ["--s" as string]: `${size}px`, ["--c" as string]: colorOf(color) }}>
      <Icon name={icon} size={Math.round(size * 0.58)} />
    </span>
  );
}

export function Badge({ color, children, plain }: { color: string; children: ReactNode; plain?: boolean }) {
  return (
    <span className={`badge${plain ? " plain" : ""}`} style={{ ["--c" as string]: color }}>
      {children}
    </span>
  );
}

export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ph">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}
