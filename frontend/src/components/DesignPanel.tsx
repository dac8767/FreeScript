/**
 * DesignPanel (v4.8) — a floating, draggable, resizable control surface that
 * exposes every registered design token as a live slider. Adjusting one writes
 * to the store (`setDesignVar`), an effect mirrors the store onto :root, and the
 * running app restyles in real time — no reload, no per-tweak note.
 *
 * It portals to <body> and is `position: fixed` so it floats over the whole app
 * (including portaled dialogs) and you can watch the thing you're tuning change
 * behind it. "Copy CSS" dumps the current overrides as a :root block so a chosen
 * look can be baked into the stylesheet permanently.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuRotateCcw, LuSearch } from 'react-icons/lu';
import { FaCopy, FaCheck, FaChevronRight, FaChevronDown } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import ExportPartButton from './ExportPartButton';
import { runMajorChange } from '../utils/majorChange';
import { pushWindowAction } from '../stores/windowUndoStore';
import { DESIGN_GROUPS, buildOverrideCss, clampTokenValue, type DesignToken } from '../design/designTokens';
import { EdgeResizeZones, startEdgeResize, type EdgeZone } from './EdgeResize';

// Round to the token's step so the number input doesn't show float noise.
function snap(val: number, step: number): number {
  const inv = 1 / step;
  return Math.round(val * inv) / inv;
}

function TokenRow({ t }: { t: DesignToken }) {
  const isStore = !!t.store;
  /* v5.13, Derek: "i was trying to type 650 … but it immediately changes to
     300." The number field committed (and CLAMPED) on every keystroke, so a
     leading "6" was clamped to the 300 minimum before the "5" could land —
     unnoticed until scenesTableMin became the first token with a min bigger
     than a single digit. While focused, the field holds an unclamped DRAFT
     string; clamp-and-commit happen on blur/Enter, Escape abandons the
     draft. The slider keeps instant commit — dragging can't leave range. */
  const [draft, setDraft] = useState<string | null>(null);
  const draftCancelled = useRef(false);
  // css-var tokens read their override map; store-bound tokens read the store
  // field live (so external changes — e.g. the drag handle — reflect here too).
  const cssOverride = useEditorStore((s) => (isStore ? undefined : s.designVars[t.id]));
  const storeVal = useEditorStore((s) => (t.store ? t.store.get(s) : 0));
  const setDesignVar = useEditorStore((s) => s.setDesignVar);
  /* v7.32: the DISPLAYED value is clamped, same as the painted one. A preset
     can persist a number outside the slider's range; showing it raw would put
     the readout and the page out of step and leave the writer dragging a
     control that already reads what they want. */
  const value = isStore ? storeVal : clampTokenValue(t, cssOverride ?? t.def);
  const isOverridden = isStore ? storeVal !== t.def : cssOverride !== undefined && cssOverride !== t.def;

  /* v6.78: every committed change is undoable (window-undo lane). A range
     drag commits once per input event — the coalesceKey merges the burst so
     ⌘Z returns to the value from BEFORE the drag, in one step. `prev` is
     three-state for CSS tokens: a number override or undefined (default). */
  const apply = (val: number) => { if (t.store) t.store.set(val); else setDesignVar(t.id, val); };
  const restore = (prev: number | undefined) => {
    if (t.store) t.store.set(prev ?? t.def);
    else if (prev === undefined) useEditorStore.getState().resetDesignVar(t.id);
    else useEditorStore.getState().setDesignVar(t.id, prev);
  };
  const commit = (raw: number) => {
    if (Number.isNaN(raw)) return;
    const clamped = clampTokenValue(t, snap(raw, t.step));
    if (clamped === value) return;
    const prev = isStore ? storeVal : cssOverride;
    apply(clamped);
    pushWindowAction(
      `Design change — ${t.label}`,
      () => restore(prev),
      () => apply(clamped),
      { coalesceKey: `dz:${t.id}` },
    );
  };
  const reset = () => {
    if (!isOverridden) return;
    const prev = isStore ? storeVal : cssOverride;
    // the redo closure applies WITHOUT pushing — pushing from inside redo
    // would grow the stack on every redo
    const applyReset = () => { if (t.store) t.store.set(t.def); else useEditorStore.getState().resetDesignVar(t.id); };
    applyReset();
    pushWindowAction(`Reset — ${t.label}`, () => restore(prev), applyReset);
  };

  return (
    <div className={`dz-row${isOverridden ? ' dz-row-on' : ''}`}>
      <div className="dz-row-top">
        <span className="dz-row-label" title={t.label}>{t.label}</span>
        <div className="dz-row-num">
          {!t.choices && (
            <>
              <input
                type="number"
                className="dz-num"
                value={draft ?? value}
                min={t.min}
                max={t.max}
                step={t.step}
                onFocus={() => setDraft(String(value))}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  else if (e.key === 'Escape') { draftCancelled.current = true; e.currentTarget.blur(); }
                }}
                onBlur={(e) => {
                  // Read the DOM value, not the draft state — an Escape-blur
                  // fires this handler inside the OLD closure.
                  if (!draftCancelled.current && draft !== null) commit(parseFloat(e.currentTarget.value));
                  draftCancelled.current = false;
                  setDraft(null);
                }}
              />
              {t.unit && <span className="dz-unit">{t.unit}</span>}
            </>
          )}
          <button
            className="dz-reset"
            title={isOverridden ? 'Reset to default' : 'Default'}
            disabled={!isOverridden}
            onClick={reset}
          ><LuRotateCcw /></button>
        </div>
      </div>
      {t.choices ? (
        /* v4.71: enumerated token — a segmented row, not a slider */
        <div className="dz-choices">
          {t.choices.map((c) => (
            <button
              key={c.value}
              className={`dz-choice${value === c.value ? ' on' : ''}`}
              onClick={() => commit(c.value)}
            >{c.label}</button>
          ))}
        </div>
      ) : (
        <input
          type="range"
          className="dz-range"
          value={value}
          min={t.min}
          max={t.max}
          step={t.step}
          onChange={(e) => commit(parseFloat(e.target.value))}
        />
      )}
      {t.hint && <div className="dz-hint">{t.hint}</div>}
    </div>
  );
}

