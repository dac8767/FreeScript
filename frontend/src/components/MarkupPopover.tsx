/**
 * v5.25/v5.26: THE annotation editor window — opens at the annotation's spot
 * on the page (the ScriptNotePopover seating rules: portalled, measured
 * top/left, never bottom-anchored, clamped into the viewport; an annotation
 * whose anchor left the script seats screen-center so it is never
 * uneditable). A self-contained mini TipTap editor: rich text, links,
 * bullet/numbered/check lists, images by URL, link-to-Scrapbook-page.
 *
 * v5.26: the icon and color show as single swatches — clicking opens the
 * picker windows (MarkupPickers). "Highlight selection in script" is a
 * checkbox (range annotations only) gating the highlight color. The icon
 * follows the FIRST content kind automatically until the user picks one by
 * hand (iconManual). The ⋮ menu carries status / hide-type / delete.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  FaBold, FaItalic, FaListUl, FaListOl, FaCheckSquare, FaLink, FaRegImage, FaBook,
  FaRegTrashAlt, FaRegCheckCircle,
} from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { useNotebookStore } from '../stores/notebookStore';
import { AUTO_ICON, MarkupIcon } from './markupIcons';
import { DEFAULT_MARKUP_HIGHLIGHT } from '../stores/slices/markupsSlice';
import { confirmDialog } from './ConfirmDialog';
import { showToast } from './Toast';
import { FullscreenIcon } from './uiIcons';
import { EdgeResizeZones, startEdgeResize, type EdgeZone } from './EdgeResize';
import { convertMarkupToRange, removeMarkupFromDoc } from '../utils/markupActions';
import { MarkupColorSwatch, MarkupUsedRow } from './MarkupPickers';
import {
  findMarkupPos, setMarkupHighlight, firstContentKind, markupNavLines, markupIsList,
  markupDocIsEmpty, type MarkupNavLine,
} from '../utils/markupActions';
import { MarkupNavLineSpans } from './MarkupNavLines';
import { fileToDataUrl, compressImage } from '../utils/imageIntake';
import { api } from '../services/api';
import { useProjectStore } from '../stores/projectStore';
import Underline from '@tiptap/extension-underline';

const POP_W = 380;

export default function MarkupPopover({ editor }: { editor: Editor | null }) {
  const id = useEditorStore((s) => s.markupEditorId);
  const markup = useEditorStore((s) => s.markups.find((m) => m.id === id) ?? null);
  const setMarkupEditorId = useEditorStore((s) => s.setMarkupEditorId);
  const updateMarkup = useEditorStore((s) => s.updateMarkup);
  // v5.37, Derek's addendum: this window needs the EDITOR visible — when a
  // fullscreen tool (or the Scrapbook surface) takes the editor area, the
  // window saves and stands down.
  const fsTool = useEditorStore((s) => s.fullscreenTool);
  const nbOpen = useNotebookStore((s) => s.notebookOpen);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [scrapPicker, setScrapPicker] = useState(false);
  // v5.46, Derek: Insert Link / Insert Image used window.prompt — a SILENT
  // NO-OP under Tauri's WebKit (prompt is disabled there; fine in a browser,
  // dead in the app). Both are in-window flows now, and Insert Image is a
  // three-source menu: local device / Asset Manager / URL.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [imgMenu, setImgMenu] = useState<null | 'menu' | 'url' | 'assets'>(null);
  const [imgUrl, setImgUrl] = useState('');
  const [assetList, setAssetList] = useState<{ id: string; filename: string }[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentProject = useProjectStore((s) => s.currentProject);
  // v5.30 window chrome: drag override + fullscreen; a ref mirrors them so
  // the scroll/resize re-seat handler can stand down once the user takes over.
  const [dragPos, setDragPos] = useState<{ top: number; left: number } | null>(null);
  const [maximized, setMaximized] = useState(false);
  // v5.31: "Add Highlighted Text in Script" — the window stays open while
  // the user selects; a ref lets the outside-press saver stand down.
  const [pickingRange, setPickingRange] = useState(false);
  const pickingRef = useRef(false);
  pickingRef.current = pickingRange;
  const overrideRef = useRef(false);
  overrideRef.current = dragPos !== null || maximized;
  // what the annotation looked like when this window opened — the X button's
  // discard restores it ("close without saving"). v5.46: `content` is the
  // STORE value at open — the live mirror below writes content while the
  // window is up, so discard must put the original back.
  const snapRef = useRef<{ json: string; content: unknown; icon: string; color: string; highlight: string | null; done: boolean } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const nbPages = useNotebookStore((s) => s.pages);
  // v5.33, Derek: the Navigator row, previewed LIVE (v5.41: "In Navigator:",
  // plus whether it's a LIST — lists show no icon there).
  const [navPreview, setNavPreview] = useState<{ lines: MarkupNavLine[]; isList: boolean }>({ lines: [], isList: false });
  // the seat function, reachable from the ResizeObserver effect below
  const reseatRef = useRef<(() => void) | null>(null);

  const mini = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
      // v5.33: 'scrapbook' must be an ALLOWED protocol — tiptap's Link
      // strips the href of any scheme it doesn't know at render time, which
      // left Scrapbook links as dead <a href=""> anchors.
      Link.configure({ openOnClick: false, protocols: ['scrapbook'] }),
      Image,
      TaskList,
      TaskItem.configure({ nested: false }),
      // v5.41: the ribbon's U button drives this editor too
      Underline,
    ],
    content: null,
  }, []);

  // Load the annotation's content whenever a different one opens — and
  // snapshot its state for the × button's are-you-sure discard (v5.30).
  useEffect(() => {
    if (!mini || !markup) return;
    mini.commands.setContent((markup.content as never) ?? '');
    snapRef.current = {
      json: JSON.stringify(mini.getJSON()),
      content: markup.content,
      icon: markup.icon,
      color: markup.color,
      highlight: markup.highlight,
      done: markup.done,
    };
    setScrapPicker(false);
    setDragPos(null);
    setMaximized(false);
    setPickingRange(false);
    setLinkOpen(false);
    setLinkUrl('');
    setImgMenu(null);
    setImgUrl('');
    setAssetList(null);
  }, [mini, id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // v5.31: while picking, the next real selection in the SCRIPT converts
  // this point annotation into a range annotation (yellow default).
  useEffect(() => {
    if (!pickingRange || !editor || !id) return;
    const dom = editor.view.dom;
    const onUp = () => {
      window.setTimeout(() => {
        const sel = editor.state.selection;
        if (sel.empty) return;
        convertMarkupToRange(editor, id, sel.from, sel.to);
        setPickingRange(false);
      }, 0);
    };
    dom.addEventListener('mouseup', onUp);
    return () => dom.removeEventListener('mouseup', onUp);
  }, [pickingRange, editor, id]);

  // v5.26 auto-icon: the FIRST content kind decides — but a hand-picked icon
  // is never overwritten (iconManual). Live, so the swatch reads true.
  useEffect(() => {
    if (!mini || !id) return;
    const sync = () => {
      const st = useEditorStore.getState();
      const m = st.markups.find((x) => x.id === id);
      if (!m || m.iconManual) return;
      const kind = firstContentKind(mini.getJSON());
      const auto = kind ? AUTO_ICON[kind] : null;
      if (auto && auto !== m.icon) st.updateMarkup(id, { icon: auto });
    };
    mini.on('update', sync);
    return () => { mini.off('update', sync); };
  }, [mini, id]);

  // v5.33: the "In Navigator:" lines track the mini editor keystroke-live —
  // the same capper AND list predicate the Navigator renders with.
  useEffect(() => {
    if (!mini || !id) return;
    const syncPreview = () => {
      const json = mini.getJSON();
      setNavPreview({ lines: markupNavLines(json), isList: markupIsList(json) });
    };
    syncPreview();
    mini.on('update', syncPreview);
    return () => { mini.off('update', syncPreview); };
  }, [mini, id]);

  // v5.41, Derek: while this window is open, the ribbon's formatting
  // buttons drive the mini editor — register it; closing clears it.
  useEffect(() => {
    if (!mini || !id) return;
    useEditorStore.getState().setMarkupMiniEditor(mini);
    return () => { useEditorStore.getState().setMarkupMiniEditor(null); };
  }, [mini, id]);

  // v5.46, Derek: "if a checklist annotation is checked in the annotation
  // window, show a checkmark in the navigator as well" — the mini's content
  // mirrors into the STORE live (debounced a beat), so the real Navigator
  // row, the panel card and this window always agree while you edit. The ×
  // discard restores the snapshot's content (closeWithoutSaving), so "close
  // without saving" still means it.
  useEffect(() => {
    if (!mini || !id) return;
    let t = 0;
    const liveSync = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        // v5.52: STRUCTURAL empty (a textless checklist is content) — the
        // old text-only test stored null for a lone blank checkbox, so the
        // Navigator saw no list and drew the big auto-check icon.
        const json = mini.getJSON();
        useEditorStore.getState().updateMarkup(id, { content: markupDocIsEmpty(json) ? null : json });
      }, 250);
    };
    mini.on('update', liveSync);
    return () => { window.clearTimeout(t); mini.off('update', liveSync); };
  }, [mini, id]);

  // Seat UNDER the annotation's on-script margin icon (v5.33, Derek), with
  // the window's right edge on the side panel's left edge — or centered
  // under the icon when no right panel is showing. When the icon is hidden
  // (type filtered out, layer off) the highlight/block rect stands in; an
  // anchorless (orphaned) annotation seats screen-center so it can still be
  // read, edited and deleted (v5.26 — "unable to edit some items").
  useLayoutEffect(() => {
    if (!id) { setPos(null); return; }
    const place = () => {
      if (overrideRef.current) return;   // dragged or fullscreen — user owns it
      const el = document.querySelector(`.markup-margin-icon[data-markup-icon="${CSS.escape(id)}"]`)
        || document.querySelector(`.script-markup-highlight[data-markup-id="${CSS.escape(id)}"]`)
        || document.querySelector(`[data-markup-block="${CSS.escape(id)}"]`);
      let r = el?.getBoundingClientRect();
      if ((!r || (r.width === 0 && r.height === 0)) && editor && markup) {
        const p = findMarkupPos(editor, id);
        if (p != null) {
          try {
            const c = editor.view.coordsAtPos(Math.min(p + 1, editor.state.doc.content.size));
            r = { top: c.top, bottom: c.bottom, left: c.left, right: c.right, width: 0, height: c.bottom - c.top } as DOMRect;
          } catch { /* keep last */ }
        }
      }
      // live offsetWidth — the window is user-resizable (v5.33)
      const w = popRef.current?.offsetWidth || POP_W;
      const h = popRef.current?.offsetHeight || 320;
      if (!r) {
        setPos({ top: Math.max(8, (window.innerHeight - h) / 2), left: Math.max(8, (window.innerWidth - w) / 2) });
        return;
      }
      const below = r.bottom + 6;
      let top = below + h > window.innerHeight ? r.top - h - 6 : below;
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
      const dockR = document.querySelector('.tool-dock-wrap.tool-dock-right')?.getBoundingClientRect();
      const left = dockR && dockR.width > 0
        ? dockR.left - w
        : r.left + r.width / 2 - w / 2;
      setPos({ top, left: Math.max(8, Math.min(left, window.innerWidth - w - 8)) });
    };
    reseatRef.current = place;
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [id, editor, markup]);

  // v5.33: the window is user-resizable — when its SIZE changes, re-seat so
  // the right edge stays pinned to the panel edge (the box grows leftward).
  // A dragged or maximized window is the user's own geometry; place()
  // already stands down for those.
  const hasPos = pos !== null;
  useEffect(() => {
    if (!hasPos || !popRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => reseatRef.current?.());
    ro.observe(popRef.current);
    return () => ro.disconnect();
  }, [id, hasPos]);

  // Outside press closes AND SAVES (save-on-close = the sticky-card model).
  // Presses inside a picker/menu sub-popover count as INSIDE this window.
  useEffect(() => {
    if (!id) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (popRef.current?.contains(t)) return;
      if (t.closest?.('.markup-subpop')) return;
      // v5.41, Derek: ribbon buttons operate ON this window (formatting
      // drives the mini editor) — a ribbon press is not an outside press.
      if (t.closest?.('.toolbar-btn')) return;
      // v5.46, Derek: the Design window is the tweak-ALONGSIDE tool — its
      // window and its dock row must not save-close this one; seeing both
      // at the same time is the point.
      if (t.closest?.('.dz-panel')) return;
      if (t.closest?.('[data-tool-row="design"]')) return;
      // v5.30: the ×'s are-you-sure dialog is outside this window — its
      // buttons must not double as an outside-press save.
      if (t.closest?.('.fs-confirm-overlay')) return;
      // v5.31: script clicks while picking a highlight ARE the flow.
      if (pickingRef.current) return;
      save();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.fs-confirm-overlay')) return;   // dialog owns Esc
      if (pickingRef.current) { setPickingRange(false); return; }  // cancel the pick only
      save();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  });   // deliberately unmemoized: `save` closes over live editors

  // v5.37: an editor-area takeover rising while this window is open =
  // save-and-close (the same semantics as an outside press).
  useEffect(() => {
    if (!id || (!fsTool && !nbOpen)) return;
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsTool, nbOpen, id]);

  if (!id || !markup || !pos) return null;

  const save = () => {
    if (mini) {
      const json = mini.getJSON();
      updateMarkup(id, { content: markupDocIsEmpty(json) ? null : json });
    }
    if (editor) editor.emit('update', { editor, transaction: editor.state.tr });
    setMarkupEditorId(null);
  };

  const setHighlight = (hl: string | null) => {
    updateMarkup(id, { highlight: hl });
    if (editor) setMarkupHighlight(editor, id, hl);
  };

  const insertLink = () => {
    const url = linkUrl.trim();
    if (!url || !mini) return;
    if (mini.state.selection.empty) {
      // nothing selected — insert the URL itself as the linked text
      mini.chain().focus().insertContent([
        { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] },
        { type: 'text', text: ' ' },
      ]).run();
    } else {
      mini.chain().focus().setLink({ href: url }).run();
    }
    setLinkOpen(false);
    setLinkUrl('');
  };
  const insertImageUrl = () => {
    const u = imgUrl.trim();
    if (u) mini?.chain().focus().setImage({ src: u }).run();
    setImgMenu(null);
    setImgUrl('');
  };
  const onPickLocalImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !mini) return;
    try {
      // the Scrapbook's intake discipline: compress until the data URL is
      // storage-sized (annotations persist like its pages do)
      const raw = await fileToDataUrl(f);
      let out = await compressImage(raw, 1200, 0.85);
      if (out.src.length > 300_000) out = await compressImage(raw, 800, 0.8);
      if (out.src.length > 300_000) out = await compressImage(raw, 520, 0.72);
      mini.chain().focus().setImage({ src: out.src }).run();
    } catch {
      showToast('Could not read that image', 'error');
    }
    setImgMenu(null);
  };
  const openAssetPick = async () => {
    setImgMenu('assets');
    if (!currentProject) { setAssetList([]); return; }
    try {
      const list = await api.listAssets(currentProject.id) as { id: string; filename: string; mime_type?: string }[];
      setAssetList(list.filter((a) => (a.mime_type ?? '').startsWith('image/')));
    } catch {
      setAssetList([]);
    }
  };
  const linkScrapPage = (pageId: string, title: string) => {
    // v5.33: a REAL link mark, not an HTML string — the Link extension's
    // scheme validation rejected the scrapbook: protocol on parse, so the
    // raw <a…> markup landed in the note as plain text.
    mini?.chain().focus().insertContent([
      {
        type: 'text',
        text: `📖 ${title || 'Scrapbook page'}`,
        marks: [{ type: 'link', attrs: { href: `scrapbook:${pageId}` } }],
      },
      { type: 'text', text: ' ' },
    ]).run();
    setScrapPicker(false);
  };

  // v5.26: links in the note are CLICKABLE — scrapbook: links open that
  // Scrapbook page (saving this window first); web links open externally.
  const onBodyClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('scrapbook:')) {
      e.preventDefault();
      const pageId = href.slice('scrapbook:'.length);
      save();
      const nb = useNotebookStore.getState();
      if (nb.pages[pageId]) nb.selectPage(pageId);
      useEditorStore.getState().openTool('notebook');
    } else if (/^https?:/i.test(href)) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener');
    }
  };

  const miniBtn = (active: boolean, title: string, onClick: () => void, child: React.ReactNode) => (
    <button className={`markup-mini-btn${active ? ' active' : ''}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{child}</button>
  );

  // v5.30: window chrome — drag by the title bar; × discards (with a
  // confirm when something changed); the square maximizes.
  const isDirty = () => {
    const snap = snapRef.current;
    if (!snap || !mini) return false;
    return JSON.stringify(mini.getJSON()) !== snap.json
      || markup.icon !== snap.icon || markup.color !== snap.color
      || markup.highlight !== snap.highlight || markup.done !== snap.done;
  };
  const closeWithoutSaving = async () => {
    const snap = snapRef.current;
    if (isDirty() && snap) {
      const sure = await confirmDialog('Are you sure you want to close this annotation without saving?');
      if (!sure) return;
      // v5.46: content too — the live mirror wrote edits into the store
      updateMarkup(id, {
        content: snap.content as never,
        icon: snap.icon, color: snap.color, highlight: snap.highlight, done: snap.done,
      });
      if (editor) setMarkupHighlight(editor, id, snap.highlight);
    }
    setMarkupEditorId(null);
  };
  // v5.48, Derek: the title bar's delete WARNS first — deleting removes
  // the highlight anchor and the annotation itself (the ⋮ menu's exact
  // delete, with a confirm in front).
  const deleteWithConfirm = async () => {
    const sure = await confirmDialog(
      'Delete this annotation? Its highlight and content are removed.',
      { title: 'Delete Annotation', confirmLabel: 'Delete', danger: true },
    );
    if (!sure) return;
    const s = useEditorStore.getState();
    if (editor) {
      removeMarkupFromDoc(editor, id);
      editor.emit('update', { editor, transaction: editor.state.tr });
    }
    s.removeMarkup(id);
    setMarkupEditorId(null);
  };

  const startDrag = (e: React.PointerEvent) => {
    if (maximized) return;
    const start = dragPos ?? pos;
    if (!start) return;
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => setDragPos({
      top: Math.max(8, Math.min(start.top + ev.clientY - sy, window.innerHeight - 60)),
      left: Math.max(8, Math.min(start.left + ev.clientX - sx, window.innerWidth - 120)),
    });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  };

  // v5.46, Derek: any edge/corner resizes (native resize:both — bottom-right
  // only, with WebKit's hash corner — is gone). Writing dragPos hands the
  // geometry to the user, so the auto-seat and its right-edge re-pin stand
  // down for the rest of this window's life (same as a title-bar drag).
  const beginEdge = (zone: EdgeZone, e: React.PointerEvent) => {
    if (maximized) return;
    const el = popRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    startEdgeResize(e, zone, {
      rect: () => ({ left: r.left, top: r.top, w: r.width, h: r.height }),
      min: { w: 300, h: 220 },
      apply: (g) => {
        el.style.width = `${g.w}px`;
        el.style.height = `${g.h}px`;
        setDragPos({ top: g.top, left: g.left });
      },
    });
  };

  // width lives in CSS (v5.33: the window is user-resizable — the browser's
  // resize handle writes inline width/height that React must not clobber)
  const winStyle = maximized
    ? { top: 48, left: 48, right: 48, bottom: 48 }
    : { top: (dragPos ?? pos).top, left: (dragPos ?? pos).left };

  return createPortal(
    <div ref={popRef} className={`fs-markup-popover${maximized ? ' maximized' : ''}`} style={winStyle}
      onPointerDown={(e) => e.stopPropagation()}>
      {/* v5.46: any edge/corner resizes — the native corner grip is gone */}
      {!maximized && <EdgeResizeZones onStart={beginEdge} />}
      {/* the draggable title bar — v5.48, Derek: the ⋮ menu is GONE from
          this window; STATUS and DELETE ride the bar directly (delete
          warns first), then fullscreen and × like every window */}
      <div className="markup-pop-titlebar" onPointerDown={startDrag}>
        <span className="markup-pop-title">Annotation</span>
        <button
          className={`markup-win-btn markup-win-status${markup.done ? ' done' : ''}`}
          title={markup.done ? '' : 'Mark as complete'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => updateMarkup(id, { done: !markup.done })}
        >
          <FaRegCheckCircle />
        </button>
        <button
          className="markup-win-btn markup-win-delete"
          title="Delete annotation"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={deleteWithConfirm}
        >
          <FaRegTrashAlt />
        </button>
        <button className="markup-win-btn" title={maximized ? 'Exit full screen' : 'Full screen'}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => setMaximized((v) => !v)}>
          <FullscreenIcon />
        </button>
        <button className="markup-win-btn markup-win-close" title="Close without saving"
          onPointerDown={(e) => e.stopPropagation()} onClick={closeWithoutSaving}>
          ×
        </button>
      </div>
      {/* v5.46: the window frame no longer scrolls — this inner box does.
          The edge zones anchor to the frame, so they stay put however far
          the content scrolls. */}
      <div className="markup-pop-scroll">
      {/* ONE head row (v5.29, Derek): "Icon:" swatches · "Highlight:"
          swatch (range annotations only) · ⋮ pinned at the right edge.
          v5.42, Derek: the wrapping lives in an INNER box (head-main) with
          no spacer — a tight window drops the highlight group to the next
          line with no phantom row between, and the ⋮ NEVER wraps. */}
      <div className="markup-pop-row markup-pop-head">
        <div className="markup-pop-head-main">
          <span className="markup-pop-group markup-pop-icon-group">
            <span className="markup-pop-grouplabel">Icon:</span>
            {/* v5.31: the USED combos ride the window itself; + = the
                combined icon-and-color picker */}
            <MarkupUsedRow markup={markup} />
          </span>
          {markup.anchor === 'range' ? (
          <span className="markup-pop-group markup-hl-group">
            <span className="markup-pop-grouplabel">Highlight:</span>
            <MarkupColorSwatch
              value={markup.highlight ?? DEFAULT_MARKUP_HIGHLIGHT}
              title="Highlight color"
              usedKind="highlight"
              onPick={(color) => setHighlight(color)}
            />
            {/* (v5.48, Derek: the remove-highlight button is GONE — every
                annotation stays connected to its highlighted text.) */}
          </span>
        ) : (
          <span className="markup-pop-group">
            <button
              className={`markup-hl-clear markup-add-hl${pickingRange ? ' active' : ''}`}
              title="Highlight text in the script and link it to this annotation"
              onClick={() => setPickingRange((v) => !v)}
            >
              {pickingRange ? 'Select text in the script…' : 'Link Script Text'}
            </button>
          </span>
        )}
        </div>
        {/* (v5.48, Derek: the ⋮ moved UP into the title bar.) */}
      </div>
      {/* mini editor toolbar */}
      <div className="markup-pop-row markup-mini-bar">
        {miniBtn(!!mini?.isActive('bold'), 'Bold', () => mini?.chain().focus().toggleBold().run(), <FaBold />)}
        {miniBtn(!!mini?.isActive('italic'), 'Italic', () => mini?.chain().focus().toggleItalic().run(), <FaItalic />)}
        {miniBtn(!!mini?.isActive('bulletList'), 'Bullet list', () => mini?.chain().focus().toggleBulletList().run(), <FaListUl />)}
        {miniBtn(!!mini?.isActive('orderedList'), 'Numbered list', () => mini?.chain().focus().toggleOrderedList().run(), <FaListOl />)}
        {miniBtn(!!mini?.isActive('taskList'), 'Checklist', () => mini?.chain().focus().toggleTaskList().run(), <FaCheckSquare />)}
        {miniBtn(linkOpen || !!mini?.isActive('link'), 'Insert link', () => { setImgMenu(null); setLinkOpen((v) => !v); }, <FaLink />)}
        {miniBtn(imgMenu !== null, 'Insert image', () => { setLinkOpen(false); setImgMenu((v) => (v ? null : 'menu')); }, <FaRegImage />)}
        {miniBtn(scrapPicker, 'Link a Scrapbook page', () => setScrapPicker((v) => !v), <FaBook />)}
      </div>
      {linkOpen && (
        <form className="markup-insert-row" onSubmit={(e) => { e.preventDefault(); insertLink(); }}>
          <input
            className="tool-action-field markup-insert-url"
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
          <button type="submit" className="dialog-btn dialog-btn-primary">Insert Link</button>
        </form>
      )}
      {imgMenu === 'menu' && (
        <div className="markup-scrap-list markup-img-menu">
          <button className="markup-scrap-item" onClick={() => fileInputRef.current?.click()}>From local device…</button>
          <button className="markup-scrap-item" onClick={openAssetPick}>From Asset Manager…</button>
          <button className="markup-scrap-item" onClick={() => setImgMenu('url')}>From URL…</button>
        </div>
      )}
      {imgMenu === 'url' && (
        <form className="markup-insert-row" onSubmit={(e) => { e.preventDefault(); insertImageUrl(); }}>
          <input
            className="tool-action-field markup-insert-url"
            autoFocus
            value={imgUrl}
            onChange={(e) => setImgUrl(e.target.value)}
          />
          <button type="submit" className="dialog-btn dialog-btn-primary">Insert Image</button>
        </form>
      )}
      {imgMenu === 'assets' && (
        <div className="markup-scrap-list">
          {assetList === null && <div className="markup-scrap-empty">Loading assets…</div>}
          {assetList?.length === 0 && (
            <div className="markup-scrap-empty">
              {currentProject ? 'No image assets in the Asset Manager yet.' : 'No project open — no assets available.'}
            </div>
          )}
          {(assetList ?? []).map((a) => (
            <button
              key={a.id}
              className="markup-scrap-item"
              onClick={() => {
                if (currentProject) mini?.chain().focus().setImage({ src: api.getAssetUrl(currentProject.id, a.id) }).run();
                setImgMenu(null);
              }}
            >{a.filename}</button>
          ))}
        </div>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickLocalImage} />
      {scrapPicker && (
        <div className="markup-scrap-list">
          {Object.values(nbPages).length === 0 && <div className="markup-scrap-empty">No Scrapbook pages yet.</div>}
          {Object.values(nbPages).map((p) => (
            <button key={p.id} className="markup-scrap-item" onClick={() => linkScrapPage(p.id, p.title)}>{p.title || '(untitled page)'}</button>
          ))}
        </div>
      )}
      <div className="markup-mini-editor" onClick={onBodyClick}><EditorContent editor={mini} /></div>
      {/* v5.33/v5.41, Derek: the two live previews — "In Navigator:" (the
          real row's classes, no icon for LIST annotations) and "In Script:"
          (the margin chip exactly as it sits in the page's right margin). */}
      {/* v5.49, Derek: In Navigator / In Script STACKED, both left-aligned;
          Save rides the same section, pinned to its bottom-right. */}
      <div className="markup-pop-row markup-pop-preview">
        <div className="markup-prev-lines">
          <div className="markup-prev-line">
            <span className="markup-pop-grouplabel">In Navigator:</span>
            <span className="fs-nav-anno markup-nav-preview" style={{ color: markup.color }}>
              {!navPreview.isList && (
                <span className="fs-nav-kind-icon fs-nav-markup-icon">
                  <MarkupIcon icon={markup.icon} color={markup.color} />
                </span>
              )}
              <MarkupNavLineSpans lines={navPreview.lines} />
            </span>
          </div>
          <div className="markup-prev-line">
            <span className="markup-pop-grouplabel">In Script:</span>
            <span className="markup-margin-preview" style={{ borderColor: markup.color }}>
              <MarkupIcon icon={markup.icon} color={markup.color} />
            </span>
          </div>
        </div>
        <button className="dialog-btn dialog-btn-primary markup-save" onClick={save}>Save</button>
      </div>
      </div>
    </div>,
    document.body,
  );
}
