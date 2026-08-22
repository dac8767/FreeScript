import { useEffect, useRef, useState } from 'react';
import { FaColumns, FaEdit, FaRegTrashAlt, FaCheck, FaChevronUp, FaChevronDown, FaRegEye, FaRegEyeSlash } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { isBuiltinWorkspace } from '../stores/seedDefaults';
import { Modal } from './Modal';

/* ─────────────────────────────────────────────────────────────────────────
   Workspace dialogs (View → Workspaces)

   SaveWorkspaceDialog — replaces the native window.prompt() with a themed
   in-app dialog: autofocused input, Enter saves, Escape cancels, and an
   overwrite hint when the name already exists.

   EditWorkspacesDialog — lists all saved workspaces with inline rename and
   two-step delete (the Delete button turns into a confirm), replacing the
   old "Delete Current Workspace" menu item.
   ───────────────────────────────────────────────────────────────────────── */

export function SaveWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspaces, saveWorkspace } = useEditorStore();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      // Focus after the dialog mounts
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const trimmed = name.trim();
  const exists = trimmed.length > 0 && Object.prototype.hasOwnProperty.call(workspaces, trimmed);

  const save = () => {
    if (!trimmed) return;
    saveWorkspace(trimmed);
    onClose();
  };

  return (
    <Modal onClose={onClose} boxClassName="ws-dialog">
        <div className="dialog-header">
          <FaColumns className="ws-dialog-header-icon" /> Save Workspace
        </div>
        <div className="dialog-body">
          <div className="dialog-row">
            <label htmlFor="ws-name-input">
              Saves the current layout — open panels, tool placement, toolbar and sizes — under a name you can return to from View → Workspaces.
            </label>
            <input
              id="ws-name-input"
              ref={inputRef}
              type="text"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); save(); }
                if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              }}
            />
            <div className={`ws-overwrite-hint${exists ? ' visible' : ''}`}>
              {exists ? `A workspace named “${trimmed}” already exists — saving will replace it.` : '\u00A0'}
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" onClick={save} disabled={!trimmed}>
            {exists ? 'Replace' : 'Save'}
          </button>
        </div>
    </Modal>
  );
}

export function EditWorkspacesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspaces, workspaceOrder, setWorkspaceOrder, activeWorkspace, renameWorkspace, deleteWorkspace,
    workspacesHidden, setWorkspaceHidden } = useEditorStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setRenaming(null);
      setRenameValue('');
      setConfirmDelete(null);
    }
  }, [open]);

  useEffect(() => {
    if (renaming) setTimeout(() => renameRef.current?.focus(), 0);
  }, [renaming]);

  if (!open) return null;

  // Display order is user-controlled; append any stragglers not yet in the order list.
  const names = [
    ...workspaceOrder.filter((n) => workspaces[n]),
    ...Object.keys(workspaces).filter((n) => !workspaceOrder.includes(n)).sort(),
  ];

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= names.length) return;
    const next = [...names];
    [next[idx], next[j]] = [next[j], next[idx]];
    setWorkspaceOrder(next);
  };

  const startRename = (n: string) => {
    setConfirmDelete(null);
    setRenaming(n);
    setRenameValue(n);
  };

  const commitRename = () => {
    if (!renaming) return;
    const next = renameValue.trim();
    if (next && next !== renaming) renameWorkspace(renaming, next);
    setRenaming(null);
    setRenameValue('');
  };

  const cancelRename = () => {
    setRenaming(null);
    setRenameValue('');
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-box ws-dialog ws-edit-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <FaColumns className="ws-dialog-header-icon" /> Edit Workspaces
        </div>
        <div className="dialog-body">
          {names.length === 0 ? (
            <div className="ws-empty">
              No saved workspaces yet.
              <br />
              Use <strong>View → Workspaces → Save as New Workspace…</strong> to save your current layout.
            </div>
          ) : (
            <div className="ws-list">
              {names.map((n, idx) => {
                const isActive = activeWorkspace === n;
                const isRenaming = renaming === n;
                const isConfirming = confirmDelete === n;
                const hidden = workspacesHidden.includes(n);
                return (
                  <div key={n} className={`ws-row${isActive ? ' active' : ''}${hidden ? ' ws-row-hidden' : ''}`}>
                    {/* v7.02 (style audit remaining #8): the shared spinner —
                        one bordered frame around both arrows — instead of this
                        window's own pair of 7px bordered buttons. */}
                    <span className="fs-updown">
                      <button className="fs-updown-btn" title="Move up" onClick={() => move(idx, -1)} disabled={idx === 0}>
                        <FaChevronUp />
                      </button>
                      <button className="fs-updown-btn" title="Move down" onClick={() => move(idx, 1)} disabled={idx === names.length - 1}>
                        <FaChevronDown />
                      </button>
                    </span>
                    {isRenaming ? (
                      <>
                        <input
                          ref={renameRef}
                          className="ws-rename-input"
                          type="text"
                          value={renameValue}
                          maxLength={60}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                            if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                          }}
                        />
                        <button
                          className="ws-icon-btn ws-confirm"
                          title="Save name"
                          onClick={commitRename}
                          disabled={!renameValue.trim()}
                        >
                          <FaCheck />
                        </button>
                        <button className="ws-icon-btn" title="Cancel" onClick={cancelRename}>
                          ×
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="ws-name" title={n}>
                          {n}
                          {isActive && <span className="ws-active-badge">active</span>}
                        </span>
                        {/* v7.70, Derek: the five that ship with the app are
                            "non deletable" — and not renameable either, since
                            the name is a built-in's identity and the original
                            would reappear beside the renamed copy on the next
                            launch. Same rule as the Workspaces panel, read
                            from the same isBuiltinWorkspace, so the two lists
                            cannot come to disagree about which rows those are. */}
                        {/* v7.73, Derek: "add an option to hide workspaces from
                            the menu." THIS dialog is the one surface that keeps
                            showing a hidden workspace — it is where the eye
                            lives, so hiding always leaves a way back. It sits
                            before the default badge because a built-in is
                            exactly the case that needs it: the five cannot be
                            deleted, so hiding is the only way to clear one out
                            of your way. */}
                        <button
                          className={`ws-icon-btn${hidden ? ' ws-hidden-on' : ''}`}
                          title={hidden ? `Show “${n}” in the menu again` : `Hide “${n}” from the menu and the Workspaces panel`}
                          onClick={() => setWorkspaceHidden(n, !hidden)}
                        >
                          {hidden ? <FaRegEyeSlash /> : <FaRegEye />}
                        </button>
                        {isBuiltinWorkspace(n) ? (
                          <span className="ws-builtin-badge">default</span>
                        ) : isConfirming ? (
                          <>
                            <span className="ws-confirm-label">Delete?</span>
                            <button
                              className="ws-icon-btn ws-danger"
                              title={`Delete “${n}”`}
                              onClick={() => { deleteWorkspace(n); setConfirmDelete(null); }}
                            >
                              <FaCheck />
                            </button>
                            <button className="ws-icon-btn" title="Keep it" onClick={() => setConfirmDelete(null)}>
                              ×
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="ws-icon-btn" title="Rename" onClick={() => startRename(n)}>
                              <FaEdit />
                            </button>
                            <button
                              className="ws-icon-btn ws-danger"
                              title="Delete"
                              onClick={() => { setRenaming(null); setConfirmDelete(n); }}
                            >
                              <FaRegTrashAlt />
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn dialog-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
