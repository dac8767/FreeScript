/**
 * customizeResets — ONE registry of every "reset to default" the Customize
 * tabs offer (v4.65, Derek). Each tab renders its entries in a Reset section
 * at its bottom (ResetSection), and Settings ▸ Defaults compiles all of them
 * plus the Reset All button (moved there from the Customize globals). Add a
 * reset here and every surface picks it up — no drifting copies.
 */
import React from 'react';
import { DEFAULT_MARKUP_PRESETS } from '../stores/slices/markupsSlice';
import { useEditorStore, DEFAULT_TOOL_CONFIG, DEFAULT_TOOL_ORDER } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { useWindowUndoStore } from '../stores/windowUndoStore';
import { useShortcutStore } from '../stores/shortcutStore';
import { runMajorChange } from '../utils/majorChange';
import { DEFAULT_TOOLBAR_LEFT } from './toolbarBuiltins';
import { resetValue } from '../stores/seedDefaults';
import { activeSnapshot } from '../stores/slices/workspacesSlice';
import { saveViewState } from '../stores/viewState';
import { confirmDialog } from './ConfirmDialog';

/* v7.00: 'design' / 'helper' / 'keys' are WINDOW groups — they render only
   in Settings ▸ Defaults (no Customize tab carries them). */
export type CustomizeTabId = 'elements' | 'toolbar' | 'panels' | 'qat' | 'context' | 'themes' | 'markups' | 'design' | 'helper' | 'keys';

export interface ResetAction {
  id: string;
  label: string;
  tab: CustomizeTabId;
  /** v7.58, Derek: "move the reset buttons so they are each under their
   *  respective section." One bar per tab was right while a tab was one list.
   *  The Editor tab is four sections, so its bar could only sit after ONE of
   *  them — it landed under Transitions and read as belonging to it, while
   *  actually resetting Elements and Suggestions too. A reset that names a
   *  section renders at the foot of that section instead of in the tab's bar.
   *  Settings ▸ Defaults still compiles the whole registry by `tab`, so this
   *  changes where a button sits, never what the app can put back. */
  section?: string;
  /** What goes back to default, in the warning's words ("the ribbon
   *  toolbar's layout"). v6.77: every reset warns first. */
  what: string;
  run: () => void;
  /** Snapshot for the window-undo lane; returns the restore closure.
   *  Omitted = the state lives in CUSTOMIZATION_FIELDS, so the shared
   *  captureCustomizations/restoreCustomizations pair covers it. */
  capture?: () => () => void;
}

/**
 * What every Reset below puts back, asked in ONE place.
 *
 * v7.71, Derek: "resetting anything should set it to the default of the
 * current workspace. so resetting the ribbon toolbar returns it to the initial
 * state of the current workspace, whether it is the default workspace,
 * minimalist, etc." So the workspace you are standing in is the baseline, and
 * what a workspace does not carry — design values, annotation presets, helper
 * text, the element lists — falls through to what the app ships (resetValue).
 *
 * Read fresh on every run, never captured at module load: the answer depends
 * on which workspace is applied when the button is pressed.
 */
const ws = () => activeSnapshot(useEditorStore.getState());

/** The default capture: the same full-customize snapshot Customize's own
 *  Save/Cancel rests on (v3.49) — one list, nothing quietly left behind. */
const captureCustomizeState = (): (() => void) => {
  const snap = useEditorStore.getState().captureCustomizations();
  return () => useEditorStore.getState().restoreCustomizations(snap);
};

