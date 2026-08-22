import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FaRegImage, FaMusic, FaFilm, FaRegFileAlt, FaRegFile, FaRegFolder,
  FaUpload, FaDownload, FaRegTrashAlt, FaPen, FaTimes,
} from 'react-icons/fa';
import { useAssetStore } from '../stores/assetStore';
import type { Asset } from '../stores/assetStore';
import AssetViewer from './AssetViewer';
import { api } from '../services/api';
import { showToast } from './Toast';
import { confirmDialog, promptDialog } from './ConfirmDialog';
import { useAssetDisplayUrl } from '../utils/useAssetDisplayUrl';

interface AssetManagerProps {
  projectId: string;
  embedded?: boolean;
}

/** A file waiting for the Upload button. `preview` is an object URL for
 *  images and '' for everything else. */
interface StagedFile { file: File; preview: string }

const getMimeIcon = (mime: string): React.ReactNode => {
  if (mime.startsWith('image/')) return <FaRegImage />;
  if (mime.startsWith('audio/')) return <FaMusic />;
  if (mime.startsWith('video/')) return <FaFilm />;
  if (mime === 'application/pdf') return <FaRegFileAlt />;
  if (mime.startsWith('text/')) return <FaRegFile />;
  return <FaRegFolder />;
};

/** List thumbnail with the v6.33 self-healing source: direct URL first,
 *  bytes→blob on error, and an honest missing-file icon if both fail. */
const AssetThumb: React.FC<{ projectId: string; asset: Asset; onPreview: () => void }> = ({
  projectId, asset, onPreview,
}) => {
  const { url, missing, onError } = useAssetDisplayUrl(projectId, asset.id, asset.filename, asset.mime_type);
  if (missing) {
    return (
      <span className="asset-thumb-missing" title="Image file not found on disk. Re-upload this asset">
        {getMimeIcon(asset.mime_type)}
      </span>
    );
  }
  return (
    <img
      className="asset-thumb"
      src={url}
      alt=""
      loading="lazy"
      title="Click to preview"
      onClick={onPreview}
      onError={onError}
    />
  );
};

