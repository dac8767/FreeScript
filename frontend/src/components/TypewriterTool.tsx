/**
 * Typewriter (v1.68 → v1.77) — Tools menu; dockable like any tool.
 *
 * The window stays open when you click into the editor (keepOpenOnEditorClick
 * in ALL_TOOLS): these options are tuned WHILE writing. v1.77 also slimmed
 * the panel per Derek — line-length limit and keep-lines are gone, Hemingway
 * mode lives in Vomit Draft, and restore-cursor moved to Settings > General.
 * The "Dim unfocused text" sub-options (what stays bright + how faint the
 * rest goes) are visually nested under their parent toggle.
 * v4.35: the intro paragraph moved into a "?" popover on the master row, and
 * with the master off everything below it dims and goes inert as one block.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaRegQuestionCircle } from 'react-icons/fa';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { centerCaretLine, refreshTypewriterChrome } from '../editor/extensions/TypewriterScroll';
import { useHt } from '../utils/helperText';

/** Highlight tints — rendered ~30% over the white page, so mid-brightness
 *  hues read best. The color input at the end covers everything else. */
const HIGHLIGHT_COLORS = ['#4a9eff', '#f5d90a', '#34c759', '#ff9f0a', '#ff6ba9', '#9a9a9a'];

/** v5.66, Derek: the "?" rides the window HEADER now (chrome Controls slot).
 *  Same popover shape as v4.35: PORTALLED to document.body and positioned
 *  fixed from the button rect (top/left, never bottom), because a child of
 *  the panel could never escape its overflow. */
export function FocusHeaderControls() {
  const ht = useHt();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement>(null);
  const [helpPos, setHelpPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // contains(), not ===: a hit on the button's svg is still the button.
      if (!t.closest('.fs-help-pop') && !helpBtnRef.current?.contains(t)) setHelpOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHelpOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [helpOpen]);

  const toggleHelp = () => {
    if (!helpOpen && helpBtnRef.current) {
      const r = helpBtnRef.current.getBoundingClientRect();
      setHelpPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 120, window.innerWidth - 288)) });
    }
    setHelpOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={helpBtnRef}
        className="fs-help-btn"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); toggleHelp(); }}
      ><FaRegQuestionCircle /></button>
      {helpOpen && helpPos && createPortal(
        <div className="fs-help-pop" style={{ top: helpPos.top, left: helpPos.left }}>
          {ht("Focus mode keeps the line you're typing on fixed on screen. The page scrolls, your eyes don't.")}
        </div>,
        document.body,
      )}
    </>
  );
}

