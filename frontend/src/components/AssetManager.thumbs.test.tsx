// @vitest-environment jsdom
/**
 * Asset list thumbnails (v6.30, Derek: "show a preview of the image in the
 * asset manager") — image assets render a real <img> thumbnail in the list
 * (same click-to-preview as the name); every other type keeps its mime icon.
 *
 * v6.33 ("the images are still broken"): the thumbnail is self-healing — if
 * the direct URL errors (the desktop asset:// protocol was 404ing), it
 * re-reads the bytes through the storage layer and serves a blob: URL; if
 * the bytes read fails too, an honest missing-file icon replaces the
 * eternal broken-image glyph.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import AssetManager from './AssetManager';
import { useAssetStore } from '../stores/assetStore';

const { IMG, PDF, getAssetBytes } = vi.hoisted(() => ({
  IMG: {
    id: 'a1', filename: 'still.png', original_name: 'still.png',
    mime_type: 'image/png', size_bytes: 1234, tags: [] as string[],
  },
  PDF: {
    id: 'a2', filename: 'notes.pdf', original_name: 'notes.pdf',
    mime_type: 'application/pdf', size_bytes: 5678, tags: [] as string[],
  },
  getAssetBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock('../services/api', () => ({
  api: {
    // the component re-fetches on mount — the MOCK must serve the fixtures,
    // or the fetch overwrites whatever the test seeded into the store.
    listAssets: vi.fn(async () => [IMG, PDF]),
    getAssetUrl: (p: string, id: string, f: string) => `http://test/assets/${p}/${id}/${f}`,
    getAssetBytes,
  },
}));

let host: HTMLElement | null = null;
beforeEach(() => {
  getAssetBytes.mockClear();
  getAssetBytes.mockImplementation(async () => new Uint8Array([1, 2, 3]));
  URL.createObjectURL = vi.fn(() => 'blob:test-fallback');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { host?.remove(); host = null; });

async function mount() {
  useAssetStore.setState({ assets: [] as never });
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host!).render(<AssetManager projectId="p1" embedded />);
  });
}

describe('AssetManager thumbnails', () => {
  it('images get an <img> thumbnail; other types keep the mime icon', async () => {
    await mount();
    const thumbs = host!.querySelectorAll('img.asset-thumb');
    expect(thumbs.length).toBe(1);
    expect((thumbs[0] as HTMLImageElement).src).toBe('http://test/assets/p1/a1/still.png');
    // the pdf row keeps an icon cell without a thumbnail
    const rows = host!.querySelectorAll('.asset-row');
    expect(rows.length).toBe(2);
    expect(rows[1].querySelector('img.asset-thumb')).toBeNull();
    expect(rows[1].querySelector('.asset-cell-icon span')).not.toBeNull();
  });

  it('a failing direct URL falls back to bytes → blob URL', async () => {
    await mount();
    const img = host!.querySelector('img.asset-thumb') as HTMLImageElement;
    await act(async () => { img.dispatchEvent(new Event('error')); });
    expect(getAssetBytes).toHaveBeenCalledWith('p1', 'a1');
    const after = host!.querySelector('img.asset-thumb') as HTMLImageElement;
    expect(after.src).toBe('blob:test-fallback');
  });

  it('when the bytes read fails too, the missing-file icon shows', async () => {
    getAssetBytes.mockImplementation(async () => { throw new Error('gone'); });
    await mount();
    const img = host!.querySelector('img.asset-thumb') as HTMLImageElement;
    await act(async () => { img.dispatchEvent(new Event('error')); });
    expect(host!.querySelector('img.asset-thumb')).toBeNull();
    const missing = host!.querySelector('.asset-thumb-missing');
    expect(missing).not.toBeNull();
    /* v7.76: Derek's own wording — the em dash became a full stop, so the
       "r" is a capital now. Matched case-insensitively rather than pinned to
       one spelling of a sentence he is free to keep editing. */
    expect(missing!.getAttribute('title')?.toLowerCase()).toContain('re-upload');
  });
});
