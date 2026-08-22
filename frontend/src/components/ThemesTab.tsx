/**
 * Customize → Themes (v0.78).
 *
 * Lists every theme in menu order — drag to reorder, Show/Hide, and for custom
 * themes Edit and Delete. Built-ins can be reordered and hidden but never
 * edited or deleted, so their buttons are disabled rather than absent (the row
 * stays legible instead of looking broken).
 */
import React from 'react';
import ColorPicker from './ColorPicker';
import { DndColumns } from './CustomizePanelsDialog';
import { useEditorStore } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useThemeStore } from '../stores/themeStore';
import {
  BUILTIN_THEMES, THEME_VARS, isCustomTheme, seedVarsFromBase,
  applyThemeToDom, type CustomTheme,
} from './themes';

export default function ThemesTab() {
  const theme = useEditorStore((s) => s.theme);
  const setTheme = useEditorStore((s) => s.setTheme);
  // v4.26, Derek: theme POLICY lives with the theme picker — this toggle sat
  // in Preferences > General, a different surface from the list it overrides.
  const followSystemTheme = useSettingsStore((st) => st.followSystemTheme);
  const setFollowSystemTheme = useSettingsStore((st) => st.setFollowSystemTheme);

  const customThemes = useThemeStore((s) => s.customThemes);
  const hiddenThemes = useThemeStore((s) => s.hiddenThemes);
  const allThemeIds = useThemeStore((s) => s.allThemeIds);
  const setThemeOrder = useThemeStore((s) => s.setThemeOrder);
  const setThemeHidden = useThemeStore((s) => s.setThemeHidden);
  const saveCustomTheme = useThemeStore((s) => s.saveCustomTheme);
  const deleteCustomTheme = useThemeStore((s) => s.deleteCustomTheme);

  const [editing, setEditing] = React.useState<CustomTheme | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [pickerKey, setPickerKey] = React.useState<string | null>(null);

  // v3.79, Derek: if the user builds a theme then clicks the Customize dialog's
  // Save (instead of the tab's "Save Theme"), commit it anyway so it lands in
  // the list. The dialog dispatches this right before it closes.
  React.useEffect(() => {
    const commit = () => {
      if (!editing) return;
      saveCustomTheme({ ...editing, label: editing.label.trim() || 'My Theme' });
      // v4.22, Derek: if the edited theme is the one currently applied, re-apply
      // it so the changes land immediately. Without this the DOM keeps the
      // pre-edit colors until you reselect the theme. setTheme re-reads the
      // freshly-saved custom themes, so it picks up the new colors.
      if (theme === editing.id) setTheme(editing.id);
      setEditing(null);
    };
    window.addEventListener('scriptcraft:customize-save', commit);
    return () => window.removeEventListener('scriptcraft:customize-save', commit);
  }, [editing, saveCustomTheme, theme, setTheme]);

  const ids = allThemeIds();
  const labelOf = (id: string) =>
    BUILTIN_THEMES.find((b) => b.id === id)?.label
    ?? customThemes.find((c) => c.id === id)?.label
    ?? id;

  /** v1.3: Themes now behaves like every other tab — a hidden theme LEAVES the
   *  list and lives in + Add Item until you put it back. */
  const visibleIds = ids.filter((id) => !hiddenThemes.includes(id));
  const hiddenIds = ids.filter((id) => hiddenThemes.includes(id));

  const newTheme = () => setEditing({
    id: `custom:${Date.now()}`,
    label: 'My Theme',
    base: 'dark',
    vars: seedVarsFromBase('dark'),
  });

  // ── Editor ──
  if (editing) {
    const groups = [...new Set(THEME_VARS.map((v) => v.group))];
    const isNew = !customThemes.some((c) => c.id === editing.id);
    return (
      <section>
        <h3>{isNew ? 'New Theme' : `Edit ${editing.label}`}</h3>
        <p className="fs-customize-hint">
          Pick a light or dark base, then set the colors you want. Anything you
          don’t set follows the base, so the theme stays complete.
        </p>

        <div className="fs-customize-row">
          <span className="fs-customize-tool">Name</span>
          <input
            className="fs-theme-name-input"
            value={editing.label}
            maxLength={40}
            onChange={(e) => setEditing({ ...editing, label: e.target.value })}
          />
        </div>

        <div className="fs-customize-row">
          <span className="fs-customize-tool">Base</span>
          <span className="fs-customize-seg">
            {(['dark', 'light'] as const).map((b) => (
              <button
                key={b}
                className={editing.base === b ? 'active' : ''}
                onClick={() => setEditing({ ...editing, base: b, vars: seedVarsFromBase(b) })}
              >{b[0].toUpperCase() + b.slice(1)}</button>
            ))}
          </span>
        </div>

        {groups.map((g) => (
          <div key={g} className="fs-shortcut-group">
            <div className="fs-shortcut-group-title">{g}</div>
            {THEME_VARS.filter((v) => v.group === g).map((v) => (
              <div className="fs-customize-row" key={v.key}>
                <span className="fs-customize-tool">{v.label}</span>
                <span className="fs-theme-color-controls">
                  {/* The swatch opens our OWN picker, anchored here. A native
                      <input type="color"> would summon the OS color panel,
                      which the app can't position — that's how it ended up on
                      another monitor. */}
                  <button
                    className="fs-theme-color"
                    style={{ background: toHex(editing.vars[v.key]) }}
                    title="Choose a color"
                    onClick={() => setPickerKey(pickerKey === v.key ? null : v.key)}
                  />
                  <input
                    className="fs-theme-hex"
                    value={editing.vars[v.key] ?? ''}
                    onChange={(e) => setEditing({
                      ...editing,
                      vars: { ...editing.vars, [v.key]: e.target.value },
                    })}
                  />
                  {pickerKey === v.key && (
                    <span className="fs-theme-picker-anchor">
                      <ColorPicker
                        value={toHex(editing.vars[v.key])}
                        onChange={(color) => {
                          if (!color) return;      // 'Reset to Default' -> ignore
                          setEditing({ ...editing, vars: { ...editing.vars, [v.key]: color } });
                        }}
                        onClose={() => setPickerKey(null)}
                      />
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}

        <div className="fs-tbzone-adders">
          <button
            className="dialog-btn dialog-btn-sm"
            onClick={() => {
              const label = editing.label.trim() || 'My Theme';
              saveCustomTheme({ ...editing, label });
              setTheme(editing.id);          // saving applies it, so you can see it
              setEditing(null);
            }}
          >Save Theme</button>
          <button
            className="dialog-btn dialog-btn-sm"
            title="Preview without saving"
            onClick={() => applyThemeToDom(editing.id, [...customThemes, editing])}
          >Preview</button>
          <button
            className="dialog-btn dialog-btn-sm"
            onClick={() => {
              setEditing(null);
              applyThemeToDom(theme, customThemes);   // discard any preview
            }}
          >Cancel</button>
        </div>
      </section>
    );
  }

  // ── List ──
  return (
    <section>
      <h3>Themes</h3>
      <div className="fs-customize-row">
        <label className="fs-follow-system-row">
          <input
            type="checkbox"
            checked={followSystemTheme}
            onChange={(e) => setFollowSystemTheme(e.target.checked)}
          />
          <span>Match the system's light or dark appearance</span>
        </label>
      </div>
      <p className="fs-customize-hint">
        Switches between the Dark and Light themes when macOS does. Picking a
        theme by hand still works; the next system change follows again.
      </p>
      <p className="fs-customize-hint">
        Click a theme to switch to it. Drag themes between Shown and Hidden —
        where you drop one is its place in the View → Themes menu. Built-in
        themes can be reordered and hidden, but not edited or deleted; the
        theme you're using can't be hidden.
      </p>

      {/* v1.81: Outlook-style — Shown | Hidden, drag between them. */}
      <DndColumns
        columns={[
          {
            id: 'shown', title: 'Shown',
            /* v7.57, Derek: "Move '+ New Theme' to the header of the themes
               Shown column header." It sits on the list it adds to now, rather
               than in the tab's action bar below. */
            headerExtra: (
              <button className="fs-dnd-headbtn" title="Create a new theme" onClick={newTheme}>
                + New Theme
              </button>
            ),
            sections: [{
              rows: visibleIds.map((id) => {
                const custom = isCustomTheme(id);
                return {
                  key: id,
                  content: (
                    /* v6.48, Derek: clicking a theme SWITCHES to it (the row's
                       buttons keep their own jobs — the guard skips them). */
                    <span
                      className="fs-customize-tool fs-theme-click"
                      title={theme === id ? undefined : 'Switch to this theme'}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button')) return;
                        setTheme(id);
                      }}
                    >
                      {labelOf(id)}
                      {theme === id && <span className="fs-theme-active-dot" title="Current theme"> ●</span>}
                      {custom && <span className="fs-theme-badge">Custom</span>}
                      <span className="fs-dnd-rowactions">
                        {custom && (
                          <button
                            className="fs-shortcut-clear"
                            title="Edit this theme"
                            onClick={() => {
                              const t = customThemes.find((c) => c.id === id);
                              if (t) setEditing({ ...t, vars: { ...t.vars } });
                            }}
                          >Edit</button>
                        )}
                        {custom && (
                          <button
                            className="fs-shortcut-clear"
                            title="Delete this theme"
                            onClick={() => setConfirmDelete(id)}
                          >Delete</button>
                        )}
                        {theme !== id && (
                          <button
                            className="fs-dnd-rowbtn"
                            title="Hide this theme"
                            onClick={() => setThemeHidden(id, true)}
                          >×</button>
                        )}
                      </span>
                    </span>
                  ),
                };
              }),
            }],
          },
          {
            id: 'hidden', title: 'Hidden', isHidden: true,
            sections: [{
              label: 'Themes',
              rows: hiddenIds.map((id) => ({
                key: id,
                content: (
                  /* v6.48: clicking a hidden theme applies it too — and moves
                     it to Shown, since the active theme can never be hidden. */
                  <span
                    className="fs-customize-tool fs-theme-click"
                    title="Switch to this theme"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button')) return;
                      setThemeHidden(id, false);
                      setTheme(id);
                    }}
                  >
                    {labelOf(id)}
                    {isCustomTheme(id) && <span className="fs-theme-badge">Custom</span>}
                    <button className="fs-dnd-rowbtn" title="Show this theme" onClick={() => setThemeHidden(id, false)}>+</button>
                  </span>
                ),
              })),
            }],
          },
        ]}
        onDrop={(src2, dst) => {
          const id = src2.key;
          if (dst.col === 'hidden') {
            if (theme !== id) setThemeHidden(id, true);   // never hide the active theme
            return;
          }
          const next = visibleIds.filter((x) => x !== id);
          next.splice(Math.min(dst.idx, next.length), 0, id);
          setThemeOrder([...next, ...hiddenIds.filter((x) => x !== id)]);
          if (hiddenThemes.includes(id)) setThemeHidden(id, false);
        }}
      />

      {confirmDelete && (
        <p className="fs-shortcut-note">
          Delete “{labelOf(confirmDelete)}”?{' '}
          <button
            className="fs-shortcut-clear"
            onClick={() => {
              // If the theme being deleted is active, fall back to Dark first,
              // or the app would keep rendering a theme that no longer exists.
              if (theme === confirmDelete) setTheme('dark');
              deleteCustomTheme(confirmDelete);
              setConfirmDelete(null);
            }}
          >Delete</button>
          <button className="fs-shortcut-clear" onClick={() => setConfirmDelete(null)}>Cancel</button>
        </p>
      )}


      {/* v7.57: no action bar here any more. Its only occupant was + New Theme,
          which moved into the Shown column header above, and this tab
          registers no resets — a bar with nothing in it is a rule and a gap. */}
    </section>
  );

  /* ── Export / Import ──────────────────────────────────────────────────
     v7.56, Derek: "remove the import and export options from all tabs." The
     three functions that lived here — exportThemes, importThemes and
     importFromProject — went with the two menus that were their only callers.
     They are DELETED rather than parked: a function no caller can reach is a
     function nobody maintains, and tsc will not hold it anyway.

     Recover them from git history (v7.55, ThemesTab.tsx) if the two
     capabilities they carried are wanted back. Both are worth naming, because
     Settings ▸ Backup & Restore does NOT replace them:

       · exporting a SINGLE theme as its own file. The preset bundle has no
         way to say "just this one", so routing it there would have quietly
         exported all of them — a wrong answer wearing the right label.
       · Import from Project, which reads themes out of another PROJECT
         rather than out of a preset file.

     Neither wants to come back as a tab-level import/export pair; a per-row
     action on a theme is the natural home for the first, and the second is a
     genuine import that belongs wherever imports live now.

     `addThemes` below stays — it is what an import would call, and it holds
     the rule that imports never overwrite. */

}


/* v7.56: `extractThemes` is gone with the imports that called it. Its docblock
   said it was exported for the Presets panel — that has been untrue since
   v6.63, when the panel moved to reading useThemeStore directly, so the export
   had been holding the door open for a caller that no longer existed. Removing
   the theme imports above simply made that visible. It is in git history with
   them if the capability comes back. */

/** <input type="color"> only accepts #rrggbb — coerce anything else. */
function toHex(v: string | undefined): string {
  if (!v) return '#000000';
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return '#' + s.slice(1).split('').map((c) => c + c).join('');
  }
  const m = s.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  if (m) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  return '#000000';
}