export default function TypewriterTool({ editor }: { editor: Editor | null }) {
  const {
    typewriterEnabled, setTypewriterEnabled,
    typewriterFollowCursor, setTypewriterFollowCursor,
    typewriterOffset, setTypewriterOffset,
    typewriterHighlightLine, setTypewriterHighlightLine,
    typewriterHighlightColor, setTypewriterHighlightColor,
    typewriterDimOthers, setTypewriterDimOthers,
    typewriterDimMode, setTypewriterDimMode,
    typewriterDimOpacity, setTypewriterDimOpacity,
    writingFocus, setWritingFocus,
    typewriterMasterEnabled, setTypewriterMasterEnabled,
  } = useEditorStore();
  const off = !typewriterMasterEnabled;

  const live = editor && !editor.isDestroyed ? editor : null;
  const snapToCenter = () => { if (live) centerCaretLine(live); };
  const refreshChrome = () => { if (live) refreshTypewriterChrome(live); };
  /** Dim decorations recompute on the next transaction — force one so a
   *  toggle takes effect immediately, not on the next keystroke. */
  const nudge = () => { if (live) live.view.dispatch(live.state.tr); };

  return (
    <div className="fs-typewriter">
      {/* v1.84: the master switch. Sub-options keep their checked state, so
          flipping this back on restores exactly the setup you had. */}
      <div className="fs-typewriter-masterrow">
        <label className="fs-typewriter-toggle fs-typewriter-master">
          <input
            type="checkbox"
            className="fs-switch"
            checked={typewriterMasterEnabled}
            onChange={(e) => {
              setTypewriterMasterEnabled(e.target.checked);
              if (!e.target.checked) setWritingFocus(false);
              refreshChrome();
              nudge();
              if (e.target.checked && typewriterEnabled) snapToCenter();
            }}
          />
          <span>Enable Focus Tool</span>
        </label>
        {/* (v5.66: the "?" moved to the window header — FocusHeaderControls) */}
      </div>

      {/* v4.35: master off = everything below dims AND goes inert as one
          block (the per-input disabled= stays on as belt and braces). */}
      <div className={'fs-typewriter-rest' + (off ? ' disabled' : '')}>
        <label className="fs-typewriter-toggle">
          <input
            type="checkbox"
            disabled={off}
            checked={typewriterEnabled}
            onChange={(e) => {
              setTypewriterEnabled(e.target.checked);
              if (e.target.checked) snapToCenter(); else refreshChrome();
            }}
          />
          <span>Typewriter scrolling</span>
        </label>

        <div className={`fs-typewriter-subgroup${typewriterEnabled && !off ? '' : ' disabled'}`}>
          <label className="fs-typewriter-toggle">
            <input
              type="checkbox"
              disabled={off || !typewriterEnabled}
              checked={typewriterFollowCursor}
              onChange={(e) => {
                setTypewriterFollowCursor(e.target.checked);
                if (e.target.checked) snapToCenter();
              }}
            />
            <span>Also center when the cursor moves</span>
          </label>

          <div className="fs-typewriter-offset">
            <span>Line position</span>
            <input
              type="range"
              min={20}
              max={80}
              step={5}
              disabled={off || !typewriterEnabled}
              value={Math.round(typewriterOffset * 100)}
              onChange={(e) => { setTypewriterOffset(Number(e.target.value) / 100); snapToCenter(); }}
            />
            <span className="fs-typewriter-offset-val">{Math.round(typewriterOffset * 100)}%</span>
          </div>
        </div>

        <label className="fs-typewriter-toggle">
          <input
            type="checkbox"
            disabled={off}
            checked={typewriterHighlightLine}
            onChange={(e) => { setTypewriterHighlightLine(e.target.checked); refreshChrome(); }}
          />
          <span>Highlight the current line</span>
        </label>
        <div className={`fs-typewriter-subgroup${typewriterHighlightLine && !off ? '' : ' disabled'}`}>
          <div className="fs-typewriter-offset">
            <span>Color</span>
            <span className="fs-typewriter-swatches">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c}
                  className={`fs-typewriter-swatch${typewriterHighlightColor.toLowerCase() === c ? ' active' : ''}`}
                  style={{ background: c }}
                  disabled={off || !typewriterHighlightLine}
                  title={c}
                  onClick={() => { setTypewriterHighlightColor(c); refreshChrome(); }}
                />
              ))}
            </span>
          </div>
        </div>

        <label className="fs-typewriter-toggle">
          <input
            type="checkbox"
            disabled={off}
            checked={typewriterDimOthers}
            onChange={(e) => { setTypewriterDimOthers(e.target.checked); nudge(); }}
          />
          <span>Dim unfocused text</span>
        </label>
        <div className={`fs-typewriter-subgroup${typewriterDimOthers && !off ? '' : ' disabled'}`}>
          <div className="fs-typewriter-offset">
            <span>Keep focus on</span>
            <select
              disabled={off || !typewriterDimOthers}
              value={typewriterDimMode}
              onChange={(e) => { setTypewriterDimMode(e.target.value as 'elements' | 'sentences'); nudge(); }}
            >
              <option value="elements">Current element</option>
              <option value="sentences">Current sentence</option>
            </select>
          </div>
          <div className="fs-typewriter-offset">
            <span>Dimmed to</span>
            <input
              type="range"
              min={5}
              max={70}
              step={5}
              disabled={off || !typewriterDimOthers}
              value={Math.round(typewriterDimOpacity * 100)}
              onChange={(e) => setTypewriterDimOpacity(Number(e.target.value) / 100)}
            />
            <span className="fs-typewriter-offset-val">{Math.round(typewriterDimOpacity * 100)}%</span>
          </div>
        </div>

        <label className="fs-typewriter-toggle">
          <input
            type="checkbox"
            disabled={off}
            checked={writingFocus}
            onChange={(e) => setWritingFocus(e.target.checked)}
          />
          <span>Extreme focus (fullscreen, everything hidden)</span>
        </label>
      </div>
    </div>
  );
}