/**
 * The scrollable guts of the Design surface — search, the grouped token rows,
 * and the Reset/Copy footer. Shared verbatim by the floating window (below) and
 * the dockable side-panel tool (ToolDock 'design'), so the two entry points can
 * never drift apart. It carries no chrome and no positioning of its own — the
 * host provides that.
 */
export function DesignPanelBody() {
  const designVars = useEditorStore((s) => s.designVars);
  const [query, setQuery] = useState('');
  // v4.32 batch-v8 #4, Derek: sections start COLLAPSED and the state is
  // remembered across close/reopen (store-persisted; null = untouched, which
  // now means every group folded rather than every group open).
  const collapsedIds = useEditorStore((s) => s.designCollapsedGroups);
  const setCollapsedIds = useEditorStore((s) => s.setDesignCollapsedGroups);
  const collapsed = useMemo(
    () => new Set(collapsedIds ?? DESIGN_GROUPS.map((g) => g.id)),
    [collapsedIds],
  );
  const [copied, setCopied] = useState(false);

  const q = query.trim().toLowerCase();
  const groups = DESIGN_GROUPS
    .map((g) => ({
      ...g,
      tokens: q ? g.tokens.filter((t) => t.label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)) : g.tokens,
    }))
    .filter((g) => g.tokens.length > 0);

  const overrideCount = Object.keys(designVars).filter((k) => designVars[k] !== undefined).length;

  const copyCss = async () => {
    const css = buildOverrideCss(designVars);
    if (!css) return;
    try {
      await navigator.clipboard.writeText(css);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = css; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* no-op */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const toggleGroup = (id: string) => {
    const next = new Set<string>(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setCollapsedIds([...next]);
  };

  return (
    <>
      <div className="dz-search">
        <LuSearch className="dz-search-icon" />
        <input
          className="dz-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="dz-note">A setting only shows an effect while the thing it styles is on screen — open that panel, window, or dialog to watch it change.</div>

      <div className="dz-body">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.id) && !q;
          return (
            <div className="dz-group" key={g.id}>
              <button className="dz-group-head" onClick={() => toggleGroup(g.id)}>
                {isCollapsed ? <FaChevronRight /> : <FaChevronDown />}
                <span>{g.label}</span>
              </button>
              {!isCollapsed && g.tokens.map((t) => <TokenRow key={t.id} t={t} />)}
            </div>
          );
        })}
        {/* (v6.22: the Helper Text group moved to its OWN window —
            Help ▸ Developer ▸ Helper Text….) */}
        {groups.length === 0 && <div className="dz-empty">No settings match “{query}”.</div>}
      </div>

      <div className="dz-footer">
        {/* v6.77: warned + undoable — a session of tuned sliders is exactly
            the "hard work" Derek's helper-text reset lost. */}
        <button
          className="dz-foot-btn"
          onClick={() => {
            const st = useEditorStore.getState();
            const n = Object.keys(st.designVars).length;
            void runMajorChange({
              title: 'Reset All Design Settings',
              message: `Reset all ${n} changed design setting${n === 1 ? '' : 's'} back to the app defaults?\n\nEvery slider you have moved in this window goes back to factory.`,
              confirmLabel: 'Reset',
              label: `Reset all design settings (${n})`,
              capture: () => {
                const prev = { ...st.designVars };
                return () => useEditorStore.getState().setDesignVars(prev);
              },
              run: () => useEditorStore.getState().resetAllDesign(),
            });
          }}
          disabled={overrideCount === 0}
        >
          <LuRotateCcw /> Reset all
        </button>
        <button className="dz-foot-btn" onClick={copyCss} disabled={overrideCount === 0}>
          {copied ? <><FaCheck /> Copied</> : <><FaCopy /> Copy CSS</>}
        </button>
        {/* v7.74, Derek: "make it so I can export design and helper text info…
            I will export a file from each for you to integrate into the code
            directly." Copy CSS beside it writes the OVERRIDES as CSS for a
            stylesheet; this writes the values themselves, as a file that also
            imports back into the app. Same button as the Helper Text window's,
            because it is the same act. */}
        <ExportPartButton part="design" />
      </div>
    </>
  );
}

