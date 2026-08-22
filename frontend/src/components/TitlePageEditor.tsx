import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FaRegTrashAlt, FaRegImage, FaRegHandPaper } from 'react-icons/fa';
/* v7.02 (style audit remaining #6): the zoom magnifiers join the line-icon
   family the rest of the chrome uses — they were the heavier Fa pair sitting
   next to Lu icons. */
import { LuZoomIn, LuZoomOut } from 'react-icons/lu';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { TitlePageAttrs } from '../editor/extensions/TitlePage';
import { useEditorStore } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useProjectStore } from '../stores/projectStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { useAssetStore } from '../stores/assetStore';
import { ImageSourceMenu } from './CharacterAssetMedia';
import { CharacterImagePickerDialog } from './CharacterImageOverlays';
import { api } from '../services/api';
import { resolveImageUrl } from '../utils/imageAsset';
import { authedFetch } from '../services/authedFetch';
import { isTauri } from '../services/platform';
import { showToast } from './Toast';
import { confirmDialog } from './ConfirmDialog';
import { titlePageBlockSpecs, titleLineStyle, titlePaperShiftPx } from '../utils/titlePageLayout';
import { findTitlePageNode } from '../utils/titlePageDraftLine';

/** Small auth-aware image thumbnail for the title-page preview/list. Uses the
 *  same blob-fetch path as the editor NodeView so it loads reliably.
 *  `fill` (v4.73): size to the parent's block instead of the 70px list thumb —
 *  the to-scale preview gives each image its real line-budget box. */
const TpImageThumb: React.FC<{ attrs: Record<string, unknown>; align?: boolean; fill?: boolean }> = ({ attrs, align, fill }) => {
  const resolved = useMemo(() => resolveImageUrl(attrs) || '', [attrs]);
  // data: URLs and Tauri asset:// load directly; web asset URLs need an authed fetch.
  const directUrl = useMemo(() => (resolved.startsWith('data:') || isTauri() ? resolved : ''), [resolved]);
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    if (!resolved || resolved.startsWith('data:') || isTauri()) return;
    let obj: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(resolved);
        if (!res.ok) return;
        const blob = await res.blob();
        obj = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(obj);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj); };
  }, [resolved]);
  const url = directUrl || blobUrl;
  if (!url) return null;
  const a = align ? ((attrs.align as string) || 'center') : 'center';
  const margin = fill
    ? (a === 'left' ? '0 auto 0 0' : a === 'right' ? '0 0 0 auto' : '0 auto')
    : (a === 'left' ? '3px auto 3px 0' : a === 'right' ? '3px 0 3px auto' : '3px auto');
  return <img src={url} alt="" style={{ maxWidth: '70%', maxHeight: fill ? '100%' : 70, display: 'block', margin }} />;
};

interface Props {
  editor: Editor;
  onClose: () => void;
}

const EMPTY_ATTRS: Omit<TitlePageAttrs, 'field'> = {
  tpTitle: '',
  tpTitle2: '',
  tpTitle2FontSize: 12,
  tpWrittenBy: '',
  tpBasedOn: '',
  tpDraft: '',
  tpDraftDate: '',
  tpContact: '',
  tpCopyright: '',
  tpWgaRegistration: '',
  tpNotes: '',
  tpTitleFontSize: 12,
};

// Title font-size choices (pt). Matches the editor's font-size dropdowns.
const TITLE_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];
/** v4.73, Derek: both size dropdowns lead with "Default". Picking it APPLIES
 *  this size, so the select then reads as the number ("12 pt") — the option
 *  is a shortcut back to the built-in size, not a sticky display state. */
const DEFAULT_TITLE_SIZE = 12;

/* findTitlePageNode (the walker that locates the title block carrying the
   structured data) moved to utils/titlePageDraftLine in v7.24, so the draft-
   line writer and this editor read the same node the same way. */