export const CUSTOMIZE_RESETS: ResetAction[] = [
  /* ── Annotations ──
     v7.56: this one had its OWN button and its own runMajorChange call in
     MarkupsCustomizeTab, which is exactly the drifting copy this registry's
     header warns about — and it meant Settings ▸ Defaults, which compiles the
     registry, never listed it. Registered here it appears in both places and
     warns through the one wrapper. */
  {
    id: 'markupPresets', label: 'Reset Annotation Presets', tab: 'markups',
    what: 'your annotation presets — the icon and colour combinations',
    run: () => useEditorStore.getState()
      .setMarkupPresets(resetValue(ws(), 'markupPresets', DEFAULT_MARKUP_PRESETS)),
    capture: () => {
      const prev = useEditorStore.getState().markupPresets.map((m) => ({ ...m }));
      return () => useEditorStore.getState().setMarkupPresets(prev);
    },
  },
  /* ── Editor ──
     v7.58, Derek: "we do not need the 'Reset Mores and Continueds' button at
     all." Removed from the registry rather than only from the tab, so it
     leaves Settings ▸ Defaults with it — a reset that exists in one surface
     and not the other is the drift this registry exists to prevent. The
     section is four controls with visible defaults; putting them back by hand
     is quicker than finding the button was. */
  {
    id: 'transitions', label: 'Reset Transitions', tab: 'elements', section: 'transitions',
    what: 'your transition list — custom entries, hidden ones and their order',
    run: () => useFormattingTemplateStore.getState().resetTransitions(),
    capture: () => {
      const st = useFormattingTemplateStore.getState();
      const prev = {
        custom: [...st.customTransitions],
        hidden: [...st.hiddenTransitions],
        order: [...st.transitionOrder],
      };
      return () => useFormattingTemplateStore.getState().restoreTransitions(prev);
    },
  },
  {
    id: 'elements', label: 'Reset Elements', tab: 'elements', section: 'elements',
    what: 'the element list’s hidden items and order',
    run: () => useFormattingTemplateStore.getState().resetElementOverrides(),
    capture: () => {
      const st = useFormattingTemplateStore.getState();
      const hidden = [...st.elementHidden];
      const order = [...st.elementOrder];
      return () => {
        const cur = useFormattingTemplateStore.getState();
        cur.setElementHidden(hidden);
        cur.setElementOrder(order);
      };
    },
  },
  {
    // v7.81: the section is "Element Rules" now; its reset follows the rename.
    id: 'suggestions', label: 'Reset Element Rules', tab: 'elements', section: 'suggestions',
    what: 'the element suggestion rules',
    run: () => {
      const st = useEditorStore.getState();
      st.setSuggestionRules(resetValue(ws(), 'suggestionRules', null));
      st.setSuggestionMode(resetValue(ws(), 'suggestionMode', 'smart'));
    },
  },
  // ── Toolbar ──
  {
    id: 'toolbarSize', label: 'Reset Size', tab: 'toolbar',
    what: 'the toolbar’s size and spacing',
    run: () => {
      const st = useEditorStore.getState();
      st.setToolbarMode(resetValue(ws(), 'toolbarMode', 'compact'));
      st.setChromeGap('toolbar', resetValue<Record<string, number>>(ws(), 'chromeGapPx', {}).toolbar ?? 2);
    },
  },
  {
    id: 'toolbarItems', label: 'Reset Items', tab: 'toolbar',
    what: 'the ribbon toolbar’s layout',
    run: () => {
      const st = useEditorStore.getState();
      st.setToolbarZones(
        resetValue(ws(), 'toolbarLeft', [...DEFAULT_TOOLBAR_LEFT]),
        resetValue(ws(), 'toolbarRight', []),
      );
      const toolbarDdWidths = resetValue(ws(), 'toolbarDdWidths', {});
      saveViewState({ toolbarDdWidths });
      useEditorStore.setState({ toolbarDdWidths });
    },
  },
  // ── Side Panels ──
  {
    id: 'panelsSize', label: 'Reset Size', tab: 'panels',
    what: 'the side panels’ width and tool scale',
    run: () => {
      // v4.65, Derek's bug report: resetting the width MODE alone read as
      // "not working" whenever only the vertical tool scaling had been
      // dragged — the size reset covers BOTH width and the tool scale now.
      const st = useEditorStore.getState();
      const mode = resetValue<{ left?: string; right?: string }>(ws(), 'panelSizeMode', {});
      const scale = resetValue<{ left?: number; right?: number }>(ws(), 'panelItemScale', {});
      for (const side of ['left', 'right'] as const) {
        st.setPanelSizeMode(side, (mode[side] ?? 'comfortable') as Parameters<typeof st.setPanelSizeMode>[1]);
        st.setPanelItemScale(side, scale[side] ?? 1);
      }
    },
  },
  {
    id: 'panelsItems', label: 'Reset Items', tab: 'panels',
    what: 'the side panels’ tools, sides and order',
    run: () => {
      // Mirrors the old in-tab reset: every tool back to its default side,
      // dividers cleared, default order.
      const st = useEditorStore.getState();
      st.setToolConfig(resetValue(ws(), 'toolConfig', { ...DEFAULT_TOOL_CONFIG }));
      st.setPanelDividers(resetValue(ws(), 'panelDividers', []));
      st.setToolOrder(resetValue(ws(), 'toolOrder', [...DEFAULT_TOOL_ORDER]));
    },
  },
  // ── Quick Access ──
  {
    id: 'qatItems', label: 'Reset Items', tab: 'qat',
    what: 'the Quick Access Toolbar’s buttons',
    run: () => useEditorStore.getState()
      .setQatItems(resetValue(ws(), 'qatItems', ['save', 'undo', 'redo'])),
  },
  // ── Context Menu ──
  {
    id: 'contextItems', label: 'Reset Items', tab: 'context',
    what: 'the right-click menu’s items and order',
    run: () => {
      const st = useEditorStore.getState();
      st.setContextMenuHidden(resetValue(ws(), 'contextMenuHidden', []));
      st.setContextMenuOrder(resetValue(ws(), 'contextMenuOrder', []));
    },
  },
  /* v7.00, Derek (via the feedback form): the WINDOW resets join the
     registry so Settings ▸ Defaults truly compiles every reset. Same
     bulk-restore store functions the windows' own buttons use. */
  {
    id: 'designTokens', label: 'Reset Design Tokens', tab: 'design',
    what: 'every Design-window slider override',
    capture: () => {
      const prev = { ...useEditorStore.getState().designVars };
      return () => useEditorStore.getState().setDesignVars(prev);
    },
    run: () => useEditorStore.getState().setDesignVars(resetValue(ws(), 'designVars', {})),
  },
  {
    id: 'helperText', label: 'Reset Helper Text', tab: 'helper',
    what: 'every helper-text edit and hidden entry',
    capture: () => {
      const st = useEditorStore.getState();
      const o = { ...st.helperTextOverrides };
      const h = [...st.helperTextHidden];
      return () => {
        const s = useEditorStore.getState();
        s.setHelperTextOverrides(o);
        s.setHelperTextHidden(h);
      };
    },
    run: () => {
      const s = useEditorStore.getState();
      s.setHelperTextOverrides(resetValue(ws(), 'helperTextOverrides', {}));
      s.setHelperTextHidden(resetValue(ws(), 'helperTextHidden', []));
    },
  },
  {
    id: 'shortcuts', label: 'Reset Keyboard Shortcuts', tab: 'keys',
    what: 'every rebound keyboard shortcut',
    capture: () => {
      const prev = JSON.parse(JSON.stringify(useShortcutStore.getState().overrides));
      return () => useShortcutStore.getState().restoreOverrides(prev);
    },
    run: () => useShortcutStore.getState().restoreOverrides({}),
  },
];

