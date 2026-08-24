// @vitest-environment jsdom
/**
 * Link-preview safety (v7.84, security review D4).
 *
 * The property under test is a security one: a beat description can arrive
 * inside an OPENED file, so the preview hook must NEVER reach the network on
 * its own — no fetch, and (because the hook no longer returns ready-to-render
 * previews) no remote og:image either. A preview is fetched only when the
 * writer clicks "Load preview". These tests pin the hook so a future change
 * that re-adds auto-fetch fails loudly.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useLinkPreviews, prettyHost } from './BeatBoard';
import { api } from '../services/api';
import type { BeatLinkPreview } from '../stores/editorStore';

let captured: ReturnType<typeof useLinkPreviews> | null = null;
function Probe({ description, existing }: { description: string; existing?: BeatLinkPreview[] }) {
  captured = useLinkPreviews(description, existing);
  return null;
}
function renderHook(description: string, existing?: BeatLinkPreview[]) {
  captured = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(<Probe description={description} existing={existing} />);
  });
  return captured!;
}

describe('useLinkPreviews — no network on open (D4)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not fetch a preview when a description with a URL is rendered', () => {
    const spy = vi.spyOn(api, 'fetchLinkPreview');
    renderHook('check this out https://evil.example.com/beacon?id=42');
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports the URLs in the description without touching them', () => {
    const spy = vi.spyOn(api, 'fetchLinkPreview');
    const r = renderHook('a https://a.example.com and b http://b.example.com');
    expect(r.urls).toEqual(['https://a.example.com', 'http://b.example.com']);
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces saved preview DATA for a URL still in the description, without fetching', () => {
    const spy = vi.spyOn(api, 'fetchLinkPreview');
    const saved: BeatLinkPreview[] = [
      { url: 'https://a.example.com', title: 'A', description: '', image: 'https://a/og.png', siteName: 'A' },
    ];
    const r = renderHook('see https://a.example.com', saved);
    expect(r.byUrl.get('https://a.example.com')?.title).toBe('A');
    expect(spy).not.toHaveBeenCalled();
  });

  it('drops saved previews whose URL is no longer in the description', () => {
    const saved: BeatLinkPreview[] = [
      { url: 'https://gone.example.com', title: 'Gone', description: '', image: '', siteName: '' },
    ];
    const r = renderHook('no links here', saved);
    expect(r.byUrl.size).toBe(0);
  });
});

describe('prettyHost', () => {
  it('strips scheme and www', () => {
    expect(prettyHost('https://www.example.com/a/b?c=1')).toBe('example.com');
    expect(prettyHost('http://sub.example.org')).toBe('sub.example.org');
  });
  it('falls back to the raw string for a non-URL', () => {
    expect(prettyHost('not a url')).toBe('not a url');
  });
});