/** Read structured attrs, falling back to legacy child-text content if structured attrs are empty. */
function readTitlePageData(editor: Editor): Omit<TitlePageAttrs, 'field'> {
  const result = { ...EMPTY_ATTRS };
  const titleNode = findTitlePageNode(editor);
  if (titleNode && titleNode.attrs.tpTitle) {
    // Structured data exists — use it
    result.tpTitle = titleNode.attrs.tpTitle || '';
    result.tpTitle2 = titleNode.attrs.tpTitle2 || '';
    result.tpTitle2FontSize = Number(titleNode.attrs.tpTitle2FontSize) || 12;
    result.tpTitleFontSize = Number(titleNode.attrs.tpTitleFontSize) || 12;
    result.tpWrittenBy = titleNode.attrs.tpWrittenBy || '';
    result.tpBasedOn = titleNode.attrs.tpBasedOn || '';
    result.tpDraft = titleNode.attrs.tpDraft || '';
    result.tpDraftDate = titleNode.attrs.tpDraftDate || '';
    result.tpContact = titleNode.attrs.tpContact || '';
    result.tpCopyright = titleNode.attrs.tpCopyright || '';
    result.tpWgaRegistration = titleNode.attrs.tpWgaRegistration || '';
    result.tpNotes = titleNode.attrs.tpNotes || '';
    return result;
  }

  // Fallback: read from legacy child-text titlePage nodes
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'titlePage') {
      const field = node.attrs.field as string;
      const text = node.textContent || '';
      switch (field) {
        case 'title': result.tpTitle = text; break;
        case 'title2': result.tpTitle2 = text; break;
        case 'author': result.tpWrittenBy = text; break;
        case 'contact': result.tpContact = text; break;
        case 'date': result.tpDraftDate = text; break;
        case 'draft': result.tpDraft = text; break;
        case 'copyright': result.tpCopyright = text; break;
      }
    }
    return true;
  });
  return result;
}

type TpData = Omit<TitlePageAttrs, 'field'>;

/* v2.25: the classic layout lives in utils/titlePageLayout.ts — ONE builder
   shared with the FDX and Fountain importers, so an imported title page is
   the same title page this dialog builds. v4.73: the preview renders from
   the same builder's specs, so it can't drift either. */

/** Title-page images split by whether they sit above or below the title. */
function classifyTitleImages(editor: Editor): { imagesAbove: Record<string, unknown>[]; imagesBelow: Record<string, unknown>[] } {
  const doc = editor.state.doc;
  const imagesAbove: Record<string, unknown>[] = [];
  const imagesBelow: Record<string, unknown>[] = [];
  let sawTitle = false;
  for (let k = 0; k < doc.childCount; k++) {
    const child = doc.child(k);
    const t = child.type.name;
    if (t === 'titlePage' || t === 'screenplayImage') {
      if (t === 'titlePage' && child.attrs.field === 'title') sawTitle = true;
      if (t === 'screenplayImage') (sawTitle ? imagesBelow : imagesAbove).push(child.attrs as Record<string, unknown>);
    } else break;
  }
  return { imagesAbove, imagesBelow };
}

/** End position (doc coords) of the leading title-page region. */
function titlePageRegionEnd(editor: Editor): number {
  const doc = editor.state.doc;
  let end = 0;
  for (let k = 0; k < doc.childCount; k++) {
    const child = doc.child(k);
    if (child.type.name === 'titlePage' || child.type.name === 'screenplayImage') end += child.nodeSize;
    else break;
  }
  return end;
}

/**
 * Build the title-page nodes with the classic layout: optional images at the
 * top, the title ~⅓ down, the credit line below it, the draft/contact/copyright/
 * notes block pushed to the bottom (via blank spacer lines), then optional
 * images at the very bottom. Rendered identically by the flow exporters.
 */