/** THE way a registry reset runs — warn, capture, run, land on the
 *  window-undo lane (v6.77's rule). v6.85: extracted so Settings ▸ Defaults
 *  runs the SAME wrapper as the per-tab Reset sections — it was still
 *  calling a.run() bare, the drift the one-registry design exists to
 *  prevent. Every surface that renders CUSTOMIZE_RESETS calls this. */
export function runCustomizeReset(a: ResetAction): void {
  void runMajorChange({
    title: a.label,
    message: `Put ${a.what} back to the app defaults?`,
    confirmLabel: 'Reset',
    // three tabs share the bare "Reset Items" label — the undo
    // toast names WHAT came back, not which button was pressed
    label: `Reset — ${a.what}`,
    capture: a.capture ?? captureCustomizeState,
    run: a.run,
    toast: `${a.label} — done`,
  });
}

/** The bottom-of-tab Reset section — every tab's reset buttons in one place.
 *  v6.77, Derek: "any button that makes major changes, always include a
 *  warning window" — every entry warns first and lands on the window-undo
 *  lane, through the ONE wrapper (runMajorChange), so no button can drift
 *  back to resetting silently. */
/**
 * TabActionBar — the one bar that closes every Customize tab.
 *
 * v7.55, Derek, of the bottom of these tabs: "now it just looks like a random
 * stack of buttons. figure out a way to organize where buttons that is clean
 * and intuitive. the size is good, the arrangement/presentation is not."
 *
 * He was right, and the stack was structural rather than stylistic. Three
 * separate blocks ended each tab, each authored somewhere different and none
 * of them aware of the others: the tab's own adder row, a Reset section with
 * its own heading, and the Export/Import row. Stacked with their own margins
 * they read as three unrelated afterthoughts, because that is what they were.
 *
 * One bar now, with a grammar the rest of the app already uses — the same one
 * as any dialog footer:
 *
 *   [ things that ADD to the list above ] ……………………………… [ resets ]
 *
 * Left is contextual: it acts on what you are looking at. Right is the tab's
 * own housekeeping.
 *
 * The "Reset to Default" heading is gone with the stack. It was labelling a
 * section that no longer exists, in front of buttons that already say "Reset
 * Transitions" and "Reset Items" — a heading whose whole job was to announce
 * what its buttons announce.
 *
 * v7.56 took the third group out: Export… / Import… moved the whole preset
 * bundle whatever tab you were standing on, so a copy per tab advertised a
 * scope they never had. They are one Backup & Restore door beside the tabs now,
 * and the `presets` slot that carried them is gone rather than left empty.
 *
 * v7.57 emptied the LEFT group on most tabs: an adder belongs on the list it
 * adds to, so wherever a tab has a Shown column the adder moved into that
 * column's header. What is left here is what acts on the whole tab. A tab with
 * neither — Themes, since + New Theme moved and it registers no resets —
 * renders no bar at all, because a bar with nothing in it is a rule and a gap.
 */
