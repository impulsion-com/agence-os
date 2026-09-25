import type { Priority, TaskStatus } from "@/lib/types";

// Icône de statut dessinée : cercle pointillé, vide, demi, trois-quarts, coché.
export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const c = `var(--st-${status})`;
  const r = 6;
  const circ = 2 * Math.PI * 3;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden style={{ flexShrink: 0 }}>
      {status === "backlog" && <circle cx="8" cy="8" r={r} fill="none" stroke={c} strokeWidth="1.6" strokeDasharray="2.2 2.2" />}
      {status === "todo" && <circle cx="8" cy="8" r={r} fill="none" stroke={c} strokeWidth="1.6" />}
      {(status === "progress" || status === "review") && (
        <>
          <circle cx="8" cy="8" r={r} fill="none" stroke={c} strokeWidth="1.6" />
          <circle
            cx="8" cy="8" r="3" fill="none" stroke={c} strokeWidth="6"
            strokeDasharray={`${circ * (status === "progress" ? 0.5 : 0.75)} ${circ}`}
            transform="rotate(-90 8 8)"
          />
        </>
      )}
      {status === "done" && (
        <>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="var(--surface)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

// Barres de priorité (3 barres), point d'exclamation pour urgent.
export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  if (priority === "urgent")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden style={{ flexShrink: 0 }}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="var(--red)" />
        <path d="M8 4.5v4.2M8 11.2v.3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  if (priority === "none")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden style={{ flexShrink: 0 }}>
        {[3, 7, 11].map((x) => (
          <rect key={x} x={x} y="7.2" width="2.2" height="1.6" rx=".6" fill="var(--text-4)" />
        ))}
      </svg>
    );
  const lvl = { high: 3, medium: 2, low: 1 }[priority];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden style={{ flexShrink: 0 }}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2.5 + i * 4} y={10 - i * 3.2} width="2.6" height={3.4 + i * 3.2} rx=".8" fill={i < lvl ? "var(--text-2)" : "var(--border-strong)"} />
      ))}
    </svg>
  );
}