function buildTitlePageBlocks(
  editor: Editor,
  data: TpData,
  imagesAbove: Record<string, unknown>[],
  imagesBelow: Record<string, unknown>[],
): PMNode[] {
  const schema = editor.state.schema;
  const titlePageType = schema.nodes.titlePage;
  const imageType = schema.nodes.screenplayImage;
  const imgLines = (a: Record<string, unknown>) => Math.max(1, Number(a.heightLines) || 8);
  const aboveLines = imagesAbove.reduce((s, a) => s + imgLines(a), 0);
  const belowLines = imagesBelow.reduce((s, a) => s + imgLines(a), 0);

  // The layout itself is shared with the importers (utils/titlePageLayout).
  // Top images fill the space ABOVE the title; they only push the title down
  // when they're taller than that space. Bottom images ride below the bottom
  // block, whose gap already budgeted their height.
  /* v7.11, Derek: the Draft Date is stored ISO (it is an <input type="date">)
     and RENDERED in the Settings format — the same formatAppDate every other
     date in the app goes through. Read at build time, so Apply and the live
     preview below always agree. */
  const specs = titlePageBlockSpecs(
    data, aboveLines, belowLines, useSettingsStore.getState().dateFormat,
  );
  const blocks: PMNode[] = [];
  for (const a of imagesAbove) blocks.push(imageType.create(a));
  for (const s of specs) blocks.push(titlePageType.create(s.attrs, s.text ? schema.text(s.text) : undefined));
  for (const a of imagesBelow) blocks.push(imageType.create(a));
  return blocks;
}