export function TabActionBar({ tab, section, adders }: {
  tab: CustomizeTabId;
  /** v7.58: render the resets that named THIS section, at its foot. Omitted
   *  means the tab's own bar, which carries only the resets that named no
   *  section — so a reset appears in exactly one of the two, never both. */
  section?: string;
  /** The tab's own adders. They belong at the LEFT, next to what they act on.
   *  Only for adders with nowhere better: a tab with a Shown column puts them
   *  in its header instead (v7.57). Annotations still passes one — it builds a
   *  combo from a grid rather than listing shown against hidden, so it has no
   *  column header to sit in. */
  adders?: React.ReactNode;
}) {
  const actions = CUSTOMIZE_RESETS.filter((a) => a.tab === tab
    && (section ? a.section === section : !a.section));
  if (!adders && !actions.length) return null;
  return (
    <div className="fs-tabbar">
      {adders && <div className="fs-tabbar-group">{adders}</div>}
      <div className="fs-tabbar-gap" />
      {actions.length > 0 && (
        <div className="fs-tabbar-group">
          {actions.map((a) => (
            <button
              key={a.id}
              className="dialog-btn dialog-btn-sm"
              onClick={() => runCustomizeReset(a)}
            >{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Reset All — one definition (moved from the Customize globals, v4.65).
 *  Keeps its own STRONGER confirm (type-to-confirm), and since v6.77 the
 *  reset lands on the window-undo lane like the per-tab ones. */
export function ResetAllButton() {
  return (
    <button
      className="fs-reset-all-btn"
      title="Reset every customization to the defaults"
      onClick={async () => {
        if (await confirmDialog(
          'Reset ALL customizations to their defaults? Sizes and spacing, the toolbar layout, dropdown widths, Quick Access Toolbar, menu bar order, side panels, and the Outline Toolbar all go back to factory. (Themes, Editor and Keyboard Shortcuts have their own resets and are not touched.) You can undo this afterwards with the usual Undo key.',
          { title: 'Reset All Customizations', confirmLabel: 'Reset Customizations', danger: true, requireText: 'Reset Customizations' },
        )) {
          const restore = captureCustomizeState();
          useEditorStore.getState().resetAllCustomizations();
          useWindowUndoStore.getState().push(
            'Reset all customizations',
            restore,
            () => useEditorStore.getState().resetAllCustomizations(),
          );
        }
      }}
    >Reset All</button>
  );
}
