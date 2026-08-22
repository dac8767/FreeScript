/**
 * StickyCard (v0.96) — THE card. One component for every card in Notes and
 * Snippets, whether the thing was made in the window or in the script.
 *
 * It used to live inside StickyNotes, so anything outside that file could only
 * imitate it — which is exactly how script to-dos and script notes ended up as
 * second-class lookalikes with a different shape. Extracted here so there is one
 * card and both callers render it instead of reproducing it.
 *
 * It also breaks an import cycle: ScriptNotes needs the card, and StickyNotes
 * needs ScriptNotes. formatDate lives here now, so nothing imports backwards.
 *
 * v5.36, Derek's Notes v2: a note's body is a RICH TEXT field like the
 * annotation window — bold/italic, bullet/numbered/check lists, links,
 * images — so the separate checklist card kind is gone (old ones migrate in
 * shelfMigrate.ts). The mini toolbar shows while the card has focus. The
 * v4.37 height grabber went with the textarea: rows share their height now
 * (the equal-height grid), so a hand-set card height has nothing to mean.
 */
import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { FaCopy, FaRegTrashAlt, FaBold, FaItalic, FaListUl, FaListOl, FaCheckSquare, FaLink, FaRegImage } from 'react-icons/fa';
import type { ShelfCard, ShelfCardType } from '../stores/editorStore';
import { SHELF_COLORS, SHELF_DEFAULT_COLOR, useEditorStore } from '../stores/editorStore';
import { useNotebookStore } from '../stores/notebookStore';
import { readableTextOn } from '../utils/palettes';
import { migrateShelfCards } from '../utils/shelfMigrate';
import { stripHtml } from '../utils/stripHtml';

/** The drag payload for a card: its TEXT, because text/plain is what
 *  ProseMirror pastes when a card is dropped in the script. v6.17, Derek:
 *  dragging a snippet into the editor inserted the card's UUID — the id had
 *  been the payload since v5.24, when setData was added only to satisfy
 *  WebKit's won't-start-a-drag-without-data rule (CLAUDE.md §4). Nothing
 *  reads the payload on reorder (the lists track dragId in state), so the
 *  id was never load-bearing. Snippets carry script text verbatim
 *  (multi-line survives); notes flatten their rich HTML; never empty, or
 *  WebKit refuses the drag. */
export function cardDragText(card: ShelfCard): string {
  const text = card.type === 'snippet' ? (card.text || '') : stripHtml(card.text || '');
  return text || ' ';
}

/** Shared date formatter for card headers. */
export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// v1.2: the title is an editable field, and "Note" reads like a label for the
// card rather than an invitation to type. The ellipsis says "your turn".
// ('todo' remains in the type for files that predate the v5.36 migration.)
export const CARD_PLACEHOLDERS: Record<ShelfCardType, string> = {
  comment: 'Note Title...',
  todo: '✓ List Title...',
  snippet: 'Snippet',
};

