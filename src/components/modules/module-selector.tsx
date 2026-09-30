"use client";

import { Check, Link2 } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { MODULE, MODULES, PRESETS, withRequirements, withoutModule, type ModuleId } from "@/lib/modules";
import "@/styles/modules.css";

const GROUPS = ["Production", "Commercial", "Performance"] as const;
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
      {GROUPS.map((g) => (
        <div key={g} className="mods-group">
          <div className="mods-gh">{g}</div>
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
      ))}
    </div>
  );
}
