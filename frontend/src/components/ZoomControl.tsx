/**
 * ZoomControl — the toolbar's zoom stepper, its editable percentage, and the
 * Reset / Fit menu behind the caret.
 *
 * v7.46: lifted out of Toolbar's renderBuiltinControl. That switch is 661
 * lines and closes over 79 values, which reads like an unsplittable knot —
 * but the 79 is the UNION across 33 cases, and the median case uses three.
 * The knot is four cases carrying their own state; zoom is the biggest, at
 * five state fields, three effects and two measuring functions.
 *
 * Which is why this takes NO PROPS. Everything it needs (zoomLevel,
 * setZoomLevel, pageLayout) is in the store, and everything else was always
 * private to zoom — it only looked like Toolbar's state because it was
 * declared there.
 *
 * WHAT MUST NOT BE RE-DERIVED, kept verbatim below: fitPageToScreen takes the
 * page height from pageLayout, NOT from the DOM. There is only one .page
 * element and it holds the whole script — page breaks are decorations — so
 * measuring the element measures the entire document and "fit" shrinks the
 * script until every page fits. Reading min-height instead does not help: at
 * runtime the element carries an inline min-height of the LAST page's end.
 * Two attempts (v0.85, v0.87) died there before v0.89 stopped asking the DOM.
 */
import React, { useState, useRef, useEffect } from 'react';
import { FaChevronDown } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { CirclePlusIcon, CircleMinusIcon } from './uiIcons';

/** Zoom bounds. Toolbar-local constants that only zoom ever used, so they came
 *  with it. The editable input previously advertised max 200 while the buttons
 *  allowed 300 — unified here (v0.75), and worth keeping said: two controls
 *  for one number is how they disagree. */
const ZOOM_MIN = 50;
const ZOOM_MAX = 300;