export function ColorDots({ card, onUpdate, surface }: { card: ShelfCard; onUpdate: (p: Partial<ShelfCard>) => void; surface?: string }) {
  const [open, setOpen] = useState(false);
  // v4.35 (batch-v9 #5): while the NATIVE color panel is up the pointer is off
  // the row — the pop must not close under it, or the <input> unmounts and
  // every pick lands in the void. Blur (next click anywhere) closes instead.
  const picking = React.useRef(false);
  const cur = card.color || SHELF_DEFAULT_COLOR;
  const isPreset = SHELF_COLORS.some(([c]) => c === cur);
  // v4.37: the closed trigger circle is painted the card's own color and sits
  // ON the card — on a dark card it vanishes. Ring it with the black-or-white
  // that readableTextOn picks for ink on that surface (the card face itself,
  // or whatever surface the caller says the dot is sitting on).
  const ring = readableTextOn(surface || cur);
  // the pop is right-anchored, so the row fans out to the LEFT of the trigger
  // and always stays inside the pane. v4.36 batch-v10 #3, Derek: whatever
  // shows the CURRENT color sits RIGHTMOST — exactly over the closed dot's
  // spot, so opening the pop never moves it — and the custom + swatch takes
  // the FAR (left) end. When the current color IS a custom hex, the custom
  // swatch is the current-color slot and stays rightmost instead.
  const ordered = [...SHELF_COLORS.filter(([c]) => c !== cur), ...SHELF_COLORS.filter(([c]) => c === cur)];
  const customSwatch = (
    <label
      className="swn-color-custom"
      title="Custom color"
      style={isPreset ? undefined : { background: cur, outline: '2px solid #666' }}
    >
      <input
        type="color"
        value={cur}
        onFocus={() => { picking.current = true; }}
        onBlur={() => { picking.current = false; setOpen(false); }}
        onChange={(e) => onUpdate({ color: e.target.value })}
      />
      {isPreset && <span>+</span>}
    </label>
  );
  return (
    <span
      className="swn-color-pick"
      onClick={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
    >
      <span
        className="swn-dot"
        style={{
          background: cur,
          visibility: open ? 'hidden' : 'visible',
          ...(ring ? { borderColor: ring } : {}),
        }}
        title="Note color picker"
        onClick={() => setOpen(true)}
      />
      {open && (
        <span className="swn-color-pop" onMouseLeave={() => { if (!picking.current) setOpen(false); }}>
          {isPreset && customSwatch}
          {ordered.map(([c, name]) => (
            <span
              key={c}
              className="swn-dot"
              title={name}
              style={{ background: c, outline: c === cur ? '2px solid #666' : 'none' }}
              onClick={() => { onUpdate({ color: c }); setOpen(false); }}
            />
          ))}
          {!isPreset && customSwatch}
        </span>
      )}
    </span>
  );
}

/** The rich note body — the annotation window's field, on a card. Its own
 *  component so the TipTap hook never sits below StickyCard's branch returns
 *  (the hooks-after-early-return footgun, CLAUDE.md §4). */
function NoteBody({ card, onUpdate }: { card: ShelfCard; onUpdate: (p: Partial<ShelfCard>) => void }) {
  // a card that reached the renderer unmigrated (collab from an old build)
  // goes through the SAME migration for its initial content — one converter
  const legacyDoc = card.content == null ? migrateShelfCards([card])[0].content ?? null : null;
  const mini = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
      // scrapbook: must be an allowed protocol or Link strips the href (v5.33)
      Link.configure({ openOnClick: false, protocols: ['scrapbook'] }),
      Image,
      TaskList,
      TaskItem.configure({ nested: false }),
      // v5.47, Derek: no helper text in the field — the placeholder is gone.
    ],
    content: (card.content as never) ?? (legacyDoc as never),
    onUpdate: ({ editor }) => onUpdate({ content: editor.getJSON(), text: editor.getText().trim() }),
  }, []);

  // Remote (collab) edits land in the store; fold them in unless this card
  // is the one being typed in. Own updates round-trip identical JSON, so
  // this is a no-op for the local writer.
  useEffect(() => {
    if (!mini || mini.isFocused || card.content == null) return;
    if (JSON.stringify(card.content) !== JSON.stringify(mini.getJSON())) {
      mini.commands.setContent(card.content as never);
    }
  }, [mini, card.content]);

  const onBodyClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('scrapbook:')) {
      e.preventDefault();
      const pageId = href.slice('scrapbook:'.length);
      const nb = useNotebookStore.getState();
      if (nb.pages[pageId]) nb.selectPage(pageId);
      useEditorStore.getState().openTool('notebook');
    } else if (/^https?:/i.test(href)) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener');
    }
  };

  const btn = (active: boolean, title: string, onClick: () => void, child: React.ReactNode) => (
    <button
      className={`swn-mini-btn${active ? ' active' : ''}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      tabIndex={-1}
    >{child}</button>
  );
  const promptLink = () => {
    const url = window.prompt('Link URL:');
    if (url) mini?.chain().focus().setLink({ href: url }).run();
  };
  const promptImage = () => {
    const url = window.prompt('Image URL:');
    if (url) mini?.chain().focus().setImage({ src: url }).run();
  };

  return (
    <div className="swn-note-body">
      {/* shown while the card has focus (CSS :focus-within) */}
      <div className="swn-mini-bar">
        {btn(!!mini?.isActive('bold'), 'Bold', () => mini?.chain().focus().toggleBold().run(), <FaBold />)}
        {btn(!!mini?.isActive('italic'), 'Italic', () => mini?.chain().focus().toggleItalic().run(), <FaItalic />)}
        {btn(!!mini?.isActive('bulletList'), 'Bullet list', () => mini?.chain().focus().toggleBulletList().run(), <FaListUl />)}
        {btn(!!mini?.isActive('orderedList'), 'Numbered list', () => mini?.chain().focus().toggleOrderedList().run(), <FaListOl />)}
        {btn(!!mini?.isActive('taskList'), 'Checklist', () => mini?.chain().focus().toggleTaskList().run(), <FaCheckSquare />)}
        {btn(!!mini?.isActive('link'), 'Insert link', promptLink, <FaLink />)}
        {btn(false, 'Insert image by URL', promptImage, <FaRegImage />)}
      </div>
      <div className="swn-note-editor" onClick={onBodyClick}><EditorContent editor={mini} /></div>
    </div>
  );
}

interface StickyCardProps {
  card: ShelfCard;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDropHere: () => void;
  onUpdate: (p: Partial<ShelfCard>) => void;
  onRemove: () => void;
  /** Replace the card's body while keeping the identical shell. */
  children?: React.ReactNode;
  /** v6.38: extra head-row action buttons (the snippet window's
   *  insert-into-script), rendered beside the card's own actions. */
  headActions?: React.ReactNode;
}

// v4.33: the `anchor` foot ("Linked to Scene 14" / "General") is gone — every
// card in these windows is general now, so there was nothing left to
// distinguish. Script notes/to-dos live in the Navigator instead.
export function StickyCard({ card, dragging, onDragStart, onDragEnd, onDropHere, onUpdate, onRemove, children, headActions }: StickyCardProps) {
  // Header: ⋮⋮ grip drags; the type name is placeholder text in an editable title
  const head = (extra?: React.ReactNode) => (
    <h5 className="swn-card-head">
      <span
        className="swn-drag-grip"
        draggable
        onDragStart={(e) => {
          // v5.24, Derek: "the drag feature isn't working." The consumers
          // pass bare closures, and WebKit refuses to START a drag without
          // dataTransfer data (the house footgun, CLAUDE.md §4) — so the
          // grip sets its own payload; no caller can forget it again.
          e.dataTransfer.setData('text/plain', cardDragText(card));
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(e);
        }}
        onDragEnd={onDragEnd}
        title="Drag to reorder"
      >⋮⋮</span>
      <input
        className="swn-card-title"
        value={card.title || ''}
        placeholder={CARD_PLACEHOLDERS[card.type]}
        onChange={(e) => onUpdate({ title: e.target.value })}
      />
      <span className="swn-card-actions">
        <ColorDots card={card} onUpdate={onUpdate} />
        {extra}
        <button className="swn-x" title="Delete" onClick={onRemove}><FaRegTrashAlt /></button>
      </span>
    </h5>
  );

  const wrap = (inner: React.ReactNode) => (
    <div
      className={'swn-card' + (dragging ? ' dragging' : '')}
      style={{ background: card.color || SHELF_DEFAULT_COLOR }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropHere}
    >
      {inner}
      <div className="swn-card-foot">
        {card.createdAt && <span className="swn-card-date">{formatDate(card.createdAt)}</span>}
      </div>
    </div>
  );

  // A caller can supply the body while keeping the identical shell — this is how
  // a script note gets the same card as a window note without losing its own
  // editor (asset autocomplete, media).
  if (children) return wrap(<>{head()}{children}</>);

  // v5.36: 'comment' AND legacy 'todo' both render the rich body — a todo
  // that somehow escaped migration still shows (its items become content on
  // the next load; NoteBody falls back to `text`, which mirrors them).
  if (card.type === 'comment' || card.type === 'todo') {
    return wrap(<>
      {head()}
      <NoteBody card={card} onUpdate={onUpdate} />
    </>);
  }

  if (card.type === 'snippet') {
    return wrap(<>
      {head((
        <>
          {headActions}
          <button
            className="swn-x"
            title="Copy to clipboard"
            onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(card.text || ''); }}
          ><FaCopy /></button>
        </>
      ))}
      <div className="swn-snippet">{card.text}</div>
    </>);
  }
  return null;
}
