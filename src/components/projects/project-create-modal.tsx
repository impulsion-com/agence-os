"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { AssigneePicker, CompanyPicker, DatePicker } from "@/components/pickers";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { ObjIcon } from "@/components/ui/misc";
import { Modal, Popover } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { COLORS, PLATFORMS, PROJECT_ICONS, PROJECT_STATUS, PROJECT_TEMPLATES, colorOf } from "@/lib/constants";
import { addDays, iso, parseDay, today } from "@/lib/format";
import type { TablesInsert } from "@/lib/database.types";
import type { Project, ProjectStatus } from "@/lib/types";
import { must, useMutate, useWorkspace } from "@/lib/workspace/context";

import "@/styles/projects.css";

const PROJECT_COLORS = ["indigo", "blue", "violet", "teal", "green", "amber", "orange", "rose", "red", "slate"];

/** Clé proposée à partir du nom : initiales ou premières lettres, 2 à 6 caractères, unique. */
export function suggestKey(name: string, taken: string[]) {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["LE", "LA", "LES", "DE", "DU", "DES", "ET", "L", "D"].includes(w));
  if (!words.length) return "";
  let base = words.length >= 2 ? words.map((w) => w[0]).join("").slice(0, 4) : words[0].slice(0, 3);
  if (base.length < 2) base = (words[0] + "XX").slice(0, 3);
  if (base.length < 3 && words[0].length >= 3) base = words[0].slice(0, 3);
  let key = base;
  let i = 2;
  while (taken.includes(key)) key = `${base.slice(0, 5)}${i++}`.slice(0, 6);
  return key;
}

const cleanKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

/**
 * Création (ou modification si `project` est fourni) d'un projet.
 * À la création : modèle de tâches de départ, journal project.created, redirection.
 */
export interface ProjectDefaults {
  company_id?: string | null;
  template?: string;
  name?: string;
  monthly_budget?: number | null;
}

