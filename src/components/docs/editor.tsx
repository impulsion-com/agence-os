"use client";

// Éditeur des Docs, sur Tiptap (open source, MIT) comme Docmost et Outline.
// Les raccourcis Markdown marchent à la frappe, comme dans Notion : « # » titre,
// « - » liste, « [] » case à cocher, « > » citation, « ``` » code.
// Les images se collent, se glissent ou s'envoient par le bouton : elles partent dans le
// stockage de l'espace, jamais en base64 dans la page.
//
// Le contenu reçu est toujours relu par l'éditeur, qui ne garde que les nœuds de son
// schéma : aucun HTML venu d'une page n'est injecté tel quel.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import {
  Bold, Code, Heading1, Heading2, Heading3, ImagePlus, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, LoaderCircle, Minus, Quote,
  Redo2, SquareCode, Strikethrough, Table as TableIcon, Underline, Undo2,
} from "lucide-react";

import { supabaseBrowser } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/context";
import { uploadDocFile } from "@/lib/docs/upload";

function extensions(placeholder?: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { target: null, rel: "noopener noreferrer" } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Image,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

/** Lecture seule (aperçu d'une version) : même schéma, donc même nettoyage du HTML. */
export function DocReader({ content }: { content: string }) {
  const editor = useEditor({ immediatelyRender: false, editable: false, extensions: extensions(), content, editorProps: { attributes: { class: "docs-prose" } } });
  return <EditorContent editor={editor} />;
}

export function DocEditor({
  content,
  editable,
  onChange,
  onError,
}: {
  content: string;
  editable: boolean;
  onChange: (html: string, text: string) => void;
  onError: (message: string) => void;
}) {
  const ws = useWorkspace();
  const router = useRouter();
  const [uploads, setUploads] = useState(0);
  // Les gestionnaires de Tiptap sont figés à la création : passer par une ref
  const cb = useRef({ onChange, onError });
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    cb.current = { onChange, onError };
  });

  const insertFiles = async (editor: Editor, files: File[], pos?: number) => {
    for (const f of files) {
      setUploads((n) => n + 1);
      try {
        const r = await uploadDocFile(supabaseBrowser(), ws.workspace.id, f, f.name);
        const chain = editor.chain().focus();
        if (pos !== undefined) chain.setTextSelection(pos);
        if (r.image) chain.setImage({ src: r.url, alt: r.name }).run();
        else chain.insertContent({ type: "text", text: r.name, marks: [{ type: "link", attrs: { href: r.url } }] }).run();
      } catch (e) {
        cb.current.onError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploads((n) => n - 1);
      }
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: extensions("Écris ici. « # » pour un titre, « [] » pour une case à cocher, colle une capture d'écran…"),
    content,
    onUpdate: ({ editor }) => cb.current.onChange(editor.getHTML(), editor.getText({ blockSeparator: "\n" })),
    editorProps: {
      attributes: { class: "docs-prose docs-editable" },
      // Un lien s'ouvre au clic : les pages de l'app sur place, le reste dans un nouvel onglet
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest("a[href]");
        const href = a?.getAttribute("href");
        if (!href || event.button !== 0) return false;
        event.preventDefault();
        if (href.startsWith("/") && !href.startsWith("//") && !event.metaKey && !event.ctrlKey) router.push(href);
        else window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length || !editorRef.current) return false;
        event.preventDefault();
        void insertFiles(editorRef.current, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || !files.length || !editorRef.current) return false;
        event.preventDefault();
        void insertFiles(editorRef.current, files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  if (!editor) return <div style={{ minHeight: "40vh" }} />;
  return (
    <div>
      {editable && <Toolbar editor={editor} uploads={uploads} onFiles={(f) => insertFiles(editor, f)} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Btn({ on, onClick, title, children, disabled }: { on?: boolean; onClick: () => void; title: string; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`btn btn-ghost btn-sm btn-icon${on ? " docs-tool-on" : ""}`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="docs-tool-sep" />;

function Toolbar({ editor, uploads, onFiles }: { editor: Editor; uploads: number; onFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState<string | null>(null);
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"),
      code: e.isActive("code"), link: e.isActive("link"), bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"),
      tasks: e.isActive("taskList"), quote: e.isActive("blockquote"), codeBlock: e.isActive("codeBlock"), table: e.isActive("table"),
      undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  const applyLink = () => {
    const u = (link ?? "").trim();
    if (!u) c().extendMarkRange("link").unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: /^(https?:|mailto:|\/)/i.test(u) ? u : `https://${u}` }).run();
    setLink(null);
  };
  const s = 15;

  return (
    <div className="docs-toolbar">
      <div className="docs-tools">
        <Btn title="Titre 1" on={st.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}><Heading1 size={s} /></Btn>
        <Btn title="Titre 2" on={st.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}><Heading2 size={s} /></Btn>
        <Btn title="Titre 3" on={st.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}><Heading3 size={s} /></Btn>
        <Sep />
        <Btn title="Gras (⌘B)" on={st.bold} onClick={() => c().toggleBold().run()}><Bold size={s} /></Btn>
        <Btn title="Italique (⌘I)" on={st.italic} onClick={() => c().toggleItalic().run()}><Italic size={s} /></Btn>
        <Btn title="Souligné (⌘U)" on={st.underline} onClick={() => c().toggleUnderline().run()}><Underline size={s} /></Btn>
        <Btn title="Barré" on={st.strike} onClick={() => c().toggleStrike().run()}><Strikethrough size={s} /></Btn>
        <Btn title="Code" on={st.code} onClick={() => c().toggleCode().run()}><Code size={s} /></Btn>
        <Btn title="Lien" on={st.link} onClick={() => setLink(link === null ? (editor.getAttributes("link").href ?? "") : null)}><LinkIcon size={s} /></Btn>
        <Sep />
        <Btn title="Liste à puces" on={st.bullet} onClick={() => c().toggleBulletList().run()}><List size={s} /></Btn>
        <Btn title="Liste numérotée" on={st.ordered} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={s} /></Btn>
        <Btn title="Cases à cocher" on={st.tasks} onClick={() => c().toggleTaskList().run()}><ListChecks size={s} /></Btn>
        <Btn title="Citation" on={st.quote} onClick={() => c().toggleBlockquote().run()}><Quote size={s} /></Btn>
        <Btn title="Bloc de code" on={st.codeBlock} onClick={() => c().toggleCodeBlock().run()}><SquareCode size={s} /></Btn>
        <Btn title="Séparateur" onClick={() => c().setHorizontalRule().run()}><Minus size={s} /></Btn>
        <Btn title="Tableau" on={st.table} onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={s} /></Btn>
        <Btn title="Image ou PDF" onClick={() => input.current?.click()}>
          {uploads ? <LoaderCircle size={s} className="spin" /> : <ImagePlus size={s} />}
        </Btn>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          multiple
          className="sr"
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <Sep />
        <Btn title="Annuler (⌘Z)" disabled={!st.undo} onClick={() => c().undo().run()}><Undo2 size={s} /></Btn>
        <Btn title="Rétablir (⇧⌘Z)" disabled={!st.redo} onClick={() => c().redo().run()}><Redo2 size={s} /></Btn>
      </div>

      {st.table && (
        <div className="docs-tools docs-tools-sub">
          <span className="faint">Tableau :</span>
          {(
            [
              ["+ ligne", () => c().addRowAfter().run()],
              ["+ colonne", () => c().addColumnAfter().run()],
              ["- ligne", () => c().deleteRow().run()],
              ["- colonne", () => c().deleteColumn().run()],
              ["Supprimer le tableau", () => c().deleteTable().run()],
            ] as [string, () => void][]
          ).map(([label, run]) => (
            <button key={label} type="button" className="btn btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={run}>
              {label}
            </button>
          ))}
        </div>
      )}

      {link !== null && (
        <form
          className="docs-tools docs-tools-sub"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            className="input"
            style={{ height: "var(--h-sm)", flex: 1 }}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLink(null)}
            placeholder="https://… ou un lien vers une autre page (vide pour retirer le lien)"
          />
          <button type="submit" className="btn btn-primary btn-sm">OK</button>
        </form>
      )}
    </div>
  );
}
