"use client";

import { Fragment } from "react";

import { SetPage, SetSection } from "./shell";

type Keys = (string | "then" | "or")[];

const GROUPS: { title: string; items: { label: string; keys: Keys }[] }[] = [
  {
    title: "Général",
    items: [
      { label: "Palette de commandes et recherche", keys: ["⌘", "K"] },
      { label: "Rechercher", keys: ["/"] },
      { label: "Masquer ou afficher la barre latérale", keys: ["["] },
      { label: "Fermer une fenêtre, un menu ou un tiroir", keys: ["Échap"] },
    ],
  },
  {
    title: "Créer",
    items: [
      { label: "Nouvelle tâche", keys: ["C"] },
      { label: "Nouveau projet", keys: ["P"] },
      { label: "Nouveau deal", keys: ["D"] },
    ],
  },
  {
    title: "Aller à",
    items: [
      { label: "Accueil", keys: ["G", "then", "H"] },
      { label: "Boîte de réception", keys: ["G", "then", "I"] },
      { label: "Mes tâches", keys: ["G", "then", "M"] },
      { label: "Projets", keys: ["G", "then", "P"] },
      { label: "Tâches", keys: ["G", "then", "T"] },
      { label: "Pipeline commercial", keys: ["G", "then", "C"] },
      { label: "Reporting", keys: ["G", "then", "R"] },
      { label: "Réglages", keys: ["G", "then", "S"] },
    ],
  },
  {
    title: "Listes et boîte de réception",
    items: [
      { label: "Élément suivant ou précédent", keys: ["J", "or", "K"] },
      { label: "Ouvrir l'élément sélectionné", keys: ["Entrée"] },
      { label: "Marquer comme lu ou non lu", keys: ["U"] },
      { label: "Archiver la notification", keys: ["E"] },
      { label: "Changer le statut d'une tâche ouverte", keys: ["1", "…", "5"] },
    ],
  },
];

export function ShortcutsSettings() {
  return (
    <SetPage title="Raccourcis clavier" lead="Tout se fait au clavier. Les raccourcis sont désactivés pendant la saisie dans un champ.">
      {GROUPS.map((g) => (
        <SetSection key={g.title} title={g.title}>
          <div className="kbd-list">
            {g.items.map((i) => (
              <div key={i.label} className="kbd-row">
                <span>{i.label}</span>
                <span className="keys">
                  {i.keys.map((k, n) => (
                    <Fragment key={n}>
                      {k === "then" ? <span>puis</span> : k === "or" ? <span>ou</span> : k === "…" ? <span>à</span> : <kbd>{k}</kbd>}
                    </Fragment>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </SetSection>
      ))}
    </SetPage>
  );
}
