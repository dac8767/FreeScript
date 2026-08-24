import React, { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { SYSTEM_TEMPLATE_LIST, useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { formatAppDate } from '../utils/dateFormat';
import { SaveLocationsField, CustomizeFromFileField } from './setupFields';
import { Modal } from './Modal';

/*
 * NewScriptDialog (v1.50) — File > New Script…
 *
 * The welcome-screen shell (hero card, from the original OpenDraft welcome)
 * around the Save dialog's field grid: Script Name, Draft, Version — the same
 * classes, so the fields are formatted by the same CSS the Save window uses.
 * Draft defaults to "1st Draft" (editable); Version autofills today's date.
 * What's entered here seeds the new document via the New Script flow.
 *
 * v1.88: the script format is a Format dropdown here — the separate
 * "Choose script format" window no longer appears after Create. The list
 * follows Format > Script Format Preferences; with nothing initialized (or
 * everything deselected) it falls back to all built-in formats.
 */

export interface NewScriptMeta {
  name: string;
  draft: string;
  version: string;
  /** v1.88: the chosen format — applied directly, no follow-up picker. */
  templateId: string;
}

/** The dropdown's options: enabled formats in canonical order, or every
 *  built-in when preferences were never set / were emptied. */
function formatOptions() {
  /* v7.81, Derek: "a new script will always show all options." The
     enabledScriptFormats filter and its Shown/Hidden configuration are gone —
     every system format plus every custom template, always. */
  const user = useFormattingTemplateStore.getState().templates.filter((t) => t.category !== 'system');
  return [...SYSTEM_TEMPLATE_LIST, ...user];
}

export default function NewScriptDialog({ open, onClose, onCreate, onBack }: {
  open: boolean;
  onClose: () => void;
  onCreate: (meta: NewScriptMeta) => void;
  /** v4.80: back to the launcher, which now owns Open Script / Import File. */
  onBack?: () => void;
}) {
  // v1.59: the Version autofill follows Settings > General > Date format
  // (default Short = MM/DD/YY, the historical behavior).
  const todayVersion = formatAppDate(new Date(), useSettingsStore.getState().dateFormat);

  // v1.60: the Draft default comes from Settings > General.
  const defaultDraft = useSettingsStore.getState().defaultDraftLabel || '1st Draft';
  const [name, setName] = useState('');
  const [draft, setDraft] = useState(defaultDraft);
  const [version, setVersion] = useState(todayVersion);
  const options = formatOptions();
  const [templateId, setTemplateId] = useState(options[0].id);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDraft(defaultDraft);
      setVersion(todayVersion);
      setTemplateId(formatOptions()[0].id);
      setTimeout(() => nameRef.current?.focus(), 0);
    }
    // todayVersion is derived from the clock; recomputing it on open is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const create = () => {
    onCreate({
      name: name.trim() || 'Untitled Script',
      draft: draft.trim() || defaultDraft,
      version: version.trim(),
      templateId,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); create(); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <Modal
      /* fs-overlay-center (v3.25, Derek): this hero card centers on the
         screen instead of the overlay's usual upper anchor. */
      onClose={onClose}
      overlayClassName="fs-overlay-center"
      boxClass="welcome-card fs-newscript-card"
    >
        <div className="welcome-hero">
          <div className="welcome-logo">SC</div>
          <h1 className="welcome-title">New Script</h1>
          <p className="welcome-subtitle">Name it now — everything stays editable later.</p>
        </div>

        <div className="fs-saveas-grid fs-newscript-grid" onKeyDown={onKeyDown}>
          <label htmlFor="newscript-name">Script Name:</label>
          <input
            id="newscript-name"
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled Script"
          />

          <label htmlFor="newscript-draft">Draft:</label>
          <input
            id="newscript-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={defaultDraft}
          />

          <label htmlFor="newscript-version">Version:</label>
          <input
            id="newscript-version"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder={todayVersion}
          />

          <label htmlFor="newscript-format">Format:</label>
          <select
            id="newscript-format"
            className="fs-newscript-format"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            {options.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          {/* v4.80, Derek: where it saves, chosen here. These ARE the Save
              Options settings — which is also what the most recently saved
              script used, so they open pre-filled with exactly that. */}
          <label>Save to:</label>
          <SaveLocationsField />
        </div>

        <div className="fs-newscript-extra">
          <CustomizeFromFileField />
        </div>

        <div className="fs-newscript-actions">
          {/* v4.80: Open Script / Import File moved to the launcher. */}
          {onBack && (
            <button className="fs-newscript-alt" onClick={onBack}>← Back</button>
          )}
          <span className="fs-newscript-actions-gap" aria-hidden="true" />
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" onClick={create}>Create</button>
        </div>
    </Modal>
  );
}
