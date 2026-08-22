import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import { api } from '../services/api';
import type { VersionInfo } from '../services/api';
import { DiffSummaryBlock } from './ScriptDiffView';
import { computeScriptDiff, type DiffSummary } from '../utils/scriptDiff';
import type { JSONContent } from '@tiptap/react';
import { showToast } from './Toast';
import { confirmDialog } from './ConfirmDialog';
import { withTimeout, SNAPSHOT_LOAD_TIMEOUT_MS } from '../utils/withTimeout';

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}

/* v6.74, Derek: "currently the snapshot window appears as a side bar of its
   own style. make this window appear in the side panel like all other tool
   window." The fixed-position shell is gone — this is a tool BODY hosted by
   ToolDock like every other tool. (v6.76: Take Snapshot moved from the tool
   chrome down into the body — Derek: "move the 'Take Snapshot' button out
   of the window title section and down into the script history window.") */
const VersionHistory: React.FC = () => {
  const navigate = useNavigate();
  const { currentProject, currentScriptId, versions, setVersions, setVersionHistoryOpen, triggerScriptReload } =
    useProjectStore();

  const [selectedVersion, setSelectedVersion] = useState<VersionInfo | null>(null);
  /* v6.75, Derek: "strange red code appears when a snapshot is clicked" —
     the row click used to show the backend's RAW text diff of the document
     JSON. It now shows the same human summary the compare uses, computed
     against the previous snapshot. `note` carries the plain-words cases
     (initial snapshot, script missing). */
  const [rowSummary, setRowSummary] = useState<{ summary?: DiffSummary; note?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compare mode — checkboxes on version rows. v6.74, Derek: the diff pair
  // lives in the PROJECT store — "the compare feature will open in the main
  // editor window", so ScreenplayEditor renders it as an editor-area
  // takeover instead of this window floating an overlay over the chrome.
  const [compareSelection, setCompareSelection] = useState<string[]>([]);  // commit hashes
  /* v6.75, Derek: "items start not selectable, but when I click 'Compare'
     it allows me to pick two items from the list." The checkboxes only
     exist inside this mode; picking the second one runs the compare and
     leaves the mode. */
  const [compareMode, setCompareMode] = useState(false);
  const setScriptCompare = useProjectStore((s) => s.setScriptCompare);
  /* v6.75, Derek: the compare SUMMARY lives in this side panel while the
     compare owns the editor area. Computed from the same pair the diff
     renders, so the two can never disagree. */
  const scriptCompare = useProjectStore((s) => s.scriptCompare);
  const compareSummary = useMemo(
    () => (scriptCompare
      ? computeScriptDiff(scriptCompare.docA as JSONContent, scriptCompare.docB as JSONContent).summary
      : null),
    [scriptCompare],
  );

  const toggleCompareSelect = useCallback((hash: string) => {
    setCompareSelection((prev) => {
      if (prev.includes(hash)) return prev.filter((h) => h !== hash);
      if (prev.length >= 2) return [prev[1], hash]; // drop oldest, keep rolling window of 2
      return [...prev, hash];
    });
  }, []);

  const runScriptCompare = useCallback(async () => {
    if (!currentProject || !currentScriptId || compareSelection.length !== 2) return;
    try {
      const vA = versions.find((v) => v.hash === compareSelection[0]);
      const vB = versions.find((v) => v.hash === compareSelection[1]);
      if (!vA || !vB) {
        showToast('Selected snapshots no longer available', 'error');
        return;
      }
      // Order: earlier version = A, later = B
      const aIsEarlier = new Date(vA.date).getTime() < new Date(vB.date).getTime();
      const earlier = aIsEarlier ? vA : vB;
      const later = aIsEarlier ? vB : vA;

      // Fetch each version independently so a 404 on one side shows as an
      // "Added in this version" / "Removed before this version" state rather
      // than killing the whole compare.
      const fetchOrNull = async (hash: string) => {
        try {
          return await api.getScriptAtVersion(currentProject.id, hash, currentScriptId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('404') || /not found/i.test(msg)) return null;
          throw e;
        }
      };

      const [respA, respB] = await Promise.all([
        fetchOrNull(earlier.hash),
        fetchOrNull(later.hash),
      ]);

      if (!respA && !respB) {
        showToast(
          `This script does not exist in either selected snapshot.`,
          'error',
        );
        return;
      }
      if (!respA) {
        showToast(
          `This script was added in “${later.message}” — it does not exist in “${earlier.message}”.`,
          'info',
        );
      }
      if (!respB) {
        showToast(
          `This script was removed before “${later.message}” — showing only “${earlier.message}”.`,
          'info',
        );
      }

      setCompareMode(false);
      setCompareSelection([]);
      /* v6.80/v6.81, Derek (three reports): the summary must show in the
         SIDE PANEL. His tool reached the compare from a floating window
         (v6.80) and then from the FULLSCREEN takeover (v6.81) — in both,
         the panel row sat expanded with no body, the summary homeless.
         Comparing SEATS the tool into the docked panel, whatever shape it
         was in: set the mode, leave the takeover, and if no surface holds
         the tool any more, open it (docked now). An explicit product rule
         (v4.84: gestures write the mode — starting a compare is one). */
      const es = useEditorStore.getState();
      if (es.toolMode['history'] !== 'docked') es.setToolMode('history', 'docked');
      if (es.fullscreenTool === 'history') es.setFullscreenTool(null);
      const now = useEditorStore.getState();
      if (now.activeTool !== 'history' && now.activeToolRight !== 'history' && now.tempTool !== 'history') {
        now.openTool('history');
      }
      const emptyDoc = { type: 'doc', content: [] };
      setScriptCompare({
        docA: (respA?.content || emptyDoc) as Record<string, unknown>,
        docB: (respB?.content || emptyDoc) as Record<string, unknown>,
        // v6.75: names and times, not internal hashes.
        labelA: respA
          ? `${earlier.message} — ${relativeTime(earlier.date)}`
          : `${earlier.message} — (script not in this snapshot)`,
        labelB: respB
          ? `${later.message} — ${relativeTime(later.date)}`
          : `${later.message} — (script not in this snapshot)`,
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to load snapshots for comparison',
        'error',
      );
    }
  }, [currentProject, currentScriptId, compareSelection, versions]);

  /* v6.75: the second pick IS the go — no separate confirm click. */
  useEffect(() => {
    if (compareMode && compareSelection.length === 2) void runScriptCompare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode, compareSelection]);

  /* Load versions when the panel opens. v6.69, Derek: "forever stuck on
     Loading snapshots…". The wait is BOUNDED now — whatever the transport
     does, the spinner ends in a message the writer can act on. */
  const loadVersions = useCallback(async () => {
    if (!currentProject) return;
    setLoading(true);
    setError(null);
    try {
      const data = await withTimeout(
        api.getVersions(currentProject.id, currentScriptId || undefined),
        SNAPSHOT_LOAD_TIMEOUT_MS,
        'Snapshots did not answer. The server may be unreachable — check Settings → System Settings.',
      );
      setVersions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load snapshots');
    } finally {
      setLoading(false);
    }
  }, [currentProject, currentScriptId, setVersions]);

  // v6.73: versionsTick reloads the OPEN window — Take Snapshot bumps it, so
  // a snapshot taken from here appears right away.
  const versionsTick = useProjectStore((s) => s.versionsTick);
  useEffect(() => {
    if (currentProject) loadVersions();
  }, [currentProject, loadVersions, versionsTick]);

  const handleViewDiff = useCallback(
    async (version: VersionInfo, index: number) => {
      if (!currentProject) return;
      setSelectedVersion(version);

      if (index >= versions.length - 1) {
        setRowSummary({ note: 'Initial snapshot — there is nothing earlier to compare against.' });
        return;
      }
      if (!currentScriptId) {
        setRowSummary({ note: 'Open a script to see what changed in it.' });
        return;
      }

      const prevVersion = versions[index + 1]; // versions are newest-first
      try {
        const fetchOrNull = async (hash: string) => {
          try {
            return await api.getScriptAtVersion(currentProject.id, hash, currentScriptId);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('404') || /not found/i.test(msg)) return null;
            throw e;
          }
        };
        const [prev, cur] = await Promise.all([fetchOrNull(prevVersion.hash), fetchOrNull(version.hash)]);
        if (!cur) { setRowSummary({ note: 'This script is not in this snapshot.' }); return; }
        if (!prev) { setRowSummary({ note: 'This script was added in this snapshot.' }); return; }
        const diff = computeScriptDiff(prev.content as JSONContent, cur.content as JSONContent);
        setRowSummary({ summary: diff.summary });
      } catch (err) {
        setRowSummary({ note: `Could not load this snapshot: ${err instanceof Error ? err.message : 'unknown error'}` });
      }
    },
    [currentProject, currentScriptId, versions]
  );

  const [restoreConfirm, setRestoreConfirm] = useState<VersionInfo | null>(null);

  const handleRestore = useCallback(
    (version: VersionInfo) => {
      setRestoreConfirm(version);
    },
    []
  );

  /* v6.73, Derek: "add a delete option for the snapshots in the snapshot
     window. show a warning window before deleting." Delete-one on each row,
     and Delete All in the footer — the one-click way out of the pile of
     'Auto save' entries versions before v6.72 wrote into this list. Both
     warn first; a snapshot deletes nothing but itself. */
  const handleDelete = useCallback(async (version: VersionInfo) => {
    if (!currentProject) return;
    const ok = await confirmDialog(
      `Delete snapshot “${version.message}”?\n\nOnly this saved version is deleted. Your script is not touched. This cannot be undone.`,
      { title: 'Delete Snapshot', confirmLabel: 'Delete', danger: true },
    );
    if (!ok) return;
    try {
      await api.deleteVersion(currentProject.id, version.hash);
      if (selectedVersion?.hash === version.hash) { setSelectedVersion(null); setRowSummary(null); }
      setCompareSelection((sel) => sel.filter((h) => h !== version.hash));
      await loadVersions();
      showToast(`Snapshot “${version.message}” deleted`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete that snapshot', 'error');
    }
  }, [currentProject, selectedVersion, loadVersions]);

  const handleDeleteAll = useCallback(async () => {
    if (!currentProject || versions.length === 0) return;
    const ok = await confirmDialog(
      `Delete all ${versions.length} snapshot${versions.length === 1 ? '' : 's'} of this project?\n\nEvery saved version is deleted — including any old "Auto save" entries. Your script is not touched. This cannot be undone.`,
      { title: 'Delete All Snapshots', confirmLabel: 'Delete All', danger: true },
    );
    if (!ok) return;
    try {
      const { deleted } = await api.deleteAllVersions(currentProject.id);
      setSelectedVersion(null); setRowSummary(null); setCompareSelection([]);
      await loadVersions();
      showToast(`Deleted ${deleted} snapshot${deleted === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete the snapshots', 'error');
    }
  }, [currentProject, versions.length, loadVersions]);

  const handleRestoreConfirm = useCallback(
    async () => {
      if (!currentProject || !restoreConfirm) return;
      const version = restoreConfirm;
      setRestoreConfirm(null);
      try {
        await api.restoreVersion(currentProject.id, version.hash);
        await loadVersions();
        setSelectedVersion(null);
        setRowSummary(null);

        // Check if the current script still exists after restore
        if (currentScriptId) {
          try {
            await api.getScript(currentProject.id, currentScriptId);
            // Script still exists — reload it in the editor
            triggerScriptReload();
          } catch {
            // Script was removed by the restore — go to project view
            setVersionHistoryOpen(false);
            navigate(`/project/${currentProject.id}`, { replace: true });
            showToast(`Restored to “${version.message}”. The open script no longer exists in this snapshot.`, 'info');
            return;
          }
        } else {
          triggerScriptReload();
        }
        showToast(`Restored to “${version.message}”`, 'success');
      } catch (err) {
        showToast(`Restore failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      }
    },
    [currentProject, currentScriptId, restoreConfirm, loadVersions, navigate, setVersionHistoryOpen, triggerScriptReload]
  );


  return (
    <div className="version-history-body">
      {/* v6.76, Derek: while a compare owns the editor, this panel shows
          ONLY the summary — the list, its bars and the take button stand
          down until the compare closes. */}
      {compareSummary && (
        <div className="version-summary-host">
          <DiffSummaryBlock summary={compareSummary} />
        </div>
      )}
      {!compareSummary && <>
      {/* v6.80, Derek: Compare… sits beside Take Snapshot; the explaining
          sentence only appears once Compare… is clicked. */}
      <div className="version-history-actions">
        {/* v6.81, Derek: "'take snapshot' and 'compare' should both be in
            the blue formatting" — ONE accent class, shared with Compare…. */}
        <button
          className="version-compare-btn version-history-take"
          title="Take a snapshot of this script"
          onClick={() => useEditorStore.getState().setTakeSnapshotRequest(true)}
        >+ Take Snapshot</button>
        {!compareMode && (
          <button
            className="version-compare-btn"
            disabled={!currentScriptId || versions.length < 2}
            title={!currentScriptId || versions.length < 2
              ? 'You need at least two snapshots to compare'
              : 'Compare two snapshots side by side'}
            onClick={() => { setCompareSelection([]); setCompareMode(true); }}
          >Compare…</button>
        )}
      </div>
      {!currentProject && (
        <div className="version-history-empty">
          No project selected. Import or create a script first.
        </div>
      )}

      {error && (
        <div className="version-history-error">
          {error}
          {/* v6.69: never a dead end — the writer can try again without
              closing and reopening the window. */}
          <button className="version-history-retry" onClick={loadVersions}>Try again</button>
        </div>
      )}

      {loading && <div className="version-history-loading">Loading snapshots...</div>}

      {compareMode && (
        <div className="version-compare-bar">
          <span className="version-compare-info">
            Compare two snapshots side by side — {compareSelection.length === 0 ? 'pick two from the list' : 'pick one more'}
          </span>
          <button
            className="version-compare-clear"
            onClick={() => { setCompareMode(false); setCompareSelection([]); }}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="version-history-content">
        <div className="version-history-list">
          {versions.length > 0 && (
            <div className="version-history-listbar">
              <span className="version-history-count">{versions.length} snapshot{versions.length === 1 ? '' : 's'}</span>
              <button
                className="version-deleteall-btn"
                onClick={() => void handleDeleteAll()}
                title="Delete all snapshots"
              >Delete All…</button>
            </div>
          )}
          {versions.length === 0 && !loading && currentProject && (
            <div className="version-history-empty">
              No snapshots yet. Use File &gt; Script History &gt; Take Snapshot to save one.
            </div>
          )}
          {/* v6.79, Derek: ONE compact row per snapshot — name, age and the
              buttons together. In compare mode the whole ROW is the picker
              ("clicking anywhere on an item in the list should select it"),
              so the buttons stand down while picking. */}
          {versions.map((v, i) => (
            <div
              key={v.hash}
              className={`version-item ${selectedVersion?.hash === v.hash ? 'selected' : ''}${compareSelection.includes(v.hash) ? ' compare-selected' : ''}`}
              role={compareMode ? 'option' : undefined}
              aria-selected={compareMode ? compareSelection.includes(v.hash) : undefined}
              title={compareMode ? 'Click to pick this snapshot for the comparison' : undefined}
              onClick={() => (compareMode ? toggleCompareSelect(v.hash) : handleViewDiff(v, i))}
            >
              <span className="version-message">{v.message}</span>
              <span className="version-date">{relativeTime(v.date)}</span>
              {!compareMode && (
                <span className="version-item-actions">
                  {currentScriptId && (
                    <button
                      className="version-view-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (currentProject && currentScriptId) {
                          setVersionHistoryOpen(false);
                          setSelectedVersion(null);
                          setRowSummary(null);
                          navigate(`/project/${currentProject.id}/history/${currentScriptId}/${v.hash}`);
                        }
                      }}
                      title="View this snapshot in the editor (read-only)"
                    >
                      View
                    </button>
                  )}
                  <button
                    className="version-restore-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRestore(v);
                    }}
                    title="Restore this snapshot"
                  >
                    Restore
                  </button>
                  <button
                    className="version-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(v);
                    }}
                    title="Delete snapshot"
                  >
                    Delete
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>

        {rowSummary !== null && selectedVersion && (
          <div className="version-diff-area">
            <div className="version-diff-header">
              <span>Changes in “{selectedVersion.message}”</span>
              <button
                className="version-diff-close"
                onClick={() => {
                  setSelectedVersion(null);
                  setRowSummary(null);
                }}
              >
                x
              </button>
            </div>
            {rowSummary.note
              ? <div className="version-summary-note">{rowSummary.note}</div>
              : <DiffSummaryBlock summary={rowSummary.summary!} />}
          </div>
        )}
      </div>
      </>}
      {restoreConfirm && (
        <div className="dialog-overlay" onClick={() => setRestoreConfirm(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Restore Snapshot</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>
                Restore to <strong>“{restoreConfirm.message}”</strong>?
                This will create a new snapshot with the restored content.
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setRestoreConfirm(null)}>Cancel</button>
              <button className="dialog-btn dialog-btn-primary" onClick={handleRestoreConfirm}>
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VersionHistory;