/** The dockable side-panel form of the Design surface (ToolDock 'design'). */
export function DesignPanelDocked() {
  return <div className="dz-embedded"><DesignPanelBody /></div>;
}

export default function DesignPanel() {
  const open = useEditorStore((s) => s.designPanelOpen);
  const setOpen = useEditorStore((s) => s.setDesignPanelOpen);
  const designVars = useEditorStore((s) => s.designVars);

  const [pos, setPos] = useState<{ x: number; y: number }>({ x: -1, y: 64 });
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 340, h: 560 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // v5.49, Derek: the pop-out SEATS against its side panel — the window's
  // RIGHT edge touching the right panel's LEFT edge (mirrored when the
  // tool lives in the left panel) — the classic popped position every
  // drag-out window snaps to (v4.64). Every open re-seats; dragging it
  // somewhere else is respected while it stays open. No visible panel
  // (icon rail / hidden) → fall back to the top-right anchor.
  // v5.50, Derek ("it flashes on the far left for a split second"): a
  // LAYOUT effect — the seat lands before the browser paints, so the
  // stale/initial position never shows for a frame.
  useLayoutEffect(() => {
    if (!open) return;
    const side = (useEditorStore.getState().toolConfig.design?.side ?? 'right') as 'left' | 'right';
    const dockEl = document.querySelector<HTMLElement>(`.tool-dock-wrap.tool-dock-${side}`);
    const r = dockEl?.getBoundingClientRect();
    if (r && r.width > 0) {
      setPos({
        x: side === 'right'
          ? Math.max(8, r.left - size.w - 8)
          : Math.min(window.innerWidth - size.w - 8, r.right + 8),
        y: Math.max(8, r.top + 8),
      });
    } else {
      setPos({ x: Math.max(8, window.innerWidth - size.w - 24), y: 64 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    // v5.47, Derek ("i can no longer add the design window back into the
    // side panel"): the v4.39 gesture works on THIS window too — while it
    // drags, hovering a side panel marks the drop target; releasing there
    // docks Design (writes toolMode 'docked', which the row click honors
    // until the row is dragged back out).
    let over: { side: 'left' | 'right'; el: HTMLElement } | null = null;
    const zones = () => (['left', 'right'] as const).flatMap((s) => {
      if (useEditorStore.getState().panelSizeMode[s] === 'icons') return [];
      const el = document.querySelector<HTMLElement>(`.tool-dock-wrap.tool-dock-${s} .tool-dock`);
      return el ? [{ side: s, el }] : [];
    });
    const dockInto = (side: 'left' | 'right') => {
      const st = useEditorStore.getState();
      const cfg = st.toolConfig.design;
      if (!cfg?.enabled || cfg.side !== side) {
        st.setToolConfig({ ...st.toolConfig, design: { side, enabled: true } });
      }
      st.setToolMode('design', 'docked');
      st.setDesignPanelOpen(false);
      st.openTool('design');   // routes to the docked slot now
    };
    const move = (e: PointerEvent) => {
      if (drag.current) {
        setPos({
          x: Math.min(window.innerWidth - 80, Math.max(0, e.clientX - drag.current.dx)),
          y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - drag.current.dy)),
        });
        const hit = zones().find(({ el }) => {
          const r = el.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        }) ?? null;
        if ((hit?.el ?? null) !== (over?.el ?? null)) {
          over?.el.classList.remove('tool-dock-drop-target');
          hit?.el.classList.add('tool-dock-drop-target');
          over = hit;
        }
      }
    };
    const up = () => {
      const dropped = drag.current && over;
      drag.current = null;
      if (over) {
        const side = over.side;
        over.el.classList.remove('tool-dock-drop-target');
        over = null;
        if (dropped) dockInto(side);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  if (!open) return null;

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input')) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };
  // v5.46: any edge/corner resizes (the corner grip is gone).
  const beginEdge = (zone: EdgeZone, e: React.PointerEvent) => startEdgeResize(e, zone, {
    rect: () => ({ left: pos.x, top: pos.y, w: size.w, h: size.h }),
    min: { w: 280, h: 240 },
    apply: (g) => { setPos({ x: g.left, y: g.top }); setSize({ w: g.w, h: g.h }); },
  });

  const overrideCount = Object.keys(designVars).filter((k) => designVars[k] !== undefined).length;

  return createPortal(
    <div className="dz-panel" style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}>
      <div className="dz-header" onPointerDown={startDrag}>
        <span className="dz-title">Design</span>
        {overrideCount > 0 && <span className="dz-count">{overrideCount} changed</span>}
        <button className="dz-close" title="Close" onClick={() => setOpen(false)}>&times;</button>
      </div>

      <DesignPanelBody />

      {/* v5.46: any edge/corner resizes — the corner grip is gone */}
      <EdgeResizeZones onStart={beginEdge} />
    </div>,
    document.body,
  );
}
