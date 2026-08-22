/**
 * ScriptNotePopover (v4.33, Derek) — THE editing surface for script notes.
 *
 * The Notes window is general-only now; a note anchored in the script is
 * read and edited HERE, in a small popover that opens on the highlight
 * itself (click the highlight, toolbar Note button on a noted range, or
 * context menu → Edit Note). The Navigator lists script notes and jumps
 * to them.
 *
 * Everything in here moved from the old Notes-window script card: the
 * title/text inputs, @asset autocomplete, media preview, color dots that
 * recolor the highlight mark, and delete-with-highlight-removal.
 *
 * Positioning: portalled to document.body, fixed coords measured from the
 * highlight span (top/left only — WebKit collapses bottom-anchored boxes),
 * re-measured on scroll/resize. If the span disappears (text deleted,
 * highlight removed), the popover closes rather than floating orphaned.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaRegTrashAlt } from 'react-icons/fa';
import type { Editor } from '@tiptap/react';
import { useEditorStore, type NoteColor, type ShelfCard } from '../stores/editorStore';
import { ColorDots, CARD_PLACEHOLDERS, formatDate } from './StickyCard';
import {
  NoteContentDisplay, noteStickyBg, hasRichContent,
  shelfHexForNote, noteColorForShelfHex, getNoteColorHex,
} from './ScriptNotes';
import { useAssetStore, type Asset } from '../stores/assetStore';
import { useProjectStore } from '../stores/projectStore';

const POPOVER_WIDTH = 340;

/** First rendered span of the note's highlight mark, if it's on screen. */
const findAnchorEl = (noteId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(
    `.script-note-highlight[data-note-id="${CSS.escape(noteId)}"]`,
  );

export default function ScriptNotePopover({ editor }: { editor: Editor | null }) {
  const noteId = useEditorStore((s) => s.notePopoverId);
  const setNotePopoverId = useEditorStore((s) => s.setNotePopoverId);
  const note = useEditorStore((s) => (noteId ? s.notes.find((n) => n.id === noteId) ?? null : null));
  const updateNote = useEditorStore((s) => s.updateNote);
  const deleteNote = useEditorStore((s) => s.deleteNote);

  const { assets } = useAssetStore();
  const { currentProject } = useProjectStore();
  const projectId = currentProject?.id ?? null;

  const popRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // @asset autocomplete (same behavior the window card had)
  const [assetQuery, setAssetQuery] = useState<string | null>(null);
  const [assetSuggestions, setAssetSuggestions] = useState<Asset[]>([]);
  const [assetSugIdx, setAssetSugIdx] = useState(0);

  const close = useCallback(() => setNotePopoverId(null), [setNotePopoverId]);

  /** Measure the highlight span and seat the popover under it (or above when
   *  there is no room below — still positioned by TOP, never by bottom). */
  const place = useCallback(() => {
    if (!noteId) return;
    const el = findAnchorEl(noteId);
    if (!el) { close(); return; }
    const r = el.getBoundingClientRect();
    // A collapsed rect means the span is display:none (e.g. mid-repaint) —
    // keep the last position rather than jumping to 0,0.
    if (r.width === 0 && r.height === 0) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_WIDTH - 8));
    let top = r.bottom + 6;
    const h = popRef.current?.offsetHeight ?? 0;
    if (h && top + h > window.innerHeight - 8) {
      top = Math.max(8, r.top - h - 6);
    }
    setPos({ top, left });
  }, [noteId, close]);

  // Open/refresh: wait a frame so a just-created mark is painted before
  // measuring, then track scroll + resize while open.
  useEffect(() => {
    if (!noteId) { setPos(null); setConfirmDelete(false); return; }
    const raf = requestAnimationFrame(place);
    const onScroll = () => place();
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [noteId, place]);

  // Re-seat once the popover has a real height (flip above if needed).
  useLayoutEffect(() => {
    if (pos) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, [pos !== null]);

  // Focus the text box on open — the popover exists to type into.
  useEffect(() => {
    if (noteId && pos) textareaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, pos !== null]);

  // Outside pointerdown / Escape close. The delete-confirm overlay is its own
  // surface, so it doesn't count as outside.
  useEffect(() => {
    if (!noteId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (popRef.current?.contains(t)) return;
      if (t.closest('.fs-notepop-confirm')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [noteId, close]);

  // If the note vanishes from the store (undo, load), drop the popover.
  useEffect(() => {
    if (noteId && !note) close();
  }, [noteId, note, close]);

  // Accepts a name OR a custom '#rrggbb' — the highlight mark always gets the
  // resolved hex either way, so a custom pick recolors the script too.
  const handleColorChange = useCallback((color: NoteColor | string) => {
    if (!note) return;
    updateNote(note.id, { color });
    if (editor) {
      const hex = getNoteColorHex(color);
      const { doc, schema } = editor.state;
      const markType = schema.marks.scriptNote;
      if (markType) {
        editor.chain().command(({ tr }) => {
          doc.descendants((node, p) => {
            if (!node.isText) return;
            const mark = node.marks.find((m) => m.type === markType && m.attrs.noteId === note.id);
            if (mark) {
              tr.removeMark(p, p + node.nodeSize, mark);
              tr.addMark(p, p + node.nodeSize, markType.create({ noteId: note.id, color: hex }));
            }
          });
          return true;
        }).run();
      }
    }
  }, [editor, note, updateNote]);

  const handleDelete = useCallback(() => {
    if (!note) return;
    if (editor) {
      const { doc, schema } = editor.state;
      const markType = schema.marks.scriptNote;
      if (markType) {
        editor.chain().focus().command(({ tr }) => {
          doc.descendants((node, p) => {
            if (!node.isText) return;
            const mark = node.marks.find((m) => m.type === markType && m.attrs.noteId === note.id);
            if (mark) tr.removeMark(p, p + node.nodeSize, mark);
          });
          return true;
        }).run();
      }
    }
    deleteNote(note.id);
    close();
  }, [editor, note, deleteNote, close]);

  const handleTextChange = useCallback((value: string) => {
    if (!note) return;
    updateNote(note.id, { content: value });
    const textarea = textareaRef.current;
    if (!textarea) return;
    const before = value.slice(0, textarea.selectionStart);
    const atMatch = before.match(/@(\S*)$/);
    if (atMatch) {
      const query = atMatch[1].toLowerCase();
      setAssetQuery(query);
      setAssetSuggestions(assets.filter(
        (a) =>
          a.original_name.toLowerCase().includes(query) ||
          a.original_name.replace(/\s+/g, '_').toLowerCase().includes(query),
      ).slice(0, 8));
      setAssetSugIdx(0);
    } else {
      setAssetQuery(null);
      setAssetSuggestions([]);
    }
  }, [note, updateNote, assets]);

  const insertAssetRef = useCallback((asset: Asset) => {
    if (!note) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart;
    const before = note.content.slice(0, cursor);
    const after = note.content.slice(cursor);
    const atMatch = before.match(/@(\S*)$/);
    if (!atMatch) return;
    const prefix = before.slice(0, before.length - atMatch[0].length);
    const ref = `@${asset.original_name.replace(/\s+/g, '_')}`;
    updateNote(note.id, { content: prefix + ref + ' ' + after });
    setAssetQuery(null);
    setAssetSuggestions([]);
    requestAnimationFrame(() => {
      const p = prefix.length + ref.length + 1;
      textarea.setSelectionRange(p, p);
      textarea.focus();
    });
  }, [note, updateNote]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (assetSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAssetSugIdx((i) => Math.min(i + 1, assetSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAssetSugIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertAssetRef(assetSuggestions[assetSugIdx]);
    } else if (e.key === 'Escape') {
      setAssetQuery(null);
      setAssetSuggestions([]);
    }
  }, [assetSuggestions, assetSugIdx, insertAssetRef]);

  if (!noteId || !note || !pos) return null;
  const hex = getNoteColorHex(note.color);

  return createPortal(
    <>
      <div
        ref={popRef}
        className="fs-note-popover"
        style={{
          top: pos.top,
          left: pos.left,
          width: POPOVER_WIDTH,
          background: noteStickyBg(note.color),
          borderTopColor: hex,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h5 className="swn-card-head">
          <input
            className="swn-card-title"
            value={note.title || ''}
            placeholder={CARD_PLACEHOLDERS.comment}
            onChange={(e) => updateNote(note.id, { title: e.target.value })}
          />
          <span className="swn-card-actions">
            <ColorDots
              card={{ id: note.id, type: 'comment', color: shelfHexForNote(note.color) } as ShelfCard}
              surface={noteStickyBg(note.color)}
              onUpdate={(patch) => {
                if (patch.color) handleColorChange(noteColorForShelfHex(patch.color));
              }}
            />
            <button className="swn-x" title="Delete note" onClick={() => setConfirmDelete(true)}><FaRegTrashAlt /></button>
            <button className="swn-x fs-notepop-close" title="Close" onClick={close}>&times;</button>
          </span>
        </h5>

        <div className="note-edit-area">
          <textarea
            ref={textareaRef}
            className="swn-comment-input"
            value={note.content}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Research links, notes to self…"
          />
          {assetSuggestions.length > 0 && assetQuery !== null && (
            <div className="note-asset-dropdown">
              {assetSuggestions.map((a, idx) => (
                <div
                  key={a.id}
                  className={`note-asset-option${idx === assetSugIdx ? ' selected' : ''}`}
                  onMouseDown={(ev) => { ev.preventDefault(); insertAssetRef(a); }}
                >
                  <span className="note-asset-option-name">{a.original_name}</span>
                  <span className="note-asset-option-tags">{a.tags.slice(0, 2).join(', ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {note.content && hasRichContent(note.content) && (
          <div className="note-item-media">
            <NoteContentDisplay content={note.content} assets={assets} projectId={projectId} />
          </div>
        )}

        {note.createdAt && (
          <div className="swn-card-foot">
            <span className="swn-card-date">{formatDate(note.createdAt)}</span>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="dialog-overlay fs-notepop-confirm" onClick={() => setConfirmDelete(false)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Delete Note</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>Delete this note? The highlight will also be removed from the script.</p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setConfirmDelete(false)}>Cancel</button>
              {/* v7.01 (style audit G202): the inline #c0392b was one of ten
                  hardcoded reds meaning "danger"; it reads the token now. */}
              <button className="dialog-btn dialog-btn-primary dialog-btn-danger-fill" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
