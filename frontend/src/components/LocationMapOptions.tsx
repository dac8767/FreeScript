/**
 * LocationMapOptions (v5.77) — the Map view's options menu.
 *
 * v5.81, Derek: it moved OUT of the header cluster and down beside + Add Pin,
 * with the word "Map Options" instead of an ellipsis icon, offering
 * Replace Map (from the device or the Asset Manager) · Rotate 90 degrees ·
 * Delete Map. Both are map-wide actions, so they sit together on one row —
 * and the header cluster stays the four shared controls (v5.80's rule).
 *
 * The file input lives here too: the same button both replaces the map and
 * imports the first one, so the picking machinery belongs with the menu that
 * offers it. Rotation is this menu's "Rotate 90 degrees" item, usable at any
 * time (v6.39 — the import-time Set Rotation pass is gone; the pins turn
 * with the map, so nothing drifts).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { createPortal } from 'react-dom';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useAssetStore } from '../stores/assetStore';
import { api } from '../services/api';
import { showToast } from './Toast';
import { confirmDialog } from './ConfirmDialog';
import { CharacterImagePickerDialog } from './CharacterImageOverlays';

/** Read a chosen file into the store as the map, project-asset or data-URL —
 *  the two-path rule every image in this app follows. Shared with the Map
 *  tab's own "Add Map" button so there is one importer, not two. */
export async function importLocationMap(file: File): Promise<boolean> {
  if (!file.type.startsWith('image/')) { showToast('Please choose an image file', 'error'); return false; }
  const store = useEditorStore.getState();
  try {
    const currentProject = useProjectStore.getState().currentProject;
    if (currentProject) {
      const asset = await api.uploadAsset(currentProject.id, file, ['location-map']);
      store.setLocationMapImage({
        assetId: asset.id, projectId: currentProject.id,
        filename: asset.filename ?? file.name, rotation: 0, rotationLocked: true,
      });
    } else {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      store.setLocationMapImage({ src: dataUrl, filename: file.name, rotation: 0, rotationLocked: true });
    }
    return true;
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Could not add the map', 'error');
    return false;
  }
}

/** v6.38, Derek: "move the button 'Map Options' into the header, and rename
 *  it 'Options'" — reversing v5.81, which had moved it out of the header.
 *  The header variant wears the header-control clothes; the menu is the
 *  same either way. */
export default function LocationMapOptions({ variant }: { variant?: 'header' } = {}) {
  const mapImage = useEditorStore((s) => s.locationMapImage);
  const setMapImage = useEditorStore((s) => s.setLocationMapImage);
  const currentProject = useProjectStore((s) => s.currentProject);
  const { assets, setAssets } = useAssetStore();
  const imageAssets = useMemo(() => assets.filter((a) => a.mime_type.startsWith('image/')), [assets]);

  const btnRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assetFilter, setAssetFilter] = useState('');
  /* Replace Map opens a SUB-list rather than a second floating layer — the
     same one-panel-at-a-time shape the pin dropdown uses. */
  const [sub, setSub] = useState<'replace' | null>(null);
  const rotateMap = useEditorStore((s) => s.rotateLocationMap);

  const open = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    setSub(null);
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 220)) });
  }, []);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importLocationMap(file);
  }, []);

  const openAssetPicker = useCallback(async () => {
    if (!currentProject) return;
    setAssetFilter('');
    setPickerOpen(true);
    try { setAssets(await api.listAssets(currentProject.id)); } catch { /* stale list still renders */ }
  }, [currentProject, setAssets]);

  const deleteMap = useCallback(async () => {
    if (!(await confirmDialog(
      'Delete the map? The pins and everything written on them are kept, and reappear if you add a map again.',
      { title: 'Delete Map', confirmLabel: 'Delete Map', danger: true },
    ))) return;
    setMapImage(null);
  }, [setMapImage]);

  const item = (label: string, onPick: () => void) => (
    <button className="char-upload-menu-item" onClick={() => { setPos(null); onPick(); }}>{label}</button>
  );

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
      <button
        ref={btnRef}
        className={variant === 'header'
          ? `tool-ctl locmap-mapopts-btn${pos ? ' open' : ''}`
          : `locmap-add-btn locmap-mapopts-btn${pos ? ' open' : ''}`}
        title="Replace, rotate or delete the map"
        onClick={() => (pos ? setPos(null) : open())}
        onPointerDown={variant === 'header' ? (e) => e.stopPropagation() : undefined}
      >{variant === 'header' ? <span className="tool-ctl-label">Options</span> : 'Options'}</button>
      {pos && createPortal(
        <>
          {/* A click anywhere else closes it — the menu is portalled to
              <body> because a panel clips absolutely-positioned children
              (the AddMenu lesson). */}
          <div className="locmap-menu-veil" onPointerDown={() => setPos(null)} />
          <div className="char-upload-menu locmap-mapopts-menu" style={{ top: pos.top, left: pos.left }}>
            {sub === 'replace' ? (
              <>
                <button className="char-upload-menu-item locmap-mapopts-back" onClick={() => setSub(null)}>
                  <FaChevronLeft /> Replace Map
                </button>
                {item('From local device…', () => fileRef.current?.click())}
                {/* Always offered, never silently missing: without a project
                    there is no asset library to pick from, so the item says
                    so instead of vanishing. */}
                <button
                  className="char-upload-menu-item"
                  disabled={!currentProject}
                  title={currentProject ? undefined : ''}
                  onClick={() => { setPos(null); void openAssetPicker(); }}
                >From Asset Manager…</button>
              </>
            ) : (
              <>
                <button className="char-upload-menu-item locmap-mapopts-more" onClick={() => setSub('replace')}>
                  {mapImage ? 'Replace Map' : 'Add Map'}<FaChevronRight />
                </button>
                {mapImage && item('Rotate 90 degrees', () => rotateMap())}
                {mapImage && item('Delete Map', () => { void deleteMap(); })}
              </>
            )}
          </div>
        </>,
        document.body,
      )}
      {pickerOpen && currentProject && (
        <CharacterImagePickerDialog
          forName="the Location Map"
          filter={assetFilter}
          setFilter={setAssetFilter}
          imageAssets={imageAssets}
          linkedImageIds={[]}
          projectId={currentProject.id}
          onAssociate={(assetId: string) => {
            const asset = imageAssets.find((a) => a.id === assetId);
            setMapImage({
              assetId, projectId: currentProject.id, filename: asset?.filename ?? null,
              rotation: 0, rotationLocked: true,
            });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
