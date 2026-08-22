/**
 * WorkspacesTool (v4.23, Derek) — the dockable side-panel form of Workspaces.
 * The same saved layouts the View → Workspaces menu drives, listed so you can
 * apply one with a click, save the current arrangement, and rename/delete in
 * place. It reads and writes the SAME store API the menu and the Workspace
 * dialogs use (workspaces / applyWorkspace / saveWorkspace / renameWorkspace /
 * deleteWorkspace), so the two entry points can never drift apart.
 * v4.35: the menu's remaining actions live here too — save-changes, reset,
 * Edit Workspaces… and Import Workspaces from a Project….
 * v7.64: "Save as New Workspace" joined them as a BUTTON at the head of that
 * group, replacing the text field that used to sit above the list.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { FaColumns, FaEdit, FaRegTrashAlt, FaCheck } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { workspaceIsDirty } from '../stores/slices/workspacesSlice';
import { isBuiltinWorkspace } from '../stores/seedDefaults';
import { EditWorkspacesDialog } from './WorkspaceDialogs';
import { importWorkspacesFromFile } from '../utils/workspaceImport';
import { promptDialog, confirmDialog } from './ConfirmDialog';

export default function WorkspacesTool() {
  const workspaces = useEditorStore((s) => s.workspaces);
  const workspaceOrder = useEditorStore((s) => s.workspaceOrder);
  const workspacesHidden = useEditorStore((s) => s.workspacesHidden);
  const activeWorkspace = useEditorStore((s) => s.activeWorkspace);
  const saveWorkspace = useEditorStore((s) => s.saveWorkspace);
  const applyWorkspace = useEditorStore((s) => s.applyWorkspace);
  const deleteWorkspace = useEditorStore((s) => s.deleteWorkspace);
  const renameWorkspace = useEditorStore((s) => s.renameWorkspace);
  /* v7.65, Derek: both of these are no-ops when the layout still matches what
     was saved — one writes back what is already stored, the other restores
     what is already on screen. */
  const dirty = useEditorStore(workspaceIsDirty);

  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  /* v7.73: hidden workspaces leave this list too — it is the same offer the
     menu makes, and "hidden" that only half-hides is not hidden. Edit
     Workspaces… lists every one with the eye, and its button is right below. */
  const names = workspaceOrder.filter((n) => workspaces[n] && !workspacesHidden.includes(n));

  /* v7.64, Derek: a BUTTON that asks for the name, under the list and above
     "Save Changes to this Workspace" — the shape Photoshop uses, and the one
     he sent a screenshot of. It replaces a text field that sat above the list
     and read as a search box: a bare input with a greyed Save beside it says
     "filter these", not "make a new one from what's on screen right now".
     The name is asked for AFTER the intent, which is also the order that lets
     an existing name raise the overwrite question instead of silently
     replacing a saved layout — the old field just relabelled its button
     "Overwrite" and hoped you read it. */
  const doSaveAs = async () => {
    const name = (await promptDialog('Name this workspace:', 'Untitled Workspace', {
      title: 'New Workspace',
      confirmLabel: 'OK',
    }))?.trim();
    if (!name) return;
    if (Object.prototype.hasOwnProperty.call(workspaces, name)
      && !(await confirmDialog(`“${name}” already exists. Replace its saved layout with the current one?`, {
        title: 'Replace Workspace',
        confirmLabel: 'Replace',
        danger: true,
      }))) return;
    saveWorkspace(name);
  };

  const startEdit = (name: string) => { setEditing(name); setEditValue(name); };
  const commitEdit = () => {
    const next = editValue.trim();
    if (editing && next && next !== editing && !workspaces[next]) renameWorkspace(editing, next);
    setEditing(null);
  };

  return (
    <div className="ws-tool">
      <div className="ws-list">
        {names.length === 0 ? (
          <div className="ws-empty">
            {workspaceOrder.some((n) => workspaces[n])
              ? 'Every workspace is hidden. Use “Edit Workspaces…” below to bring one back.'
              : 'No saved workspaces yet. Arrange your panels, then use “Save as New Workspace” below.'}
          </div>
        ) : (
          names.map((name) => {
            const isActive = name === activeWorkspace;
            /* v7.70, Derek: the five that ship with the app are "non
               deletable". No Delete button, and no Rename either — the name is
               a built-in's identity, so renaming one would orphan it and the
               original would reappear beside it on the next launch. The tag
               says which rows those are, so the missing buttons read as a rule
               rather than as something broken. */
            const builtin = isBuiltinWorkspace(name);
            if (editing === name) {
              return (
                <div key={name} className="ws-item ws-item-editing">
                  <input
                    className="ws-edit-input"
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(null); }}
                  />
                  <button className="ws-icon-btn" title="Save name" onClick={commitEdit}><FaCheck /></button>
                  <button className="ws-icon-btn" title="Cancel" onClick={() => setEditing(null)}>×</button>
                </div>
              );
            }
            return (
              <div key={name} className={`ws-item${isActive ? ' ws-item-active' : ''}`}>
                <button className="ws-apply" onClick={() => applyWorkspace(name)} title="Apply this workspace">
                  <FaColumns className="ws-apply-icon" />
                  <span className="ws-apply-name">{name}</span>
                </button>
                {builtin ? (
                  <span className="ws-builtin-badge">default</span>
                ) : confirmDelete === name ? (
                  <>
                    <button className="ws-icon-btn ws-danger" title="Confirm delete" onClick={() => { deleteWorkspace(name); setConfirmDelete(null); }}><FaCheck /></button>
                    <button className="ws-icon-btn" title="Cancel" onClick={() => setConfirmDelete(null)}>×</button>
                  </>
                ) : (
                  <>
                    <button className="ws-icon-btn" title="Rename" onClick={() => startEdit(name)}><FaEdit /></button>
                    <button className="ws-icon-btn" title="Delete" onClick={() => setConfirmDelete(name)}><FaRegTrashAlt /></button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* v4.35: the View → Workspaces menu's actions, mirrored. */}
      <div className="ws-actions">
        {/* v7.64, Derek: first in this group, directly under the list. It is
            the only one here that is always available — the two below it need
            a workspace to be active. */}
        <button
          className="ws-action-btn"
          onClick={() => { void doSaveAs(); }}
        >
          Save as New Workspace
        </button>
        <button
          className="ws-action-btn"
          disabled={!activeWorkspace || !dirty}
          title={!activeWorkspace ? ''
            : dirty ? `Overwrite “${activeWorkspace}” with the current layout`
              : `“${activeWorkspace}” already matches the current layout`}
          onClick={() => { if (activeWorkspace && dirty) saveWorkspace(activeWorkspace); }}
        >
          Save Changes to this Workspace
        </button>
        <button
          className="ws-action-btn"
          disabled={!activeWorkspace || !dirty}
          title={!activeWorkspace ? ''
            : dirty ? `Reapply the saved “${activeWorkspace}” layout`
              : 'Nothing has changed'}
          onClick={() => { if (activeWorkspace && dirty) applyWorkspace(activeWorkspace); }}
        >
          Reset to Saved Layout
        </button>
        <button className="ws-action-btn" onClick={() => setEditDialogOpen(true)}>
          Edit Workspaces…
        </button>
        <button className="ws-action-btn" onClick={() => { void importWorkspacesFromFile(); }}>
          Import Workspaces from a Project…
        </button>
      </div>

      {/* Portalled: as a temp window this tool sits under a transform
          (.tool-window-temp), which would hijack the overlay's fixed
          positioning — from document.body it covers the viewport. */}
      {createPortal(
        <EditWorkspacesDialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} />,
        document.body,
      )}
    </div>
  );
}
