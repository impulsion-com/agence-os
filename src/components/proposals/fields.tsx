"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { MenuList, Popover } from "@/components/ui/overlay";

export interface Option {
  id: string;
  label: string;
  sub?: string;
}

/** Sélecteur compact en pastille, avec recherche (contacts, deals…). */
export function SelectPill({
  value,
  options,
  onChange,
  placeholder,
  icon,
  search,
  noneLabel = "Aucun",
  bordered,
  disabled,
}: {
  value: string | null;
  options: Option[];
  onChange: (v: string | null) => void;
  placeholder: string;
  icon?: ReactNode;
  search?: string;
  noneLabel?: string;
  bordered?: boolean;
  disabled?: boolean;
}) {
  const cur = options.find((o) => o.id === value);
  return (
    <Popover
      width={280}
      trigger={(open) => (
        <button
          type="button"
          className={`pill${bordered ? " bordered" : ""}${cur ? "" : " empty"}`}
          onClick={open}
          disabled={disabled}
          aria-haspopup="menu"
          style={{ maxWidth: "100%" }}
        >
          {icon}
          <span className="trunc">{cur?.label ?? placeholder}</span>
          {bordered && <ChevronDown size={13} className="fainter" style={{ marginLeft: "auto" }} />}
        </button>
      )}
    >
      {(close) => (
        <MenuList
          onClose={close}
          search={search ?? "Rechercher…"}
          items={[
            { label: noneLabel, checked: !value, onSelect: () => onChange(null) },
            ...options.map((o) => ({ label: o.label, sub: o.sub, checked: o.id === value, onSelect: () => onChange(o.id) })),
          ]}
        />
      )}
    </Popover>
  );
}

/** Textarea qui grandit avec son contenu. */
export function AutoTextarea({
  value,
  onChange,
  className = "",
  placeholder,
  ariaLabel,
  onKeyDown,
  autoFocus,
  minRows = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
  minRows?: number;
}) {
  return (
    <textarea
      className={`pe-auto ${className}`}
      value={value}
      rows={minRows}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
      ref={(el) => {
        // Repli pour les navigateurs sans field-sizing: content
        if (el && !CSS.supports?.("field-sizing", "content")) {
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }
      }}
    />
  );
}
