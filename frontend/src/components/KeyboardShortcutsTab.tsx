/**
 * Customize → Keyboard Shortcuts (v0.77).
 *
 * Lists every command grouped by menu — those WITH a shortcut and those
 * without, so an unbound command can be given one. Click a binding to record:
 * the next key combo you press becomes the shortcut.
 *
 * Conflicts are detected and resolved explicitly: assigning a combo that's
 * already taken unbinds the other command (and says which), rather than
 * silently creating two commands on one key where only one would ever fire.
 */
import React from 'react';
import { useShortcutStore } from '../stores/shortcutStore';
import { runMajorChange } from '../utils/majorChange';
import { pushWindowAction } from '../stores/windowUndoStore';
import {
  SHORTCUT_COMMANDS, SHORTCUT_GROUPS, COMMAND_BY_ID,
  eventToCombo, formatCombo, findConflict,
} from './shortcuts';

/* v6.78: single-binding changes are undoable. An override is three-state
   (combo / null = deliberately unbound / absent = the default), so a
   snapshot keeps `has` beside the combo and the restore picks the right
   setter. A recording that STEALS a key from another command restores both
   in one ⌘Z. */
const bindingSnapshot = (id: string) => {
  const o = useShortcutStore.getState().overrides;
  return Object.prototype.hasOwnProperty.call(o, id)
    ? { has: true as const, combo: o[id] }
    : { has: false as const, combo: null };
};
const restoreBinding = (id: string, snap: { has: boolean; combo: string | null }) => {
  const st = useShortcutStore.getState();
  if (snap.has) st.setBinding(id, snap.combo); else st.resetBinding(id);
};

export default function KeyboardShortcutsTab() {
  const bindings = useShortcutStore((s) => s.bindings);
  const setBinding = useShortcutStore((s) => s.setBinding);
  const resetBinding = useShortcutStore((s) => s.resetBinding);

  const [recording, setRecording] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string>('');

  // While recording, swallow every keystroke so the combo can't also trigger
  // the command it's being assigned to (or the browser's own handler).
  React.useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') { setRecording(null); setNote(''); return; }

      const combo = eventToCombo(e);
      if (!combo) return;   // modifier held on its own — keep listening

      const clash = findConflict(bindings, combo, recording);
      const prevSelf = bindingSnapshot(recording);
      const prevClash = clash ? bindingSnapshot(clash) : null;
      if (clash) {
        // One key can only run one command, so take it from the other and say so.
        setBinding(clash, null);
        setNote(`${formatCombo(combo)} was assigned to “${COMMAND_BY_ID[clash].label}” — that command is now unbound.`);
      } else {
        setNote('');
      }
      setBinding(recording, combo);
      const id = recording;
      pushWindowAction(
        `Shortcut change — ${COMMAND_BY_ID[id]?.label ?? id}`,
        () => { restoreBinding(id, prevSelf); if (clash && prevClash) restoreBinding(clash, prevClash); },
        () => { const st = useShortcutStore.getState(); if (clash) st.setBinding(clash, null); st.setBinding(id, combo); },
      );
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, bindings, setBinding]);

  const rows = (group: string) => SHORTCUT_COMMANDS.filter((c) => c.group === group);

  return (
    <section>
      <h3>Keyboard Shortcuts</h3>
      <p className="fs-customize-hint">
        Click a shortcut to change it, then press the keys you want. Esc cancels.
        Commands with no shortcut can be given one. Cut, Copy, Paste, Undo, Redo
        and Select All are handled by your operating system and can’t be
        reassigned here.
      </p>

      {note && <p className="fs-shortcut-note">{note}</p>}

      {SHORTCUT_GROUPS.map((group) => {
        const items = rows(group);
        if (!items.length) return null;
        return (
          <div key={group} className="fs-shortcut-group">
            <div className="fs-shortcut-group-title">{group}</div>
            {items.map((c) => {
              const combo = bindings[c.id];
              const isRec = recording === c.id;
              const locked = c.owner === 'system';
              // Clear = remove the shortcut entirely (no key runs the command).
              // Reset = restore the DEFAULT. Enablement follows the actual
              // state, not merely "an override exists": Clear is available
              // whenever a key is bound, Reset whenever the binding differs
              // from the default (including after a Clear).
              const atDefault = combo === c.defaultCombo;
              /* v6.78: single-binding changes are undoable — hoisted so the
                 buttons stay one-liners (the helper-catalog builder reads a
                 button's label from the lines right after its title). */
              const clearOne = () => {
                setNote('');
                const prev = bindingSnapshot(c.id);
                setBinding(c.id, null);
                pushWindowAction(`Clear shortcut — ${c.label}`,
                  () => restoreBinding(c.id, prev),
                  () => useShortcutStore.getState().setBinding(c.id, null));
              };
              const resetOne = () => {
                setNote('');
                const prev = bindingSnapshot(c.id);
                resetBinding(c.id);
                pushWindowAction(`Reset shortcut — ${c.label}`,
                  () => restoreBinding(c.id, prev),
                  () => useShortcutStore.getState().resetBinding(c.id));
              };
              return (
                <div className="fs-customize-row fs-shortcut-row" key={c.id}>
                  <span className="fs-customize-tool">{c.label}</span>
                  <span className="fs-shortcut-controls">
                    <button
                      className={`fs-shortcut-key${isRec ? ' recording' : ''}${!combo ? ' unset' : ''}`}
                      disabled={locked}
                      title={locked
                        ? 'Handled by your operating system'
                        : isRec ? 'Press a key combination… (Esc to cancel)'
                        : 'Click, then press the keys you want'}
                      onClick={() => { if (!locked) { setNote(''); setRecording(isRec ? null : c.id); } }}
                    >
                      {isRec ? 'Press keys…' : combo ? formatCombo(combo) : 'Not set'}
                    </button>
                    <button
                      className="fs-shortcut-clear"
                      disabled={locked || !combo}
                      title="Remove this shortcut"
                      onClick={clearOne}
                    >Clear</button>
                    <button
                      className="fs-shortcut-clear"
                      disabled={locked || atDefault}
                      title="Restore the default shortcut"
                      onClick={resetOne}
                    >Reset</button>
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="fs-tbzone-adders">
        {/* v6.77: warned + undoable like every bulk reset (majorChange). */}
        <button
          className="dialog-btn dialog-btn-sm"
          title="Restore all shortcuts to default"
          onClick={() => {
            const st = useShortcutStore.getState();
            const n = Object.keys(st.overrides).length;
            void runMajorChange({
              title: 'Reset All Shortcuts',
              message: `Restore every keyboard shortcut to its default?\n\n${n} rebound or cleared shortcut${n === 1 ? '' : 's'} go${n === 1 ? 'es' : ''} back to the app's own keys.`,
              confirmLabel: 'Reset',
              label: `Reset all shortcuts (${n})`,
              capture: () => {
                const prev = { ...st.overrides };
                return () => useShortcutStore.getState().restoreOverrides(prev);
              },
              run: () => {
                setRecording(null); setNote('');
                useShortcutStore.getState().resetAll();
              },
            });
          }}
        >Reset All Shortcuts</button>
      </div>
    </section>
  );
}
