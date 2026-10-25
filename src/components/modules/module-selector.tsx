"use client";

import { useEffect, useRef } from "react";
import { Check, Link2 } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { MODULE, MODULES, PRESETS, withRequirements, withoutModule, type ModuleId } from "@/lib/modules";
import "@/styles/modules.css";

const GROUPS = ["Performance", "Commercial", "Production"] as const;
const same = (a: ModuleId[], b: ModuleId[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Choix des modules : profils types en tête, puis une carte par module avec interrupteur.
 * Les dépendances sont gérées ici (activer Rendez-vous active le CRM, désactiver le CRM coupe Rendez-vous).
 */
export function ModuleSelector({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: ModuleId[];
  onChange: (next: ModuleId[], changed: { id: ModuleId; on: boolean; also: ModuleId[] } | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const preset = PRESETS.find((p) => same(p.modules, value));
  const toggle = (id: ModuleId) => {
    if (disabled) return;
    if (value.includes(id)) {
      if (value.length === 1) return; // au moins un module
      const next = withoutModule(value, id);
      onChange(next, { id, on: false, also: value.filter((m) => m !== id && !next.includes(m)) });
    } else {
      const next = withRequirements([...value, id]);
      onChange(next, { id, on: true, also: next.filter((m) => m !== id && !value.includes(m)) });
    }
  };
  // Toute une section d'un coup : allume ce qui manque, ou éteint tout si tout est allumé
  const toggleGroup = (ids: ModuleId[]) => {
    if (disabled) return;
    const allOn = ids.every((id) => value.includes(id));
    if (allOn) {
      const next = ids.reduce((v, id) => withoutModule(v, id), value);
      if (!next.length) return; // au moins un module
      const off = value.filter((m) => !next.includes(m));
      onChange(next, { id: off[0], on: false, also: off.slice(1) });
    } else {
      const next = withRequirements([...value, ...ids]);
      const added = next.filter((m) => !value.includes(m));
      onChange(next, { id: added[0], on: true, also: added.slice(1) });
    }
  };
  return (
    <div className={`mods${compact ? " compact" : ""}`}>
      <div className="mods-presets" role="radiogroup" aria-label="Profils types">
        {PRESETS.map((p) => {
          const on = preset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              className={`mods-preset${on ? " on" : ""}`}
              onClick={() => onChange(p.modules, null)}
            >
              <Icon name={p.icon} size={16} />
              <b>{p.name}</b>
              <span>{p.desc}</span>
            </button>
          );
        })}
      </div>
      <p className="mods-hint">{preset ? "Profil choisi. Ajuste module par module si besoin :" : "Sélection personnalisée :"}</p>
      {GROUPS.map((g) => {
        const ids = MODULES.filter((m) => m.group === g).map((m) => m.id);
        const on = ids.filter((id) => value.includes(id)).length;
        // Éteindre la section viderait l'espace : interrupteur bloqué
        const lastGroup = on === ids.length && value.every((m) => ids.includes(m));
        return (
        <div key={g} className="mods-group">
          <div className="mods-gh">
            <span>{g}</span>
            <GroupToggle
              all={on === ids.length}
              some={on > 0 && on < ids.length}
              disabled={disabled || lastGroup}
              title={lastGroup ? "Garde au moins un module" : on === ids.length ? `Désactiver toute la section ${g}` : `Activer toute la section ${g}`}
              onToggle={() => toggleGroup(ids)}
              label={g}
            />
          </div>
          <div className="mods-grid">
            {MODULES.filter((m) => m.group === g).map((m) => {
              const on = value.includes(m.id);
              const needs = (m.requires ?? []).map((r) => MODULE[r].name);
              const last = on && value.length === 1;
              return (
                <label key={m.id} className={`mods-card${on ? " on" : ""}${disabled ? " ro" : ""}`}>
                  <span className="mods-ic">
                    <Icon name={m.icon} size={17} />
                  </span>
                  <span className="mods-txt">
                    <b>{m.name}</b>
                    <span className="d">{m.desc}</span>
                    {!compact && (
                      <span className="inc">
                        {m.includes.map((x) => (
                          <span key={x}>
                            <Check size={11} />
                            {x}
                          </span>
                        ))}
                      </span>
                    )}
                    {needs.length > 0 && (
                      <span className="req">
                        <Link2 size={11} />
                        Nécessite {needs.join(", ")}
                      </span>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={on}
                    disabled={disabled || last}
                    title={last ? "Garde au moins un module" : undefined}
                    onChange={() => toggle(m.id)}
                    aria-label={`${on ? "Désactiver" : "Activer"} ${m.name}`}
                  />
                </label>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}

/** Interrupteur de section : allumé si tous ses modules le sont, à mi-course si une partie seulement. */
function GroupToggle({ all, some, disabled, title, onToggle, label }: { all: boolean; some: boolean; disabled?: boolean; title: string; onToggle: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="toggle"
      checked={all}
      disabled={disabled}
      title={title}
      onChange={onToggle}
      aria-label={`${all ? "Désactiver" : "Activer"} toute la section ${label}`}
      aria-checked={some ? "mixed" : all}
    />
  );
}
