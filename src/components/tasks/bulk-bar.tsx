"use client";

import { Archive, Calendar, CircleDot, SignalHigh, Tag, Trash2, UserRound, X } from "lucide-react";

import { AssigneePicker, DatePicker, PriorityPicker, StatusPicker } from "@/components/pickers";
import { Popover } from "@/components/ui/overlay";
import { colorOf } from "@/lib/constants";
import { useWorkspace } from "@/lib/workspace/context";
import { useKit } from "./kit";

/** Barre d'actions groupées, visible dès qu'une tâche est sélectionnée. */
export function BulkBar() {
  const kit = useKit();
  const ws = useWorkspace();
  const list = kit.tasks.filter((t) => kit.selected.has(t.id));
  if (!list.length || !kit.canWrite) return null;
  const n = list.length;
  const one = n === 1 ? list[0] : undefined;
  const opts = { undo: true };
  const btn = (icon: React.ReactNode, label: string) =>
    function BulkTrigger(open: (e: React.MouseEvent) => void) {
      return (
        <button type="button" className="btn btn-ghost btn-sm" onClick={open}>
          {icon}
          <span className="tv-hide-sm">{label}</span>
        </button>
      );
    };
  return (
    <div className="bulkbar tk-bulkbar" role="toolbar" aria-label="Actions groupées">
      <span className="tk-bulk-count num">
        {n} sélectionnée{n > 1 ? "s" : ""}
      </span>
      <StatusPicker value={one?.status ?? "todo"} trigger={btn(<CircleDot size={14} />, "Statut")} onChange={(status) => void kit.actions.update(list, { status }, { ...opts, toast: "Statut mis à jour" })} />
      <PriorityPicker value={one?.priority ?? "none"} trigger={btn(<SignalHigh size={14} />, "Priorité")} onChange={(priority) => void kit.actions.update(list, { priority }, { ...opts, toast: "Priorité mise à jour" })} />
      <AssigneePicker value={one?.assignee_id ?? null} trigger={btn(<UserRound size={14} />, "Responsable")} onChange={(assignee_id) => void kit.actions.update(list, { assignee_id }, { ...opts, toast: "Responsable mis à jour" })} />
      <DatePicker value={one?.due_date ?? null} trigger={btn(<Calendar size={14} />, "Échéance")} onChange={(due_date) => void kit.actions.update(list, { due_date }, { ...opts, toast: "Échéance mise à jour" })} />
      <Popover trigger={btn(<Tag size={14} />, "Étiquettes")}>
        {() => (
          <div>
            <div className="mi-h">Ajouter ou retirer</div>
            {ws.labels.map((l) => {
              const all = list.every((t) => t.label_ids.includes(l.id));
              const some = !all && list.some((t) => t.label_ids.includes(l.id));
              return (
                <button key={l.id} type="button" className="mi" onClick={() => void kit.actions.toggleLabel(list, l.id)}>
                  <input type="checkbox" className="check" readOnly checked={all} tabIndex={-1} style={some ? { borderColor: "var(--accent)" } : undefined} />
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: colorOf(l.color) }} />
                  {l.name}
                  {some && <span className="sub">partiel</span>}
                </button>
              );
            })}
          </div>
        )}
      </Popover>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          void kit.actions.archive(list);
          kit.clearSelection();
        }}
      >
        <Archive size={14} />
        <span className="tv-hide-sm">Archiver</span>
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => kit.confirmDelete(list)}>
        <Trash2 size={14} />
        <span className="tv-hide-sm">Supprimer</span>
      </button>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Annuler la sélection (Échap)" title="Annuler la sélection (Échap)" onClick={kit.clearSelection}>
        <X size={14} />
      </button>
    </div>
  );
}