export function ProjectCreateModal({ onClose, project, memberIds = [], defaults = {} }: { onClose: () => void; project?: Project; memberIds?: string[]; defaults?: ProjectDefaults }) {
  const ws = useWorkspace();
  const mutate = useMutate();
  const router = useRouter();
  const toast = useToast();
  const editing = !!project;
  const taken = ws.projects.filter((p) => p.id !== project?.id).map((p) => p.key);

  const [name, setName] = useState(project?.name ?? defaults.name ?? "");
  const [key, setKey] = useState(project?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(editing);
  const [company, setCompany] = useState<string | null>(project?.company_id ?? defaults.company_id ?? null);
  const [icon, setIcon] = useState(project?.icon ?? "megaphone");
  const [color, setColor] = useState(project?.color ?? "indigo");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "planning");
  const [lead, setLead] = useState<string | null>(project?.lead_id ?? ws.me.id);
  const [team, setTeam] = useState<string[]>(memberIds);
  const [platforms, setPlatforms] = useState<string[]>(project?.platforms ?? []);
  const [budget, setBudget] = useState(project?.monthly_budget ? String(project.monthly_budget) : defaults.monthly_budget ? String(defaults.monthly_budget) : "");
  const [start, setStart] = useState<string | null>(project?.start_date ?? (editing ? null : iso(today())));
  const [due, setDue] = useState<string | null>(project?.due_date ?? null);
  const [description, setDescription] = useState(project?.description ?? "");
  const [template, setTemplate] = useState(defaults.template ?? "blank");
  const [busy, setBusy] = useState(false);

  const keyErr = !key ? "" : !/^[A-Z0-9]{2,6}$/.test(key) ? "2 à 6 lettres ou chiffres" : taken.includes(key) ? "Cette clé est déjà prise par un autre projet" : "";
  const valid = name.trim() && /^[A-Z0-9]{2,6}$/.test(key) && !keyErr;

  const onName = (v: string) => {
    setName(v);
    if (!keyTouched) setKey(suggestKey(v, taken));
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const fields = {
      name: name.trim(), key, company_id: company, icon, color, status, lead_id: lead, platforms,
      monthly_budget: budget ? Number(budget.replace(",", ".")) || null : null, start_date: start, due_date: due, description,
    };
    if (editing) {
      const ok = await mutate(
        async (sb) => {
          must(await sb.from("projects").update(fields).eq("id", project.id));
          const add = team.filter((u) => !memberIds.includes(u));
          const del = memberIds.filter((u) => !team.includes(u));
          if (del.length) must(await sb.from("project_members").delete().eq("project_id", project.id).in("user_id", del));
          if (add.length) must(await sb.from("project_members").insert(add.map((user_id) => ({ project_id: project.id, user_id }))));
          if (fields.status !== project.status)
            await sb.from("activity").insert({ workspace_id: ws.workspace.id, project_id: project.id, verb: "project.status", meta: { name: fields.name, from: project.status, to: fields.status } });
          return true;
        },
        { success: "Projet mis à jour" },
      );
      setBusy(false);
      if (ok) {
        onClose();
        if (key !== project.key) router.replace(`${ws.base}/projects/${key}/overview`);
      }
      return;
    }
    const tpl = PROJECT_TEMPLATES.find((t) => t.id === template)!;
    const created = await mutate(
      async (sb) => {
        const p = must(await sb.from("projects").insert({ ...fields, workspace_id: ws.workspace.id }).select("id, key").single())!;
        const members = [...new Set([...team, ...(lead ? [lead] : [])])];
        if (members.length) must(await sb.from("project_members").insert(members.map((user_id) => ({ project_id: p.id, user_id }))));
        const base = parseDay(start) ?? today();
        for (const [i, t] of tpl.tasks.entries()) {
          const row = {
            workspace_id: ws.workspace.id, project_id: p.id, title: t.title, status: "todo", position: (i + 1) * 1000,
            due_date: t.due !== undefined ? iso(addDays(base, t.due)) : null, milestone: !!t.milestone, assignee_id: lead,
          } as unknown as TablesInsert<"tasks">;
          const task = must(await sb.from("tasks").insert(row).select("id").single())!;
          const label = t.label ? ws.labels.find((l) => l.name.toLowerCase() === t.label!.toLowerCase()) : undefined;
          if (label) must(await sb.from("task_labels").insert({ task_id: task.id, label_id: label.id }));
        }
        await sb.from("activity").insert({ workspace_id: ws.workspace.id, project_id: p.id, verb: "project.created", meta: { name: fields.name, template: tpl.id } });
        return p;
      },
      { refresh: false },
    );
    setBusy(false);
    if (created) {
      toast(tpl.tasks.length ? `Projet créé avec ${tpl.tasks.length} tâches de départ` : "Projet créé");
      onClose();
      router.push(`${ws.base}/projects/${created.key}/board`);
      router.refresh();
    }
  };

  return (
    <Modal
      title={editing ? "Modifier le projet" : "Nouveau projet"}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="faint pj-modal-hint">⌘ + Entrée pour {editing ? "enregistrer" : "créer"}</span>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            {editing ? "Enregistrer" : "Créer le projet"}
          </button>
        </>
      }
    >
      <div
        className="pj-form"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <div className="pj-form-name">
          <Popover
            width={260}
            trigger={(open) => (
              <button type="button" className="pj-icon-btn" onClick={open} aria-label="Icône et couleur">
                <ObjIcon icon={icon} color={color} size={40} />
              </button>
            )}
          >
            {() => (
              <div style={{ padding: 6 }}>
                <div className="mi-h" style={{ padding: "2px 2px 6px" }}>Couleur</div>
                <div className="pj-swatches">
                  {PROJECT_COLORS.map((c) => (
                    <button key={c} type="button" aria-label={c} className={`pj-swatch${c === color ? " on" : ""}`} style={{ background: COLORS[c] }} onClick={() => setColor(c)}>
                      {c === color && <Check size={12} color="#fff" />}
                    </button>
                  ))}
                </div>
                <div className="mi-h" style={{ padding: "10px 2px 6px" }}>Icône</div>
                <div className="pj-icons">
                  {PROJECT_ICONS.map((i) => (
                    <button key={i} type="button" aria-label={i} className={`pj-icon-opt${i === icon ? " on" : ""}`} style={{ ["--c" as string]: colorOf(color) }} onClick={() => setIcon(i)}>
                      <Icon name={i} size={16} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Popover>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="pj-name">Nom du projet</label>
            <input id="pj-name" className="input lg" autoFocus placeholder="Ex. Maison Lumen · Q4 Meta Ads" value={name} onChange={(e) => onName(e.target.value)} />
          </div>
          <div className="field" style={{ width: 110 }}>
            <label htmlFor="pj-key">Clé</label>
            <input
              id="pj-key"
              className="input lg mono"
              placeholder="LUM"
              value={key}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(cleanKey(e.target.value));
              }}
              aria-invalid={!!keyErr}
            />
          </div>
        </div>
        {keyErr ? <span className="err pj-key-err">{keyErr}</span> : <span className="hint pj-key-err">Les tâches seront numérotées {key || "CLÉ"}-1, {key || "CLÉ"}-2…</span>}

        <div className="pj-grid">
          <div className="field">
            <span className="label">Client</span>
            <CompanyPicker value={company} onChange={setCompany} trigger={(open) => <PillField open={open} text={ws.company(company)?.name ?? "Projet interne"} empty={!company} />} />
          </div>
          <div className="field">
            <span className="label">Statut</span>
            <Popover trigger={(open) => <PillField open={open} text={PROJECT_STATUS[status].name} dot={PROJECT_STATUS[status].color} />}>
              {(close) => (
                <div>
                  {(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => (
                    <button key={s} type="button" className="mi" onClick={() => { setStatus(s); close(); }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: PROJECT_STATUS[s].color }} />
                      {PROJECT_STATUS[s].name}
                      {s === status && <span className="sub">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          </div>
          <div className="field">
            <span className="label">Responsable</span>
            <AssigneePicker value={lead} onChange={setLead} trigger={(open) => <PillField open={open} text={ws.member(lead)?.profile.full_name ?? "Aucun"} empty={!lead} avatar={lead} />} />
          </div>
          <div className="field">
            <span className="label">Équipe</span>
            <Popover
              width={240}
              trigger={(open) => (
                <button type="button" className="pj-pillfield" onClick={open}>
                  {team.length ? (
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", minWidth: 0 }}>
                      {team.slice(0, 5).map((id) => (
                        <Avatar key={id} profile={ws.member(id)?.profile} size={18} />
                      ))}
                      <span className="faint trunc">{team.length} membre{team.length > 1 ? "s" : ""}</span>
                    </span>
                  ) : (
                    <span className="faint">Ajouter des membres</span>
                  )}
                </button>
              )}
            >
              {() => (
                <div>
                  {ws.members.map((m) => {
                    const on = team.includes(m.user_id);
                    return (
                      <button key={m.user_id} type="button" className="mi" onClick={() => setTeam(on ? team.filter((x) => x !== m.user_id) : [...team, m.user_id])}>
                        <input type="checkbox" className="check" readOnly checked={on} tabIndex={-1} />
                        <Avatar profile={m.profile} size={18} title={false} />
                        <span className="trunc">{m.profile.full_name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Popover>
          </div>
          <div className="field">
            <span className="label">Début</span>
            <DatePicker value={start} onChange={setStart} placeholder="Date de début" trigger={(open) => <PillField open={open} text={start ? parseDay(start)!.toLocaleDateString("fr-FR") : "Date de début"} empty={!start} />} />
          </div>
          <div className="field">
            <span className="label">Échéance</span>
            <DatePicker value={due} onChange={setDue} trigger={(open) => <PillField open={open} text={due ? parseDay(due)!.toLocaleDateString("fr-FR") : "Date de fin"} empty={!due} />} />
          </div>
          <div className="field">
            <label htmlFor="pj-budget">Budget média mensuel</label>
            <div className="pj-money">
              <input id="pj-budget" className="input num" inputMode="decimal" placeholder="0" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.,]/g, ""))} />
              <span className="faint">{ws.workspace.currency === "EUR" ? "€" : ws.workspace.currency} / mois</span>
            </div>
          </div>
          <div className="field">
            <span className="label">Plateformes</span>
            <div className="pj-platforms">
              {PLATFORMS.map((p) => {
                const on = platforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    className={`pj-plat${on ? " on" : ""}`}
                    style={{ ["--c" as string]: p.color }}
                    onClick={() => setPlatforms(on ? platforms.filter((x) => x !== p.id) : [...platforms, p.id])}
                  >
                    {p.name.replace(" Ads", "")}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="pj-desc">Description</label>
          <textarea id="pj-desc" className="textarea" rows={2} style={{ minHeight: 60 }} placeholder="Objectif, KPI visés, contexte…" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {!editing && (
          <div className="field">
            <span className="label">Modèle de départ</span>
            <div className="pj-templates" role="radiogroup" aria-label="Modèle de départ">
              {PROJECT_TEMPLATES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={template === t.id} className={`pj-tpl${template === t.id ? " on" : ""}`} onClick={() => setTemplate(t.id)}>
                  <Icon name={t.icon} size={16} />
                  <span style={{ minWidth: 0 }}>
                    <b>{t.name}</b>
                    <span className="faint">{t.tasks.length ? `${t.tasks.length} tâches · ${t.desc}` : t.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PillField({ open, text, empty, dot, avatar }: { open: (e: React.MouseEvent) => void; text: string; empty?: boolean; dot?: string; avatar?: string | null }) {
  const ws = useWorkspace();
  return (
    <button type="button" className="pj-pillfield" onClick={open}>
      {dot && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />}
      {avatar !== undefined && avatar && <Avatar profile={ws.member(avatar)?.profile} size={18} title={false} />}
      <span className={`trunc${empty ? " faint" : ""}`}>{text}</span>
    </button>
  );
}
