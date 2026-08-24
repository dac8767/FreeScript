/**
 * Customize ▸ Editor ▸ Element Suggestions (v4.59, Derek; table form v4.63).
 *
 * Mode toggle: Script-Aware (the follows-what grammar filters the Enter-key
 * suggestion list) vs All Elements (no filtering). Below it, the rules as a
 * TABLE — one row per previous element, one column per candidate, a check
 * cell where the candidate is allowed to follow. Derek's table is the
 * default; edits are stored whole in editorStore (`suggestionRules`), Reset
 * returns to the default. "Character" is the name-line id (the row/column
 * line); a dual-dialogue block above uses the Dialogue row.
 */
import React from 'react';
import { ELEMENT_LABELS, useEditorStore } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { DEFAULT_SUGGESTION_RULES, SUGGESTION_RULE_CANDIDATES } from './screenplayEditorConstants';

/* v7.35, Derek: "in the element suggestion table, change 'Character' to
   'Character Name'." Scoped to THIS table on purpose — the element is called
   Character everywhere else in the app, and renaming it globally would
   rewrite the Element menu, the toolbar picker and every saved template. Here
   the rows and columns are both element names, so the extra word says which
   Character is meant: the cue line, not the person in the Characters tool. */
const TABLE_LABEL_OVERRIDES: Record<string, string> = { character: 'Character Name' };

const label = (id: string): string =>
  TABLE_LABEL_OVERRIDES[id]
  ?? (id === 'dualDialogue' ? 'Dual Dialogue' : (ELEMENT_LABELS[id] ?? id));

const ROWS = Object.keys(DEFAULT_SUGGESTION_RULES);

const CheckIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <polyline points="2,6.5 5,9.5 10,2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* v7.81, Derek: "Move the 'All elements' button up one row. Add 'Show:'
   before it." The mode row used to render inside this editor, one row below
   the section heading; his layout puts it ON the heading row, and the heading
   lives in CustomizePanelsDialog. The control is exported rather than copied —
   mode is store state, so both pieces read the same switch. */
export const SuggestionModeToggle: React.FC = () => {
  const mode = useEditorStore((s) => s.suggestionMode);
  const setMode = useEditorStore((s) => s.setSuggestionMode);
  return (
    <span className="fs-sugg-mode">
      <span className="fs-sugg-mode-label">Show:</span>
      <span className="fs-customize-seg">
        <button
          className={mode !== 'all' ? 'active' : ''}
          onClick={() => setMode('smart')}
        >Script-Aware</button>
        <button
          className={mode === 'all' ? 'active' : ''}
          onClick={() => setMode('all')}
        >All Elements</button>
      </span>
    </span>
  );
};

const SuggestionRulesEditor: React.FC = () => {
  const mode = useEditorStore((s) => s.suggestionMode);
  const rules = useEditorStore((s) => s.suggestionRules);
  const setRules = useEditorStore((s) => s.setSuggestionRules);
  const effective = rules ?? DEFAULT_SUGGESTION_RULES;
  // v4.64, Derek: elements hidden in the Elements section above have no
  // column here — the picker can never offer them anyway (its grammar filter
  // intersects with the pickable list). Their stored rule values survive, so
  // un-hiding an element brings its column back exactly as it was.
  const pickable = useFormattingTemplateStore((s) => s.getPickableElements)();
  useFormattingTemplateStore((s) => s.elementHidden);   // re-render on change
  const visibleIds = new Set(pickable.map((r) => r.id));
  const cols = SUGGESTION_RULE_CANDIDATES.filter((c) => visibleIds.has(c));

  const toggle = (row: string, id: string) => {
    const next: Record<string, string[]> = Object.fromEntries(
      ROWS.map((r) => [r, [...(effective[r] ?? [])]]),
    );
    const list = next[row];
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1);
    else list.push(id);
    setRules(next);
  };

  return (
    <div className="fs-sugg-editor">
      {/* v7.81: the Show toggle renders on the section heading row now —
          SuggestionModeToggle above, placed by CustomizePanelsDialog. */}
      {mode !== 'all' && (
        <div className="fs-sugg-tablewrap">
          <table className="fs-sugg-table">
            <thead>
              <tr>
                <th scope="col" className="fs-sugg-corner">After element…</th>
                {cols.map((c) => (
                  <th scope="col" key={c}>{label(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row}>
                  <th scope="row">{label(row)}</th>
                  {cols.map((c) => {
                    const on = (effective[row] ?? []).includes(c);
                    return (
                      <td key={c}>
                        <button
                          className={`fs-sugg-cell${on ? ' active' : ''}`}
                          title={`${label(c)} ${on ? 'can' : 'cannot'} follow ${label(row)}`}
                          aria-pressed={on}
                          onClick={() => toggle(row, c)}
                        >{on && <CheckIcon />}</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SuggestionRulesEditor;
