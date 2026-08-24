/**
 * Quick single-select picker shown when the user invokes New Script and
 * has 2+ formats enabled in their preferences. The list contains only the
 * enabled formats. Picking one calls onPick(templateId).
 *
 * If only one format is enabled, callers should skip this dialog entirely
 * and apply that format directly.
 */

import React from 'react';
import { SYSTEM_TEMPLATE_LIST, useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { Modal } from './Modal';

interface Props {
  onPick: (templateId: string) => void;
  onCancel: () => void;
}

const ScriptFormatPickerDialog: React.FC<Props> = ({ onPick, onCancel }) => {
  const userTemplates = useFormattingTemplateStore((s) => s.templates);
  /* v7.81, Derek: "a new script will always show all options" — every system
     format, then every custom template. The enabledIds filter (and the
     Shown/Hidden columns that fed it) are gone. */
  const options = [
    ...SYSTEM_TEMPLATE_LIST,
    ...userTemplates.filter((t) => t.category !== 'system'),
  ];

  return (
    <Modal onClose={onCancel} boxClass="fmt-dialog fmt-dialog-narrow">
        <div className="dialog-header">Choose script format</div>
        <div className="fmt-dialog-body">
          {options.length === 0 ? (
            <div className="fmt-empty">
              No formats enabled. Open Format → Script Format Preferences to choose at least one.
            </div>
          ) : (
            <div className="fmt-card-list">
              {options.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className="fmt-card"
                  onClick={() => onPick(tpl.id)}
                >
                  <div className="fmt-card-info">
                    <div className="fmt-card-name">
                      <span>{tpl.name}</span>
                      {tpl.scriptTypeGroup && (
                        <span className="fmt-card-group">{tpl.scriptTypeGroup}</span>
                      )}
                    </div>
                    <div className="fmt-card-tagline">
                      {tpl.scriptTypeTagline || tpl.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onCancel}>Cancel</button>
        </div>
    </Modal>
  );
};

export default ScriptFormatPickerDialog;