const TitlePageEditor: React.FC<Props> = ({ editor, onClose }) => {
  const [data, setData] = useState<Omit<TitlePageAttrs, 'field'>>({ ...EMPTY_ATTRS });
  // v7.11: the Settings date format, subscribed — change it and the preview
  // below re-renders the draft date immediately.
  const dateFormat = useSettingsStore((s) => s.dateFormat);
  // v5.74: the preview renders the REAL page — its paper size, margins and
  // paper-centering shift, the same three the editor's page uses.
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const paperShift = titlePaperShiftPx(pageLayout);

  useEffect(() => {
    const fromDoc = readTitlePageData(editor);
    /* v1.34: the Draft is ONE value across the Title Page, Production > Set
     * Draft Number, and Save Script. If the title page doesn't carry a draft
     * line yet, prefill from the shared value instead of showing an empty
     * field that contradicts the other two surfaces. */
    if (!fromDoc.tpDraft) fromDoc.tpDraft = useEditorStore.getState().draftLabel || '';
    setData(fromDoc);
  }, [editor]);

  const setField = useCallback((key: keyof Omit<TitlePageAttrs, 'field'>, value: string) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyTitlePage = useCallback((thenPreview: boolean) => {
    try {
      const { imagesAbove, imagesBelow } = classifyTitleImages(editor);
      const built = buildTitlePageBlocks(editor, data, imagesAbove, imagesBelow);
      const tr = editor.state.tr;
      const regionEnd = titlePageRegionEnd(editor);
      if (regionEnd > 0) tr.delete(0, regionEnd);
      for (let i = built.length - 1; i >= 0; i--) tr.insert(0, built[i]);
      editor.view.dispatch(tr);
      // v1.34: Draft is one shared value — applying a changed draft here
      // updates the store, which the Save dialog and Set Draft Number read.
      const appliedDraft = data.tpDraft.trim();
      if (appliedDraft && appliedDraft !== useEditorStore.getState().draftLabel) {
        useEditorStore.getState().setDraftLabel(appliedDraft);
      }
      // v3.44, Derek: Preview applies, then flips the editor to Preview view —
      // the one place the title page actually shows.
      if (thenPreview) useEditorStore.getState().setPreviewMode(true);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update title page', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, data, onClose]);
  const handleApply = useCallback(() => applyTitlePage(false), [applyTitlePage]);
  const handlePreview = useCallback(() => applyTitlePage(true), [applyTitlePage]);

  // --- Title-page image (v4.73, Derek): the character tool's control, shared —
  // the "+ Add Image" placeholder opens the same ImageSourceMenu (local device /
  // Asset Manager). New images land ABOVE the title; once an image exists its
  // row's Top/Bottom select is the placement control. ---
  const imageInputRef = useRef<HTMLInputElement>(null);
  const handleAddImage = useCallback(() => imageInputRef.current?.click(), []);
  const [imgMenu, setImgMenu] = useState<{ top: number; left: number } | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetFilter, setAssetFilter] = useState('');
  const { assets, setAssets } = useAssetStore();
  const currentProject = useProjectStore((s) => s.currentProject);
  const imageAssets = useMemo(() => assets.filter((a) => a.mime_type.startsWith('image/')), [assets]);
  const openAssetPicker = useCallback(async () => {
    if (!currentProject) return;
    setAssetFilter('');
    setAssetPickerOpen(true);
    try { setAssets(await api.listAssets(currentProject.id)); } catch { /* stale list still renders */ }
  }, [currentProject, setAssets]);

  const handleImageChosen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Please choose an image file', 'error'); return; }
    const placement = 'above';
    try {
      const currentProject = useProjectStore.getState().currentProject;
      let attrs: Record<string, unknown>;
      if (currentProject) {
        const asset = await api.uploadAsset(currentProject.id, file, ['title-page-image']);
        attrs = { assetId: asset.id, projectId: currentProject.id, filename: asset.filename ?? file.name, align: 'center' };
      } else {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        attrs = { src: dataUrl, align: 'center' };
      }
      // Add to the chosen group and rebuild the page so it appears in the right place.
      const g = classifyTitleImages(editor);
      (placement === 'above' ? g.imagesAbove : g.imagesBelow).push(attrs);
      const built = buildTitlePageBlocks(editor, data, g.imagesAbove, g.imagesBelow);
      const tr = editor.state.tr;
      const end = titlePageRegionEnd(editor);
      if (end > 0) tr.delete(0, end);
      for (let i = built.length - 1; i >= 0; i--) tr.insert(0, built[i]);
      editor.view.dispatch(tr);
      showToast('Image added to title page', 'success');
    } catch (err) {
      showToast(`Failed to add image: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [editor, data]);

  const handleSyncFromProject = useCallback(() => {
    const { documentTitle } = useEditorStore.getState();
    setData((prev) => ({
      ...prev,
      tpTitle: documentTitle || prev.tpTitle,
    }));
    showToast('Synced title from project', 'success');
  }, []);

  // The active script-format template can restrict which title-page fields appear
  // (e.g. stage plays don't have WGA Registration). Unset = show all default fields.
  const activeTpFields: string[] | undefined = (() => {
    try {
      return useFormattingTemplateStore.getState().getActiveTemplate().titlePageFields;
    } catch {
      return undefined;
    }
  })();
  const showField = (id: string): boolean => !activeTpFields || activeTpFields.includes(id);

  // Re-render the preview when the document changes (e.g. an image is added).
  const [, bumpDocVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => bumpDocVersion((v) => v + 1);
    editor.on('update', onUpdate);
    return () => { editor.off('update', onUpdate); };
  }, [editor]);

  // Preview (v4.73, Derek: TO SCALE) — a real 8.5×11in page rendered from the
  // SAME titlePageBlockSpecs Apply inserts (one builder, so the preview can't
  // drift from the document), scaled down with zoom controls.
  const { imagesAbove, imagesBelow } = classifyTitleImages(editor);
  const previewImgLines = (a: Record<string, unknown>) => Math.max(1, Number(a.heightLines) || 8);
  const previewSpecs = titlePageBlockSpecs(
    data,
    imagesAbove.reduce((s, a) => s + previewImgLines(a), 0),
    imagesBelow.reduce((s, a) => s + previewImgLines(a), 0),
    dateFormat,
  );
  const [tpZoom, setTpZoom] = useState<number | 'fit'>('fit');
  const previewBoxRef = useRef<HTMLDivElement>(null);
  // v5.39, Derek: the hand tool — while on, dragging the zoomed preview
  // pans it (scrolls the container); the zoom cluster carries the toggle.
  const [panMode, setPanMode] = useState(false);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const startPan = (e: React.PointerEvent) => {
    if (!panMode) return;
    const el = previewScrollRef.current;
    if (!el) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const sl = el.scrollLeft, stp = el.scrollTop;
    const move = (ev: PointerEvent) => {
      el.scrollLeft = sl - (ev.clientX - sx);
      el.scrollTop = stp - (ev.clientY - sy);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [fitScale, setFitScale] = useState(0.28);
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    /* v6.33, Derek: Fit must satisfy BOTH axes — width alone let a short
       window crop the page bottom. The scale is the smaller of the two
       ratios, measured against the scroll viewport (the box minus the zoom
       bar), so the whole page lands inside the preview. */
    const compute = () => {
      const availW = el.clientWidth - 20;
      const scroll = previewScrollRef.current;
      const availH = (scroll ? scroll.clientHeight : el.clientHeight - 40) - 20;
      const wScale = availW / (pageLayout.pageWidth * 96);
      const hScale = availH / (pageLayout.pageHeight * 96);
      setFitScale(Math.max(0.1, Math.min(wScale, hScale)));
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageLayout.pageWidth, pageLayout.pageHeight]);
  const tpScale = tpZoom === 'fit' ? fitScale : tpZoom;
  /** One title-page block, at page geometry: 12pt line grid; enlarged titles
   *  occupy ceil(size/12) grid lines per wrapped line — the paginator's math. */
  const renderSpecLine = (s: { field: string; text: string }, i: number) => {
    /* v5.74, Derek ("the two title pages still do not match"): ONE definition
       of the look — utils/titlePageLayout.titleLineStyle — shared with the
       Pages window's thumbnail, so the miniature and this preview cannot
       drift again. Size comes from the live FORM here (no node exists yet);
       the thumbnail reads the node's tpTitleFontSize. */
    const size = s.field === 'title' ? data.tpTitleFontSize
      : s.field === 'title2' ? data.tpTitle2FontSize
      : undefined;
    return (
      <div key={i} style={titleLineStyle(s.field, { sizePt: size, shiftPx: paperShift })}>
        {s.text || (s.field === 'title' ? 'UNTITLED' : ' ')}
      </div>
    );
  };

  // Rebuild the whole title page (classic layout) from the live fields + the
  // given image groups, so every image operation updates the page immediately.
  const rebuild = (above: Record<string, unknown>[], below: Record<string, unknown>[]) => {
    const built = buildTitlePageBlocks(editor, data, above, below);
    const tr = editor.state.tr;
    const end = titlePageRegionEnd(editor);
    if (end > 0) tr.delete(0, end);
    for (let i = built.length - 1; i >= 0; i--) tr.insert(0, built[i]);
    editor.view.dispatch(tr);
  };
  const editImages = (mutate: (above: Record<string, unknown>[], below: Record<string, unknown>[]) => void) => {
    const g = classifyTitleImages(editor);
    mutate(g.imagesAbove, g.imagesBelow);
    rebuild(g.imagesAbove, g.imagesBelow);
  };
  const removeImg = (above: boolean, idx: number) => editImages((a, b) => { (above ? a : b).splice(idx, 1); });
  const moveImg = (above: boolean, idx: number, target: 'above' | 'below') => editImages((a, b) => {
    if ((above ? 'above' : 'below') === target) return;
    const [x] = (above ? a : b).splice(idx, 1);
    if (x) (target === 'above' ? a : b).push(x);
  });
  const alignImg = (above: boolean, idx: number, align: string) => editImages((a, b) => {
    const arr = above ? a : b;
    if (arr[idx]) arr[idx] = { ...arr[idx], align };
  });
  // Asset Manager pick (v4.73) — same association the character tool makes,
  // landed above the title; the row's Top/Bottom select moves it after.
  const handleAssetPicked = (assetId: string) => {
    if (!currentProject) return;
    const picked = assets.find((x) => x.id === assetId);
    editImages((a) => {
      a.push({ assetId, projectId: currentProject.id, filename: picked?.filename ?? picked?.original_name, align: 'center' });
    });
    setAssetPickerOpen(false);
    showToast('Image added to title page', 'success');
  };

  // v2.24: confirmDialog, never window.confirm — the Tauri shim made this
  // exact button take down the whole app ("dialog.confirm not allowed").
  const handleDeleteTitlePage = useCallback(async () => {
    if (!(await confirmDialog('Delete the entire title page (title, credits, and images)?', { title: 'Delete Title Page', confirmLabel: 'Delete', danger: true }))) return;
    const end = titlePageRegionEnd(editor);
    if (end > 0) {
      const tr = editor.state.tr.delete(0, end);
      if (tr.doc.content.size === 0) {
        const fallback = editor.schema.nodes.action || editor.schema.nodes.general;
        if (fallback) tr.insert(0, fallback.create());
      }
      editor.view.dispatch(tr);
    }
    onClose();
  }, [editor, onClose]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="tp-editor-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">Title Page</div>
        <div className="tp-editor-body">
          <div className="tp-editor-form">
            {/* v4.73, Derek: Sync sits ABOVE the Title row it fills. */}
            <button
              className="tp-sync-btn"
              onClick={handleSyncFromProject}
              type="button"
            >
              Sync Title from Project
            </button>
            {showField('tpTitle') && (
            <div className="props-field-wide tp-field-row">
              <div className="props-field tp-field-grow">
                <label className="props-label">Title</label>
                <input
                  className="props-input"
                  value={data.tpTitle}
                  onChange={(e) => setField('tpTitle', e.target.value)}
                  placeholder="SCRIPT TITLE"
                  autoFocus
                />
              </div>
              <div className="props-field tp-field-size">
                <label className="props-label">Title Size</label>
                <select
                  className="props-input"
                  value={data.tpTitleFontSize}
                  onChange={(e) => setData((prev) => ({
                    ...prev,
                    tpTitleFontSize: e.target.value === 'default' ? DEFAULT_TITLE_SIZE : Number(e.target.value),
                  }))}
                >
                  <option value="default">Default</option>
                  {TITLE_FONT_SIZES.map((s) => <option key={s} value={s}>{s} pt</option>)}
                </select>
              </div>
            </div>
            )}
            {showField('tpTitle') && (
            <div className="props-field-wide tp-field-row">
              <div className="props-field tp-field-grow">
                <label className="props-label">Title Line 2</label>
                <input
                  className="props-input"
                  value={data.tpTitle2}
                  onChange={(e) => setField('tpTitle2', e.target.value)}
                  placeholder="Optional second title line"
                />
              </div>
              {data.tpTitle2 && (
              <div className="props-field tp-field-size">
                <label className="props-label">Title Line 2 Size</label>
                <select
                  className="props-input"
                  value={data.tpTitle2FontSize}
                  onChange={(e) => setData((prev) => ({
                    ...prev,
                    tpTitle2FontSize: e.target.value === 'default' ? DEFAULT_TITLE_SIZE : Number(e.target.value),
                  }))}
                >
                  <option value="default">Default</option>
                  {TITLE_FONT_SIZES.map((s) => <option key={s} value={s}>{s} pt</option>)}
                </select>
              </div>
              )}
            </div>
            )}
            {showField('tpWrittenBy') && (
            <div className="props-field">
              <label className="props-label">Written By</label>
              <input
                className="props-input"
                value={data.tpWrittenBy}
                onChange={(e) => setField('tpWrittenBy', e.target.value)}
                placeholder="Author Name"
              />
            </div>
            )}
            {showField('tpBasedOn') && (
            <div className="props-field">
              <label className="props-label">Based On</label>
              <input
                className="props-input"
                value={data.tpBasedOn}
                onChange={(e) => setField('tpBasedOn', e.target.value)}
                placeholder="the novel by..."
              />
            </div>
            )}
            {showField('tpDraft') && (
            <div className="props-field">
              <label className="props-label">Draft</label>
              <input
                className="props-input"
                value={data.tpDraft}
                onChange={(e) => setField('tpDraft', e.target.value)}
                placeholder="e.g. Second Draft"
              />
            </div>
            )}
            {showField('tpDraftDate') && (
            <div className="props-field">
              <label className="props-label">Draft Date</label>
              <input
                className="props-input"
                type="date"
                value={data.tpDraftDate}
                onChange={(e) => setField('tpDraftDate', e.target.value)}
              />
            </div>
            )}
            {showField('tpContact') && (
            <div className="props-field props-field-wide">
              <label className="props-label">Contact</label>
              <textarea
                className="props-textarea"
                value={data.tpContact}
                onChange={(e) => setField('tpContact', e.target.value)}
                // eslint-disable-next-line -- a JS string, not a JSX attr
                // literal: attr strings keep the backslash, so the ghost text
                // showed a literal \n (v6.27)
                placeholder={'Name\nAgency\nemail@example.com\n(310) 555-0100'}
                rows={4}
              />
            </div>
            )}
            {showField('tpCopyright') && (
            <div className="props-field">
              <label className="props-label">Copyright</label>
              <input
                className="props-input"
                value={data.tpCopyright}
                onChange={(e) => setField('tpCopyright', e.target.value)}
                placeholder="Copyright 2026 Author Name"
              />
            </div>
            )}
            {showField('tpWgaRegistration') && (
            <div className="props-field">
              <label className="props-label">WGA Registration #</label>
              <input
                className="props-input"
                value={data.tpWgaRegistration}
                onChange={(e) => setField('tpWgaRegistration', e.target.value)}
                placeholder="WGAw #123456"
              />
            </div>
            )}
            {showField('tpNotes') && (
            <div className="props-field props-field-wide">
              <label className="props-label">Notes</label>
              <input
                className="props-input"
                value={data.tpNotes}
                onChange={(e) => setField('tpNotes', e.target.value)}
                placeholder="e.g. CONFIDENTIAL"
              />
            </div>
            )}
            {/* v4.73, Derek: the character tool's image control, verbatim —
                the placeholder IS the upload control; clicking opens the
                shared source menu. Placement (Top / Bottom) appears on each
                image's row below once it exists. */}
            <div className="props-field props-field-wide">
              <div
                className="char-profile-image-placeholder char-img-clickable tp-image-ph"
                role="button"
                aria-label="Add an image to the title page"
                title="Add an image to the title page"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setImgMenu({ top: r.top + Math.min(r.height, 48), left: r.left + 12 });
                }}
              >
                <FaRegImage />
                <span className="char-profile-image-add-label">+ Add Image</span>
              </div>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageChosen}
            />

            {(imagesAbove.length + imagesBelow.length) > 0 && (
              <div className="props-field props-field-wide">
                <label className="props-label">Title Page Images ({imagesAbove.length + imagesBelow.length})</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    ...imagesAbove.map((attrs, idx) => ({ attrs, above: true, idx })),
                    ...imagesBelow.map((attrs, idx) => ({ attrs, above: false, idx })),
                  ].map((row, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--fd-border, #ddd)', borderRadius: 4, padding: 4 }}>
                      <div style={{ width: 48, flex: '0 0 auto' }}><TpImageThumb attrs={row.attrs} /></div>
                      <select
                        className="props-input"
                        value={row.above ? 'above' : 'below'}
                        onChange={(e) => moveImg(row.above, row.idx, e.target.value as 'above' | 'below')}
                        style={{ flex: 1 }}
                        title="Image placement"
                      >
                        <option value="above">Top</option>
                        <option value="below">Bottom</option>
                      </select>
                      <select
                        className="props-input"
                        value={(row.attrs.align as string) || 'center'}
                        onChange={(e) => alignImg(row.above, row.idx, e.target.value)}
                        style={{ flex: 1 }}
                        title="Image alignment"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                      <button type="button" className="tp-sync-btn" style={{ marginTop: 0 }} onClick={() => removeImg(row.above, row.idx)}>
                        <FaRegTrashAlt />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Live preview (v4.73, Derek: TO SCALE) — a real 8.5×11in page
              rendered from the same specs Apply inserts, scaled down; the
              zoom buttons magnify, Fit re-fits the column. */}
          <div className="tp-editor-preview tp-editor-preview-scale" ref={previewBoxRef}>
            <div className="tp-preview-zoom">
              {/* v5.39, Derek: the hand grabber — a MODE, so it leads the
                  zoom actions */}
              <button
                type="button"
                className={`tp-pan-toggle${panMode ? ' active' : ''}`}
                title={panMode ? '' : 'Drag to pan'}
                onClick={() => setPanMode((v) => !v)}
              ><FaRegHandPaper /></button>
              <button type="button" title="Zoom out" onClick={() => setTpZoom(Math.max(0.12, Math.round((tpScale / 1.25) * 1000) / 1000))}><LuZoomOut /></button>
              <button type="button" className="tp-preview-zoom-fit" title="Fit the preview column" onClick={() => setTpZoom('fit')}>Fit</button>
              <button type="button" title="Zoom in" onClick={() => setTpZoom(Math.min(1.6, Math.round((tpScale * 1.25) * 1000) / 1000))}><LuZoomIn /></button>
            </div>
            <div className={`tp-preview-scroll${panMode ? ' tp-pan-mode' : ''}`} ref={previewScrollRef} onPointerDown={startPan}>
              {/* v5.74: the preview page is the REAL paper — size and margins
                  from the live page layout, not a hardcoded 8.5x11 with 1in/
                  1.5in. A4 (or any custom margin) previewed as US Letter
                  before, so the miniature could not match the page. */}
              <div style={{ width: pageLayout.pageWidth * 96 * tpScale, height: pageLayout.pageHeight * 96 * tpScale, position: 'relative', margin: '0 auto', flex: '0 0 auto' }}>
                <div
                  className="tp-scale-page"
                  style={{
                    transform: `scale(${tpScale})`,
                    width: `${pageLayout.pageWidth}in`,
                    height: `${pageLayout.pageHeight}in`,
                    paddingTop: `${pageLayout.topMargin}pt`,
                    paddingBottom: `${pageLayout.bottomMargin}pt`,
                    paddingLeft: `${pageLayout.leftMargin}in`,
                    paddingRight: `${pageLayout.rightMargin}in`,
                  }}
                >
                  {imagesAbove.map((a, i) => (
                    <div key={`a${i}`} style={{ height: `${previewImgLines(a) * 12}pt`, overflow: 'hidden' }}>
                      <TpImageThumb attrs={a} align fill />
                    </div>
                  ))}
                  {previewSpecs.map(renderSpecLine)}
                  {imagesBelow.map((a, i) => (
                    <div key={`b${i}`} style={{ height: `${previewImgLines(a) * 12}pt`, overflow: 'hidden' }}>
                      <TpImageThumb attrs={a} align fill />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        {imgMenu && (
          <ImageSourceMenu
            pos={imgMenu}
            onLocal={handleAddImage}
            onAssets={currentProject ? () => { void openAssetPicker(); } : undefined}
            onClose={() => setImgMenu(null)}
          />
        )}
        {assetPickerOpen && currentProject && (
          <CharacterImagePickerDialog
            forName="the Title Page"
            filter={assetFilter}
            setFilter={setAssetFilter}
            imageAssets={imageAssets}
            linkedImageIds={[]}
            projectId={currentProject.id}
            onAssociate={handleAssetPicked}
            onClose={() => setAssetPickerOpen(false)}
          />
        )}
        <div className="dialog-actions">
          <button onClick={handleDeleteTitlePage} style={{ marginRight: 'auto', color: 'var(--fd-danger)', background: 'rgba(192, 57, 43, 0.14)', borderColor: 'rgba(192, 57, 43, 0.45)' }}>
            Delete Title Page
          </button>
          {/* v3.44, Derek: apply and jump to Preview to see the title page in place. */}
          <button onClick={handlePreview}>Preview</button>
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default TitlePageEditor;
