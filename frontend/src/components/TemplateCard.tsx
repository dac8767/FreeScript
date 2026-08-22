/**
 * TemplateCard — THE row for a formatting template, wherever one is listed.
 *
 * v7.50, Derek, pointing at the Format ▸ Script Format / Template window: "this
 * is the window that should be duplicated in the setting > page setup tab. use
 * the window shown in the screenshot, and add the view button. keep the
 * shown/hidden section below this."
 *
 * "Duplicated" is the one thing this must NOT be. Two lists of the same
 * templates, drawn by two functions, is the exact shape of nearly every bug in
 * this project's history — a menu icon map that stopped matching its menu, a
 * card copied instead of shared. Settings ▸ Page Setup had its own row markup
 * (`pst-listrow`, a "Default" chip, its own action buttons) and the dialog had
 * `renderTemplateItem`; they had already drifted — one showed the mode badge
 * and which template was CURRENT, the other showed neither. So this is one
 * component and both lists render it.
 *
 * WHAT VARIES BETWEEN THE TWO PLACES is exactly what is a prop, and each
 * follows the same rule the v7.49 Cancel followed: AN AFFORDANCE EXISTS IF AND
 * ONLY IF THERE IS SOMETHING FOR IT TO DO, never because a boolean somewhere
 * says a context's name.
 *
 *   · onSelect — the dialog picks a template to Apply; the Settings tab is a
 *     management list where clicking a row means nothing. No handler, so the
 *     row is not clickable and never paints as selected.
 *   · onView — opens that template's page setup. Only the Settings tab has
 *     somewhere for that to go.
 *
 * Duplicate/Edit/Delete behave identically in both, which is the whole point,
 * so they live here rather than being passed in: duplicating a BUILT-IN opens
 * the editor on the copy (there is nothing else you could want — the original
 * is immutable), duplicating a custom one just makes the copy.
 */
import React from 'react';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import type { FormattingTemplate } from '../stores/formattingTypes';
import { confirmDialog } from './ConfirmDialog';
import { showToast } from './Toast';

export interface TemplateCardProps {
  template: FormattingTemplate;
  /** Draws the `current` badge — the template the open script is using. */
  isCurrent?: boolean;
  /** Paints the row as chosen. Meaningless without onSelect. */
  selected?: boolean;
  /** Omit where a row selection means nothing; the row then is not clickable. */
  onSelect?: () => void;
  /** Omit where there is nothing to view. Adds the View button when given. */
  onView?: () => void;
  /** Open the template editor on this template — also called with the COPY
   *  after duplicating a built-in, since the built-in itself cannot be edited. */
  onEdit: (t: FormattingTemplate) => void;
  /** Told after a delete, so a caller holding ids (a selection, a shown list)
   *  can drop it. */
  onDeleted?: (id: string) => void;
  /** Told about the COPY, for the same reason in reverse: Settings ▸ Page Setup
   *  owns which templates the New Script picker offers, and a copy nobody adds
   *  to that list is a template the writer just made and cannot find. */
  onDuplicated?: (t: FormattingTemplate) => void;
}

const TemplateCard: React.FC<TemplateCardProps> = ({
  template: t, isCurrent = false, selected = false, onSelect, onView, onEdit, onDeleted, onDuplicated,
}) => {
  const duplicateTemplate = useFormattingTemplateStore((s) => s.duplicateTemplate);
  const deleteTemplate = useFormattingTemplateStore((s) => s.deleteTemplate);

  /* The six built-ins are immutable constants, not rows in `templates[]`, so
     updateTemplate() on one is a silent no-op. That is why they get Duplicate
     and not Edit. */
  const isSystem = t.category === 'system';

  const remove = async () => {
    /* v7.01 (style audit U350): never window.confirm here. In the Tauri app it
       is an ASYNC IPC shim returning a Promise, and a Promise is always truthy,
       so the branch ran whatever the writer answered and the template was
       deleted either way. */
    const ok = await confirmDialog(
      `Delete the template “${t.name}”? This cannot be undone.`,
      { title: 'Delete template?', confirmLabel: 'Delete', danger: true },
    );
    if (!ok) return;
    await deleteTemplate(t.id);
    onDeleted?.(t.id);
    showToast('Template deleted', 'success');
  };

  /* v7.52, Derek: "if i click on the bottom half of a template item it does not
     select."

     It did not, and the guard causing it was mine. The rule I wanted is "a
     press ON a button is not also a row selection" — but I wrote it as
     stopPropagation on the CONTAINER holding the buttons, and that container
     is the full width of the card. The buttons occupy the first ~50px of it;
     the other ~1,150px is empty strip that was swallowing clicks. Everything
     below the description read as dead.

     So the rule is stated where it belongs, on the row, in the terms it was
     always meant in: the row selects unless the press landed on a control. */
  const rowClick = onSelect
    ? (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, select, a')) return;
      onSelect();
    }
    : undefined;

  return (
    <div
      className={`template-select-item${selected ? ' selected' : ''}${onSelect ? '' : ' template-select-item-static'}`}
      onClick={rowClick}
    >
      <div className="template-select-item-info">
        <span className="template-select-item-name">
          {t.name}
          {isCurrent && <span className="template-select-current-badge">current</span>}
        </span>
        <span className={`template-select-mode-badge template-select-mode-${t.mode}`}>
          {t.mode}
        </span>
      </div>
      {t.description && (
        <span className="template-select-item-desc">{t.description}</span>
      )}
      {/* No handler here: the row above decides, by looking at what was
          actually pressed. A stopPropagation on this container is what made
          the whole width of it dead in v7.50–v7.51. */}
      <div className="template-select-item-actions">
        {onView && (
          <button
            className="dialog-btn dialog-btn-sm"
            title="Open template page setup"
            onClick={onView}
          >
            View
          </button>
        )}
        {!isSystem && (
          <button className="dialog-btn dialog-btn-sm" title="Edit this template" onClick={() => onEdit(t)}>
            Edit
          </button>
        )}
        <button
          className="dialog-btn dialog-btn-sm"
          title={isSystem ? 'Make a copy of this template' : 'Make a copy of this template'}
          onClick={async () => {
            const dup = await duplicateTemplate(t.id);
            onDuplicated?.(dup);
            // A built-in cannot be edited, so the copy IS the point of the copy.
            if (isSystem) onEdit(dup);
            else showToast('Template duplicated', 'success');
          }}
        >
          Duplicate
        </button>
        {!isSystem && (
          <button
            className="dialog-btn dialog-btn-sm dialog-btn-danger"
            title="Delete this template"
            onClick={() => { void remove(); }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};

export default TemplateCard;