const ZoomControl: React.FC = () => {
  const zoomLevel = useEditorStore((s) => s.zoomLevel);
  const setZoomLevel = useEditorStore((s) => s.setZoomLevel);
  const pageLayout = useEditorStore((s) => s.pageLayout);

  // ── Zoom dropdown (v0.75) ──
  const [zoomInput, setZoomInput] = useState(String(zoomLevel));
  const [zoomEditing, setZoomEditing] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomInputRef = useRef<HTMLInputElement>(null);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!zoomEditing) setZoomInput(String(zoomLevel)); }, [zoomLevel, zoomEditing]);

  const commitZoom = () => {
    const val = parseInt(zoomInput, 10);
    if (!isNaN(val) && val >= ZOOM_MIN && val <= ZOOM_MAX) setZoomLevel(val);
    else setZoomInput(String(zoomLevel));
    setZoomEditing(false);
  };

  // Fit Page to Screen is also a rebindable shortcut (v0.77); the MenuBar's key
  // handler dispatches it here because the measurement lives in this component.
  useEffect(() => {
    const onCmd = (e: Event) => {
      if ((e as CustomEvent).detail === 'fitPage') fitPageToScreen();
      if ((e as CustomEvent).detail === 'fitWidth') fitPageToWidth();
    };
    window.addEventListener('scriptcraft:command', onCmd);
    return () => window.removeEventListener('scriptcraft:command', onCmd);
  });

  // Close the zoom menu on an outside click.
  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!zoomMenuRef.current?.contains(e.target as Node)) {
        setZoomMenuOpen(false);
        setZoomEditing(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [zoomMenuOpen]);

  /** Scale so one whole page fits the visible editor area.
   *  Measured from the DOM: the page's UNSCALED height (its rendered height
   *  divided by the zoom currently applied) against the scroll container's
   *  height, minus the page's vertical margins. Deriving it from real geometry
   *  keeps it correct for any paper size or margin setting. */
  const fitPageToScreen = () => {
    const page = document.querySelector('.page') as HTMLElement | null;
    const scroller = document.querySelector('.editor-main') as HTMLElement | null;
    if (!page || !scroller) return;

    // ROOT CAUSE, take two (v0.87). There is only ONE .page element and it holds
    // the WHOLE script — page breaks are decorations, not separate elements. So
    // measuring the element measured the entire document, and "fit" shrank the
    // script until EVERY page fitted.
    //
    // v0.85 tried to fix that by reading min-height, on the reasoning that the
    // stylesheet sets it to one page (11in). It doesn't, at runtime: the element
    // carries an INLINE min-height of `lastPageEnd + bottomMargin` — the end of
    // the LAST page — which overrides the stylesheet. So it was still measuring
    // the whole document, just via a different property. That's why it still
    // showed two pages.
    //
    // The page height is not something to infer from the DOM at all: pageLayout
    // states it (US Letter = 11in). Take it from there. CSS treats 1in as 96px
    // regardless of the actual display, so this is exact.
    const CSS_PX_PER_IN = 96;
    const pc = getComputedStyle(page);

    const onePageH = pageLayout.pageHeight * CSS_PX_PER_IN;
    const pageW = pageLayout.pageWidth * CSS_PX_PER_IN;

    // v0.89: only the page's TOP margin sits between the top of the view and the
    // first page. Its bottom margin falls BELOW page one — counting it shrank
    // the page by that much and let the next page peek in.
    const marginTop = parseFloat(pc.marginTop) || 0;
    const blockH = onePageH + marginTop;
    if (!blockH || !pageW) return;

    // .editor-main pads 30px top / 60px bottom. Only the TOP padding pushes page
    // one down the screen; the bottom padding sits after the WHOLE document, not
    // after page one. Subtracting both (as v0.87 did) made the page ~60px
    // shorter than the space available — and that leftover strip is exactly the
    // sliver of page two Derek could see.
    const sc = getComputedStyle(scroller);
    const padTop = parseFloat(sc.paddingTop) || 0;
    const padX = (parseFloat(sc.paddingLeft) || 0) + (parseFloat(sc.paddingRight) || 0);
    const availH = scroller.clientHeight - padTop;
    const availW = scroller.clientWidth - padX;
    if (availH <= 0 || availW <= 0) return;

    // Whichever axis runs out first decides the zoom — fitting height alone
    // would clip the sides on a narrow window.
    const pct = Math.floor(Math.min(availH / blockH, availW / pageW) * 100);
    setZoomLevel(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pct)));
  };

  /** v2.57, Derek: scale so the page fills the editor's WIDTH — as big as it
   *  can get in the current window; the height scrolls. How much width there
   *  is depends on the sidebars, which is the point: same measured-geometry
   *  approach as fitPageToScreen, width axis only. */
  const fitPageToWidth = () => {
    const scroller = document.querySelector('.editor-main') as HTMLElement | null;
    if (!scroller) return;
    const CSS_PX_PER_IN = 96;
    const pageW = pageLayout.pageWidth * CSS_PX_PER_IN;
    const sc = getComputedStyle(scroller);
    const padX = (parseFloat(sc.paddingLeft) || 0) + (parseFloat(sc.paddingRight) || 0);
    const availW = scroller.clientWidth - padX;
    if (availW <= 0 || !pageW) return;
    const pct = Math.floor((availW / pageW) * 100);
    setZoomLevel(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pct)));
  };

  return (
    <div className="zoom-menu-wrap" ref={zoomMenuRef}>
      {/* v3.04, Derek: step zoom straight from the toolbar. v3.48: the %
          is edited RIGHT HERE (click to type) — no popup that just repeats
          the stepper. A small caret keeps Reset / Fit within reach. */}
      <button
        className="toolbar-btn zoom-tb-step"
        title="Zoom out"
        disabled={zoomLevel <= ZOOM_MIN}
        onClick={() => setZoomLevel(Math.max(ZOOM_MIN, zoomLevel - 10))}
      ><CircleMinusIcon /></button>
      <span className="zoom-tb-mid">
        <span className="zoom-tb-icon"><CirclePlusIcon /></span>
        {zoomEditing ? (
          <input
            ref={zoomInputRef}
            className="zoom-tb-input"
            type="number"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={10}
            value={zoomInput}
            onChange={(e) => setZoomInput(e.target.value)}
            onBlur={commitZoom}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitZoom(); }
              if (e.key === 'Escape') { setZoomInput(String(zoomLevel)); setZoomEditing(false); }
            }}
            autoFocus
          />
        ) : (
          <span
            className="toolbar-btn-text zoom-tb-value"
            title="Click to type exact zoom %"
            onClick={() => { setZoomEditing(true); setTimeout(() => zoomInputRef.current?.select(), 0); }}
          >{zoomLevel}%</span>
        )}
        <button
          className="zoom-tb-caret"
          title="Zoom options"
          onClick={() => setZoomMenuOpen((o) => !o)}
        ><FaChevronDown /></button>
      </span>
      <button
        className="toolbar-btn zoom-tb-step"
        title="Zoom in"
        disabled={zoomLevel >= ZOOM_MAX}
        onClick={() => setZoomLevel(Math.min(ZOOM_MAX, zoomLevel + 10))}
      ><CirclePlusIcon /></button>
      {zoomMenuOpen && (
        <div className="zoom-menu">
          <button
            className="zoom-menu-item"
            onClick={() => { setZoomLevel(100); setZoomMenuOpen(false); }}
          >Reset</button>
          <button
            className="zoom-menu-item"
            onClick={() => { fitPageToScreen(); setZoomMenuOpen(false); }}
          >Fit Page to Screen</button>
          <button
            className="zoom-menu-item"
            onClick={() => { fitPageToWidth(); setZoomMenuOpen(false); }}
          >Scale to Max Width</button>
        </div>
      )}
    </div>
  );
};

export default ZoomControl;