const AssetManager: React.FC<AssetManagerProps> = ({ projectId, embedded = false }) => {
  const { assets, setAssets, assetManagerOpen, setAssetManagerOpen } = useAssetStore();
  const [filterText, setFilterText] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [editTagsValue, setEditTagsValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [savingTagsId, setSavingTagsId] = useState<string | null>(null);
  // v7.27: picked/dropped files wait HERE until Upload is pressed.
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAssets = useCallback(async () => {
    try {
      const list = await api.listAssets(projectId);
      setAssets(list);
    } catch {
      // silently fail
    }
  }, [projectId, setAssets]);

  useEffect(() => {
    if (embedded || assetManagerOpen) {
      fetchAssets();
    }
  }, [embedded, assetManagerOpen, fetchAssets]);

  // Handle Tauri native drag-and-drop forwarded from ScreenplayEditor
  useEffect(() => {
    if (!embedded && !assetManagerOpen) return;
    const handler = async (e: Event) => {
      const paths = (e as CustomEvent).detail?.paths as string[] | undefined;
      if (!paths || paths.length === 0) return;
      try {
        /* v7.17: read through the Rust command. These paths come from a
           native drag-and-drop — anywhere on disk — and the fs plugin's scope
           is $APPDATA now. read_binary_file returns a byte array over IPC. */
        const { invoke } = await import('@tauri-apps/api/core');
        setUploading(true);
        const read: File[] = [];
        for (const filePath of paths) {
          const filename = filePath.replace(/^.*[\\/]/, '') || 'file';
          try {
            const data = new Uint8Array(await invoke<number[]>('read_binary_file', { path: filePath }));
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            const mimeMap: Record<string, string> = {
              png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
              webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
              mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
              txt: 'text/plain',
            };
            read.push(new File([data], filename, { type: mimeMap[ext] || 'application/octet-stream' }));
          } catch {
            showToast(`Could not read "${filename}"`, 'error');
          }
        }
        setUploading(false);
        /* v7.27: a NATIVE drop stages exactly like a picked or dropped file.
           It used to upload on the spot, which would have left two different
           answers to "what happens when I drop a file" depending on whether
           the drop came from the OS or the webview. */
        stageFiles(read);
      } catch {
        setUploading(false);
      }
    };
    window.addEventListener('tauri-asset-drop', handler);
    return () => window.removeEventListener('tauri-asset-drop', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, assetManagerOpen, projectId, fetchAssets]);

  /* v7.27, Derek: "When an item is picked in the browser or dropped in the
     upload field, it shouldn't immediately be added to the list. show the
     item, and at this point, the tags field appears. add a button 'Upload'
     which actually adds the item with the tags to the list."

     So picking STAGES. Nothing reaches the library until Upload is pressed,
     which also means the tags field is never a question asked before you have
     anything to answer it about — the "Tags for upload:" box sitting above an
     empty picker is what made it confusing. */
  const stageFiles = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setStaged((prev) => [
      ...prev,
      ...list.map((file) => ({
        file,
        // revoked in clearStaged / removeStaged — never on unmount, because
        // the window remounts on a move and the previews must survive it
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      })),
    ]);
  };

  const removeStaged = (i: number) => {
    setStaged((prev) => {
      const gone = prev[i];
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return prev.filter((_, k) => k !== i);
    });
  };

  const clearStaged = (list: StagedFile[]) => {
    list.forEach((s) => { if (s.preview) URL.revokeObjectURL(s.preview); });
    setStaged([]);
    setTagInput('');
  };

  /** The Upload button — this is the only path that adds to the library. */
  const commitStaged = async () => {
    if (!staged.length) return;
    const sending = staged;
    const tags = tagInput.trim() ? tagInput.trim().split(',').map((t) => t.trim()).filter(Boolean) : [];
    setUploading(true);
    let failed = 0;
    for (const s of sending) {
      try {
        await api.uploadAsset(projectId, s.file, tags);
      } catch (err) {
        failed++;
        showToast(`Failed to upload "${s.file.name}": ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      }
    }
    await fetchAssets();
    setUploading(false);
    const succeeded = sending.length - failed;
    // Only the ones that made it leave the staging area; a failure stays put
    // with its tags so Upload can be pressed again.
    if (!failed) clearStaged(sending);
    if (succeeded > 0) {
      showToast(`Uploaded ${succeeded} file${succeeded !== 1 ? 's' : ''} successfully`, 'success');
    }
  };

  const handleDelete = async (asset: Asset) => {
    /* v7.27, Derek: "add a warning window when deleting assets". Deleting an
       asset removes the file, and a script that placed it shows a broken
       image afterwards — there is no undo for this. confirmDialog is the
       app's one confirm primitive (never window.confirm — see its header). */
    const ok = await confirmDialog(
      `Delete “${asset.original_name}”? Any script using this file will lose it. This cannot be undone.`,
      { title: 'Delete asset', confirmLabel: 'Delete', danger: true },
    );
    if (!ok) return;
    setDeletingId(asset.id);
    try {
      await api.deleteAsset(projectId, asset.id);
      await fetchAssets();
      showToast('Asset deleted', 'success');
    } catch (err) {
      showToast(`Failed to delete asset: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  /* v7.27, Derek: "add a button to rename items". The DISPLAY name — the file
     on disk keeps its name, because that is what a placed image resolves
     through. promptDialog is the app's one prompt primitive. */
  const handleRename = async (asset: Asset) => {
    const next = await promptDialog('Rename asset', asset.original_name, { title: 'Rename asset' });
    const name = next?.trim();
    if (!name || name === asset.original_name) return;
    setRenamingId(asset.id);
    try {
      await api.renameAsset(projectId, asset.id, name);
      await fetchAssets();
      showToast('Asset renamed', 'success');
    } catch (err) {
      showToast(`Failed to rename asset: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setRenamingId(null);
    }
  };

  const handleDownload = (asset: Asset) => {
    const url = api.getAssetUrl(projectId, asset.id, asset.filename);
    const a = document.createElement('a');
    a.href = url;
    a.download = asset.original_name;
    a.click();
  };

  const handleSaveTags = async (assetId: string) => {
    const tags = editTagsValue.split(',').map((t) => t.trim()).filter(Boolean);
    setSavingTagsId(assetId);
    try {
      await api.updateAssetTags(projectId, assetId, tags);
      await fetchAssets();
      showToast('Tags updated', 'success');
    } catch (err) {
      showToast(`Failed to update tags: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setSavingTagsId(null);
      setEditingTagsId(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    stageFiles(e.dataTransfer.files);
  };

  // Collect all unique tags
  const allTags = Array.from(new Set(assets.flatMap((a) => a.tags))).sort();

  // Filter assets
  const filtered = assets.filter((a) => {
    const nameMatch = !filterText || a.original_name.toLowerCase().includes(filterText.toLowerCase());
    const tagMatch = !filterTag || a.tags.includes(filterTag);
    return nameMatch && tagMatch;
  });

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const content = (
    <div className="asset-manager-content">
      {/* \u2500\u2500 ADD (v7.27) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
          Derek: separate the upload section from the list section, and make
          picking a file stage it rather than file it. The section is its own
          bordered box so the two halves read as two halves. */}
      <section className="asset-add" aria-label="Add assets">
        <div className="asset-section-title">Add</div>
        <div
          className={`asset-upload-zone ${dragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { stageFiles(e.target.files); e.target.value = ''; }}
          />
          <div className="asset-upload-icon" style={uploading ? { opacity: 0.5 } : undefined}><FaUpload /></div>
          <div className="asset-upload-text">
            {uploading ? 'Uploading\u2026' : 'Drop files here or click to choose'}
          </div>
        </div>

        {/* The staged files, the tags for them, and the button that commits
            them. All three appear together and only once there is something
            to commit \u2014 the tags field asked its question before there was
            anything to answer it about, which is what made it confusing. */}
        {staged.length > 0 && (
          <div className="asset-staged">
            <div className="asset-staged-list">
              {staged.map((s, i) => (
                <span className="asset-staged-chip" key={`${s.file.name}-${i}`}>
                  {s.preview
                    ? <img className="asset-staged-thumb" src={s.preview} alt="" />
                    : <span className="asset-staged-icon">{getMimeIcon(s.file.type)}</span>}
                  <span className="asset-staged-name" title={s.file.name}>{s.file.name}</span>
                  <span className="asset-staged-size">{formatSize(s.file.size)}</span>
                  <button
                    className="asset-staged-x"
                    title="Remove from this upload"
                    onClick={() => removeStaged(i)}
                    disabled={uploading}
                  ><FaTimes /></button>
                </span>
              ))}
            </div>
            {/* v7.31, Derek: "shorten the tags field so it can be on the
                same row as cancel and Upload 1 file". One row — the label,
                the field taking what is left, then the two buttons. */}
            <div className="asset-staged-actions">
              <label htmlFor="asset-stage-tags" className="asset-stage-tags-label">
                Tags for {staged.length === 1 ? 'this file' : `these ${staged.length} files`}:
              </label>
              <input
                id="asset-stage-tags"
                type="text"
                placeholder={'tag1, tag2….'}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void commitStaged(); }}
                className="asset-tag-input"
                disabled={uploading}
              />
              <button className="dialog-btn" onClick={() => clearStaged(staged)} disabled={uploading}>
                Cancel
              </button>
              <button
                className="dialog-btn dialog-btn-primary asset-upload-btn"
                onClick={() => { void commitStaged(); }}
                disabled={uploading}
                title="Add these files to the list with the tags above"
              >
                {uploading ? 'Uploading\u2026' : `Upload ${staged.length} file${staged.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Filter bar */}
      <div className="asset-filter-bar">
        <input
          type="text"
          placeholder="Search by name..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="asset-filter-input"
        />
        <select
          value={filterTag}
          onChange={(e) => setFilterTag(e.target.value)}
          className="asset-filter-select"
        >
          <option value="">All Tags</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </div>

      {/* ── LIBRARY — the other half (v7.27) ─────────────────────────── */}
      <div className="asset-section-title asset-section-title-list">Library</div>
      <div className="asset-list">
        {filtered.length === 0 ? (
          <div className="asset-list-empty">
            {assets.length === 0 ? 'No assets yet. Upload files to get started.' : 'No assets match your filters.'}
          </div>
        ) : (
          <table className="asset-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Name</th>
                <th>Size</th>
                <th>Tags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((asset) => (
                <tr key={asset.id} className="asset-row">
                  <td className="asset-cell-icon">
                    {/* v6.30, Derek: images show a real THUMBNAIL in the list
                        (click = the same full preview as the name). Other
                        types keep their mime icon. */}
                    {asset.mime_type.startsWith('image/') ? (
                      <AssetThumb
                        projectId={projectId}
                        asset={asset}
                        onPreview={() => setPreviewAsset(asset)}
                      />
                    ) : (
                      <span title={asset.mime_type}>{getMimeIcon(asset.mime_type)}</span>
                    )}
                  </td>
                  <td
                    className="asset-cell-name"
                    onClick={() => setPreviewAsset(asset)}
                    title="Click to preview"
                  >
                    {asset.original_name}
                  </td>
                  <td className="asset-cell-size">{formatSize(asset.size_bytes)}</td>
                  <td className="asset-cell-tags">
                    {editingTagsId === asset.id ? (
                      <div className="asset-tags-edit">
                        <input
                          type="text"
                          value={editTagsValue}
                          onChange={(e) => setEditTagsValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveTags(asset.id);
                            if (e.key === 'Escape' && !savingTagsId) setEditingTagsId(null);
                          }}
                          className="asset-tags-edit-input"
                          disabled={savingTagsId === asset.id}
                          autoFocus
                        />
                        <button
                          className="asset-tags-save-btn"
                          onClick={() => handleSaveTags(asset.id)}
                          disabled={savingTagsId === asset.id}
                        >
                          {savingTagsId === asset.id ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    ) : (
                      <div
                        className="asset-tags-display"
                        onClick={() => {
                          setEditingTagsId(asset.id);
                          setEditTagsValue(asset.tags.join(', '));
                        }}
                        title="Click to edit tags"
                      >
                        {asset.tags.length > 0
                          ? asset.tags.map((t) => (
                              <span key={t} className="asset-tag-badge">#{t}</span>
                            ))
                          : <span className="asset-no-tags">no tags</span>
                        }
                      </div>
                    )}
                  </td>
                  <td className="asset-cell-actions">
                    <button
                      className="asset-action-btn"
                      onClick={() => handleDownload(asset)}
                      title="Download"
                      disabled={deletingId === asset.id}
                    >
                      <FaDownload />
                    </button>
                    <button
                      className="asset-action-btn"
                      onClick={() => { void handleRename(asset); }}
                      title="Rename"
                      disabled={deletingId === asset.id || renamingId === asset.id}
                    >
                      <FaPen />
                    </button>
                    <button
                      className="asset-action-btn asset-action-delete"
                      onClick={() => { void handleDelete(asset); }}
                      title="Delete"
                      disabled={deletingId === asset.id}
                    >
                      {deletingId === asset.id ? 'Deleting\u2026' : <FaRegTrashAlt />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Preview overlay */}
      {previewAsset && (
        <AssetViewer
          asset={previewAsset}
          projectId={projectId}
          onClose={() => setPreviewAsset(null)}
        />
      )}
    </div>
  );

  // If embedded (inside ProjectView), render without dialog overlay
  if (embedded) {
    return <div className="asset-manager embedded">{content}</div>;
  }

  // Otherwise render as dialog
  if (!assetManagerOpen) return null;

  return (
    <div className="dialog-overlay" onClick={() => setAssetManagerOpen(false)}>
      <div className="asset-manager dialog" onClick={(e) => e.stopPropagation()}>
        <div className="asset-manager-header">
          <span>Asset Manager</span>
          <button className="asset-manager-close" onClick={() => setAssetManagerOpen(false)}>
            &times;
          </button>
        </div>
        {content}
      </div>
    </div>
  );
};

export default AssetManager;
